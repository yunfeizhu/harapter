<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-acp</code></h1>

<p align="center"><strong>严格、Provider 无关的稳定 Agent Client Protocol v1 客户端。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-acp"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-acp?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-acp"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-acp?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

这个包组合 `@harapter/transport-jsonrpc-stdio`，实现稳定 ACP
v1 的协商、Session 方法、Prompt、类型化更新、Permission Request、Capability
Gate 和有界未知消息观测。它不启动 ACP Agent，也不选择 Provider 或把 ACP
Event 映射成 Harapter Event。

## 应用接入还是 Adapter 开发？

普通应用通常安装 `@harapter/core` 和 Provider
Adapter；实现或测试机器接口时才直接使用本包。下面是仅使用公开导入的完整离线案例，不启动真实 Runtime，也不构成 Provider 兼容性证据。

```sh
npm init -y
npm pkg set type=module
npm install @harapter/transport-acp
npm install -D typescript @types/node
```

将下面的完整代码保存为 `app.ts`。它只导入上面安装的 npm 包；Node.js
24 可以直接执行这份 TypeScript。

<!-- sdk-example: transport-acp.ts -->

```ts
import { PassThrough } from 'node:stream';
import { AcpClient } from '@harapter/transport-acp';

const readable = new PassThrough();
const writable = new PassThrough();
// This synthetic peer implements only the initialization used in this example.
writable.on('data', (frame: Buffer) => {
  const request = JSON.parse(frame.toString('utf8')) as { id: number };
  readable.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
    }) + '\n',
  );
});
const client = new AcpClient({ readable, writable });
try {
  const initialized = await client.initialize({
    clientInfo: { name: 'harapter-application-test', version: '1.0.0' },
  });
  console.log({ protocolVersion: initialized.protocolVersion });
} finally {
  await client.close();
  readable.destroy();
  writable.destroy();
}
```

```sh
node app.ts
```

真实集成时，将合成的流／Fetch 替换为下文所述的宿主进程或端点。启动协议、payload 校验、认证、脱敏和最终状态仍由使用它的 Adapter 负责。传输写入或 EOF 不等于 Run 成功或原生取消。

[完整应用、场景案例和错误处理](../../examples/sdk-application/README.zh-CN.md) ·
[全部公开包](https://www.npmjs.com/org/harapter)

## 安装

```bash
pnpm add @harapter/transport-acp
```

## 组合真实传输

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

## 相关包

[全部包](../../README.zh-CN.md#npm-包导航)

| 包                                                                                                     | 文档                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                                       | [使用指南](../core/README.zh-CN.md)                    |
| [`@harapter/transport-jsonrpc-stdio`](https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio) | [使用指南](../transport-jsonrpc-stdio/README.zh-CN.md) |
| [`@harapter/transport-jsonl-process`](https://www.npmjs.com/package/@harapter/transport-jsonl-process) | [使用指南](../transport-jsonl-process/README.zh-CN.md) |
| [`@harapter/transport-http-sse`](https://www.npmjs.com/package/@harapter/transport-http-sse)           | [使用指南](../transport-http-sse/README.zh-CN.md)      |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)                         | [使用指南](../conformance/README.zh-CN.md)             |
