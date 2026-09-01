# Harapter

> 一套可移植、有状态的 Agent Harness API。

[![CI](https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml/badge.svg)](https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml)
[![许可证：Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
![状态：pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)

[English](./README.md) · [简体中文](./README.zh-CN.md) ·
[日本語](./README.ja.md) · [设计文档](./docs/design/README.md) ·
[示例](./examples/README.md) · [贡献指南](./CONTRIBUTING.md)

Harapter 是一个开源适配层，面向需要同时使用多个 Agent
Harness 的应用。应用只需使用一套 TypeScript 契约来处理 Client、Session、Run、流式 Event、Interaction、Capability 和 Error；独立的 Provider
Adapter 负责把这些契约翻译到官方 SDK 和机器协议。

Harapter 不替代 Agent
Runtime。每个 Runtime 仍由宿主选择、安装、认证并实施安全策略。

## 为什么选择 Harapter

- **一套生命周期，多种 Harness。**
  宿主只实现一次工作流，再为每个任务选择 Harness Profile。
- **状态始终属于原创建者。**
  每个 Session 都绑定创建它的 Provider、连接 Profile 和原生状态。
- **Capability 来自证据，而不是猜测。**
  `native`、`emulated`、`adapter_controlled`、 `unsupported` 和 `unknown`
  保持明确区分。
- **如实表达生命周期结果。** 进程或连接中止不会伪装成 Provider 原生 Run 取消。
- **仍可使用 Provider 原生能力。** 类型化 Extension 和显式 Native Escape
  Hatch 保留无法移植的行为。
- **未知事件仍然可观测。** Adapter 通过有界、脱敏的 Provider
  Channel 保留未知事件，不把它们猜测成成功结果。

## 架构

```text
宿主应用
   │
   │  @harapter/core
   ▼
HarnessRegistry ──▶ Client ──▶ Session ──▶ Run ──▶ Event + Result
   │
   ├── Codex Adapter ─────▶ App Server / JSON-RPC stdio
   ├── OpenCode Adapter ──▶ HTTP + SSE
   ├── Claude Adapter ────▶ Agent SDK
   ├── DSH Adapter ───────▶ SDK Runtime / JSON-RPC stdio
   ├── Hermes Adapter ────▶ API Server / HTTP + SSE
   ├── OpenClaw Adapter ──▶ ACP v1 / JSON-RPC stdio
   └── Pi Adapter ────────▶ strict JSONL process RPC
```

Core 不导入任何 Provider
SDK，不根据 Provider 名称分支，也不根据 Provider 身份推断能力。协议映射、兼容检查、有界 Transport 行为和脱敏 Fixture 由各 Adapter 负责。

## 当前已实现

| 层级             | 已实现模块                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| Portable API     | Core 契约与 Registry，覆盖 Client、Session、Run、Event、Interaction、Capability、Error、Extension 和 Native Access |
| Transport        | JSON-RPC stdio、严格 JSONL process RPC、有界 HTTP/SSE 和 ACP v1                                                    |
| Provider Adapter | Codex、OpenCode、Claude、DeepSeek Harness、Hermes Agent、OpenClaw 和 Pi Agent                                      |
| 证据             | 脱敏 Fixture、Mapping 与生命周期测试、Provider-negative 测试和公共 Conformance                                     |
| 参考实现         | 单 Provider 生命周期应用和并发多 Provider Client                                                                   |

### Provider 证据状态

| Provider                                      | 官方接口                | 当前状态                                                    |
| --------------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| [Codex](./providers/codex/README.md)          | 稳定 App Server         | 已有 Fixture、Conformance 和真实 Runtime 证据的源码 Adapter |
| [OpenCode](./providers/opencode/README.md)    | 稳定 HTTP/OpenAPI + SSE | 已有 Fixture、Conformance 和真实 Runtime 证据的源码 Adapter |
| [Claude](./providers/claude/README.md)        | Claude Agent SDK        | 实验状态；已有确定性证据，尚未记录真实 Runtime 证据         |
| [DeepSeek Harness](./providers/dsh/README.md) | SDK Runtime JSON-RPC    | 实验状态；已有确定性证据，尚未记录真实 Runtime 证据         |
| [Hermes Agent](./providers/hermes/README.md)  | API Server HTTP/SSE     | 实验状态；已有确定性证据，尚未记录真实 Runtime 证据         |
| [OpenClaw](./providers/openclaw/README.md)    | ACP v1 Bridge           | 实验状态；已有确定性证据，尚未记录真实 Runtime 证据         |
| [Pi Agent](./providers/pi/README.md)          | 严格 JSONL RPC 模式     | 实验状态；已有确定性证据，尚未记录真实 Runtime 证据         |

“已有证据”描述的是源码 Adapter 的证据范围，不代表已经发布包。Adapter 会在相应接口首次使用的兼容边界验证当前 Runtime 或接口结构；发现不兼容即失败关闭。“实验状态”表示 Adapter 已实现，并已通过脱敏或合成证据测试，但尚未记录对应接口的真实 Runtime 证据。Harapter 不会为了获取这些证据自动安装 Runtime。

准确的 Capability 和兼容边界请查看
[Provider 接入矩阵](./docs/design/provider-matrix.md)与各 Provider README。

## 查看参考实现

- [单 Provider 参考实现](./examples/single-provider/README.md)——完整演示 Client
  → Session → Run → Event → Result 生命周期及安全清理。
- [多 Provider 参考实现](./examples/multi-provider-client/README.md)——演示 Profile 路由、并发事件流、Session 级控制项、所有权验证和显式 Provider
  Extension 边界。

默认测试不会发现、安装、认证或调用任何第三方 Runtime。

## 项目状态

Harapter 当前处于
**pre-alpha**。TypeScript 实现可以从本工作区用于评估，但所有包仍为 private
`0.0.0`；尚未发布 npm、PyPI 或 CLI 发行物。首个公开版本会在 API、打包、来源证明、发布流程和回滚方案完成审查后发布。

当前稳定化工作聚焦于消费者反馈、由宿主运行的实验 Adapter live
evidence，以及发布准备。Portable wire schema、非 TypeScript SDK 和 local-socket
Transport 会在出现真实消费者需求时实现。Goose、Qwen Code、Crush、GitHub Copilot
CLI 和 Cursor Agent CLI 不在当前实现范围内。

## 从源码开发

前置条件：Node.js 24 和 Corepack。仓库已固定 pnpm 版本。

```bash
git clone https://github.com/yunfeizhu/harapter.git
cd harapter
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check`
会执行格式检查、类型感知 Lint、严格 TypeScript 检查、覆盖率、全部 Workspace 构建、Markdown 与链接检查、仓库一致性检查和 Agent 治理检查。

## 文档

- [架构与目标设计](./docs/design/README.md)
- [Portable Core 契约](./packages/core/README.md)
- [Provider 实现指南](./docs/design/provider-adapter-guide.md)
- [开发流程](./docs/development.md)
- [贡献指南](./CONTRIBUTING.md)
- [安全策略](./SECURITY.md)
- [发布策略](./RELEASING.md)

## 明确不做什么

Harapter 不实现 Agent Loop，不安装或更新 Provider
Runtime，不在 Harness 之间转换原生 Checkpoint，不接管宿主任务存储，不管理 Provider 插件市场，不解析凭据，也不会静默修改宿主应用的安全策略。

## 许可证

项目使用 [Apache License 2.0](./LICENSE)。
