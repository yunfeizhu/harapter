# Harapter

> 一套接口，连接所有 Agent Harness。

[English](./README.md) · [设计文档](./docs/design/README.md) ·
[贡献指南](./CONTRIBUTING.md) · [安全策略](./SECURITY.md)

Harapter 是一个面向 Agent
Harness 的开源有状态适配层。宿主应用面向稳定的 Client、Session、Run、流式事件、Interaction、Capability 和 Error 契约；Provider 包负责把这些契约翻译到目标 Harness 已公开的 SDK 或机器协议。

## 当前状态

项目目前处于 **Pre-alpha** 阶段。Portable Core、公共 Conformance、有界 JSONL
RPC 与 HTTP/SSE Transport、Codex 和 OpenCode Provider
Adapter，以及实验状态的 Claude Provider
Adapter 已有源码实现。公共 API 仍需通过更多接入形态验证，当前尚未发布 npm、PyPI 或 CLI 包。

## Harapter 提供什么

- 可移植的 Session、Run、Event、Interaction 和 Error 核心契约；
- 基于真实连接的能力探测，不根据 Provider 名称猜测功能；
- 可以独立安装、升级和回滚的 Provider Adapter；
- 类型化 Provider Extension 和 Native Escape Hatch；
- 隔离上游破坏性变化的公共 Conformance Test；
- 明确的 Session 所有权，不在不同 Harness 之间伪造原生恢复。

## 明确不做什么

Harapter 不实现 Agent Loop，不安装或更新第三方 Runtime，不转换 Provider
Checkpoint，不管理插件市场，也不接管宿主应用的任务数据库、安全策略和产品状态。

## 开发

```bash
corepack enable
pnpm install
pnpm check
```

仓库使用 Conventional Commits。Pull
Request 会自动运行格式、类型感知代码检查、严格 TypeScript 检查、Vitest 覆盖率、工作区构建、Markdown、仓库完整性和链接检查；Release
Please 在维护者明确批准首个可用的 pre-alpha 里程碑后才会由 `main`
手动启动并准备发布 PR。在此之前，普通的 `main` push 不会运行发布自动化。

完整流程见 [贡献指南](./CONTRIBUTING.md) 与 [发布指南](./RELEASING.md)。

## 许可证

项目使用 [Apache License 2.0](./LICENSE)。
