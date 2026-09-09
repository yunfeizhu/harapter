<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/transports/http-sse</code></h1>

<p align="center"><strong>为 Provider Adapter 提供有界 HTTP 与按需读取的 SSE。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm 版本"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
</p>

<!-- markdownlint-enable MD033 -->

本指南描述单个 `harapter`
SDK 内的模块。普通应用接入请先看[应用指南](../../packages/harapter/README.zh-CN.md)。单包入口的首次发布尚待完成，下面的安装命令适用于该版本发布后。

这个传输包适合“HTTP 提交操作、SSE 推送进度”的 Harness 接口。它负责安全解析 Endpoint、限制请求和响应大小、增量解析 SSE、限制并发与清理资源，但不解释任何 Provider
Route、Payload、Session 或 Run 语义。

## 应用接入还是 Adapter 开发？

普通应用通过 `harapter` 的 `createHarapter`
接入。实现或测试机器接口时才使用本 Transport 子路径。下面是仅使用公开导入的完整离线案例，不启动真实 Runtime，也不构成 Provider 兼容性证据。

```sh
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

将下面的完整代码保存为 `app.ts`。它只导入上面安装的 npm 包；Node.js
24 可以直接执行这份 TypeScript。

<!-- sdk-example: transport-http-sse.ts -->

```ts
import { HttpSseTransport } from 'harapter/transports/http-sse';

// Inject Fetch for an offline application test; no HTTP request leaves this process.
const transport = new HttpSseTransport({
  baseUrl: 'https://example.invalid/',
  fetch: (_input, init) =>
    Promise.resolve(
      init?.method === 'POST'
        ? new Response('{"accepted":true}', { status: 200 })
        : new Response('event: ready\ndata: {}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
    ),
});
try {
  const response = await transport.request('task', {
    method: 'POST',
    body: '{}',
  });
  if (response.status !== 200)
    throw new Error('Unexpected synthetic response.');
  let count = 0;
  for await (const _event of transport.subscribe('events')) {
    count += 1;
    break; // This example needs one event; an unexpected remote EOF is an error.
  }
  console.log({ httpStatus: response.status, eventsReceived: count });
} finally {
  await transport.close();
}
```

```sh
node app.ts
```

真实集成时，将合成的流／Fetch 替换为下文所述的宿主进程或端点。启动协议、payload 校验、认证、脱敏和最终状态仍由使用它的 Adapter 负责。传输写入或 EOF 不等于 Run 成功或原生取消。

[完整应用、场景案例和错误处理](../../examples/sdk-application/README.zh-CN.md) ·
[全部公开包](https://www.npmjs.com/package/harapter)

## 安装

```bash
pnpm add harapter
```

## 组合真实传输

```ts
import { HttpSseTransport } from 'harapter/transports/http-sse';

const transport = new HttpSseTransport({
  baseUrl: 'http://127.0.0.1:4096/',
  defaultHeaders: resolveHostOwnedHeaders(profile.authRef),
});

const eventTask = (async () => {
  for await (const event of transport.subscribe('event')) {
    await validateAndMapProviderEvent(event);
  }
})();

const response = await transport.request('session', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Harapter session' }),
});

await validateProviderResponse(response);
await transport.close();
await eventTask;
```

## HTTP 行为

- `baseUrl` 只能使用 HTTP/HTTPS，不能包含凭据、query 或 fragment；
- 操作路径必须保持同源并位于配置的 base path 内；
- 不自动跟随 redirect，防止默认认证 Header 被转发到其他 Endpoint；
- HTTP status 是 Provider 数据，Adapter 决定如何校验和映射；
- timeout 或 `AbortSignal` 结束本地 Fetch 等待，不代表远端 Run 被取消。

## SSE 行为

- 支持标准 `data`、`event`、`id`、`retry`、comment 及 LF/CR/CRLF；
- 订阅按需读取，不维护无界 Event Queue；
- 正常 EOF 也是 Transport Failure，绝不能被解释为 Provider 成功终态；
- `retry` 值可观察但不会自动重连；调用方结束迭代只取消当前 Response Body。

## 默认边界与安全

普通请求默认最多 64 个、SSE
8 个；Header、Body、Response、Chunk、Line 和 Event 均有有限 byte 上限。默认请求和 SSE 连接阶段等待 30 秒。Header、Body、SSE
Data 和 Content-Type 都是不可信数据，Adapter 必须校验和脱敏。

`HttpTransportError`
不保留 URL、Path、Header、Body、凭据或上游 Exception。该包不提供认证、Cookie、Retry、Reconnect、Cache、Process 管理或 Provider 映射。完整限制和配置见[英文详细文档](./README.md)。

## 相关包

[全部包](../../README.zh-CN.md#npm-包导航)

| 包                                                                            | 文档                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`harapter`](https://www.npmjs.com/package/harapter)                          | [使用指南](../core/README.zh-CN.md)                    |
| [`harapter/transports/jsonrpc-stdio`](https://www.npmjs.com/package/harapter) | [使用指南](../transport-jsonrpc-stdio/README.zh-CN.md) |
| [`harapter/transports/jsonl-process`](https://www.npmjs.com/package/harapter) | [使用指南](../transport-jsonl-process/README.zh-CN.md) |
| [`harapter/transports/acp`](https://www.npmjs.com/package/harapter)           | [使用指南](../transport-acp/README.zh-CN.md)           |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter)              | [使用指南](../conformance/README.zh-CN.md)             |
