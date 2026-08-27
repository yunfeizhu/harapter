# Harapter

## 项目定位

Harapter 是一个面向 Agent
Harness 的独立适配层。它为桌面客户端、Web 服务、CLI 和其他 Agent 产品提供稳定的有状态 Agent
API，并通过独立 Provider Adapter 调用不同 Harness 已公开的 SDK、RPC、HTTP
API 或机器协议。

它借鉴 LiteLLM 的 Provider
Adapter 思路，但适配对象不是一次模型请求，而是拥有 Session、Run、流式事件、工具调用和人工交互的有状态 Agent
Runtime。

```text
Host Application
        │
        │ Stable Harness API
        ▼
Harapter Core
        │
        ├── adapter-qwen ──────▶ Qwen Code
        ├── adapter-opencode ──▶ OpenCode
        ├── adapter-codex ─────▶ Codex CLI
        ├── adapter-claude ────▶ Claude Code
        └── other adapters ────▶ Other Harnesses
```

Harapter 是完全独立的开源项目，不依赖任何宿主产品的界面、数据库、任务模型、安全实现或本地运行时。

> 本文档描述目标设计，不代表列出的 Provider 已经实现。实际支持范围以发布包、Capability
> Manifest、Conformance Test 和 Provider README 为准。

## 解决的问题

应用接入多个 Harness 时，不再分别处理每套 SDK、进程协议和事件格式，而是统一完成：

- 注册和发现 Provider Adapter；
- 配置一个或多个 Harness Profile；
- 建立 Client 并探测真实能力；
- 创建或恢复 Session；
- 提交一次 Run 并消费流式事件；
- 响应 Provider 暴露的审批或用户输入请求；
- 获取结构化错误、使用量、产物和原始 Provider 事件；
- 访问无法统一的 Provider Extension 或原生 Client。

同一应用可以同时连接多个 Harness，而不是只能设置一个全局 Provider。例如，一个客户端可以同时注册
`qwen-local` 和 `opencode-local`，为不同任务选择不同 Harness：

```text
Task A ──▶ profile: qwen-local ─────▶ Qwen Code
Task B ──▶ profile: opencode-local ─▶ OpenCode
```

上层的任务列表、消息存储和界面可以共用，但每个 Harness
Session 始终绑定创建它的 Profile。

## 核心职责

- 定义 Registry、Profile、Client、Session、Run、Event、Interaction 和 Error 契约；
- 将公共调用翻译为目标 Harness 的官方机器接口；
- 将原生流式消息映射为稳定事件，并保留无法统一的信息；
- 通过 Capability Manifest 描述当前连接真实支持的行为；
- 区分 Provider 原生能力、Adapter 连接控制能力和不支持能力；
- 为 Provider 独有功能提供类型化 Extension 和 Native Escape Hatch；
- 通过独立 Provider 包扩展新的 Harness，不修改 Core 的执行模型。

## 不属于 Adapter 的职责

Harapter 不负责：

- 实现或复制 Agent Loop、Graph、Planner、Tool Loop 和 Checkpoint；
- 打包、下载、更新或分发第三方 Harness Runtime；
- 代替用户完成第三方账号登录、许可购买和 Runtime 配置；
- 将不同 Harness 的 Tool、Skill、Plugin、App、MCP、沙箱和权限体系重新实现一遍；
- 转换不同 Harness 的内部状态或 Checkpoint；
- 把一个 Provider 的 Session ID 交给另一个 Provider 恢复；
- 持久化宿主产品的任务、完整对话、用户资料或产物；
- 解析交互式 TUI 文本或操作图形界面来模拟正式 API；
- 承诺未被 Provider 官方机器接口暴露的功能。

首选交付模式是由用户或宿主提供已经安装并完成认证的 Runtime。Provider
Adapter 可以连接宿主提供的 SDK 实例、可执行文件或服务地址，但不把第三方发行物包含在自身安装包中。

## 能力模型

Adapter 不把所有 Harness 强行压成完全相同的功能集合，而采用三层能力模型：

