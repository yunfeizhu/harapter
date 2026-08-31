import type {
  JsonRpcDiagnostic,
  JsonRpcRequestOptions,
  JsonRpcStdioTransportOptions,
} from '@harapter/transport-jsonrpc-stdio';

/** Stable ACP wire protocol implemented by this package. */
export const ACP_PROTOCOL_VERSION = 1 as const;

/** ACP metadata extension container. Values remain untrusted. */
export type AcpMeta = Readonly<Record<string, unknown>> | null;

/** Client or Agent implementation identity returned by ACP negotiation. */
export interface AcpImplementation {
  readonly name: string;
  readonly version: string;
  readonly title?: string | null;
  readonly _meta?: AcpMeta;
}

/** Client capabilities advertised during initialization. */
export interface AcpClientCapabilities {
  readonly fs?: {
    readonly readTextFile?: boolean;
    readonly writeTextFile?: boolean;
    readonly _meta?: AcpMeta;
  };
  readonly terminal?: boolean;
  readonly auth?: {
    readonly terminal?: boolean;
    readonly _meta?: AcpMeta;
  };
  readonly _meta?: AcpMeta;
}

/** Normalized stable capabilities observed in an Agent initialize response. */
export interface AcpAgentCapabilities {
  readonly loadSession: boolean;
  readonly prompt: {
    readonly image: boolean;
    readonly audio: boolean;
    readonly embeddedContext: boolean;
  };
  readonly mcp: {
    readonly http: boolean;
    readonly sse: boolean;
  };
  readonly session: {
    readonly list: boolean;
    readonly delete: boolean;
    readonly additionalDirectories: boolean;
    readonly resume: boolean;
    readonly close: boolean;
  };
  readonly _meta?: AcpMeta;
}

/** Initialization values sent by the Harapter-side ACP client. */
export interface AcpInitializeInput {
  readonly clientCapabilities?: AcpClientCapabilities;
  readonly clientInfo?: AcpImplementation;
  readonly _meta?: AcpMeta;
}

/** Validated and normalized initialization result. */
export interface AcpInitializeResult {
  readonly protocolVersion: typeof ACP_PROTOCOL_VERSION;
  readonly capabilities: AcpAgentCapabilities;
  readonly agentInfo?: AcpImplementation;
  readonly authMethods: readonly unknown[];
  readonly _meta?: AcpMeta;
}

/** Environment entry for an ACP stdio MCP server. */
export interface AcpEnvVariable {
  readonly name: string;
  readonly value: string;
  readonly _meta?: AcpMeta;
}

/** Header entry for an ACP HTTP or SSE MCP server. */
export interface AcpHttpHeader {
  readonly name: string;
  readonly value: string;
  readonly _meta?: AcpMeta;
}

/** MCP connection declared when creating, loading, or resuming a Session. */
export type AcpMcpServer =
  | {
      readonly name: string;
      readonly command: string;
      readonly args: readonly string[];
      readonly env: readonly AcpEnvVariable[];
      readonly _meta?: AcpMeta;
    }
  | {
      readonly type: 'http' | 'sse';
      readonly name: string;
      readonly url: string;
      readonly headers: readonly AcpHttpHeader[];
      readonly _meta?: AcpMeta;
    };

interface AcpSessionConnectionInput {
  readonly cwd: string;
  readonly additionalDirectories?: readonly string[];
  readonly mcpServers?: readonly AcpMcpServer[];
  readonly _meta?: AcpMeta;
}

/** ACP session/new input. */
export interface AcpNewSessionInput extends AcpSessionConnectionInput {
  readonly mcpServers: readonly AcpMcpServer[];
}

/** ACP session/load input. */
export interface AcpLoadSessionInput extends AcpSessionConnectionInput {
  readonly sessionId: string;
  readonly mcpServers: readonly AcpMcpServer[];
}

/** ACP session/resume input. */
export interface AcpResumeSessionInput extends AcpSessionConnectionInput {
  readonly sessionId: string;
}

/** Shared optional Session state returned from setup operations. */
export interface AcpSessionState {
  readonly modes?: AcpSessionModeState | null;
  readonly configOptions?: readonly AcpSessionConfigOption[] | null;
  readonly _meta?: AcpMeta;
}

/** One stable ACP Session mode. */
export interface AcpSessionMode {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly _meta?: AcpMeta;
}

/** Available Session modes and the currently selected mode. */
export interface AcpSessionModeState {
  readonly currentModeId: string;
  readonly availableModes: readonly AcpSessionMode[];
  readonly _meta?: AcpMeta;
}

/** One selectable value for an ACP Session configuration option. */
export interface AcpSessionConfigSelectOption {
  readonly value: string;
  readonly name: string;
  readonly description?: string | null;
  readonly _meta?: AcpMeta;
}

