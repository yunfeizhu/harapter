<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-http-sse</code></h1>

<p align="center"><strong>为 Provider Adapter 提供有界 HTTP 与按需读取的 SSE。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.zh-CN.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-http-sse"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-http-sse/next?style=flat-square&amp;label=npm%20next" alt="npm next 版本"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-http-sse"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-http-sse?style=flat-square" alt="npm 下载量"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI 状态"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 或更高版本">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha 状态">
</p>

<!-- markdownlint-enable MD033 -->

这个传输包适合“HTTP 提交操作、SSE 推送进度”的 Harness 接口。它负责安全解析 Endpoint、限制请求和响应大小、增量解析 SSE、限制并发与清理资源，但不解释任何 Provider
Route、Payload、Session 或 Run 语义。

## 安装

```bash
pnpm add @harapter/transport-http-sse@next
```

## 快速开始

```ts
import { HttpSseTransport } from '@harapter/transport-http-sse';

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
