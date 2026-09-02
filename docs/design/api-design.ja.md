[English](./api-design.md) · [简体中文](./api-design.zh-CN.md) ·
[日本語](./api-design.ja.md)

# Harapter Portable API

## 1. 設計原則

- Public API は、Harness 間で安定して解釈できる外部 Semantics だけを表す
- Session と Run を First-class Object とし、Harness を 1 回の Completion
  Request に単純化しない
- Provider ID と Profile ID は Dynamic Registration し、Core の Enum に含めない
- 呼び出せる動作は Capability で決まり、Provider Brand から推測しない
- Provider 固有動作は Extension、Provider Options、Native Escape Hatch に含める
- Public Type は Graph State、Checkpoint、Tool の内部 Object、SDK-native
  Type を公開しない
- すべての Event と Error が Provider Identity を保持する
- Unsupported Input と Capability は実行前に明示的に失敗し、暗黙的に破棄しない

この文書では、Language-neutral
Contract を TypeScript に近い Pseudocode で表します。最初の SDK の実装言語を限定するものではありません。これは Target
Design であり、実装に先行する場合があります。現在実装済みの TypeScript API は
[`@harapter/core` README](../../packages/core/README.md)、Package
Export、Source、Test によって定義されます。この文書の Signature や Example は、実装済みであることや Provider がサポートすることの証拠ではありません。

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

Registry は Adapter を呼び出す前に、隔離された Profile Validation
Snapshot を保存します。Client の確立後、Profile が `requiredCapabilities`
を宣言しているかどうかに関係なく、Registry は Descriptor と Capability
Manifest を Probe します。Client Descriptor の `providerId`、`profileId`、
`connectionKind` を要求された Profile と照合し、Capability Manifest の
`providerId` と `profileId` も検証します。Probe の失敗や Identity
Mismatch がある場合は、Client を閉じてから Redaction 済み Portable
Error を返します。

Core は `switch (providerId)` を含みません。Provider
Package は Factory を通じて登録され、Provider の追加に新しい Core
Release は必要ありません。

## 3. Harness Profile

Profile は Host が保存する 1 つの選択可能な接続 Configuration です。

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

同じ Provider に複数の Profile を構成できます。Profile
ID は Host 内で Stable であり、Provider-native Session ID ではありません。

Configuration には API
Key、Token、Cookie、Password の Plaintext を保存しません。Credential が必要な場合は Secret
Reference だけを保存し、接続確立時に Host Secret
Store が制御された条件で解決します。

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

`ownership`
は Lifecycle の責任だけを表します。Adapter が起動した Process の終了は Connection
Cleanup であり、対象 Harness が意味的に完全な Run
Cancel を実装していることを意味しません。

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

`resumeSession` は 1 つの Portable Method
Shape を維持します。Provider が Resume をサポートしない場合は、Resume を模倣せず
`unsupported_capability` を返します。

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

Portable Capability は Stable Namespace を使用します。

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

Semantics の規則は次のとおりです。

- `native` は公式 Machine Interface が同等の動作を直接提供することを表す
- `emulated` は、Adapter が検証済みの同等実装で Portable
  Semantics を満たすことを表すが、Provider-native State や Lifecycle
  Guarantee を継承しない
- `adapter_controlled` は Adapter が実際に所有する Connection
  Control または Reliable Mapping にだけ使用し、Native Semantics を模倣しない
- `unsupported` は現在の Runtime Version、Configuration、Connection
  Kind では確実に実装できないことを表す
- `unknown`
  は現在の接続が Capability 名を認識しているが、Handshake、Schema、Version、Configuration の Evidence が不足していることを表す
- Capability
  Field が存在しない場合、Manifest はその名前を認識しておらず、明示的な
  `unknown` とは異なる
- `CapabilityRequirement.acceptedModes` がない場合は `native`
  だけを受け入れる。`emulated` や `adapter_controlled`
  を受け入れるには Host の明示的な選択が必要である
- UI は `providerId` を Hard-code せず、Capability に基づいて Feature を表示する
- Provider 固有動作は `qwen.code.goal` のような Provider Namespace を使用する

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

`resumeSession` は Provider Traffic を送信する前に、 `SessionRef.providerId` と
`SessionRef.profileId`
の両方を現在の Client と照合します。どちらか一方でも一致しなければ
`session_provider_mismatch` を返します。Adapter が `compatibilityRef`
を書き込む場合、Resume は Provider
Traffic の送信前に現在の Runtime または Protocol
Fingerprint との一致も検証します。値がない場合や一致しない場合も同じ Error を返します。