/** One named group of ACP Session configuration values. */
export interface AcpSessionConfigSelectGroup {
  readonly group: string;
  readonly name: string;
  readonly options: readonly AcpSessionConfigSelectOption[];
  readonly _meta?: AcpMeta;
}

interface AcpSessionConfigBase {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly category?: string | null;
  readonly _meta?: AcpMeta;
}

/** Stable ACP Session configuration selector variants. */
export type AcpSessionConfigOption = AcpSessionConfigBase &
  (
    | {
        readonly type: 'select';
        readonly currentValue: string;
        readonly options:
          | readonly AcpSessionConfigSelectOption[]
          | readonly AcpSessionConfigSelectGroup[];
      }
    | { readonly type: 'boolean'; readonly currentValue: boolean }
  );

/** ACP session/new response. */
export interface AcpNewSessionResult extends AcpSessionState {
  readonly sessionId: string;
}

/** ACP session/list filter and cursor. */
export interface AcpListSessionsInput {
  readonly cwd?: string | null;
  readonly cursor?: string | null;
  readonly _meta?: AcpMeta;
}

/** One validated ACP session/list entry. */
export interface AcpSessionInfo {
  readonly sessionId: string;
  readonly cwd: string;
  readonly additionalDirectories?: readonly string[];
  readonly title?: string | null;
  readonly updatedAt?: string | null;
  readonly _meta?: AcpMeta;
}

/** Validated ACP session/list response. */
export interface AcpListSessionsResult {
  readonly sessions: readonly AcpSessionInfo[];
  readonly nextCursor?: string | null;
  readonly _meta?: AcpMeta;
}

/** Optional annotations on an ACP content block. */
export interface AcpAnnotations {
  readonly audience?: readonly ('assistant' | 'user')[] | null;
  readonly priority?: number | null;
  readonly lastModified?: string | null;
  readonly _meta?: AcpMeta;
}

interface AcpAnnotatedContent {
  readonly annotations?: AcpAnnotations | null;
  readonly _meta?: AcpMeta;
}

/** Stable ACP v1 content block variants. */
export type AcpContentBlock =
  | (AcpAnnotatedContent & { readonly type: 'text'; readonly text: string })
  | (AcpAnnotatedContent & {
      readonly type: 'image';
      readonly data: string;
      readonly mimeType: string;
      readonly uri?: string | null;
    })
  | (AcpAnnotatedContent & {
      readonly type: 'audio';
      readonly data: string;
      readonly mimeType: string;
    })
  | (AcpAnnotatedContent & {
      readonly type: 'resource_link';
      readonly name: string;
      readonly uri: string;
      readonly title?: string | null;
      readonly description?: string | null;
      readonly mimeType?: string | null;
      readonly size?: number | null;
    })
  | (AcpAnnotatedContent & {
      readonly type: 'resource';
      readonly resource:
        | {
            readonly uri: string;
            readonly text: string;
            readonly mimeType?: string | null;
            readonly _meta?: AcpMeta;
          }
        | {
            readonly uri: string;
            readonly blob: string;
            readonly mimeType?: string | null;
            readonly _meta?: AcpMeta;
          };
    });

/** ACP session/prompt input. */
export interface AcpPromptInput {
  readonly sessionId: string;
  readonly prompt: readonly AcpContentBlock[];
  readonly _meta?: AcpMeta;
}

/** Authoritative ACP v1 prompt terminal reason. */
export type AcpStopReason =
  'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

/** ACP session/prompt result. */
export interface AcpPromptResult {
  readonly stopReason: AcpStopReason;
  readonly _meta?: AcpMeta;
}

/** ACP tool category. */
export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

/** ACP tool lifecycle status. */
export type AcpToolCallStatus =
  'pending' | 'in_progress' | 'completed' | 'failed';

/** Stable content variants attached to an ACP tool call. */
export type AcpToolCallContent =
  | {
      readonly type: 'content';
      readonly content: AcpContentBlock;
      readonly _meta?: AcpMeta;
    }
  | {
      readonly type: 'diff';
      readonly path: string;
      readonly newText: string;
      readonly oldText?: string | null;
      readonly _meta?: AcpMeta;
    }
  | {
      readonly type: 'terminal';
      readonly terminalId: string;
      readonly _meta?: AcpMeta;
    };

/** File location associated with an ACP tool call. */
export interface AcpToolCallLocation {
  readonly path: string;
  readonly line?: number | null;
  readonly _meta?: AcpMeta;
}

/** Fields shared by tool creation and update events. */
export interface AcpToolCallUpdate {
  readonly toolCallId: string;
  readonly title?: string | null;
  readonly kind?: AcpToolKind | null;
  readonly status?: AcpToolCallStatus | null;
  readonly content?: readonly AcpToolCallContent[] | null;
  readonly locations?: readonly AcpToolCallLocation[] | null;
  readonly rawInput?: unknown;
  readonly rawOutput?: unknown;
  readonly _meta?: AcpMeta;
}

