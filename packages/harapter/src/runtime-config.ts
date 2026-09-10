import {
  HarnessError,
  type HarnessProfile,
  type ProfileId,
} from '@harapter/core';
import type { HarapterOptions } from './sdk.js';
import type { RuntimeOptions } from './run-types.js';
import type { HarnessRuntime } from './runtime-types.js';

/** Snapshot callbacks and identity before asynchronous imports; reject unsupported combinations. */
export function snapshotRuntimeBinding(
  request: RuntimeOptions,
): HarnessRuntime | undefined {
  if (request.runtime === undefined) return undefined;
  const runtime = readRuntime(request.runtime);
  if (runtime.kind === 'pi-sdk') {
    keys(runtime, ['kind', 'version', 'createSession']);
    if (
      request.harness !== 'pi' ||
      !validVersion(runtime.version) ||
      typeof runtime.createSession !== 'function'
    )
      throw invalid();
    conflicts(request, ['command', 'args', 'cwd', 'url', 'headers', 'model']);
    return {
      kind: runtime.kind,
      version: runtime.version,
      createSession: runtime.createSession.bind(runtime),
    };
  }
  if (runtime.kind === 'dsh-gateway') {
    keys(runtime, [
      'kind',
      'url',
      'protocol',
      'storeId',
      'exclusiveSessions',
      'resolveCookie',
      'requestTimeoutMs',
      'runTimeoutMs',
      'maxMessageBytes',
      'maxBufferedEvents',
      'maxRunEvents',
      'maxSessions',
    ]);
    if (
      request.harness !== 'dsh' ||
      typeof runtime.resolveCookie !== 'function'
    )
      throw invalid();
    conflicts(request, ['command', 'args', 'cwd', 'url', 'headers', 'model']);
    return { ...runtime, resolveCookie: runtime.resolveCookie.bind(runtime) };
  }
  {
    keys(runtime, ['kind', 'gateway']);
    if (
      request.harness !== 'openclaw' ||
      !validGateway(runtime.gateway) ||
      typeof runtime.gateway.profileId !== 'string' ||
      !runtime.gateway.profileId ||
      !Array.isArray(runtime.gateway.methods) ||
      !runtime.gateway.methods.every((method) => typeof method === 'string') ||
      typeof runtime.gateway.request !== 'function'
    )
      throw invalid();
    const gateway = runtime.gateway;
    return {
      kind: runtime.kind,
      gateway: {
        profileId: gateway.profileId,
        methods: [...gateway.methods],
        request: gateway.request.bind(gateway),
      },
    };
  }
}

/** Compose SDK/endpoint alternatives through the same registry as default connections. */
export function prepareRuntimeBinding(
  runtime: HarnessRuntime,
  profile: HarnessProfile,
  id: ProfileId,
):
  | {
      profile: HarnessProfile;
      sdk: HarapterOptions;
    }
  | undefined {
  if (runtime.kind === 'pi-sdk')
    return {
      profile: {
        ...profile,
        connection: {
          kind: 'sdk',
          ownership: 'adapter',
          factory: runtime.createSession,
        },
        providerOptions: { sdkVersion: runtime.version },
      },
      sdk: { harnesses: ['pi'] },
    };
  if (runtime.kind === 'dsh-gateway') {
    const {
      kind: _kind,
      url,
      resolveCookie: _resolveCookie,
      ...providerOptions
    } = runtime;
    return {
      profile: {
        ...profile,
        connection: {
          kind: 'endpoint',
          ownership: 'external',
          transport: 'websocket',
          url,
          authRef: { scheme: 'harapter.runtime', id },
        },
        providerOptions,
      },
      sdk: {
        harnesses: ['dsh'],
        resolveGatewayCookie: (ref, signal) => {
          if (ref.scheme !== 'harapter.runtime' || ref.id !== id)
            throw invalid();
          return runtime.resolveCookie(signal);
        },
      },
    };
  }
  return undefined;
}

function keys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalid();
}
function conflicts(
  value: RuntimeOptions,
  names: readonly (keyof RuntimeOptions)[],
): void {
  if (names.some((name) => value[name] !== undefined)) throw invalid();
}
function invalid(): HarnessError {
  return new HarnessError(
    'invalid_request',
    'The Runtime configuration is invalid or conflicts with its harness.',
    { retryable: false },
  );
}

function readRuntime(value: unknown): HarnessRuntime {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('kind' in value) ||
    !['pi-sdk', 'dsh-gateway', 'openclaw-acp'].includes(String(value.kind))
  )
    throw invalid();
  return value as HarnessRuntime;
}
function validVersion(value: unknown): boolean {
  return value === '0.85.1';
}
function validGateway(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}
