# Harapter 架构设计

## 1. 架构目标

Harapter 只解决一个问题：让上层应用通过稳定接口连接和使用多个不同 Harness 的公开机器接口。

它不是另一个 Harness，也不在多个 Harness 之上维护第二套 Agent 执行循环。Graph、Agent
Loop、Tool、Skill、Plugin、Session
Store、Checkpoint 和内部安全机制仍由对应 Harness 自己拥有。

设计必须同时满足：

- 一个应用可以注册和连接多个 Harness；
- 同一个 Provider 可以存在多个连接 Profile；
- Portable Core 不依赖任何具体 Provider；
- Provider 特有功能不会因统一抽象而丢失；
- 上游破坏性变化被限制在单个 Provider Adapter 内；
- 未被官方机器接口暴露的能力不会被模拟成正式支持。

## 2. 逻辑架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Host Application                                            │
│ UI · Task Store · Product Policy · Artifact Index           │
└──────────────────────────────┬──────────────────────────────┘
                               │ Stable Harness API
┌──────────────────────────────▼──────────────────────────────┐
│ Core                                                        │
│ registry · profiles · contracts · capabilities · errors     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Provider Adapter Contract
┌──────────────────────────────▼──────────────────────────────┐
│ Provider Adapters                                           │
│ session mapping · event mapping · extensions · probes       │
└───────────────┬────────────────┬────────────────┬───────────┘
                │                │                │
        Official SDK      stdio / JSON-RPC    HTTP / ACP
                │                │                │
┌───────────────▼────────────────▼────────────────▼───────────┐
│ User-provided Harness Runtimes                              │
│ Qwen · OpenCode · Codex · Claude · Goose · Crush · ...      │
└─────────────────────────────────────────────────────────────┘
```

Core、Provider Adapter 和 Harness
Runtime 是三层独立边界。共享 Transport 库可以复用 ACP、JSONL、JSON-RPC、HTTP、SSE 或进程托管，但 Transport 只负责通信，不决定 Provider 语义。

## 3. Core

Core 只包含与具体 Provider 无关的内容：

- Provider Registry 和 Adapter Factory；
- Harness Profile 和连接配置契约；
- `HarnessClient`、`HarnessSession` 和 `HarnessRun` 接口；
- Input、Event、Interaction、Capability 和 Error 类型；
- Provider Extension Registry；
- 公共 Conformance Test Kit。

Core 不包含：

- Harness SDK 依赖；
- Provider 名称枚举或条件分支；
- Provider 原生 API 字段；
- Runtime 安装器和第三方账号登录实现；
- Graph State、Checkpoint 或 Tool 内部对象；
- 宿主产品的数据库、任务和 UI 类型。

## 4. Provider Registry 与 Profile

Provider Adapter 通过 Registry 动态注册。Provider ID 描述适配实现，例如
`qwen.code`；Profile ID描述宿主中的一份实际连接配置，例如 `qwen-local`。

```text
Provider: qwen.code
    ├── Profile: qwen-local
    └── Profile: qwen-team-account

Provider: opencode
    ├── Profile: opencode-local
    └── Profile: opencode-remote
```

Profile 允许同一应用同时连接不同 Harness，也允许同一 Harness 使用不同账号、工作空间或部署地址。Adapter
Core 不决定默认 Profile；这是宿主设置和任务创建流程的职责。

## 5. Provider Adapter

每个 Provider Adapter 负责一个 Harness 的公开接口映射：

- 校验并建立 SDK、进程、Socket 或服务连接；
- 读取 Runtime 身份、协议特征和实际 Capability；
- 将统一 Session 映射为 Thread、Conversation、Agent Session 或 Provider
  Session；
- 将统一 Run 映射为 Turn、Prompt、Graph Run 或 Agent Prompt；
- 将 Provider 流式消息转换为统一 Event；
- 映射原生取消、审批、用户输入和关闭语义；
- 将 Provider 错误归入公共错误类别；
- 暴露 Provider Extension、Native Client 和原始事件；
- 通过公共 Conformance Test 和 Provider 特有测试。

Adapter 不复制目标 Harness 内部实现。它可以使用官方 SDK，也可以实现官方公开 RPC/HTTP 协议的客户端。

## 6. 连接形态

### 6.1 Embedded SDK

```text
Host Process ──▶ Provider Adapter ──▶ Official Harness SDK
```

适用于提供正式 SDK 的 Harness。SDK 对象可以由宿主注入，也可以由 Provider
Adapter 使用宿主提供的非敏感配置创建。

### 6.2 Managed Process

```text
Host Process ──▶ Provider Adapter ──▶ official stdio/RPC ──▶ Harness Process
```

适用于 Codex App Server、ACP Server 和 Headless JSONL
CLI。Adapter 可以启动宿主明确指定的命令，但不负责下载、升级或寻找可执行文件。

进程所有权必须明确：

- `adapter`：Adapter 负责启动、健康检查和关闭该进程；
- `host`：宿主拥有进程，Adapter 只关闭通信通道；
- `external`：进程由用户或外部服务管理，Adapter 不控制其生命周期。

### 6.3 Service Endpoint

```text
Host Process ──▶ Provider Adapter ──▶ HTTP / SSE / WebSocket ──▶ Harness Service
```

适用于 OpenCode Server、OpenHands Agent
Server 和其他长期运行服务。部署、认证、网络边界和服务生命周期由宿主负责。

### 6.4 Local Socket

```text
Host Process ──▶ Provider Adapter ──▶ Unix Socket / Named Pipe ──▶ Harness Service
```

适用于公开本地控制 API 的 Harness。Socket 路径、访问权限和进程所有权必须显式配置，不能通过扫描用户目录猜测活动服务。

## 7. 多 Harness 运行拓扑

一个客户端同时连接 Qwen Code 和 OpenCode 时，推荐拓扑如下：

```text
Application
    │
    ├── HarnessClient(profile=qwen-local)
    │       └── Session q-123 ──▶ Qwen Code
    │
    └── HarnessClient(profile=opencode-local)
            └── Session o-456 ─▶ OpenCode
