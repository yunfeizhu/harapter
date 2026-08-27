import type {
  ProfileId,
  ProviderId,
  ProviderSessionId,
  RunId,
} from './identifiers.js';

/** Supported connection ownership and transport families. */
export type ConnectionKind = 'sdk' | 'process' | 'endpoint' | 'local_socket';

/** Reference resolved by a host-controlled secret store. */
export interface SecretRef {
  readonly scheme: string;
  readonly id: string;
}

/** Provider connection selected by a host Profile. */
export type ProviderConnection =
  | {
      kind: 'sdk';
      client?: unknown;
      factory?: unknown;
      ownership: 'host' | 'adapter';
    }
  | {
      kind: 'process';
      command: string;
      args?: readonly string[];
      cwd?: string;
      envRefs?: Readonly<Record<string, SecretRef>>;
      ownership: 'host' | 'adapter' | 'external';
    }
  | {
      kind: 'endpoint';
      url: string;
      transport?: 'http' | 'sse' | 'websocket' | 'acp';
      authRef?: SecretRef;
      ownership: 'host' | 'external';
    }
  | {
      kind: 'local_socket';
      path: string;
      transport: 'http' | 'jsonrpc' | 'acp';
      authRef?: SecretRef;
      ownership: 'host' | 'external';
    };

