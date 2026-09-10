# Harapter API 参考

[English](./api-reference.md) · [简体中文](./api-reference.zh-CN.md) ·
[日本語](./api-reference.ja.md)

本文用于查阅从 `harapter` 导出的已实现应用 API。第一次接入请先看
[SDK 教程](../packages/harapter/README.zh-CN.md)。参考内容依据
[SDK 导出](../packages/harapter/src/index.ts)和
[可移植类型声明](../packages/core/src/contracts.ts)，不会把
[目标设计](./design/api-design.zh-CN.md)当作已实现能力。
[SDK 指南](../packages/harapter/README.zh-CN.md)和
[Core 指南](../packages/core/README.zh-CN.md)拥有运行语义；各 Provider 指南拥有所支持的配置、事件负载和兼容范围。

单个任务直接调用 `run()`。需要显式管理 Session 时，使用 `createHarapter` →
`connect` → `createSession` → `start` → `events` / `result` → `close`。

| 查什么                   | 去哪里                                                                            |
| ------------------------ | --------------------------------------------------------------------------------- |
| 执行一个任务并释放句柄   | [run](#run)                                                                       |
| 选择 Harness、提供认证   | [createHarapter](#createharapter)                                                 |
| 配置 Runtime 连接        | [HarnessProfile](#harnessprofile)                                                 |
| 连接、创建或恢复 Session | [HarnessRegistry](#harnessregistry)、[HarnessClient](#harnessclient)              |
| 提交输入、处理交互       | [HarnessSession](#harnesssession)、[HarnessInput](#harnessinput)、[交互](#交互)   |
| 流式事件、取消、最终回复 | [HarnessRun](#harnessrun)、[RunResult](#runresult)、[HarnessEvent](#harnessevent) |
| 检查可选能力与失败       | [Capability](#capability)、[HarnessError](#harnesserror)                          |
| Provider 特有行为        | [Extension 与 Native Access](#extension-与-native-access)                         |

## run

`run(request: RunRequest): Promise<RunResult>`

`run()` 是 `harapter@1.0.0`
之后新增的 API。1.0.0 不包含它，请使用包含此 API 的后续版本或源码构建。

单次调用入口在 Core 之外选择已有 Adapter，持续读取事件、释放持有的句柄后返回 Provider 的最终结果。它不安装 Runtime、不代替登录，也不改变权限策略。

| 字段         | 含义                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `harness`    | `HarnessName`：`codex`、`dsh`、`pi`、`openclaw`、`opencode` 或 `hermes`。                                            |
| `input`      | 新任务的非空文本输入。                                                                                               |
| `cwd?`       | 本地进程工作目录，默认 `process.cwd()`。OpenCode 接受服务端绝对目录，省略时沿用服务默认目录。Hermes 不支持覆盖此值。 |
| `model?`     | `RunModel`：`{ id: string; provider?: string }`。选择规则见下表。                                                    |
| `command?`   | 本地可执行文件路径，或绝对 `PATH` 条目中的命令名。不使用 Shell、不安装 Runtime、不隐式搜索当前目录。                 |
| `args?`      | 替换预设的机器接口参数；Adapter 必需的协议参数仍会应用。                                                             |
| `url?`       | OpenCode 或 Hermes 的 HTTP 基础地址，默认值见下表。不要在 URL 中嵌入凭据。                                           |
| `headers?`   | 来自宿主密钥存储的 HTTP 请求头，快照保存在私有解析器中，不写入 Profile 或 SessionRef。                               |
| `timeoutMs?` | 整次调用期限，默认 `60000`，正安全整数且不超过 `2147483647`。包含连接和异步回调；清理可能更久。                      |
| `onEvent?`   | `(event: HarnessEvent) => void \| Promise<void>`，按顺序调用；拒绝时转为脱敏的 `provider_error`。                    |

### 默认连接与模型选择

| Harness    | Connection                      | Model                                                   |
| ---------- | ------------------------------- | ------------------------------------------------------- |
| `codex`    | `codex app-server --stdio`      | 可选 `model.id`；模型 Provider 在 Codex 中配置。        |
| `dsh`      | `dsh --profile sdk`             | 必须同时提供 `model.provider` 和 `model.id`。           |
| `pi`       | `pi`，Adapter 添加 RPC/隔离参数 | 沿用 Runtime 配置；不支持 `run.model`。                 |
| `openclaw` | `openclaw acp`                  | 沿用 Runtime 配置；不支持 `run.model`。                 |
| `opencode` | `http://127.0.0.1:4096`         | 覆盖模型时必须同时提供 `model.provider` 和 `model.id`。 |
| `hermes`   | `http://127.0.0.1:8642`         | 可选 `model.id` 和 `model.provider`。                   |

进程调用拒绝 HTTP 参数，HTTP 调用拒绝进程参数。不支持的模型或工作目录覆盖会抛出
`unsupported_capability`；格式错误或不完整的参数使用
`invalid_request`。找不到本地程序使用 `runtime_not_found`。

到期会抛出 `timeout`
并中止连接，不代表已验证的原生取消。不会自动回应交互请求；出现交互时使用
`unsupported_capability`。每次调用创建新 Session；关闭句柄后原生状态可能仍保留。续接或取消使用 Session
API，清理与所有权细节见 SDK 指南。

[RunRequest / RunModel](../packages/harapter/src/run-types.ts) ·
[SDK](../packages/harapter/README.zh-CN.md)

## openSession

`openSession(options: RuntimeOptions): Promise<ChatSession>`

只调用一次 `openSession()`，之后每条消息调用 `send()`。同一个 native
Session 会保留对话历史。此 API 在 1.0.0 之后新增，1.0.0 发布版尚未包含。

`RuntimeOptions = Omit<RunRequest, 'input' | 'onEvent'>`.
`ChatSession extends HarnessSession`, with
`send(input: string, options?: SendOptions): Promise<RunResult>` and
`readonly client: HarnessClient`.

一个对话同时只允许一个活动 Run。`send()` 消费事件，支持
`{ timeoutMs, onEvent }`；默认期限沿用 `openSession()`
的值（未设置时为 60000 毫秒）。观察回调、超时或交互处理失败会关闭所拥有的连接，这不等于已证明原生取消。需要交互时使用继承的
`start()` / `respond()`；支持取消时调用返回 Run 的 `cancel()`。`chat.client`
暴露同一连接的能力、扩展、恢复和原生控制。关闭 chat 也会关闭这个 Client；需要独立管理或恢复 Session 时继续使用 Client/Session
API。

### runtime

`run()` 和 `openSession()` 共用 `RuntimeOptions`。省略 `runtime`
时使用已说明的 CLI 或 HTTP 默认连接，不需要额外导入 Harapter adapter。

- `PiSdkRuntime`:
  `{ kind: 'pi-sdk', version: '0.85.1', createSession: PiSdkSessionFactory }`.
- `DshGatewayRuntime`: `DshGatewayProfileOptions` +
  `{ kind: 'dsh-gateway', url, resolveCookie(signal) }`.
- `OpenClawAcpRuntime`:
  `{ kind: 'openclaw-acp', gateway: OpenClawGatewayBinding }`.

OpenCode 和 Hermes 使用 HTTP/SSE，不依赖 Harapter 管理的 SDK 子进程；Codex 使用 App
Server stdio。OpenClaw 仍通过 ACP 运行任务，可配置
`runtime: { kind: "openclaw-acp", gateway }`，传入已有的
`OpenClawGatewayBinding`
并保留其 profileId。此 Gateway 只补充已支持的原生 Session 控制，Harapter 不负责关闭它。

[RuntimeOptions](../packages/harapter/src/run-types.ts) ·
[Runtime bindings](../packages/harapter/src/runtime-types.ts) ·
[SDK guide](../packages/harapter/README.zh-CN.md)

## createHarapter

`openClawGateway?: OpenClawGatewayBinding` 将已有宿主绑定传递给匹配的 ACP
Profile。

`createHarapter(options?: HarapterOptions): Promise<HarnessRegistry>`

加载选中的内置协议映射，不安装 Runtime，也不建立连接。不传 `options`
时返回空 Registry；传入配置对象时必须提供 `harnesses`，重复名称只加载一次。

| HarapterOptions 字段    | 类型与用途                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harnesses`             | `readonly HarnessName[]`，从下表选择。                                                                                                             |
| `resolveAuthHeaders?`   | `(reference: SecretRef) => Readonly<Record<string, string>> \| Promise<Readonly<Record<string, string>>>`，由宿主提供 OpenCode、Hermes HTTP 认证。 |
| `resolveGatewayCookie?` | `(reference: SecretRef, signal: AbortSignal) => string \| Promise<string>`，由宿主提供 DSH Gateway 认证。                                          |

`SecretRef` 包含 `scheme: string` 和
`id: string`。Resolver 应先校验具体引用是否获准，再返回凭据。Harapter 不读取一套通用的模型密钥环境变量；模型认证由各 Runtime 负责。

| HarnessName | Profile providerId  | Runtime 配置与限制                                |
| ----------- | ------------------- | ------------------------------------------------- |
| `codex`     | `openai.codex`      | [Codex](../providers/codex/README.zh-CN.md)       |
| `dsh`       | `deepseek.harness`  | [DSH](../providers/dsh/README.zh-CN.md)           |
| `hermes`    | `nous.hermes-agent` | [Hermes](../providers/hermes/README.zh-CN.md)     |
| `openclaw`  | `openclaw`          | [OpenClaw](../providers/openclaw/README.zh-CN.md) |
| `opencode`  | `opencode`          | [OpenCode](../providers/opencode/README.zh-CN.md) |
| `pi`        | `pi.agent`          | [Pi](../providers/pi/README.zh-CN.md)             |

无效选择以 `invalid_request` 拒绝；内置映射无法初始化时以
`provider_api_incompatible` 拒绝。

## HarnessProfile

Profile 表示一套已配置的连接。切换 Profile 会为新 Client 选择 Runtime，不会迁移已有 Session。

| 字段                    | 类型与用途                                                                        |
| ----------------------- | --------------------------------------------------------------------------------- |
| `profileId`             | `ProfileId`，用 `profileId('local-dsh')` 创建，标识宿主的一套连接配置。           |
| `providerId`            | `ProviderId`，用 `providerId('deepseek.harness')` 创建，必须匹配已注册 Provider。 |
| `displayName`           | `string`，显示名称。                                                              |
| `connection`            | `ProviderConnection`，选择下面一种形式。                                          |
| `providerOptions?`      | `Readonly<Record<string, unknown>>`，所选映射支持的配置。                         |
| `requiredCapabilities?` | `readonly CapabilityRequirement[]`，在 `connect` 返回前检查。                     |
| `metadata?`             | `Readonly<Record<string, string>>`，宿主元数据。                                  |

`ProviderConnection` 是以 `kind`
区分的联合类型。类型中存在某种形式，不代表每个映射都支持：

| kind           | 字段                                                                                                           | ownership                       |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `process`      | `command: string`、`args?: readonly string[]`、`cwd?: string`、`envRefs?: Readonly<Record<string, SecretRef>>` | `host`、`adapter` 或 `external` |
| `endpoint`     | `url: string`、`transport?: 'http' \| 'sse' \| 'websocket' \| 'acp'`、`authRef?: SecretRef`                    | `host` 或 `external`            |
| `local_socket` | `path: string`、`transport: 'http' \| 'jsonrpc' \| 'acp'`、`authRef?: SecretRef`                               | `host` 或 `external`            |
| `sdk`          | `client?: unknown`、`factory?: unknown`                                                                        | `host` 或 `adapter`             |

`ownership`
必填。允许的值、进程参数、认证和资源释放语义见所选 Runtime 指南。传入任意
`sdk.client` 对象不会自动识别和适配。

## HarnessRegistry

| 方法                                        | 返回值                            | 行为                                                                      |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `connect(profile: HarnessProfile)`          | `Promise<HarnessClient>`          | 连接已注册 Provider，校验连接类型、描述与能力清单的身份，再检查所需能力。 |
| `listProviders()`                           | `readonly ProviderDescriptor[]`   | 按注册顺序返回元数据。                                                    |
| `getProvider(id: ProviderId)`               | `ProviderDescriptor \| undefined` | 查询一个已注册映射。                                                      |
| `register(factory: ProviderAdapterFactory)` | `void`                            | 注册自定义映射；重复 Provider ID 抛出 `invalid_request`。                 |
| `unregister(id: ProviderId)`                | `void`                            | 移除注册，不关闭已有 Client。                                             |

内置映射使用 `createHarapter` 组合。自定义组合可以使用
`new HarnessRegistry()`；Factory 实现 `descriptor()` 和 `connect(profile)`。
`ProviderDescriptor` 包含 `providerId`、`displayName`、`connectionKinds`
和可选的 `documentationUrl`。

## HarnessClient

| 方法                                             | 返回值                        | 行为                                                                   |
| ------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------- |
| `descriptor()`                                   | `Promise<ClientDescriptor>`   | 当前 Provider/Profile 身份、连接类型、Runtime 元数据、兼容状态及警告。 |
| `capabilities(options?: CapabilityProbeOptions)` | `Promise<CapabilityManifest>` | 已观测能力；可通过 `refresh: true` 请求刷新。                          |
| `createSession(input?: CreateSessionInput)`      | `Promise<HarnessSession>`     | 在此连接上创建 Session。                                               |
| `resumeSession(ref: SessionRef)`                 | `Promise<HarnessSession>`     | 在支持恢复时校验所有者与兼容性，然后恢复状态。                         |
| `extensions()`                                   | `ProviderExtensionRegistry`   | 查询 Provider 特有扩展。                                               |
| `native<T = unknown>(guard?)`                    | `T \| undefined`              | 显式原生访问，见后文。                                                 |
| `close()`                                        | `Promise<void>`               | 按连接所有权幂等释放 Client 资源。                                     |

`ClientDescriptor.compatibility` 为 `supported`、`experimental` 或
`unsupported`。接口有某个方法不等于支持恢复或交互，应结合能力清单和 Runtime 指南。关闭句柄不等于删除原生历史。

## HarnessSession

| 方法                                                        | 返回值                        | 行为                                                       |
| ----------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `ref()`                                                     | `SessionRef`                  | 返回属于原 Provider、Profile 和原生 Session 的不透明引用。 |
| `capabilities()`                                            | `Promise<CapabilityManifest>` | Session 能力观测。                                         |
| `start(input: HarnessInput, options?: RunOptions)`          | `Promise<HarnessRun>`         | 在此 Session 上启动任务。                                  |
| `respond(requestId: string, response: InteractionResponse)` | `Promise<void>`               | 回应受支持的待处理交互。                                   |
| `close()`                                                   | `Promise<void>`               | 幂等释放 Session 资源。                                    |

`CreateSessionInput` 的字段全部可选：

| 字段              | 类型与用途                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `workspace`       | `WorkspaceRef`：`{ uri: string }`，Runtime 所在位置的 Workspace。                                                  |
| `systemContext`   | `string`，映射支持时使用的上下文。                                                                                 |
| `model`           | `ModelSelection`：`{ id: string; providerOptions?: Readonly<Record<string, unknown>> }`，由 Runtime 解释模型选择。 |
| `providerOptions` | `Readonly<Record<string, unknown>>`，原生 Session 配置。                                                           |
| `metadata`        | `Readonly<Record<string, string>>`，宿主元数据。                                                                   |

`SessionRef` 包含 `providerId`、`profileId`、`providerSessionId`，以及可选的
`compatibilityRef` 和不透明
`providerState`。需要恢复时，由宿主保存在授权存储中；不要修改引用来切换 Provider，也不要输出到普通日志。多轮对话在同一 Session 上启动后续 Run；并发 Run 可能触发
`run_conflict`。分叉和原生历史操作使用支持它们的 Provider
Extension，没有可移植的 `session.fork()` 方法。

## HarnessInput

`HarnessInput` 必须提供 `parts: readonly InputPart[]`，可选
`metadata: Readonly<Record<string, string>>`。

| InputPart.type | 必填字段                         | 可选字段            |
| -------------- | -------------------------------- | ------------------- |
| `text`         | `text: string`                   | —                   |
| `file_ref`     | `uri: string`                    | `mediaType: string` |
| `image_ref`    | `uri: string`                    | `mediaType: string` |
| `provider`     | `name: string`、`value: unknown` | —                   |

文本输入形如
`{ parts: [{ type: 'text', text: 'Hello!' }] }`。文件、图片和原生输入需要映射支持；类型存在不代表 Runtime 接受它。

`RunOptions` 可选字段为 `timeoutMs: number`、
`providerOptions: Readonly<Record<string, unknown>>` 和
`metadata: Readonly<Record<string, string>>`，没有可移植的 `signal`
字段。超时控制不代表原生取消。

## HarnessRun

| 方法       | 返回值                        | 行为                                                            |
| ---------- | ----------------------------- | --------------------------------------------------------------- |
| `ref()`    | `RunRef`                      | Provider/Profile/Session 身份、`runId` 和可选 `providerRunId`。 |
| `events()` | `AsyncIterable<HarnessEvent>` | Run 执行期间，用 `for await` 持续读取。                         |
| `result()` | `Promise<RunResult>`          | 权威终态结果。                                                  |
| `cancel()` | `Promise<CancelResult>`       | 请求取消并报告实际模式。                                        |

`CancelResult.mode` 为 `native`、`emulated`、`connection_aborted` 或
`already_terminal`。应检查返回模式和最终结果；中止连接与在 Runtime 内原生停止任务不同。宿主组合见[取消案例](../examples/sdk-application/README.zh-CN.md#场景案例)。

## RunResult

| 字段              | 类型与用途                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `status`          | `completed`、`cancelled`、`failed` 或 `connection_aborted`，只有 `completed` 表示成功完成。 |
| `finalMessage?`   | `string`，Provider 提供时的最终文本；成功也不保证有文本。                                   |
| `usage?`          | `UsageSummary`，可选数值字段 `inputTokens`、`outputTokens`、`totalTokens`。缺失不是零。     |
| `providerResult?` | `unknown`，由 Provider 定义，在宿主授权边界内处理。                                         |

除了捕获异常，也要处理非成功结果。EOF 或事件流关闭本身不能证明成功。

## HarnessEvent

每个事件都有 `id`、`type`、`providerId`、`profileId`、`sessionId`、`runId`、
`sequence`、`timestamp` 和 `data`。可选 `providerEventType`、`raw`
保留 Provider 上下文。`sequence` 表示同一 Run 内的事件顺序。

| 类别     | HarnessEventType 值                                                                 |
| -------- | ----------------------------------------------------------------------------------- |
| 生命周期 | `run.started`、`run.completed`、`run.cancelled`、`run.failed`、`connection.aborted` |
| 消息     | `message.delta`、`message.completed`                                                |
| 推理     | `reasoning.delta`、`reasoning.completed`                                            |
| 工具     | `tool.started`、`tool.updated`、`tool.completed`                                    |
| 交互     | `interaction.requested`、`interaction.resolved`                                     |
| 其他     | `artifact.created`、`usage.updated`、`provider`                                     |

`HarnessEvent<T = unknown>` 将 `data` 的类型设为 `T`，默认是
`unknown`。统一的是外层结构和事件词汇，负载遵循具体映射；不要假定存在
`event.data.text`。未知上游事件进入有界、脱敏的 Provider 通道，不表示成功。渲染前查阅 Provider 指南，普通日志保留元数据即可。

## 交互

`InteractionRequest` 包含 `requestId`、`kind`（`approval`、`user_input` 或
`provider`），以及可选
`title`、`prompt`、`schema`、`providerState`。处理前应校验当前映射的事件负载。

| InteractionResponse.kind | 响应字段                                                         |
| ------------------------ | ---------------------------------------------------------------- |
| `approval`               | `decision: 'approve' \| 'deny'`，可选 `providerOptions: unknown` |
| `user_input`             | `parts: readonly InputPart[]`                                    |
| `provider`               | `value: unknown`                                                 |

将匹配的请求 ID 和响应传给
`session.respond`。支持范围和关联规则由 Provider 定义。宿主负责审批 UI 和策略，通用标题不构成工具操作安全的证据。参见[交互案例](../examples/sdk-application/README.zh-CN.md#场景案例)。

## Capability

`CapabilityManifest` 包含 `providerId`、`profileId`、`observedAt`、可选
`runtimeIdentity`，以及
`capabilities: Readonly<Record<string, CapabilityStatus>>`。

| CapabilityStatus.mode | 含义                      |
| --------------------- | ------------------------- |
| `native`              | Runtime 原生提供此能力。  |
| `emulated`            | Adapter 模拟该行为。      |
| `adapter_controlled`  | 行为由 Adapter 边界控制。 |
| `unsupported`         | 当前映射明确不支持。      |
| `unknown`             | 尚未确定是否支持。        |

缺失的键表示 Adapter 不识别该能力名称，与 `unknown` 不同。状态还可包含
`reason`、`limits` 和 `source`（`handshake`、`schema`、`version_profile`、
`configuration`），使用前应读取限制。

`CapabilityRequirement` 包含 `name` 和可选 `acceptedModes`。
`profile.requiredCapabilities` 让 `connect` 在返回 Client 前执行检查；不写
`acceptedModes` 时只接受 `native`。

## HarnessError

使用 `isHarnessError(error: unknown): error is HarnessError` 收窄捕获的值。
`HarnessError` 继承 `Error`，包含 `code`、`retryable`
和可选的 Provider/Profile 身份、 `providerCode`、`details`。`retryable`
是明确给出的诊断，不会自动重试，也不能证明重放任务安全。

| HarnessErrorCode            | 类别                                       |
| --------------------------- | ------------------------------------------ |
| `provider_not_found`        | 没有匹配的已注册 Provider。                |
| `profile_invalid`           | 连接 Profile 无效。                        |
| `runtime_not_found`         | 所需 Runtime 不可用。                      |
| `connection_failed`         | 连接或资源释放失败。                       |
| `authentication_failed`     | 认证被拒绝或不可用。                       |
| `provider_api_incompatible` | Runtime/协议不兼容或映射不可用。           |
| `unsupported_capability`    | 操作或所需能力不可用。                     |
| `invalid_request`           | API 输入无效。                             |
| `session_not_found`         | 原生 Session 不可用。                      |
| `session_provider_mismatch` | Provider、Profile 或兼容身份不匹配。       |
| `run_conflict`              | 存在冲突的执行。                           |
| `timeout`                   | 超出操作时限。                             |
| `provider_error`            | Provider 失败。                            |
| `connection_aborted`        | Transport/进程连接结束，没有原生终态结果。 |

上游失败如何映射由 Adapter 定义。构造错误使用
`new HarnessError(code, message, options)`，其中 `options.retryable`
必填；可选字段为
`providerId`、`profileId`、`providerCode`、`details`、`cause`。消息、详情和原因必须在传入前脱敏，构造器不会清洗任意值。日志应记录安全类别，不要整体输出捕获的错误。

## Extension 与 Native Access

`client.extensions()` 返回 `ProviderExtensionRegistry`：

| 方法                                                           | 返回值                                   |
| -------------------------------------------------------------- | ---------------------------------------- |
| `list()`                                                       | `readonly ProviderExtensionDescriptor[]` |
| `has(name: string)`                                            | `boolean`                                |
| `get<T>(name: string, guard?: (value: unknown) => value is T)` | `T \| undefined`                         |

描述包含 `name`、`providerId`、`displayName`，可选 `description`、
`documentationUrl`、`stability`（`stable` 或
`experimental`）。扩展名和方法见 Provider 指南。扩展缺失或 Guard 校验失败时返回
`undefined`；仅提供泛型参数不会进行运行时校验。

`client.native<T = unknown>(guard?: (value: unknown) => value is T)` 同样返回
`T | undefined`，明确绑定 Provider。这两种访问方式都不会让原生状态可移植。

## Adapter 作者工具

下面的导出也来自 `harapter`，普通内置配置无需使用：

| 导出                                                                                | 用途                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `providerId(value)`、`profileId(value)`、`providerSessionId(value)`、`runId(value)` | 将无首尾空白的非空字符串转换为带标记的 ID，不解析原生标识符。                                                      |
| `assertSessionOwnership(ref, expectedProviderId, expectedProfileId)`                | 所有者不匹配时抛出 `session_provider_mismatch`。                                                                   |
| `assertSessionCompatibility(ref, expectedCompatibilityRef)`                         | 兼容指纹不匹配时抛出 `session_provider_mismatch`。                                                                 |
| `new ExtensionRegistry(ownerProviderId)`                                            | 提供扩展查询，以及返回幂等清理函数的 `register(descriptor, value)`；所有者错误或名称重复时抛出 `invalid_request`。 |

精确声明见 [Core 导出](../packages/core/src/index.ts)、
[ID](../packages/core/src/identifiers.ts)、
[所有权检查](../packages/core/src/ownership.ts)和
[扩展注册表](../packages/core/src/extensions.ts)。高级 SDK 子路径见
[SDK 指南](../packages/harapter/README.zh-CN.md)，它们属于同一个 npm 包。
