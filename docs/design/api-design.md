[English](./api-design.md) · [简体中文](./api-design.zh-CN.md) ·
[日本語](./api-design.ja.md)

# Harapter portable API

## 1. Design principles

- The public API expresses only external semantics that remain stable across
  Harnesses.
- Sessions and Runs are first-class objects; a Harness is not reduced to one
  Completion request.
- Provider IDs and Profile IDs register dynamically and do not enter a Core
  enum.
- Capabilities determine callable behavior; Provider branding never implies
  support.
- Provider-specific behavior belongs in Extensions, Provider Options, or a
  Native Escape Hatch.
- Public types do not expose Graph State, Checkpoints, internal Tool objects, or
  SDK-native types.
- Every Event and Error retains Provider identity.
- Unsupported input and behavior fail explicitly before execution and are not
  silently discarded.

This document uses TypeScript-like pseudocode to express language-neutral
contracts. It does not constrain the implementation language of the first SDK.
It describes target design and may precede implementation. The current
implemented TypeScript API is defined by the
[`harapter` README](../../packages/core/README.md), package exports, source, and
tests. A signature or example here is not evidence that it is implemented or
that a Provider supports it.

## 2. Registry

```ts
interface HarnessRegistry {
  register(factory: ProviderAdapterFactory): void;
  unregister(providerId: string): void;
  listProviders(): ProviderDescriptor[];
  getProvider(providerId: string): ProviderDescriptor | undefined;

  connect(profile: HarnessProfile): Promise<HarnessClient>;
}

interface ProviderAdapterFactory {
  descriptor(): ProviderDescriptor;
  connect(profile: HarnessProfile): Promise<HarnessClient>;
}

interface ProviderDescriptor {
  providerId: string;
  displayName: string;
  connectionKinds: ConnectionKind[];
  documentationUrl?: string;
}
```

Before calling an Adapter, the Registry stores an isolated validation snapshot
of the Profile. After a Client connects, the Registry probes its Descriptor and
Capability Manifest whether or not the Profile declares `requiredCapabilities`.
It verifies the Client Descriptor's `providerId`, `profileId`, and
`connectionKind` against the requested Profile, and the Capability Manifest's
`providerId` and `profileId`. If probing fails or identity does not match, the
Registry closes the Client before returning a redacted portable Error.

Core contains no `switch (providerId)`. Provider packages register through
Factories, and adding a Provider does not require a new Core release.

## 3. Harness Profile

A Profile is one selectable connection configuration stored by the host:

```ts
interface HarnessProfile {
  profileId: string;
  displayName: string;
  providerId: string;
  connection: ProviderConnection;
  providerOptions?: Record<string, unknown>;
  requiredCapabilities?: CapabilityRequirement[];
  metadata?: Record<string, string>;
}
```

One Provider can have multiple Profiles. A Profile ID is stable within the host
and is not a Provider-native Session ID.

Configuration never stores a plaintext API key, token, cookie, or password. It
stores only a Secret Reference, which the host Secret Store resolves under
controlled conditions when establishing the connection.

## 4. Provider Connection

```ts
type ConnectionKind = 'sdk' | 'process' | 'endpoint' | 'local_socket';

type ProviderConnection =
  | {
      kind: 'sdk';
      client?: unknown;
      factory?: unknown;
      ownership: 'host' | 'adapter';
    }
  | {
      kind: 'process';
      command: string;
      args?: string[];
      cwd?: string;
      envRefs?: Record<string, SecretRef>;
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

interface SecretRef {
  scheme: string;
  id: string;
}
```

`ownership` describes lifecycle responsibility only. Terminating a process
started by an Adapter is connection cleanup; it does not mean the target Harness
implements semantically complete Run cancellation.

## 5. Client

```ts
interface HarnessClient {
  descriptor(): Promise<ClientDescriptor>;
  capabilities(options?: CapabilityProbeOptions): Promise<CapabilityManifest>;

  createSession(input?: CreateSessionInput): Promise<HarnessSession>;
  resumeSession(ref: SessionRef): Promise<HarnessSession>;

  extensions(): ProviderExtensionRegistry;
  native<T = unknown>(): T | undefined;

  close(): Promise<void>;
}

interface ClientDescriptor {
  providerId: string;
  profileId: string;
  displayName: string;
  connectionKind: ConnectionKind;
  runtime?: {
    name?: string;
    version?: string;
    protocol?: string;
    protocolVersion?: string;
  };
  compatibility: 'supported' | 'experimental' | 'unsupported';
  warnings?: CompatibilityWarning[];
}
```

`resumeSession` keeps one portable method shape. When a Provider does not
support resume, it returns `unsupported_capability` instead of imitating resume.

## 6. Capability Manifest

```ts
type CapabilityMode =
  'native' | 'emulated' | 'adapter_controlled' | 'unsupported' | 'unknown';

interface CapabilityStatus {
  mode: CapabilityMode;
  reason?: string;
  limits?: Record<string, number | string | boolean>;
  source?: 'handshake' | 'schema' | 'version_profile' | 'configuration';
}

interface CapabilityManifest {
  providerId: string;
  profileId: string;
  capabilities: Record<string, CapabilityStatus>;
  observedAt: string;
  runtimeIdentity?: string;
}

interface CapabilityRequirement {
  name: string;
  acceptedModes?: CapabilityMode[];
}
```

