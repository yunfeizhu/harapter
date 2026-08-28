import { HarnessError } from '@harapter/core';
import { CLAUDE_PROVIDER_ID } from './protocol.js';

const officialSdkSpecifier = '@anthropic-ai/claude-agent-sdk';
const officialBindings = new WeakMap<
  ClaudeSdkBinding,
  Readonly<Pick<ClaudeSdkBinding, 'getSessionInfo' | 'query'>>
>();

/** Minimal permission result understood by the official SDK callback. */
export type ClaudeSdkPermissionResult =
  | {
      readonly behavior: 'allow';
      readonly decisionClassification?: 'user_temporary';
      readonly updatedInput: Readonly<Record<string, unknown>>;
    }
  | {
      readonly behavior: 'deny';
      readonly decisionClassification?: 'user_reject';
      readonly interrupt?: boolean;
      readonly message: string;
    };

/** Runtime callback options validated by the adapter before use. */
export interface ClaudeSdkPermissionOptions {
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly toolUseID: string;
  readonly [key: string]: unknown;
}

/** Supported official query options emitted by the adapter. */
export interface ClaudeSdkQueryOptions {
  readonly abortController: AbortController;
  readonly allowedTools?: readonly string[];
  readonly canUseTool: (
    toolName: string,
    input: Readonly<Record<string, unknown>>,
    options: ClaudeSdkPermissionOptions,
  ) => Promise<ClaudeSdkPermissionResult>;
  readonly cwd?: string;
  readonly includePartialMessages: true;
  readonly maxBudgetUsd?: number;
  readonly maxTurns?: number;
  readonly model?: string;
  readonly permissionMode: string;
  readonly resume?: string;
  readonly sessionId?: string;
  readonly settingSources: readonly [];
  readonly systemPrompt?: string;
}

/** Query parameters kept small and validated before crossing into the SDK. */
export interface ClaudeSdkQueryParameters {
  readonly options: ClaudeSdkQueryOptions;
  readonly prompt: AsyncIterable<Readonly<Record<string, unknown>>>;
}

/** Lifecycle surface used from an official streaming-input Query. */
export interface ClaudeSdkQuery extends AsyncIterable<unknown> {
  close(): void;
  interrupt(): Promise<unknown>;
}

/** Read-only Session information required for native resume validation. */
export interface ClaudeSdkSessionInfo {
  readonly cwd?: string;
  readonly sessionId: string;
}

/** Injectable boundary around the official SDK for deterministic testing. */
export interface ClaudeSdkBinding {
  readonly sdkVersion: string;
  getSessionInfo(
    sessionId: string,
    options?: { readonly dir?: string },
  ): Promise<unknown>;
  query(parameters: ClaudeSdkQueryParameters): ClaudeSdkQuery;
}

/** Provider-native official SDK functions exposed without entering Core. */
export interface ClaudeNativeClient {
  readonly runtimeIdentity: string;
  readonly binding: ClaudeSdkBinding;
  readonly official?: Readonly<
    Pick<ClaudeSdkBinding, 'getSessionInfo' | 'query'>
  >;
}

type ClaudeSdkModuleImporter = (specifier: string) => Promise<unknown>;

/** Dynamically load the optional host-owned peer without bundling it. */
export async function loadOfficialClaudeSdkBinding(
  importModule: ClaudeSdkModuleImporter = importProviderModule,
): Promise<ClaudeSdkBinding> {
  let imported: unknown;
  try {
    imported = await importModule(officialSdkSpecifier);
  } catch {
    throw sdkBoundaryError(
      'runtime_not_found',
      'The host-installed Claude Agent SDK peer could not be loaded.',
      'sdk_peer_missing',
    );
  }
  if (!isOfficialSdkModule(imported)) {
    throw sdkBoundaryError(
      'provider_api_incompatible',
      'The host-installed Claude Agent SDK does not expose the required public functions.',
      'sdk_peer_shape',
    );
  }

  const official = {
    getSessionInfo: (sessionId: string, options?: { readonly dir?: string }) =>
      Promise.resolve(imported.getSessionInfo(sessionId, options)),
    query: (parameters: ClaudeSdkQueryParameters) => {
      const query = imported.query(parameters);
      if (!isClaudeSdkQuery(query)) {
        throw sdkBoundaryError(
          'provider_api_incompatible',
          'The host-installed Claude Agent SDK returned an incompatible Query.',
          'sdk_query_shape',
        );
      }
      return query;
    },
  } satisfies Pick<ClaudeSdkBinding, 'getSessionInfo' | 'query'>;
  const binding: ClaudeSdkBinding = {
    sdkVersion: 'host-installed',
    ...official,
  };
  officialBindings.set(binding, official);
  return binding;
}

/** Construct the explicit native escape hatch for the installed SDK. */
export function createClaudeNativeClient(
  runtimeIdentity: string,
  binding: ClaudeSdkBinding,
): ClaudeNativeClient {
  const official = officialBindings.get(binding);
  return {
    runtimeIdentity,
    binding,
    ...(official === undefined ? {} : { official }),
  };
}

async function importProviderModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

function isOfficialSdkModule(value: unknown): value is {
  readonly getSessionInfo: (
    sessionId: string,
    options?: { readonly dir?: string },
  ) => unknown;
  readonly query: (parameters: ClaudeSdkQueryParameters) => unknown;
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    typeof candidate['getSessionInfo'] === 'function' &&
    typeof candidate['query'] === 'function'
  );
}

function isClaudeSdkQuery(value: unknown): value is ClaudeSdkQuery {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ClaudeSdkQuery>;
  return (
    typeof candidate[Symbol.asyncIterator] === 'function' &&
    typeof candidate.close === 'function' &&
    typeof candidate.interrupt === 'function'
  );
}

function sdkBoundaryError(
  code: 'provider_api_incompatible' | 'runtime_not_found',
  message: string,
  providerCode: string,
): HarnessError {
  return new HarnessError(code, message, {
    retryable: false,
    providerId: CLAUDE_PROVIDER_ID,
    providerCode,
  });
}

/** Narrow an unknown host-supplied SDK binding. */
export function isClaudeSdkBinding(value: unknown): value is ClaudeSdkBinding {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ClaudeSdkBinding>;
  return (
    typeof candidate.sdkVersion === 'string' &&
    candidate.sdkVersion.length > 0 &&
    candidate.sdkVersion.length <= 128 &&
    typeof candidate.getSessionInfo === 'function' &&
    typeof candidate.query === 'function'
  );
}

/** Validate the documented SessionInfo subset without trusting SDK types. */
export function parseClaudeSdkSessionInfo(
  value: unknown,
): ClaudeSdkSessionInfo | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    typeof candidate['sessionId'] !== 'string' ||
    candidate['sessionId'].length === 0 ||
    candidate['sessionId'].length > 4_096
  ) {
    return undefined;
  }
  if (
    candidate['cwd'] !== undefined &&
    (typeof candidate['cwd'] !== 'string' || candidate['cwd'].length > 4_096)
  ) {
    return undefined;
  }
  return {
    sessionId: candidate['sessionId'],
    ...(typeof candidate['cwd'] === 'string' ? { cwd: candidate['cwd'] } : {}),
  };
}
