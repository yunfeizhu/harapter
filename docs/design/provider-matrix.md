# Provider 接入矩阵

## 1. 声明范围

本文件记录目标 Harness 已公开的程序化接入面，以及它们对 Harapter 设计的影响。它不是 Provider 可用性承诺。

一个 Provider 只有在对应 Adapter 完成实现、兼容探测、Conformance
Test 和真实 Runtime 测试后，才能在发布物中标记为可用。

“可接入”表示可以覆盖统一的创建 Session、提交输入、消费事件和获得终态主链路；“原生高级能力”仍取决于目标 Harness 的公开机器接口。

## 2. 首批 Provider

| Provider           | Provider ID             | 首选接入面                           | 预计公共覆盖 | 主要限制                                                               |
| ------------------ | ----------------------- | ------------------------------------ | ------------ | ---------------------------------------------------------------------- |
| Claude Code        | `anthropic.claude-code` | Claude Agent SDK                     | 高           | SDK 和 CLI 进程生命周期、权限模式需要显式配置                          |
| Codex CLI          | `openai.codex`          | Codex App Server                     | 很高         | 协议持续扩展，必须按运行时 Schema 探测                                 |
| OpenCode           | `opencode`              | Headless HTTP/OpenAPI；ACP 可选      | 很高         | HTTP 服务生命周期和认证由宿主管理                                      |
| Goose              | `goose`                 | ACP Server 或官方 API                | 高           | Extension、Recipe、Subagent 等保留为 Provider Extension                |
| Qwen Code          | `qwen.code`             | SDK、ACP、HTTP daemon 或 Stream JSON | 中高         | 接口快速演进，部分 SDK/双向流能力仍可能处于实验状态                    |
| Crush              | `charm.crush`           | `crush serve` 本地 API               | 高           | 服务 API 较新，发布版本和主分支能力必须分别探测                        |
| GitHub Copilot CLI | `github.copilot-cli`    | ACP Server                           | 高           | 一部分 Tool、Reasoning 配置固定在 Server 启动参数，不能按 Session 改变 |
| Cursor Agent CLI   | `cursor.agent-cli`      | Headless Stream JSON                 | 中           | 当前为 Beta；失败流、审批、原生取消等控制面不如双向协议完整            |

这里的 Cursor 仅指公开的 `cursor-agent`
CLI。Cursor 桌面 IDE 不能因为存在 CLI 就被宣称已经完整适配。

## 3. 推荐 Provider 包

```text
adapter-claude
adapter-codex
adapter-opencode
adapter-goose
adapter-qwen
adapter-crush
adapter-copilot
adapter-cursor
```

这些包只实现适配逻辑，不包含第三方 Runtime 二进制。用户或宿主负责安装、认证和许可；Profile 负责引用具体命令、SDK 实例、Socket 或 Endpoint。

## 4. 接入策略

### 4.1 Claude Code

首选官方 Claude Agent SDK，不解析 Claude Code 交互式终端。Adapter 将 SDK
Session、消息流、Tool 事件和结果映射到公共契约，并通过 SDK 配置暴露允许的工具和权限模式。

需要重点验证：

- SDK 所管理进程的所有权和退出语义；
- Session 创建和恢复引用；
- Partial Message、Tool Call 和 Result 的顺序；
- 权限请求是否能由外部 Client 可靠响应；
- SDK 默认读取的本地设置是否需要显式关闭或固定。