Portable Capabilities use a stable namespace:

```text
session.create
session.resume
session.fork
session.close
run.stream
run.cancel
connection.abort
input.text
input.image
input.file
event.reasoning
event.tool
event.artifact
event.usage
interaction.approval
interaction.user_input
native.client
event.raw
```

Semantic rules:

- `native` means an official machine interface directly provides equivalent
  behavior.
- `emulated` means the Adapter has verified an equivalent implementation of the
  portable semantics, without inheriting Provider-native state or lifecycle
  guarantees.
- `adapter_controlled` applies only to connection control or reliable mappings
  that the Adapter actually owns; it does not imitate native semantics.
- `unsupported` means the current Runtime version, configuration, or connection
  kind cannot implement the behavior reliably.
- `unknown` means the current connection recognizes the Capability name, but
  existing handshake, schema, version, or configuration evidence is insufficient
  to classify it.
- A missing Capability field means the Manifest does not recognize that name; it
  is not the same as an explicit `unknown`.
- When `CapabilityRequirement.acceptedModes` is missing, only `native` is
  accepted. The host must explicitly opt in to `emulated` or
  `adapter_controlled`.
- The UI displays features from Capabilities and does not hard-code them from
  `providerId`.
- Provider-specific behavior uses a Provider namespace such as `qwen.code.goal`.

## 7. Session

```ts
interface CreateSessionInput {
  workspace?: WorkspaceRef;
  systemContext?: string;
  model?: ModelSelection;
  providerOptions?: Record<string, unknown>;
  metadata?: Record<string, string>;
}

interface HarnessSession {
  ref(): SessionRef;
  capabilities(): Promise<CapabilityManifest>;

  start(input: HarnessInput, options?: RunOptions): Promise<HarnessRun>;
  respond(requestId: string, response: InteractionResponse): Promise<void>;

  close(): Promise<void>;
}

interface SessionRef {
  providerId: string;
  profileId: string;
  providerSessionId: string;
  compatibilityRef?: string;
  providerState?: unknown;
}
```

Before sending resume traffic, `resumeSession` validates both
`SessionRef.providerId` and `SessionRef.profileId` against the active Client.
Either mismatch returns `session_provider_mismatch`. When an Adapter writes
`compatibilityRef`, resume also verifies that it matches the current Runtime or
protocol fingerprint before sending Provider traffic. A missing or mismatched
value returns the same Error.

`providerState` is optional opaque state returned to the same Provider Adapter.
Core does not read it or pass it to another Provider. Before persistence, the
host applies serialization and redaction rules supplied by the Provider.

## 8. Run

```ts
interface HarnessRun {
  ref(): RunRef;
  events(): AsyncIterable<HarnessEvent>;
  cancel(): Promise<CancelResult>;
  result(): Promise<RunResult>;
}

interface RunRef {
  providerId: string;
  profileId: string;
  sessionId: string;
  runId: string;
  providerRunId?: string;
}

interface RunOptions {
  timeoutMs?: number;
  providerOptions?: Record<string, unknown>;
  metadata?: Record<string, string>;
}

interface CancelResult {
  mode: 'native' | 'emulated' | 'connection_aborted' | 'already_terminal';
}
```

The result of `cancel()` cannot be stronger than the `run.cancel` Capability.
Only `native` can return `native`, only `emulated` can return `emulated`, and
`adapter_controlled` reports only the `connection_aborted` outcome it actually
causes. When the Capability is missing, `unknown`, or `unsupported`, a
non-terminal Run returns `unsupported_capability`; any terminal Run may return
`already_terminal`. A host can also call `HarnessClient.close()` to abort a
connection owned by the Adapter, but the outcome maps to `connection.aborted`
and does not imitate Provider-confirmed cancellation.

## 9. Input

```ts
interface HarnessInput {
  parts: InputPart[];
  metadata?: Record<string, string>;
}

type InputPart =
  | { type: 'text'; text: string }
  | { type: 'file_ref'; uri: string; mediaType?: string }
  | { type: 'image_ref'; uri: string; mediaType?: string }
  | { type: 'provider'; name: string; value: unknown };

interface WorkspaceRef {
  uri: string;
}

interface ModelSelection {
  id: string;
  providerOptions?: Record<string, unknown>;
}
```

If a Provider does not support an `InputPart`, it returns
`unsupported_capability` or `invalid_request` before the Run starts. It does not
silently convert the part to inequivalent text.

## 10. Event

```ts
interface HarnessEvent<T = unknown> {
  id: string;
  type: HarnessEventType;
  providerId: string;
  profileId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  timestamp: string;
  data: T;
  providerEventType?: string;
  raw?: unknown;
}

type HarnessEventType =
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
```

Event rules:

