# 通过一个 Harapter 入口连接 Runtime

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

这个私有示例是[应用入口指南](../../packages/harapter/README.zh-CN.md)
的可执行源文件。DSH 与 OpenCode 配置复用 `runTask`，通过 `HARAPTER_HARNESS`
选择连接。Runtime 安装、鉴权、Workspace 安全设置和环境变量见指南。真实调用可能产生模型费用。应用会关闭连接和自己启动的进程，外部服务继续运行，Session 状态不会跨 Harness 迁移。

`harapter`
的首次 npm 发布尚待完成。仓库示例在开发期间通过 Workspace 使用单包组合。发布后安装
`harapter`，将 [src/quick-unified.ts](src/quick-unified.ts) 复制为
`app.ts`，再运行 `node app.ts`。

开发者完成仓库构建后可运行
`pnpm --filter @harapter/example-runtime-profiles start`。集成测试和隔离 Tarball 消费者通过合成 DSH 进程、带鉴权的 OpenCode
HTTP Fixture 执行同一段业务函数，不需要模型凭据。
