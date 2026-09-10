# 单次调用与显式会话

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

SDK 指南从两个相互独立的单文件示例开始。选择需要的一个复制为 `app.ts`
即可，都不导入 Runtime 配置文件：

- [Pi: quick-run.ts](src/quick-run.ts)
- [DSH: quick-dsh-run.ts](src/quick-dsh-run.ts)

[SDK](../../packages/harapter/README.zh-CN.md) ·
[API](../../docs/api-reference.zh-CN.md#run)

`run()` 是 `harapter@1.0.0`
之后新增的 API。1.0.0 不包含它，请使用包含此 API 的后续版本或源码构建。

选中的 Harness 需要已安装并登录，或已有运行中的 HTTP 服务。Harapter 沿用该 Runtime 的工具和权限策略。任务可能访问选中的工作目录，并产生模型调用费用。

每次 `run()` 都创建新的 Session，返回权威的 `RunResult`，包括
`failed`、`cancelled` 或
`connection_aborted`。返回结果不一定代表成功。连接、事件回调或清理失败会抛出安全的
`HarnessError`；用 `isHarnessError` 判断后读取 `error.code`。

整次调用默认限时 60 秒，可以通过 `timeoutMs` 修改。到期会抛出 `timeout`
并关闭持有的连接；这不代表原生取消成功，远端任务可能继续。清理可能超过截止时间，迟到的连接或 Session 句柄会在返回后被关闭。

`run()` 不代答审批或用户输入：遇到 `interaction.requested` 会抛出
`unsupported_capability`。交互、多轮会话、恢复、分叉、原生取消、自定义连接策略和 DSH
Gateway 使用下方 Client/Session
API。关闭句柄不会删除原生历史，也不会停止外部服务。

## 进阶：应用管理连接 Profile

需要显式管理 Session 时，可以一起复制 `quick-start.ts` 和
`runtime-config.ts`，或改用可复用的 `runTask`
服务示例。这些是单次调用之外的进阶用法，不是 `run()` 的前置步骤。

- [quick-start.ts](src/quick-start.ts)
- [runtime-config.ts](src/runtime-config.ts)
- [runTask](src/quick-unified.ts)

`pnpm --filter @harapter/example-runtime-profiles start`

单次调用通过现有六个 Adapter 的 fixture 验证。隔离的 tarball 消费者编译这些入口原文，并仅通过安装的
`harapter`
包运行 DSH、Pi 和带认证的 OpenCode 任务。这些确定性测试不能替代真实 Runtime 验证。

## 连续对话

只调用一次 `openSession()`，之后每条消息调用 `send()`。同一个 native
Session 会保留对话历史。此 API 在 1.0.0 之后新增，1.0.0 发布版尚未包含。

[quick-chat.ts](./src/quick-chat.ts) ·
[Runtime guide](../../packages/harapter/README.zh-CN.md)