1. **Portable
   Core**：创建 Session、提交输入、接收事件和获得明确终态等稳定公共语义。
2. **Optional
   Capability**：Resume、Fork、原生 Cancel、Approval、Artifact、Usage 等需要运行时探测的共同能力。
3. **Provider Extension**：插件市场、Recipe、Goal、App、Slash
   Command 等 Provider 独有接口。

每项能力还要声明实现方式：

- `native`：目标 Harness 官方接口直接支持；
- `emulated`：Adapter 通过有证据的等价实现满足 portable 语义，但不宣称具有 Provider 原生状态或生命周期；
- `adapter_controlled`：Adapter 只能控制自己拥有的连接或进程，不能冒充 Provider 原生语义；
- `unsupported`：当前 Provider、版本或连接方式无法可靠实现。
- `unknown`：当前连接认识该能力名称，但没有足够证据判定是否支持。

Capability 字段缺失表示当前 Manifest 不认识该能力名称，与显式 `unknown`
不同。调用方必须明确选择可接受的模式；默认只接受 `native`。

因此，“八个 Harness 都可接入”表示它们可以进入统一的任务主链路，不表示它们都支持 Fork、审批、插件市场或运行中模式切换。

## 会话与切换边界

- 应用可以随时选择哪个 Profile 创建新 Session；
- 一个 Profile 可以被多个独立任务使用；
- 同一 Provider 可以配置多个 Profile，例如不同账号、工作目录或服务端点；
- 已创建 Session 必须保存 `providerId` 和 `profileId`，并交回兼容的 Adapter；
- 执行中的 Session 不支持透明切换 Harness；
- 跨 Harness 继续工作只能创建新 Session，并显式传入可移植的任务说明、消息摘要、文件和产物。

## 文档索引

- [架构设计](./architecture.md)：组件、运行拓扑、状态所有权和多 Provider 关系。
- [统一 API](./api-design.md)：Profile、Client、Session、Run、事件、能力和错误契约。
- [Provider 接入矩阵](./provider-matrix.md)：首批 Harness 的官方接入面、覆盖等级和限制。
- [Provider 特有能力](./provider-extensions.md)：三层能力模型、扩展接口和 Native
  Escape Hatch。
- [Provider Adapter 开发指南](./provider-adapter-guide.md)：实现新 Provider 包的要求。
- [兼容性设计](./compatibility.md)：上游变化、运行时探测、支持范围和快速替换策略。
- [实施指南](./implementation-guide.md)：独立仓库结构、构建顺序和验收要求。

## 独立项目约束

- Core 不导入任何 Harness SDK；
- Core 不包含 Provider 名称枚举或 Provider 条件分支；
- Provider ID 和 Profile ID 使用动态注册的稳定字符串；
- Provider Adapter 单独封装目标 Harness 的原生类型和版本差异；
- 公共类型不引用任何宿主产品的 Task ID、数据库 Schema 或界面类型；
- 官方 SDK/API 的许可、认证和运行要求由对应 Provider 文档说明；
- 未公开机器接口的功能不宣称已适配；
- 新增 Provider 不要求修改 Core 源码。

## 术语

- **Harness**：拥有 Agent 执行循环、状态和工具编排能力的框架或运行时。
- **Core**：稳定公共接口、公共数据类型、能力模型和 Provider Registry。
- **Provider Adapter**：把公共接口翻译到一个 Harness 官方机器接口的实现包。
- **Harness Profile**：宿主保存的一份可选择连接配置，例如 `qwen-local`。
- **Harness Client**：某个 Profile 建立的一次活动连接。
- **Harness
  Session**：对 Provider 原生 Thread、Session 或 Conversation 的统一引用。
- **Run**：向一个 Session 提交输入后产生的一次执行。
- **Capability**：当前 Client 在当前版本和配置下真实支持的行为。
- **Provider Extension**：Provider 独有、具有类型的附加接口。
- **Native Escape Hatch**：访问官方 SDK Client、协议客户端或原始事件的明确出口。