```

宿主可以并行执行两个 Session，也可以为新任务选择任意 Profile。公共事件进入同一个 UI 渲染层，但 Session、Run、原始事件、认证和错误仍保留 Provider 身份。

## 8. 会话绑定与迁移

`SessionRef` 至少绑定：

- `providerId`；
- `profileId`；
- Provider 原生 Session ID；
- 创建该引用时的兼容性身份摘要。

恢复时必须交给相同 Provider Adapter 和兼容 Profile。Core 不允许把 Qwen
SessionRef 交给 OpenCode，也不通过重放聊天历史伪造“原生恢复”。

跨 Harness 继续任务属于宿主级导出和重新创建：宿主可以将任务说明、经过用户允许的消息摘要、文件引用和产物作为新输入，但新 Harness 会创建新的 Session，原 Harness 的内部状态不会迁移。

## 9. 三层能力模型

### 9.1 Portable Core

公共最低语义包括：

- 建立 Client；
- 创建 Session；
- 提交文本输入；
- 接收顺序化事件；
- 获得完成、失败或连接中止等明确终态；
- 关闭 Session 和 Client。

### 9.2 Optional Capability

以下行为只有对应 Capability 为 `native` 时才可宣称具有 Provider 语义：

- Session Resume 或 Fork；
- Run Cancel 或 Interrupt；
- Approval 和 User Input；
- Reasoning、Tool、Artifact 和 Usage 事件；
- 动态模型、模式或权限切换。

Adapter 终止自己拥有的进程属于 `connection.abort`，不自动等同于 Provider 原生
`run.cancel`。

### 9.3 Provider Extension

DSH 插件市场、Goose Recipe、Qwen Goal、Codex App 和 Copilot Slash
Command 等能力进入 Provider 命名空间。Core 不解释这些接口，也不保证使用 Extension 的代码可以切换 Provider。

## 10. 状态所有权

| 状态                      | 所有者                       | Adapter 行为                   |
| ------------------------- | ---------------------------- | ------------------------------ |
| Agent Loop / Graph State  | Harness                      | 不读取或复制内部结构           |
| Provider Session / Thread | Harness                      | 返回绑定 Provider 的不透明引用 |
| Checkpoint                | Harness                      | 不转换、不迁移                 |
| Tool / Skill / Plugin     | Harness                      | 通过公开能力观察或原生访问     |
| Provider 原始事件         | Harness                      | 可选脱敏后保留                 |
| Profile 配置              | 宿主                         | Core 只消费，不成为配置数据库  |
| 产品 Task / Message / Run | 宿主                         | Adapter 不持久化               |
| 用户文件和产物            | 宿主或 Harness               | Adapter 传递引用和事件         |
| Secret                    | 宿主 Secret Store 或官方 SDK | Adapter 不记录明文             |

## 11. 事件边界

能够稳定解释的原生消息映射为公共 Event：

```text
run.started
message.delta
message.completed
reasoning.delta
tool.started
tool.updated
tool.completed
interaction.requested
interaction.resolved
artifact.created
usage.updated
run.completed
run.cancelled
run.failed
connection.aborted
provider
```

每个 Run 事件流的 Sequence 单调递增，并且只能产生一个终态。未知事件映射为
`provider`，保留 `providerEventType` 和可选脱敏 Raw
Payload。Adapter 不根据 TUI 展示文本猜测事件类型。

## 12. 安全与信任边界

- Adapter 不接收可序列化 Secret 明文，配置只保存 Secret Reference；
- Provider 原始错误、环境变量、请求头和 Raw Event 默认脱敏；
- Runtime 的工具权限和沙箱仍由 Runtime 或宿主产品控制；
- Adapter 不因统一了接口而为第三方 Runtime 或插件安全性背书；
- Adapter 启动进程时只使用结构化命令和参数，不通过 Shell 拼接用户输入；
- 宿主必须决定哪些 Profile、工作目录、网络端点和 Runtime 可以被用户选择。

## 13. 与宿主产品的关系

宿主产品仍然拥有自己的 Task、Message、Run、数据库、Artifact、设置、Secret
Store、审批体验和安全策略。Harapter
Event 只能被单向投影为宿主产品事件，不能替代宿主产品的事实来源。

宿主接入或替换生产 Harness 时，应在自己的架构决策中明确跨进程契约、恢复语义、安全边界和回归测试。Harapter 不替宿主决定这些产品级边界。

## 14. 扩展新 Provider

新增 Harness 只需要：

1. 创建独立 Provider 包并注册稳定 Provider ID；
2. 选择目标 Harness 的官方机器接口；
3. 实现连接、Session、Run、Event 和 Error 映射；
4. 探测并声明真实 Capability；
5. 暴露必要的 Provider Extension 和 Native Client；
6. 通过公共 Conformance Test 和真实 Runtime 测试。

新增 Provider 不要求修改 Core，也不要求其他 Provider 同步升级。
