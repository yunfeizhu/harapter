import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  HarnessError,
  profileId,
  providerId,
  type CreateSessionInput,
  type HarnessProfile,
} from '@harapter/core';
import type { HarapterOptions, HarnessName } from './sdk.js';
import type { RunRequest, RuntimeOptions } from './run-types.js';
import {
  prepareRuntimeBinding,
  snapshotRuntimeBinding,
} from './runtime-config.js';

const presets = {
  codex: {
    id: 'openai.codex',
    command: 'codex',
    args: ['app-server', '--stdio'],
  },
  dsh: { id: 'deepseek.harness', command: 'dsh', args: ['--profile', 'sdk'] },
  pi: { id: 'pi.agent', command: 'pi', args: [] },
  openclaw: { id: 'openclaw', command: 'openclaw', args: ['acp'] },
  opencode: { id: 'opencode', url: 'http://127.0.0.1:4096' },
  hermes: { id: 'nous.hermes-agent', url: 'http://127.0.0.1:8642' },
} satisfies Record<
  HarnessName,
  { id: string; command: string; args: string[] } | { id: string; url: string }
>;

const fields = new Set([
  'harness',
  'input',
  'cwd',
  'model',
  'command',
  'args',
  'url',
  'headers',
  'timeoutMs',
  'onEvent',
  'runtime',
]);

/** Snapshot and validate public configuration before any asynchronous work or credential use. */
export function snapshotRun(
  value: RunRequest,
): RunRequest & { readonly timeoutMs: number } {
  if (!record(value) || typeof value.input !== 'string' || !value.input.trim())
    throw invalid('run.input must be non-empty text.');
  return {
    ...snapshotOptions(value, true),
    input: value.input,
    ...(value.onEvent === undefined ? {} : { onEvent: value.onEvent }),
  };
}

/** Snapshot connection options for a reusable Session, without manufacturing a prompt. */
export function snapshotRuntimeOptions(
  value: RuntimeOptions,
): RuntimeOptions & { readonly timeoutMs: number } {
  return snapshotOptions(value, false);
}

function snapshotOptions(
  value: RuntimeOptions,
  allowRun: boolean,
): RuntimeOptions & { readonly timeoutMs: number } {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) =>
        !fields.has(key) || (!allowRun && ['input', 'onEvent'].includes(key)),
    ) ||
    typeof value.harness !== 'string' ||
    !Object.hasOwn(presets, value.harness)
  )
    throw invalid('Select a supported harness and run options.');
  for (const field of ['cwd', 'command', 'url'] as const)
    if (value[field] !== undefined && !nonEmpty(value[field]))
      throw invalid(
        `run.${field} must be a non-empty string without NUL characters.`,
      );
  if (
    'onEvent' in value &&
    value['onEvent'] !== undefined &&
    typeof value['onEvent'] !== 'function'
  )
    throw invalid('run.onEvent must be a function.');
  if (value.args !== undefined && !stringArray(value.args))
    throw invalid(
      'run.args must be an array of strings without NUL characters.',
    );
  if (
    value.model !== undefined &&
    (!record(value.model) ||
      Object.keys(value.model).some(
        (key) => key !== 'id' && key !== 'provider',
      ) ||
      !nonEmpty(value.model.id) ||
      (value.model.provider !== undefined && !nonEmpty(value.model.provider)))
  )
    throw invalid('run.model requires an id and an optional provider.');
  if (
    value.headers !== undefined &&
    (!record(value.headers) ||
      Object.values(value.headers).some((header) => typeof header !== 'string'))
  )
    throw invalid('run.headers must contain string values.');
  const timeoutMs = value.timeoutMs ?? 60_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  )
    throw invalid('run.timeoutMs must be a positive bounded integer.');
  const runtime = snapshotRuntimeBinding(value);
  return {
    ...value,
    timeoutMs,
    ...(runtime === undefined ? {} : { runtime }),
    ...(value.args === undefined ? {} : { args: [...value.args] }),
    ...(value.model === undefined ? {} : { model: { ...value.model } }),
    ...(value.headers === undefined ? {} : { headers: { ...value.headers } }),
  };
}