/** Permission option supplied by an ACP Agent. */
export interface AcpPermissionOption {
  readonly optionId: string;
  readonly name: string;
  readonly kind:
    'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  readonly _meta?: AcpMeta;
}

/** Validated session/request_permission request. */
export interface AcpPermissionRequest {
  readonly sessionId: string;
  readonly toolCall: AcpToolCallUpdate;
  readonly options: readonly AcpPermissionOption[];
  readonly _meta?: AcpMeta;
}

/** Host outcome returned to an ACP permission request. */
export type AcpPermissionOutcome =
  | { readonly outcome: 'cancelled'; readonly _meta?: AcpMeta }
  | {
      readonly outcome: 'selected';
      readonly optionId: string;
      readonly _meta?: AcpMeta;
    };

interface AcpContentChunk {
  readonly content: AcpContentBlock;
  readonly messageId?: string | null;
  readonly _meta?: AcpMeta;
}

/** One item in an ACP execution plan. */
export interface AcpPlanEntry {
  readonly content: string;
  readonly priority: 'high' | 'medium' | 'low';
  readonly status: 'pending' | 'in_progress' | 'completed';
  readonly _meta?: AcpMeta;
}

/** Optional unstructured input hint for an ACP command. */
export interface AcpAvailableCommandInput {
  readonly hint: string;
  readonly _meta?: AcpMeta;
}

/** One command currently exposed by an ACP Agent. */
export interface AcpAvailableCommand {
  readonly name: string;
  readonly description: string;
  readonly input?: AcpAvailableCommandInput | null;
  readonly _meta?: AcpMeta;
}

/** Validated ACP v1 session/update variants consumed by Provider Adapters. */
export type AcpSessionUpdate =
  | (AcpContentChunk & {
      readonly sessionUpdate:
        'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk';
    })
  | (AcpToolCallUpdate & {
      readonly sessionUpdate: 'tool_call';
      readonly title: string;
    })
  | (AcpToolCallUpdate & { readonly sessionUpdate: 'tool_call_update' })
  | {
      readonly sessionUpdate: 'plan';
      readonly entries: readonly AcpPlanEntry[];
      readonly _meta?: AcpMeta;
    }
  | {
      readonly sessionUpdate: 'available_commands_update';
      readonly availableCommands: readonly AcpAvailableCommand[];
      readonly _meta?: AcpMeta;
    }
  | {
      readonly sessionUpdate: 'current_mode_update';
      readonly currentModeId: string;
      readonly _meta?: AcpMeta;
    }
  | {
      readonly sessionUpdate: 'config_option_update';
      readonly configOptions: readonly AcpSessionConfigOption[];
      readonly _meta?: AcpMeta;
    }
  | {
      readonly sessionUpdate: 'session_info_update';
      readonly title?: string | null;
      readonly updatedAt?: string | null;
      readonly _meta?: AcpMeta;
    }
  | {
      readonly sessionUpdate: 'usage_update';
      readonly used: number;
      readonly size: number;
      readonly cost?: {
        readonly amount: number;
        readonly currency: string;
        readonly _meta?: AcpMeta;
      } | null;
      readonly _meta?: AcpMeta;
    };

/** Bounded structural observation for an unknown or future ACP message. */
export interface AcpRawObservation {
  readonly kind:
    'unknown_notification' | 'unknown_request' | 'unknown_session_update';
  readonly method: string;
  readonly params: unknown;
}

/** Ordered inbound event emitted by the ACP client. */
export type AcpEvent =
  | {
      readonly kind: 'session_update';
      readonly sessionId: string;
      readonly update: AcpSessionUpdate;
    }
  | { readonly kind: 'unknown'; readonly observation: AcpRawObservation };

/** Runtime hooks for baseline bidirectional ACP behavior. */
export interface AcpClientHandlers {
  readonly requestPermission?: (
    request: AcpPermissionRequest,
  ) => Promise<AcpPermissionOutcome> | AcpPermissionOutcome;
  readonly extensionRequest?: (method: string, params: unknown) => unknown;
  readonly extensionNotification?: (method: string, params: unknown) => unknown;
}

/** Construction options for one Provider-neutral ACP stream connection. */
export interface AcpClientOptions
  extends
    Omit<
      JsonRpcStdioTransportOptions,
      | 'emitJsonRpcVersion'
      | 'requireIntegerNumericIds'
      | 'requireJsonRpcVersion'
    >,
    AcpClientHandlers {
  readonly maxBufferedEvents?: number;
}

/** Request-local timeout and wait-abort controls; neither sends cancellation. */
export type AcpRequestOptions = JsonRpcRequestOptions;

/** Transport diagnostic callback type re-exported for ACP callers. */
export type AcpTransportDiagnostic = JsonRpcDiagnostic;
