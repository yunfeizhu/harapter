# Provider Adapter 开发指南

## 1. 职责

Provider Adapter 调用一个 Harness 已公开的 SDK/API，并把外部语义映射到 Harapter
Core。

它必须：

- 使用官方 SDK、RPC、HTTP API 或文档化机器协议；
- 建立 Client、Session 和 Run 映射；
- 转换流式事件、交互请求和错误；
- 探测当前连接真实支持的 Capability；
- 区分 Provider 原生行为和 Adapter 连接控制行为；
- 暴露 Provider Extension、Native Client 和可选 Raw Event；
- 通过公共 Conformance Test Kit。

它不得：

- 复制目标 Harness 的 Agent Loop；
- 抓取 TUI 文本或操作图形界面；
- 自动下载、选择或更新第三方 Runtime；
- 接管 Harness 插件、Tool、Skill、Checkpoint 或沙箱；
- 把 Provider 特有类型加入 Core；
- 为不存在的能力编造兼容实现；
- 把终止进程描述为 Provider 已确认的原生 Run Cancel。

## 2. 包结构

```text
providers/<provider-id>/
├── adapter
├── manifest
├── connections
├── compatibility
├── session-mapper
├── event-mapper
├── error-mapper
├── capabilities
├── extensions
├── native
├── fixtures
├── conformance
└── README
```

- `adapter`：实现 Provider Adapter SPI；
- `manifest`：稳定 Provider ID、显示信息和连接形态；
- `connections`：封装 SDK、进程、ACP、RPC、Socket 或服务连接；
- `compatibility`：Runtime 探测和 Strategy 选择；
- `session-mapper`：SessionRef、RunRef 和恢复映射；
- `event-mapper`：原生事件到公共 Event；
- `error-mapper`：公共错误分类和脱敏；
- `capabilities`：生成当前连接的 Capability Manifest；
- `extensions`：类型化 Provider 独有接口；
- `native`：官方 SDK Client 或协议客户端出口；
- `fixtures`：脱敏协议和事件样本；
- `conformance`：公共行为和 Provider 特有行为测试。

## 3. 接入面选择

选择顺序：

1. 官方、文档化且适合嵌入的 SDK；
2. 官方双向机器协议或 Agent Server；
3. 官方 HTTP/OpenAPI、ACP、JSON-RPC 或本地 Socket API；
4. 官方 Headless JSON/JSONL CLI；
5. Provider 维护者发布的稳定 Shim；
6. 不将交互式终端文本和 UI 自动化作为正式接入面。

选择前必须确认：

- 如何建立和关闭连接；
- 如何发现 Runtime 身份和协议；
- 如何创建、恢复和引用 Session；
- 如何提交一次输入；
- 如何接收流式事件并判断唯一终态；
- 是否支持原生 Cancel、Approval 和 User Input；
- 是否允许多个并发 Session 或 Run；
- 如何访问 Provider 原始错误和特有功能；
- 当前接口的许可和分发要求。

同一 Provider 可以实现多个 Connection
Strategy，但不同 Strategy 必须共享公共语义测试并分别声明 Capability。

## 4. Provider Manifest

```ts
const manifest = {
  providerId: 'vendor.harness',
  displayName: 'Vendor Harness',
  connectionKinds: ['sdk', 'process'],
  documentationUrl: 'https://example.com/provider-adapter',
};
```

Provider
ID 一经公开保持稳定。Core 不添加对应枚举或条件分支。衍生 Harness 如果拥有不同协议、版本治理或扩展语义，应注册独立 Provider
ID，而不是冒充底层基础框架。

## 5. 连接实现

### SDK

- 明确 SDK Client 由宿主还是 Adapter 创建；
- 会携带 Provider
  Runtime 的 SDK 必须是宿主提供的可选 Peer，不得进入默认 Workspace 依赖或锁文件；Adapter 使用动态加载或显式 Binding；
- 不读取未声明的全局配置和环境变量；
- 关闭时不释放宿主拥有的 SDK Client；
- 官方 SDK 内部启动子进程时，在 Descriptor 中说明真实运行形态。

### Process

- 使用结构化 `command` 和 `args`，不经 Shell 拼接；
- stdout 只解析官方协议，stderr 作为有界诊断流；
- 实现启动超时、健康检查、背压、异常退出和幂等关闭；
- 进程所有权为 `adapter` 时才允许主动终止；
- 非零退出或协议截断必须结束所有受影响 Run。

### Endpoint 和 Socket

- 验证 URL、Socket 类型、认证引用和连接超时；
- 不在日志中打印 Authorization、Cookie 或完整敏感查询；
- 明确重连是否能够恢复事件游标；
- 不扫描未知本地端口或用户目录猜测服务；
- 服务由宿主或外部管理时，`close()` 只关闭 Client 连接。

## 6. Session 映射

| Core           | Provider 可能使用的概念                           |
| -------------- | ------------------------------------------------- |
| HarnessClient  | SDK Client、App Server Connection、Service Client |
| HarnessSession | Thread、Session、Conversation、Agent Session      |
| HarnessRun     | Turn、Prompt、Graph Run、Agent Prompt             |
| Interaction    | Approval Request、Interrupt、Server Request       |

映射要求：

