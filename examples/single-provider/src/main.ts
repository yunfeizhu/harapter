import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CODEX_PROVIDER_ID,
  createCodexProviderFactory,
} from '@harapter/adapter-codex';
import { profileId, type RunResult } from '@harapter/core';
import {
  runSingleProviderExample,
  type SingleProviderExampleOptions,
  type SingleProviderExampleRecord,
} from './index.js';

interface CodexReferenceDependencies {
  readonly createTemporaryWorkspace: () => Promise<string>;
  readonly removeTemporaryWorkspace: (path: string) => Promise<void>;
  readonly runExample: (
    options: SingleProviderExampleOptions,
  ) => Promise<RunResult['status']>;
}

const defaultDependencies: CodexReferenceDependencies = {
  createTemporaryWorkspace: () =>
    mkdtemp(join(tmpdir(), 'harapter-codex-example-')),
  removeTemporaryWorkspace: (path) =>
    rm(path, { force: true, recursive: true }),
  runExample: runSingleProviderExample,
};

if (isDirectExecution()) {
  const command = process.env['HARAPTER_CODEX_COMMAND'];
  if (command === undefined) {
    writeError('missing_runtime_command');
    process.exitCode = 1;
  } else {
    try {
      const status = await runCodexReference(command, writeRecord);
      if (status !== 'completed') process.exitCode = 1;
    } catch {
      writeError('example_failed');
      process.exitCode = 1;
    }
  }
}

/**
 * Compose the portable example with a bounded Codex runtime configuration.
 * @param command - Host-selected Codex executable.
 * @param write - Safe portable record sink.
 * @param dependencies - Test seams for execution and temporary workspace I/O.
 * @returns The authoritative portable terminal status.
 */
export async function runCodexReference(
  command: string,
  write: (record: SingleProviderExampleRecord) => void | Promise<void>,
  dependencies: CodexReferenceDependencies = defaultDependencies,
): Promise<RunResult['status']> {
  const workspace = await dependencies.createTemporaryWorkspace();
  let status: RunResult['status'] | undefined;
  let operationError: Error | undefined;

  try {
    status = await dependencies.runExample({
      factory: createCodexProviderFactory(),
      profile: {
        profileId: profileId('codex-reference'),
        providerId: CODEX_PROVIDER_ID,
        displayName: 'Codex reference runtime',
        connection: {
          kind: 'process',
          command,
          args: ['app-server', '--stdio'],
          cwd: workspace,
          ownership: 'adapter',
        },
      },
      sessionInput: {
        workspace: { uri: pathToFileURL(workspace).href },
        providerOptions: {
          approvalPolicy: 'never',
          ephemeral: true,
          sandbox: 'read-only',
        },
      },
      input: {
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_EXAMPLE_OK. Do not use tools or inspect files.',
          },
        ],
      },
      runOptions: { timeoutMs: 60_000 },
      write,
    });
  } catch (error) {
    operationError = asError(error);
  }

  let cleanupError: Error | undefined;
  try {
    await dependencies.removeTemporaryWorkspace(workspace);
  } catch (error) {
    cleanupError = asError(error);
  }

  if (operationError !== undefined) throw operationError;
  if (cleanupError !== undefined) throw cleanupError;
  if (status === undefined)
    throw new Error('Codex reference run did not settle.');
  return status;
}

function writeRecord(record: unknown): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function writeError(code: string): void {
  process.stderr.write(`${JSON.stringify({ type: 'error', code })}\n`);
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    import.meta.url === pathToFileURL(entrypoint).href
  );
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error('Codex reference operation failed.');
}