`providerState` は同じ Provider Adapter に返す Optional Opaque
State です。Core は内容を読まず、別の Provider へ渡しません。永続化の前に、Host は Provider が提供する Serialization と Redaction の規則を適用します。

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

`cancel()` の Result は `run.cancel` Capability より強くできません。`native`
だけが `native`、`emulated` だけが `emulated` を返せます。`adapter_controlled`
は実際に発生させた `connection_aborted`
だけを報告します。Capability が存在しない、`unknown`、`unsupported`
の場合、Non-terminal Run は `unsupported_capability`
を返します。すでに終了した Run は `already_terminal` を返せます。Host は
`HarnessClient.close()`
を呼び出して Adapter 所有の接続を中止できますが、その結果は `connection.aborted`
に Mapping し、Provider が確認した Cancellation を模倣しません。

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

Provider が特定の `InputPart` をサポートしない場合、Run の開始前に
`unsupported_capability` または `invalid_request`
を返します。意味が異なる Text へ暗黙的に変換しません。

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

Event の規則は次のとおりです。

- 1 回の Run 内で `sequence` は単調増加する
- 各 Run は Terminal State を 1 つだけ生成する
- Terminal State は `run.completed`、`run.cancelled`、`run.failed`、
  `connection.aborted` のいずれかである
- Terminal Event は最後の Event であり、Run の唯一の `RunResult` と一致する
- Terminal State の後に到着した Provider
  Activity は Event を追加したり、確定済みの Result を変更したりできない
- Provider に Persistent Event
  Cursor がない場合、Core は切断後の Replay を保証しない
- Provider が Reasoning を公開しない場合、Adapter は偽の Reasoning
  Event を生成しない
- 安定した Mapping ができない Message は `provider`
  Type として引き続き観測可能で、 `providerEventType`
  と安全かつ有界な Summary を保持する。Success その他の権威ある Terminal
  Result として解釈しない
- `raw` は既定で無効にし、有効にした場合も Provider
  Adapter がサイズと構造を有界にし、Redaction と Rate Limit を適用する

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

Provider の公式 Interface が External
Client の応答を許可する場合にのみ、Adapter は対応する Interaction
Capability を宣言します。Non-interactive
CLI が Tool を自動的に許可することは、Portable
Approval の Support ではありません。

## 12. Result と Error

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

Raw Provider Error は `cause` に保持できますが、既定では Product
Log へ書き込まず、直接表示しません。Adapter は添付前に Secret、Authorization、Cookie、Environment
Value、File Body などの Sensitive Data を取り除きます。

## 13. Provider Extension と Native Client

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

Extension は Provider Namespace を使用します。

```text
deepseek.harness.plugins.marketplace
goose.recipes
qwen.code.goal
openai.codex.apps
github.copilot.commands
```

`native()` は公式 SDK Client または公式 Protocol
Client を返します。Extension や Native Client を使用する Business
Code は Provider
Binding を明示的に受け入れます。Core はその Code の Cross-provider
Portability を保証しません。

## 14. 2 Provider の例

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

Application が Provider を認識するのは Profile 接続時だけです。Task
Execution、Event Rendering、Error Handling は Portable
Contract に依存できます。Qwen Goal や OpenCode Native
Behavior が必要な場合だけ、対応する Extension を使用します。

## 15. Concurrency と Resource の規則

- 異なる Client と Session は並行実行できる
- 同じ Session で Concurrent Run を許可するかは Capability または Provider
  Limit が宣言する
- Adapter は Concurrency を許可する Provider を自動的に Serialize せず、Single
  Run を要求する Provider に Concurrency を強制しない
- `close()` は Idempotent である
- Terminal State に到達した Run の Cancel は `already_terminal` を返す
- Core は Event Ordering と一意な Terminal State だけを定義する。Slow
  Consumer、Backpressure、Event Buffer
  Limit は Adapter と Transport が定義して検証する
- Client Close または Provider
  Process の予期しない終了は、影響する各 Non-terminal Run を正確に 1 回だけ
  `connection_aborted` として確定する。永久的な Running
  State を残さず、遅れて到着した Provider
  Activity も確定済みの Result を変更できない
