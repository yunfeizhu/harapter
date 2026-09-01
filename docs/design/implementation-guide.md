# Harapter 实施指南

## 1. 独立仓库结构

```text
harapter/
├── docs/
├── packages/
│   ├── core/
│   ├── schema/
│   ├── conformance/
│   ├── transport-acp/
│   ├── transport-jsonrpc-stdio/
│   ├── transport-jsonl-process/
│   ├── transport-http-sse/
│   └── transport-local-socket/
├── providers/
│   ├── claude/
│   ├── codex/
│   ├── opencode/
│   ├── goose/
│   ├── qwen/
│   ├── crush/
│   ├── copilot/
│   ├── cursor/
│   ├── dsh/
│   ├── hermes/
│   ├── openclaw/
│   └── pi/
├── examples/
│   ├── single-provider/
│   └── multi-provider-client/
├── fixtures/
└── licenses/
```

Core、Transport 和 Provider 包独立。Transport 只实现 framing、连接、背压和生命周期，不包含 Provider 语义；Provider 包可以复用 Transport，但必须独立完成 Session、Event、Capability 和 Error 映射。

公共契约应由单一 Schema 或等价的 Canonical
Types 定义。若以后提供多语言 SDK，优先从公共 Schema 生成语言绑定，避免手写多套互不一致的契约。

## 2. 构建顺序

### 2.1 公共契约和 Fake Provider

先实现：

- Provider Registry；
- Harness Profile；
- HarnessClient、HarnessSession 和 HarnessRun；
- HarnessInput 和 HarnessEvent；
- Interaction；
- Capability Manifest；
- HarnessError；
- Provider Extension Registry；
- Native Escape Hatch。

Fake Provider 用于固定：

- 多 Profile 注册和选择；
- Session 与 Provider/Profile 绑定；
- Event 顺序和唯一终态；
- 原生 Cancel 与连接中止的区别；
- Capability 拒绝；
- Unknown Event 和 Raw；
- Extension 和错误分类。

### 2.2 第一组参考 Provider

优先选择能够覆盖不同连接形态的 Provider，而不是按品牌数量堆实现：

1. **Codex**：验证双向进程 RPC、Session/Turn、Approval、Interrupt 和 Schema 驱动兼容；
2. **OpenCode**：验证 HTTP/OpenAPI、SSE、长期服务和外部生命周期；
3. **Claude Code**：验证官方 SDK、SDK 托管进程和流式 Tool 事件。

公共 API 只有在 SDK、Process 和 Service 三种形态都能自然实现时才适合稳定。

### 2.3 下一组纵向切片

第一组参考 Provider 完成后，后续模块按以下顺序独立实现：

1. **DeepSeek Harness**：通过官方 SDK stdio
   JSON-RPC 接口验证受限的进程 Harness；没有原生运行中取消证据时，只能关闭连接并报告连接中止；
2. **Hermes Agent**：通过宿主提供的 API Server 验证 Session
   REST、Run 状态、SSE、停止和审批控制面；
3. **ACP Transport**：组合现有 JSON-RPC stdio
   Transport，实现 Provider-neutral 的 ACP
   Schema、方法、协商和 Capability 校验；
4. **OpenClaw**：通过宿主提供的 `openclaw acp` 复用 ACP Transport，并保持 ACP
   Session 与 Gateway Session 的所有权映射；
5. **JSONL Process
   Transport**：为非 JSON-RPC 的双向进程协议提供严格 LF 分帧、有界队列、串行写入、背压和连接清理；
6. **Pi Agent**：通过宿主提供的 `pi --mode rpc` 复用 JSONL Process
   Transport，并以 `agent_settled` 和权威 Assistant 结果固定 Run 终态。

每项是一个独立模块和 Pull Request。Provider
Adapter 与对应文档、脱敏 Fixture、Conformance
Test 和兼容性证据一起交付。第三方 SDK、CLI、Gateway 和 Runtime 均由宿主安装、认证和管理，不进入 Harapter 默认 Workspace 依赖。选择该顺序和接入面的理由由
[对应 Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-next-provider-integration-sequence.md)
记录。