/** Build one private Profile from an explicit harness and documented machine-interface defaults. */
export async function prepareRun(
  request: RuntimeOptions | RunRequest,
): Promise<{
  profile: HarnessProfile;
  session: CreateSessionInput;
  sdk: HarapterOptions;
}> {
  const preset = presets[request.harness];
  const id =
    request.runtime?.kind === 'openclaw-acp'
      ? request.runtime.gateway.profileId
      : profileId(`run-${randomUUID()}`);
  const profile = {
    profileId: id,
    providerId: providerId(preset.id),
    displayName: 'Harapter run',
  };
  const session: CreateSessionInput = {};
  if (request.runtime !== undefined) {
    const alternative = prepareRuntimeBinding(
      request.runtime,
      { ...profile, connection: { kind: 'sdk', ownership: 'adapter' } },
      id,
    );
    if (alternative !== undefined) return { ...alternative, session };
  }
  const model = request.model;
  if (model !== undefined) {
    if (request.harness === 'pi' || request.harness === 'openclaw')
      throw unsupported(
        'This harness uses its Runtime model configuration; run.model is unsupported.',
      );
    if (request.harness === 'codex' && model.provider !== undefined)
      throw unsupported(
        'Codex model provider selection belongs to its Runtime configuration.',
      );
    if (request.harness === 'opencode' && model.provider === undefined)
      throw invalid('OpenCode run.model requires both id and provider.');
    if (request.harness !== 'dsh') {
      session.model = {
        id: model.id,
        ...(model.provider === undefined
          ? {}
          : {
              providerOptions: {
                [request.harness === 'opencode' ? 'providerId' : 'provider']:
                  model.provider,
              },
            }),
      };
    }
  }
  if ('command' in preset) {
    if (request.url !== undefined || request.headers !== undefined)
      throw invalid(
        'Local harnesses accept command and args, not HTTP connection options.',
      );
    if (request.harness === 'dsh' && model?.provider === undefined)
      throw invalid(
        'DSH run.model requires both id and provider for its SDK handshake.',
      );
    const cwd = resolve(request.cwd ?? process.cwd());
    const command = await resolveCommand(
      request.command ?? preset.command,
      cwd,
    );
    return {
      profile: {
        ...profile,
        connection: {
          kind: 'process',
          command,
          args: request.args ?? [...preset.args],
          cwd,
          ownership: 'adapter',
        },
        ...(request.harness === 'dsh' && model !== undefined
          ? {
              providerOptions: { provider: model.provider, model: model.id },
            }
          : {}),
      },
      session,
      sdk: {
        harnesses: [request.harness],
        ...(request.runtime?.kind === 'openclaw-acp'
          ? { openClawGateway: request.runtime.gateway }
          : {}),
      },
    };
  }
  if (request.command !== undefined || request.args !== undefined)
    throw invalid(
      'HTTP harnesses accept url and headers, not process connection options.',
    );
  if (request.cwd !== undefined) {
    if (request.harness === 'hermes')
      throw unsupported(
        'Hermes uses the server workspace; run.cwd is unsupported.',
      );
    if (!isAbsolute(request.cwd))
      throw invalid('An HTTP Runtime needs an absolute server-side cwd.');
    session.workspace = { uri: pathToFileURL(request.cwd).href };
  }
  const headers = request.headers;
  const authRef = { scheme: 'harapter.run', id };
  return {
    profile: {
      ...profile,
      connection: {
        kind: 'endpoint',
        url: request.url ?? preset.url,
        transport: 'http',
        ownership: 'external',
        ...(headers === undefined ? {} : { authRef }),
      },
    },
    session,
    sdk: {
      harnesses: [request.harness],
      ...(headers === undefined
        ? {}
        : {
            resolveAuthHeaders: (ref) => {
              if (ref.scheme !== authRef.scheme || ref.id !== authRef.id)
                throw invalid('Unknown run authentication reference.');
              return headers;
            },
          }),
    },
  };
}

async function resolveCommand(command: string, cwd: string): Promise<string> {
  // Bare executable names use explicit absolute PATH entries, never shell lookup or implicit cwd search.
  const candidates =
    isAbsolute(command) || command.includes('/') || command.includes('\\')
      ? [resolve(cwd, command)]
      : (process.env['PATH'] ?? '')
          .split(delimiter)
          .filter(isAbsolute)
          .map((path) => resolve(path, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* Continue searching without exposing filesystem diagnostics. */
    }
  }
  throw new HarnessError(
    'runtime_not_found',
    'Install the selected Runtime on PATH or supply run.command.',
    { retryable: false },
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !value.includes('\0')
  );
}
function invalid(message: string): HarnessError {
  return new HarnessError('invalid_request', message, { retryable: false });
}
function unsupported(message: string): HarnessError {
  return new HarnessError('unsupported_capability', message, {
    retryable: false,
  });
}

function stringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) => typeof item === 'string' && !item.includes('\0'),
    )
  );
}
