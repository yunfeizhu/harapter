import {
  getSessionInfo as officialGetSessionInfo,
  query as officialQuery,
  type Options as OfficialOptions,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

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
  readonly official?: {
    readonly getSessionInfo: typeof officialGetSessionInfo;
    readonly query: typeof officialQuery;
  };
}

/** Official installed SDK boundary used when the host does not inject one. */
export const officialClaudeSdkBinding: ClaudeSdkBinding = {
  sdkVersion: '0.3.x',
  getSessionInfo: async (sessionId, options) =>
    officialGetSessionInfo(sessionId, options),
  query: (parameters) =>
    officialQuery({
      prompt: parameters.prompt as AsyncIterable<SDKUserMessage>,
      options: parameters.options as unknown as OfficialOptions,
    }),
};

/** Construct the explicit native escape hatch for the installed SDK. */
export function createClaudeNativeClient(
  runtimeIdentity: string,
  binding: ClaudeSdkBinding,
): ClaudeNativeClient {
  return {
    runtimeIdentity,
    binding,
    ...(binding === officialClaudeSdkBinding
      ? {
          official: {
            getSessionInfo: officialGetSessionInfo,
            query: officialQuery,
          },
        }
      : {}),
  };
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