- SessionRef 保存 `providerId`、`profileId` 和原生 Session ID；
- Provider 没有原生 Run ID 时可以生成 Client 内唯一 ID，但不得宣称持久语义；
- Provider 没有 Resume 时返回 `unsupported_capability`；
- 不通过偷偷重放完整历史伪造原生 Resume；
- 恢复前检查 SessionRef 的 Provider 和兼容性身份；
- 多 Session 之间不得串用事件和交互请求。

## 7. Event 映射

每种原生消息都应进入明确映射表：

| 原生消息              | Core Event              | 未统一信息      | 处理方式                   |
| --------------------- | ----------------------- | --------------- | -------------------------- |
| Assistant text delta  | `message.delta`         | Provider 元数据 | 可选进入 Raw               |
| Tool begin            | `tool.started`          | 原生参数        | 公共摘要和脱敏 Raw         |
| Approval request      | `interaction.requested` | 原生 Schema     | `providerState`            |
| Unknown event         | `provider`              | 全部可公开字段  | `providerEventType` 和 Raw |
| Process non-zero exit | `run.failed`            | 脱敏 stderr     | 公共错误和诊断             |

事件转换要求：

- 保持原始顺序；
- 单个 Run 只产生一个终态；
- 不根据展示文本猜测事件类型；
- 不生成 Provider 未暴露的 Reasoning；
- Raw 关闭时不影响公共事件；
- 未知事件不能丢失，也不能误判成成功；
- Raw Event、Tool 参数和错误必须脱敏、限长和限速。

## 8. Capability 映射

Capability 来自当前连接，不从 Provider 品牌名称推断。可以使用：

- 官方握手和能力列表；
- 当前 Runtime 生成的 Schema；
- SDK 对象公开方法和类型；
- 当前 Connection Strategy；
- 启动配置和许可状态；
- 无副作用的功能探测；
- 已验证兼容性策略。

禁止通过执行真实用户任务探测能力。

对于 Cancel 必须分别判断：

```text
run.cancel = native
connection.abort = adapter_controlled
```

只会杀进程的 Adapter 不得声明 `run.cancel = native`。

## 9. Provider Extension

Provider 独有功能使用命名空间：

```ts
extensions.register('goose.recipes', gooseRecipes);
extensions.register('qwen.code.goal', qwenGoals);
```

Extension 必须直接调用官方接口，不得在 Adapter 中重新实现插件市场、App 系统或 Package
Manager。

如果官方 SDK/API 已支持但 Adapter 尚未提供类型化 Extension，调用方可以通过 Native
Client 访问。

## 10. Error Mapper

Error Mapper 应区分：

- Runtime 不存在；
- 连接或握手失败；
- 认证失败；
- Provider API 不兼容；
- 不支持的 Capability；
- 无效输入；
- Session 不存在或 Provider 不匹配；
- Provider 执行失败；
- 超时；
- 连接被 Adapter 中止。

未知 Provider 故障不能包装成成功、空响应或普通超时。`providerCode`
可以保留，但错误正文必须先脱敏。

## 11. Conformance Test

### 连接

- 正常连接和幂等关闭；
- Runtime 不存在、认证失败和协议不兼容；
- Adapter、宿主和外部进程所有权；
- 启动超时、连接丢失和异常退出。

### Session

- 创建、多轮调用和关闭；
- 支持时恢复，不支持时明确拒绝；
- Profile 和 Provider 不匹配；
- 多 Session 隔离；
- Provider 并发限制。

### Streaming

- Text Delta 顺序；
- Tool、Interaction、Artifact 和 Usage；
- 未知 Event 和 Raw；
- 慢消费者和缓冲上限；
- 唯一终态；
- 事件流截断。

### Cancel 与 Interaction

- 原生 Cancel、连接中止和终态后 Cancel；
- Approval、Deny、User Input 和无效 Request ID；
- 不支持时 Capability 与错误一致；
- 不把自动批准模式误报为交互能力。

### Extension 与 Native

- Extension Registry 和命名空间；
- Extension 直接调用官方接口；
- Native Client 来源明确；
- Extension 不改变 Portable Core 语义。

### 脱敏

- Secret、Authorization、Cookie 和环境变量值不进入日志、错误和 Fixture；
- Raw Event 和 Provider Error 在默认关闭时不泄漏；
- 用户 Prompt、文件正文和 Tool 大输出不会进入公共 Fixture。

## 12. 完成标准

Provider Adapter 发布前必须满足：

- 官方接入面、许可和 Runtime 前提清楚；
- Connection Strategy、Session、Run、Event、Capability 和 Error 映射有文档；
- 公共 Conformance Test 通过；
- 目标 Runtime 的 Live Test 通过；
- Provider Extension 具有独立类型和测试；
- Native Escape Hatch 可用或明确说明不提供；
- 已知限制和 Experimental 能力明确；
- 连接失败和不支持能力不会静默降级；
- 新 Provider 不要求 Core 添加名称判断。

## 13. 官方资料

首批 Provider 的机器接口和限制统一记录在
[Provider 接入矩阵](./provider-matrix.zh-CN.md)。实现时还应在 Provider 包 README 中固定目标官方文档、协议 Schema、许可和 Live
Test 环境。