### 2.4 共享 ACP Transport

在 Provider 语义层之外实现 ACP Transport，并分别接入：

- OpenClaw；
- Goose；
- GitHub Copilot CLI；
- OpenCode ACP Strategy；
- Qwen Code ACP Strategy。

这些 Provider 共享协议收发和基础 ACP 类型，但不共享 Provider
ID、启动参数、Capability、Command 和 Extension。OpenClaw 的首个 Adapter 使用官方 ACP
bridge，不直接实现 Gateway WebSocket 客户端。

ACP 层复用 `@harapter/transport-jsonrpc-stdio`
已有的 framing、请求关联、背压、有界队列、等待超时和连接清理，不重复实现第二套 JSON-RPC
Transport。Bridge 进程的创建、终止、重启和所有权属于 Provider
Connection；ACP 层不把进程退出解释为 Provider 原生取消。

### 2.5 Headless JSONL 与本地服务

- `@harapter/transport-jsonl-process` 为非 JSON-RPC 的双向 Headless
  JSONL 协议提供严格 LF 分帧、有界队列、串行写入、背压和连接清理。请求关联、Event 分类和终态继续由 Provider
  Adapter 拥有。Pi Agent Adapter 使用该 Transport，并独立拥有 RPC
  Command、Session、Retry、Interaction、Cancel 和终态语义；
- Qwen Code 验证 SDK、Daemon 与 Stream JSON Strategy 的一致性；
- Cursor Agent CLI 验证有限 Headless 接口、非零退出和不完整终态；
- Crush 验证 Unix Socket、Windows Named Pipe、共享 Workspace 和服务版本探测。

这一组用于证明 Core 能准确表达受限 Provider，而不是迫使所有 Adapter 虚构完整控制面。

### 2.6 其他 Harness

LangGraph、OpenHands 和基于 Pi 的衍生 Harness 按同一 SPI 新增。它们可以复用 Transport 和测试工具，但不要求修改 Core。

## 3. 测试结构

```text
conformance/
├── registry
├── profile
├── connection
├── session
├── streaming
├── interaction
├── cancellation
├── errors
├── extensions
├── native
└── redaction
```

### Fake Provider Test

不依赖真实 Harness，验证 Core 自身：

- Provider 动态注册和卸载；
- 同一 Provider 多 Profile；
- 多 Provider 并行 Session；
- Session Provider Mismatch；
- Event 顺序和唯一终态；
- Capability Mode；
- Connection Abort；
- Provider Event、Raw、Extension 和错误分类。

### Recorded Fixture Test

使用脱敏原生消息验证 Provider 映射：

- 正常事件；
- 未知事件和字段；
- 必需字段缺失；
- Error Response；
- 连接中断；
- Interaction Request；
- CLI 非零退出且没有终止 JSON。

### Live Provider Test

调用用户测试环境中的真实官方 SDK/API：

- 连接和 Capability Probe；
- 创建 Session；
- 多轮 Run；
- Streaming；
- Tool 和 Interaction；
- 原生 Cancel 或明确不支持；
- Resume；
- Provider Extension；
- Native Client；
- 并发限制和资源关闭。

Live Test 必须记录 Runtime
Identity 和非敏感测试配置，不能把一次本地成功扩大为所有版本支持。

### Latest Canary

对快速演进的上游可以定时安装最新 Runtime 并运行 Live
Conformance。Canary 失败只影响对应 Provider 的新版本支持，不阻塞 Core 和其他 Provider；Canary 通过后仍需按发布策略更新兼容范围。

## 4. 多 Provider 参考应用

独立项目必须包含一个只依赖 Core 的参考客户端，同时连接至少两个语义不同的 Harness：

