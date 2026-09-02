[English](./api-design.md) · [简体中文](./api-design.zh-CN.md) ·
[日本語](./api-design.ja.md)

# Harapter 统一 API

## 1. 设计原则

- 公共 API 只表达跨 Harness 可以稳定理解的外部语义；
- Session 和 Run 是一等对象，不把 Harness 简化成一次 Completion；
- Provider ID 和 Profile ID 动态注册，不进入 Core 枚举；
- Capability 决定可调用行为，不能根据 Provider 品牌推断；
- Provider 独有能力进入 Extension、Provider Options 或 Native Escape Hatch；
- 公共类型不暴露 Graph State、Checkpoint、Tool 内部对象和 SDK 原生类型；
- 所有事件和错误都保留 Provider 身份；
- 不支持的输入和能力在执行前明确失败，不能静默丢弃。

本文使用接近 TypeScript 的伪代码表达语言无关契约，不限定首个 SDK 的实现语言。它描述的是目标设计，可能早于实现。当前已实现的 TypeScript
API 以 [`@harapter/core` README](../../packages/core/README.md)、Package
Export、源码和测试为准。本文中的签名或示例不代表已经实现，也不代表某个 Provider 已经支持。

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

Registry 在调用 Adapter 前保存隔离的 Profile 校验快照。Client 建立后，无论 Profile 是否声明
`requiredCapabilities`，Registry 都必须探测 Descriptor 和 Capability
Manifest。Registry 要将 Client Descriptor 的 `providerId`、`profileId` 和
`connectionKind` 与请求的 Profile 校验，并校验 Capability Manifest 的
`providerId` 和
`profileId`；探测失败或身份错配时先关闭 Client，再返回脱敏的 portable error。

Core 不包含
`switch (providerId)`。Provider 包通过 Factory 注册，新增 Provider 不需要发布新的 Core。

## 3. Harness Profile

Profile 是宿主保存的一份可选择连接配置：

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

同一 Provider 可以配置多个 Profile。Profile
ID 在宿主范围内稳定，不等于 Provider 原生 Session ID。

配置中不得保存 API Key、Token、Cookie 和密码明文。需要凭据时只保存 Secret
Reference，由宿主 Secret Store 在建立连接时受控解析。

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
只描述生命周期责任。终止 Adapter 自己启动的进程是连接清理，不代表目标 Harness 已经实现语义完整的 Run
Cancel。

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

`resumeSession` 保持统一方法形状。Provider 不支持时返回
`unsupported_capability`，而不是伪造恢复。

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

公共 Capability 使用稳定命名空间：

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

语义规则：

- `native` 表示官方机器接口直接提供等价行为；
- `emulated`
  表示 Adapter 通过已验证的等价实现满足 portable 语义，但不继承 Provider 原生状态或生命周期保证；
- `adapter_controlled`
  只用于 Adapter 确实拥有的连接控制或可靠映射，不能冒充原生语义；
- `unsupported` 表示当前 Runtime 版本、配置或连接形态无法可靠实现；
- `unknown`
  表示当前连接认识该能力名称，但现有握手、Schema、版本或配置证据不足以判定；
- Capability 字段缺失表示 Manifest 不认识该名称，不等同于显式 `unknown`；
- `CapabilityRequirement.acceptedModes` 缺失时只接受 `native`，接受 `emulated`
  或 `adapter_controlled` 必须由宿主明确声明；
- UI 必须根据 Capability 显示功能，不根据 `providerId` 硬编码；
- Provider 独有能力使用 Provider 命名空间，例如 `qwen.code.goal`。

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

`resumeSession` 在发送 Provider 流量前，必须同时校验 `SessionRef.providerId` 和
`SessionRef.profileId` 是否与当前 Client 一致；任一错配都返回
`session_provider_mismatch`。当 Adapter 写入 `compatibilityRef`
时，Resume 还必须在发送 Provider 流量前验证它与当前 Runtime 或协议指纹一致；缺失或错配返回同一错误。