官方入口：[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)、
[流式输出](https://code.claude.com/docs/en/agent-sdk/streaming-output)。

### 4.2 Codex CLI

首选
`codex app-server`。它提供双向 JSON-RPC 风格协议，并公开 Thread、Turn、Item、流式 Delta、Interrupt、Approval、Skill、App 和认证等接口。

Codex Adapter 应优先使用目标 Runtime 自己生成的 TypeScript 或 JSON
Schema，不能长期复制某个提交的内部类型。Thread 映射为 Session，Turn 映射为 Run，Server
Request 映射为 Interaction。

官方入口：[Codex App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)。

### 4.3 OpenCode

首选 `opencode serve`
的 HTTP/OpenAPI 接口，事件流使用官方服务事件；需要兼容 ACP 客户端场景时，可以在同一个 Provider 包中增加 ACP
Connection Strategy。

使用 HTTP 还是 ACP 是连接策略，不应该创建两个不同 Provider
ID。两种策略可以暴露不同 Capability。

官方入口：[OpenCode Server](https://dev.opencode.ai/docs/server/)、
[OpenCode CLI](https://dev.opencode.ai/docs/cli/)。

### 4.4 Goose

Goose 可以作为 ACP
Server，也公开 CLI 和 API。公共 Session/Run 主链路优先通过 ACP 或正式 API 接入。Goose 的 Extensions、Recipes、MCP
Apps 和 Subagents 不应该被压缩成 Core 字段，而应通过 `goose.*`
Extension 或 Native Client 使用。

官方入口：[Goose](https://block.github.io/goose/)。

### 4.5 Qwen Code

Qwen Code 同时提供 Headless、Stream
JSON、SDK、ACP 和长期运行服务等接入形态。Provider 包可以按部署场景实现多个 Connection
Strategy，但应共享相同的 Session、Event 和 Error 映射测试。

首选顺序：

1. 当前发布版本中明确支持的正式 SDK 或长期运行 API；
2. ACP；
3. 文档化 Headless Stream JSON；
4. 不解析交互式 TUI。

Qwen Goal、Custom Subagent、Skill 等独有能力进入 `qwen.code.*`
Extension。接口处于实验状态时，Capability 和 Client Descriptor 必须标记
`experimental`。

官方入口：[Qwen Code 架构](https://qwenlm.github.io/qwen-code-docs/en/developers/architecture/)、
[Headless Mode](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)。

### 4.6 Crush

Crush 当前提供 `crush serve` 共享后端，本地 API 通过 Unix Socket 或 Windows
Named
Pipe 暴露 Workspace、Session、Agent、LSP、MCP 等资源。Adapter 应连接正式服务 API，不操作 TUI。

由于该客户端/服务端分离接口较新，发布前必须确认目标发行版实际包含所需命令和路由，不能仅根据主分支代码扩大支持范围。

官方入口：[Crush](https://github.com/charmbracelet/crush)、
[Crush API 入口](https://github.com/charmbracelet/crush/blob/main/main.go)。

### 4.7 GitHub Copilot CLI

首选 `copilot --acp`。ACP
Server 支持 stdio 和 TCP 两种传输。Adapter 可以复用通用 ACP
Transport，但 Copilot 的启动参数、Slash
Command 和 Session 限制仍由独立 Provider 语义层处理。

部分 Tool Filter 和 Reasoning
Effort 在 Server 启动时固定，Adapter 不得把这些设置伪装成可在每个 Session 动态切换。

官方入口：[Copilot CLI ACP Server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)。

### 4.8 Cursor Agent CLI

首选
`cursor-agent --print --output-format stream-json`。Adapter 可以映射初始化、Assistant、Tool
Call 和成功 Result，并使用公开的 Resume 参数恢复已有会话。

Cursor 当前公开接口适合任务执行和进度展示，但不应默认宣称具备双向 Approval、Provider 原生 Cancel、Fork 或完整 Reasoning。进程非零退出时可能没有终止 JSON 事件，Adapter 必须依据退出码和标准错误生成
`run.failed` 或 `connection.aborted`。

官方入口：[Cursor Headless](https://docs.cursor.com/en/cli/headless)、
[输出格式](https://docs.cursor.com/en/cli/reference/output-format)、
[命令参数](https://docs.cursor.com/en/cli/reference/parameters)。

## 5. 公共能力预期

| 能力               | Claude | Codex  | OpenCode | Goose  | Qwen   | Crush  | Copilot | Cursor |
| ------------------ | ------ | ------ | -------- | ------ | ------ | ------ | ------- | ------ |
| 创建任务会话       | 可评估 | 可评估 | 可评估   | 可评估 | 可评估 | 可评估 | 可评估  | 可评估 |
| 流式事件           | 可评估 | 可评估 | 可评估   | 可评估 | 可评估 | 可评估 | 可评估  | 可评估 |
| Session Resume     | 需实测 | 可评估 | 需实测   | 需实测 | 可评估 | 需实测 | 需实测  | 可评估 |
| 原生 Run Cancel    | 需实测 | 可评估 | 需实测   | 需实测 | 需实测 | 需实测 | 需实测  | 未确认 |
| 外部审批响应       | 需实测 | 可评估 | 需实测   | 需实测 | 需实测 | 需实测 | 需实测  | 未确认 |
| Provider Extension | 可定义 | 可定义 | 可定义   | 可定义 | 可定义 | 可定义 | 可定义  | 可定义 |

“可评估”表示官方接入面存在足够信息，可以进入 Adapter 实现和 Conformance；“需实测”表示不能仅根据文档确认完整语义；“未确认”表示不能在 Capability 中标记为
`native`。

最终发布矩阵必须由目标版本的自动化测试生成，不能把本表直接当作运行时 Capability
Manifest。

## 6. 共享 Transport 与独立语义层

可以复用的 Transport 包包括：

```text
transport-acp
transport-jsonrpc-stdio
transport-jsonl-process
transport-http-sse
transport-local-socket
```

ACP 可以减少 Goose、Copilot、OpenCode 和 Qwen 的通信实现重复，但不能让它们共享同一个 Provider
Adapter。每个 Provider 仍需要独立处理：

- 启动和认证参数；
- Session 和 Run 生命周期；
- Capability；
- Provider Command、Extension 和 Error；
- 版本兼容与测试 Fixture。

## 7. 其他 Provider

LangGraph、DeepSeek Harness、OpenHands、Pi
Agent 及基于 Pi 的其他 Harness 也可以按照相同契约新增 Adapter。它们不需要进入 Core 枚举：

```text
adapter-langgraph
adapter-dsh
adapter-openhands
adapter-pi
adapter-pi-derived-harness
```

基于同一底层框架的多个 Harness 可以共享 Transport 和映射工具，但只要它们的公开行为、版本治理或扩展体系不同，就应保留独立 Provider
ID 和兼容性声明。
