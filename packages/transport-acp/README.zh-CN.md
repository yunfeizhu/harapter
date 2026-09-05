<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-acp</code></h1>

<p align="center"><strong>严格、Provider 无关的稳定 Agent Client Protocol v1 客户端。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-acp"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-acp/next?style=flat-square&amp;label=npm%20next" alt="npm next 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-acp"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-acp?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha 状态">
</p>

<!-- markdownlint-enable MD033 -->

这个包组合 `@harapter/transport-jsonrpc-stdio`，实现稳定 ACP
v1 的协商、Session 方法、Prompt、类型化更新、Permission Request、Capability
Gate 和有界未知消息观测。它不启动 ACP Agent，也不选择 Provider 或把 ACP
Event 映射成 Harapter Event。

## 安装

```bash
pnpm add @harapter/transport-acp@next
```

## 快速开始

```ts
import { AcpClient } from '@harapter/transport-acp';

const client = new AcpClient({
  readable: controlledProcess.stdout,
  writable: controlledProcess.stdin,
  cleanup: () => stopControlledProcess(controlledProcess),
  requestPermission: async (request) =>
    decidePermissionWithoutLoggingRawFields(request),
});

await client.initialize({
  clientInfo: { name: 'harapter-provider', version: 'current' },
});

const session = await client.newSession({
  cwd: controlledWorkspace,
  mcpServers: [],
});

const eventTask = (async () => {
  for await (const event of client.events()) {
    await handleValidatedAcpEvent(event);
  }
})();

await client.prompt({
  sessionId: session.sessionId,
  prompt: [{ type: 'text', text: controlledPrompt }],
});

await client.close();
await eventTask;
```

## 已实现的 ACP v1 范围

- 精确 JSON-RPC `"2.0"` 和 `protocolVersion: 1` 协商；
- `session/new`、按能力启用的 load/list/delete/resume/close；
- `session/prompt`、稳定 v1 `session/update`、`session/cancel`；
- `session/request_permission` 与 `_` 开头的显式扩展方法；
- 未来或未知消息的有界、脱敏结构观测。

ACP v2、认证、logout、terminal、filesystem、elicitation、Session mode 和 Session
configuration 方法不在当前稳定 Profile 中。未实现的 Client
Service 不能被伪装成已支持能力。

## 生命周期要点

- 一条连接只初始化一次，同一 Session 同时只有一个 Prompt；
- 只有验证通过的 `session/prompt` 响应和稳定 stop reason 才是权威终态；
- `cancelSession()` 会发送原生通知，但写入成功本身不是取消终态；
- 本地 timeout/abort 不发送取消，未确认的远端 Prompt 会阻止 Session 复用；
- `events()` 只有一个消费者，默认最多缓存 128 个未读事件；
- 未知消息不会被猜测为成功，任意字符串和标识符会在 Raw
  Observation 中被散列或移除。

扩展回调、Permission Payload、Tool Raw Input/Output 和 Remote
Error 是显式不脱敏边界，调用方必须自行执行数据策略。完整协议范围与竞态语义见
[英文详细文档](./README.md)。