`providerState` 是交给同一 Provider
Adapter 的不透明、可选状态。Core 不读取它，也不能把它交给不同 Provider。宿主持久化前必须应用 Provider 提供的序列化和脱敏规则。

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

`cancel()` 的结果不能强于 `run.cancel` Capability：只有 `native` 可以返回
`native`，只有 `emulated` 可以返回 `emulated`，`adapter_controlled`
只能报告它实际造成的 `connection_aborted`。Capability 缺失、`unknown` 或
`unsupported` 时，非终态 Run 返回
`unsupported_capability`；任何已经结束的 Run 都可以返回
`already_terminal`。宿主也可以选择调用 `HarnessClient.close()`
中止 Adapter 拥有的连接，但结果必须映射为
`connection.aborted`，不能伪装成 Provider 已确认取消。

## 9. 输入

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

Provider 不支持某种 InputPart 时，应在 Run 开始前返回 `unsupported_capability`
或 `invalid_request`，不能静默转换成不等价文本。

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

事件规则：

- 单次 Run 内 `sequence` 单调递增；
- 每个 Run 必须产生且只产生一个终态；
- 终态为 `run.completed`、`run.cancelled`、`run.failed` 或
  `connection.aborted`；
- 终态 Event 必须是最后一个 Event，且 Run 唯一的 `RunResult` 必须与它一致；
- 终态之后到达的 Provider 活动不得追加 Event 或更改已确定的 Result；
- Provider 没有持久事件游标时，Core 不承诺断线重放；
- Provider 不暴露 Reasoning 时不生成虚假 Reasoning Event；
- 无法稳定映射的消息依然通过 `provider` 类型保持可观测，并保留
  `providerEventType` 和安全、有界的摘要；不得将它解释为成功或其他权威终态结果；
- `raw` 默认关闭；开启后 Provider
  Adapter 仍必须限制其大小和结构，并进行脱敏和限流。

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

只有 Provider 官方接口允许外部 Client 响应时，才能声明对应 Interaction
Capability。非交互式 CLI 自动放行工具不等于支持统一审批。

## 12. Result 与错误

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

Provider 原始错误可以保留在
`cause`，但默认不得写入产品日志或直接显示。Adapter 必须先移除 Secret、Authorization、Cookie、环境变量值、文件正文和其他敏感数据。

## 13. Provider Extension 与 Native Client

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

Extension 使用 Provider 命名空间，例如：

```text
deepseek.harness.plugins.marketplace
goose.recipes
qwen.code.goal
openai.codex.apps
github.copilot.commands
```

`native()` 返回官方 SDK Client 或官方协议客户端。使用 Extension 或 Native
Client 的业务代码明确接受 Provider 绑定，Core 不承诺其跨 Provider 可移植性。

## 14. 双 Provider 示例

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

应用只在连接 Profile 时知道 Provider。任务执行、事件展示和错误处理可以依赖公共契约；需要 Qwen
Goal 或 OpenCode 原生功能时再进入对应 Extension。

## 15. 并发与资源规则

- 不同 Client 和 Session 可以并发执行；
- 同一 Session 是否允许并发 Run 由 Capability 或 Provider 限制声明；
- Adapter 不自动串行化本来允许并发的 Provider，也不强行并发本来要求单 Run 的 Provider；
- `close()` 必须幂等；
- Run 到达终态后再次 Cancel 返回 `already_terminal`；
- Core 契约只定义 Event 顺序和唯一终态；慢消费者、背压和事件缓冲上限由 Adapter 与 Transport 定义并验证；
- Client 关闭或 Provider 进程异常退出时，每个受影响的非终态 Run 必须且只能以
  `connection_aborted`
  结束一次；不能留下永久运行状态，迟到的 Provider 活动也不能改变已确定的结果。