```text
Reference Client
    ├── qwen-local ─────▶ adapter-qwen ─────▶ Qwen Code
    └── opencode-local ─▶ adapter-opencode ─▶ OpenCode
```

参考应用至少演示：

- 配置和选择两个 Profile；
- 分别创建 Session；
- 同时消费两条 Event Stream；
- 使用同一个 UI Event Renderer；
- 根据 Capability 隐藏不支持的操作；
- 保持 SessionRef 与原 Provider 绑定；
- 为新任务切换 Harness；
- 拒绝用 OpenCode 恢复 Qwen Session；
- 使用一个 Provider Extension，而不污染 Portable Core 示例。

这是验证 Adapter 价值的核心验收场景。

## 5. 示例配置

```json
{
  "harnessProfiles": [
    {
      "profileId": "qwen-local",
      "displayName": "Qwen Code",
      "providerId": "qwen.code",
      "connection": {
        "kind": "process",
        "command": "/usr/local/bin/qwen",
        "ownership": "adapter"
      }
    },
    {
      "profileId": "opencode-local",
      "displayName": "OpenCode",
      "providerId": "opencode",
      "connection": {
        "kind": "endpoint",
        "url": "http://127.0.0.1:4096",
        "transport": "http",
        "ownership": "external"
      }
    }
  ],
  "defaultHarnessProfile": "opencode-local"
}
```

该配置只引用用户提供的 Runtime，不代表 Adapter 自动安装它们。生产实现应允许命令、端点和 Secret
Reference 由受控设置系统提供，不能信任任意项目文件启动可执行程序。

## 6. 宿主集成示例

```text
Host Application Control Plane
        │
        ▼
Harapter Core
        │
        ├── Selected Provider Adapter A
        └── Selected Provider Adapter B
```

宿主应用继续拥有：

- Task、Run、Message 和产品事件；
- SQLite 和文件系统数据；
- Artifact 索引和预览；
- 设置和用户界面；
- Secret Store；
- 产品权限和安全边界。

Harapter 返回的 SessionRef 和 Event 由宿主单向投影到产品数据，不成为宿主数据库的替代品。

宿主在生产执行路径接入前需要单独完成：

- 更新 Harness 架构 ADR；
- 定义跨进程 Profile、SessionRef、Event 和 Capability Schema；
- 设计旧任务恢复和 Provider 不可用行为；
- 验证 Tool Policy、沙箱和网络边界不会因切换 Harness 被绕过；
- 使用 LangGraph Adapter 证明现有功能不回退；
- 对每个新 Provider 增加真实任务和故障回归。

## 7. 独立建仓要求

- 文档在没有任何宿主产品源码时可以理解；
- Core 不导入宿主产品或任何 Harness SDK；
- Provider 包不导入宿主产品类型；
- 公共 Fixture 不包含用户 Prompt、文件正文和 Secret；
- 第三方许可和官方 SDK 使用要求分别记录；
- Core、Transport、Provider 和示例可以独立构建和测试；
- 宿主通过正式包依赖使用 Harapter，不长期复制实现源码；
- Provider 包可以独立发布、回滚和禁用。

## 8. 验收标准

项目满足以下条件时，核心设计成立：

- 同一个参考应用同时连接 Qwen Code 和 OpenCode；
- 新任务只改变 Profile 即可选择 Harness；
- Core 不包含 Provider 名称判断；
- Provider Adapter 只调用公开 SDK/API；
- Session、Input、Event、Terminal Result 和 Error 具有稳定公共语义；
- SessionRef 不能跨 Provider 恢复；
- Optional Behavior 通过 Capability 检测；
- Native Cancel 与 Connection Abort 不混淆；
- Provider 独有功能可通过 Extension 或 Native Client 访问；
- Unknown Provider Event 不丢失；
- Runtime 安装、插件市场和框架内部执行不进入 Core；
- 每个发布 Provider 通过公共 Conformance 和真实 Runtime Test；
- 新增第三方 Provider 不修改 Core 源码。
