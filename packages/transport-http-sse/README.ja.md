<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-http-sse</code></h1>

<p align="center"><strong>Provider Adapter 向け bounded HTTP と pull-driven SSE。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-http-sse"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-http-sse/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-http-sse"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-http-sse?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

HTTP で操作を送り、SSE で進行を受け取る Harness
interface 向けです。安全な URL 解決、request/response size、incremental SSE
parser、concurrency、cleanup を所有しますが、Provider
route、payload、Session、Run の意味は解釈しません。

## インストール

```bash
pnpm add @harapter/transport-http-sse@next
```

## クイックスタート

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

## HTTP の動作

- `baseUrl` は HTTP/HTTPS のみで、credential、query、fragment を拒否します；
- operation path は同じ origin と base path 内に制限されます；
- redirect は自動追跡せず、default auth Header の別 Endpoint 送信を防ぎます；
- HTTP status の意味は Adapter が検証・mapping します；
- timeout と `AbortSignal` は local Fetch wait を止めるだけで remote
  cancellation ではありません。

## SSE の動作

- 標準 `data`、`event`、`id`、`retry`、comment、LF/CR/CRLF を扱います；
- subscription は pull-driven で無制限 Event Queue を持ちません；
- clean EOF も Transport Failure であり、Provider success にはなりません；
- `retry` は観測のみで、自動 reconnect は行いません。

## 既定の境界と安全性

通常 request は 64、SSE は 8 までです。Header、Body、Response、Chunk、Line、Event は有限 byte
limit を持ち、request と SSE connect は既定 30 秒です。Header、Body、SSE
Data、Content-Type は untrusted data なので Adapter が検証・redact します。

`HttpTransportError` は URL、Path、Header、Body、credential、upstream
Exception を保持しません。認証、Cookie、Retry、Reconnect、Cache、Process 管理、Provider
mapping は提供しません。詳細は[英語のドキュメント](./README.md)を参照してください。