- `sequence` increases monotonically within one Run.
- Every Run produces exactly one terminal state.
- Terminal states are `run.completed`, `run.cancelled`, `run.failed`, or
  `connection.aborted`.
- The terminal Event is the last Event, and the Run's one `RunResult` agrees
  with it.
- Provider activity arriving after termination cannot append Events or mutate
  the settled Result.
- When a Provider has no persistent Event cursor, Core does not promise replay
  after a disconnect.
- When a Provider does not expose Reasoning, the Adapter does not generate a
  false Reasoning Event.
- A message without a stable mapping remains observable as the `provider` type,
  retaining its `providerEventType` and a safe bounded summary. It is never
  interpreted as a successful or other authoritative terminal result.
- `raw` is disabled by default; when enabled, the Provider Adapter still bounds
  its size and structure, redacts it, and rate-limits it.

## 11. Interaction

```ts
interface InteractionRequest {
  requestId: string;
  kind: 'approval' | 'user_input' | 'provider';
  title?: string;
  prompt?: string;
  schema?: unknown;
  providerState?: unknown;
}

type InteractionResponse =
  | {
      kind: 'approval';
      decision: 'approve' | 'deny';
      providerOptions?: unknown;
    }
  | { kind: 'user_input'; parts: InputPart[] }
  | { kind: 'provider'; value: unknown };
```

An Adapter declares an Interaction Capability only when the Provider's official
interface allows an external Client to respond. A non-interactive CLI that
automatically allows tools does not support portable approval.

## 12. Result and errors

```ts
interface RunResult {
  status: 'completed' | 'cancelled' | 'failed' | 'connection_aborted';
  finalMessage?: string;
  usage?: UsageSummary;
  providerResult?: unknown;
}

interface HarnessError {
  code: HarnessErrorCode;
  message: string;
  retryable: boolean;
  providerId?: string;
  profileId?: string;
  providerCode?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

type HarnessErrorCode =
  | 'provider_not_found'
  | 'profile_invalid'
  | 'runtime_not_found'
  | 'connection_failed'
  | 'authentication_failed'
  | 'provider_api_incompatible'
  | 'unsupported_capability'
  | 'invalid_request'
  | 'session_not_found'
  | 'session_provider_mismatch'
  | 'run_conflict'
  | 'timeout'
  | 'provider_error'
  | 'connection_aborted';
```

A raw Provider Error may be retained in `cause`, but is not logged by the
product or displayed directly by default. Before attaching it, an Adapter
removes Secrets, authorization data, cookies, environment values, file bodies,
and other sensitive data.

## 13. Provider Extension and Native Client

```ts
interface ProviderExtensionRegistry {
  list(): ProviderExtensionDescriptor[];
  has(name: string): boolean;
  get<T>(name: string): T | undefined;
}

interface ProviderExtensionDescriptor {
  name: string;
  providerId: string;
  displayName: string;
  documentationUrl?: string;
}
```

Extensions use Provider namespaces, for example:

```text
deepseek.harness.plugins.marketplace
goose.recipes
qwen.code.goal
openai.codex.apps
github.copilot.commands
```

`native()` returns an official SDK Client or an official protocol Client.
Business code using an Extension or Native Client explicitly accepts Provider
binding; Core does not promise portability for that code.

## 14. Two-Provider example

```ts
registry.register(qwenAdapter());
registry.register(openCodeAdapter());

const qwen = await registry.connect({
  profileId: 'qwen-local',
  displayName: 'Qwen Code',
  providerId: 'qwen.code',
  connection: {
    kind: 'process',
    command: '/usr/local/bin/qwen',
    ownership: 'adapter',
  },
});

const openCode = await registry.connect({
  profileId: 'opencode-local',
  displayName: 'OpenCode',
  providerId: 'opencode',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:4096',
    transport: 'http',
    ownership: 'external',
  },
});

const client = selectedProfile === 'qwen-local' ? qwen : openCode;
const session = await client.createSession({
  workspace: { uri: 'file:///workspace/project' },
});
const run = await session.start({
  parts: [{ type: 'text', text: 'synthetic review task' }],
});

for await (const event of run.events()) {
  render(event);
}
```

The application knows a Provider only while connecting a Profile. Task
execution, Event rendering, and Error handling can use the portable contract;
code enters a corresponding Extension only when it needs a Qwen Goal or native
OpenCode behavior.

## 15. Concurrency and resource rules

- Different Clients and Sessions may run concurrently.
- Whether one Session allows concurrent Runs is declared by a Capability or
  Provider limit.
- An Adapter does not serialize a Provider that permits concurrency or force
  concurrency on a Provider that requires one active Run.
- `close()` is idempotent.
- Cancelling a terminal Run returns `already_terminal`.
- Core defines Event ordering and unique terminality. Adapters and transports
  define and verify slow-consumer behavior, backpressure, and Event buffer
  limits.
- Closing a Client or an unexpected Provider-process exit settles every affected
  non-terminal Run exactly once as `connection_aborted`; it cannot leave
  permanent running state, and late Provider activity cannot change the settled
  outcome.
