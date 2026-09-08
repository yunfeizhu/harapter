import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createSessionWorkflowSetups,
  type SessionProviderConfiguration,
} from './session-providers.js';
import { runSessionWorkflow } from './session-workflow.js';
import type { HostInteractionHandler } from './interactions.js';

/** Run an explicitly trusted host configuration, one Provider at a time. */
export async function runConfiguredSessionWorkflows(
  config: SessionProviderConfiguration,
  write: (line: string) => void | Promise<void>,
  onInteraction?: HostInteractionHandler,
): Promise<void> {
  const setups = createSessionWorkflowSetups(config);
  for (const [index, setup] of setups.entries()) {
    await runSessionWorkflow({
      setup: {
        ...setup,
        ...(onInteraction === undefined ? {} : { onInteraction }),
      },
      write: (record) =>
        write(JSON.stringify({ provider: index + 1, ...record })),
    });
  }
}

if (isDirectExecution()) {
  const configPath = process.argv[2];
  if (
    process.argv.length !== 3 ||
    configPath === undefined ||
    !isAbsolute(configPath)
  ) {
    process.stderr.write(
      'Usage: node dist/session-main.js /absolute/trusted-config.mjs\n',
    );
    process.exitCode = 1;
  } else {
    let dispose: (() => unknown) | undefined;
    try {
      // This file is host code, not untrusted input. Never discover configs automatically.
      const loaded: unknown = await import(pathToFileURL(configPath).href);
      if (hasDisposer(loaded)) dispose = () => loaded.dispose();
      if (!isConfigurationModule(loaded))
        throw new Error('Invalid configuration.');
      await runConfiguredSessionWorkflows(
        loaded.default,
        (line) => {
          process.stdout.write(`${line}\n`);
        },
        interactionHandler(loaded),
      );
    } catch {
      // Import, process, network and credential failures can contain private data.
      process.stderr.write(
        'Session workflow failed. Check the trusted host configuration and runtime requirements.\n',
      );
      process.exitCode = 1;
    } finally {
      try {
        await dispose?.();
      } catch {
        process.stderr.write('Host resource cleanup failed.\n');
        process.exitCode = 1;
      }
    }
  }
}

function interactionHandler(value: object): HostInteractionHandler | undefined {
  if (!('onInteraction' in value) || value.onInteraction === undefined)
    return undefined;
  if (typeof value.onInteraction !== 'function')
    throw new Error('Invalid host interaction handler.');
  // An explicitly trusted module implements the documented typed callback.
  return value.onInteraction as HostInteractionHandler;
}

function isConfigurationModule(
  value: unknown,
): value is { default: SessionProviderConfiguration } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'default' in value &&
    typeof value.default === 'object' &&
    value.default !== null
  );
}

function hasDisposer(value: unknown): value is { dispose: () => unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dispose' in value &&
    typeof value.dispose === 'function'
  );
}

function isDirectExecution(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    // Works throughout Node 24, including symlinks and macOS temporary aliases.
    return (
      realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}