/** Host-owned selectable configuration for one Provider connection. */
export interface HarnessProfile {
  readonly profileId: ProfileId;
  readonly displayName: string;
  readonly providerId: ProviderId;
  readonly connection: ProviderConnection;
  readonly providerOptions?: Readonly<Record<string, unknown>>;
  readonly requiredCapabilities?: readonly CapabilityRequirement[];
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Static Adapter metadata used for dynamic discovery. */
export interface ProviderDescriptor {
  providerId: ProviderId;
  displayName: string;
  connectionKinds: readonly ConnectionKind[];
  documentationUrl?: string;
}

/** Factory implemented by one independently versioned Provider package. */
export interface ProviderAdapterFactory {
  descriptor(): ProviderDescriptor;
  connect(profile: HarnessProfile): Promise<HarnessClient>;
}

/** Runtime description of an active Profile connection. */
export interface ClientDescriptor {
  providerId: ProviderId;
  profileId: ProfileId;
  displayName: string;
  connectionKind: ConnectionKind;
  runtime?: {
    name?: string;
    version?: string;
    protocol?: string;
    protocolVersion?: string;
  };
  compatibility: 'supported' | 'experimental' | 'unsupported';
  warnings?: readonly CompatibilityWarning[];
}

/** Non-sensitive compatibility diagnostic. */
export interface CompatibilityWarning {
  code: string;
  message: string;
}

/** Capability implementation strength observed for the active connection. */
export type CapabilityMode =
  'native' | 'emulated' | 'adapter_controlled' | 'unsupported' | 'unknown';

/** Runtime evidence for one portable or Provider-namespaced capability. */
export interface CapabilityStatus {
  mode: CapabilityMode;
  reason?: string;
  limits?: Readonly<Record<string, number | string | boolean>>;
  source?: 'handshake' | 'schema' | 'version_profile' | 'configuration';
}

/** Capability observations for one active Profile connection. */
export interface CapabilityManifest {
  providerId: ProviderId;
  profileId: ProfileId;
  capabilities: Readonly<Record<string, CapabilityStatus>>;
  observedAt: string;
  runtimeIdentity?: string;
}

/** Host requirement checked before a Registry returns a connected Client. */
export interface CapabilityRequirement {
  readonly name: string;
  readonly acceptedModes?: readonly CapabilityMode[];
}

/** Options for refreshing or reusing capability observations. */
export interface CapabilityProbeOptions {
  refresh?: boolean;
}

/** Portable Client bound to one Provider and Profile. */
export interface HarnessClient {
  descriptor(): Promise<ClientDescriptor>;
  capabilities(options?: CapabilityProbeOptions): Promise<CapabilityManifest>;
  createSession(input?: CreateSessionInput): Promise<HarnessSession>;
  resumeSession(ref: SessionRef): Promise<HarnessSession>;
  extensions(): ProviderExtensionRegistry;
  native<T = unknown>(guard?: (value: unknown) => value is T): T | undefined;
  close(): Promise<void>;
}

/** Optional settings applied while creating a Provider session. */
export interface CreateSessionInput {
  workspace?: WorkspaceRef;
  systemContext?: string;
  model?: ModelSelection;
  providerOptions?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, string>>;
}

/** Portable Session bound to the Client that created it. */
export interface HarnessSession {
  ref(): SessionRef;
  capabilities(): Promise<CapabilityManifest>;
  start(input: HarnessInput, options?: RunOptions): Promise<HarnessRun>;
  respond(requestId: string, response: InteractionResponse): Promise<void>;
  close(): Promise<void>;
}

/** Persistable opaque reference that only its owning Adapter may interpret. */
export interface SessionRef {
  providerId: ProviderId;
  profileId: ProfileId;
  providerSessionId: ProviderSessionId;
  compatibilityRef?: string;
  providerState?: unknown;
}

/** One active execution on a Session. */
export interface HarnessRun {
  ref(): RunRef;
  events(): AsyncIterable<HarnessEvent>;
  cancel(): Promise<CancelResult>;
  result(): Promise<RunResult>;
}

/** Stable reference for one Client-scoped Run. */
export interface RunRef {
  providerId: ProviderId;
  profileId: ProfileId;
  sessionId: ProviderSessionId;
  runId: RunId;
  providerRunId?: string;
}

/** Portable run controls and Provider-local options. */
export interface RunOptions {
  timeoutMs?: number;
  providerOptions?: Readonly<Record<string, unknown>>;
  metadata?: Readonly<Record<string, string>>;
}

/** Observable result of a cancellation request. */
export interface CancelResult {
  mode: 'native' | 'emulated' | 'connection_aborted' | 'already_terminal';
}

/** Portable user input. */
export interface HarnessInput {
  parts: readonly InputPart[];
  metadata?: Readonly<Record<string, string>>;
}

/** One Provider-independent or explicit Provider-native input part. */
export type InputPart =
  | { type: 'text'; text: string }
  | { type: 'file_ref'; uri: string; mediaType?: string }
  | { type: 'image_ref'; uri: string; mediaType?: string }
  | { type: 'provider'; name: string; value: unknown };

/** URI reference to the workspace a Provider may use. */
export interface WorkspaceRef {
  uri: string;
}

/** Provider-owned model identifier plus Provider-local selection options. */
export interface ModelSelection {
  id: string;
  providerOptions?: Readonly<Record<string, unknown>>;
}

/** Stable portable event vocabulary. */
export type HarnessEventType =
  | 'run.started'
  | 'message.delta'
  | 'message.completed'
  | 'reasoning.delta'
  | 'reasoning.completed'
  | 'tool.started'
  | 'tool.updated'
  | 'tool.completed'
  | 'interaction.requested'
  | 'interaction.resolved'
  | 'artifact.created'
  | 'usage.updated'
  | 'run.completed'
  | 'run.cancelled'
  | 'run.failed'
  | 'connection.aborted'
  | 'provider';

/** One ordered event emitted by a Run. */
export interface HarnessEvent<T = unknown> {
  id: string;
  type: HarnessEventType;
  providerId: ProviderId;
  profileId: ProfileId;
  sessionId: ProviderSessionId;
  runId: RunId;
  sequence: number;
  timestamp: string;
  data: T;
  providerEventType?: string;
  raw?: unknown;
}

/** Portable interaction requested by a Provider. */
export interface InteractionRequest {
  requestId: string;
  kind: 'approval' | 'user_input' | 'provider';
  title?: string;
  prompt?: string;
  schema?: unknown;
  providerState?: unknown;
}

/** Host response to a pending interaction. */
export type InteractionResponse =
  | {
      kind: 'approval';
      decision: 'approve' | 'deny';
      providerOptions?: unknown;
    }
  | { kind: 'user_input'; parts: readonly InputPart[] }
  | { kind: 'provider'; value: unknown };

/** Token accounting when the Provider exposes it. */
export interface UsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Exactly one terminal outcome for a Run. */
export interface RunResult {
  status: 'completed' | 'cancelled' | 'failed' | 'connection_aborted';
  finalMessage?: string;
  usage?: UsageSummary;
  providerResult?: unknown;
}

/** Read-only Provider extension lookup. */
export interface ProviderExtensionRegistry {
  list(): readonly ProviderExtensionDescriptor[];
  has(name: string): boolean;
  get<T>(name: string, guard?: (value: unknown) => value is T): T | undefined;
}

/** Discoverable metadata for one typed Provider extension. */
export interface ProviderExtensionDescriptor {
  name: string;
  providerId: ProviderId;
  displayName: string;
  description?: string;
  documentationUrl?: string;
  stability?: 'stable' | 'experimental';
}
