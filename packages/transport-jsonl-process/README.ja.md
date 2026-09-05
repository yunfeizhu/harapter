<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-jsonl-process</code></h1>

<p align="center"><strong>process-based Harness protocol 向けの strict bounded JSONL transport。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonl-process"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-jsonl-process/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonl-process"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-jsonl-process?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

非 JSON-RPC の process protocol に、strict JSONL
framing、順序付き inbound、serialized
write、backpressure、timeout、cleanup を提供します。process 起動、request
correlation、message の意味、redaction、Harapter mapping は Provider
Adapter が所有します。

## インストール

```bash
pnpm add @harapter/transport-jsonl-process@next
```

## クイックスタート

```ts
import { JsonlProcessTransport } from '@harapter/transport-jsonl-process';

const transport = new JsonlProcessTransport({
  readable: controlledProcess.stdout,
  writable: controlledProcess.stdin,
  cleanup: () => stopControlledProcess(controlledProcess),
});

const incoming = (async () => {
  for await (const message of transport.incoming()) {
    await validateAndMapProviderMessage(message);
  }
})();

await transport.send({ id: 'request-1', type: 'prompt', message: 'Hello' });
await transport.close();
await incoming;
```

## 動作境界

- 一つの UTF-8 JSON object を一つの LF record とし、CRLF も受け入れます；
- 空 record、array、primitive、無効 UTF-8、不正 JSON、切れた最終 record は失敗します；
- 既定値は message 1 MiB、未読 message 128、pending write 128、write wait
  30 秒です；
- `send()` 成功は Node write
  callback の完了だけを示し、Provider の受理や完了を示しません；
- `incoming()` の consumer は一つだけで、consumer 終了は logical
  connection を閉じます。

Stream は呼び出し側が所有します。Transport は spawn、kill、restart、end、destroy を行いません。任意の
`cleanup`
は明示 close または終端 failure 後に最大一回だけ実行されます。timeout と
`AbortSignal` は local write wait のみを制御します。

## Error と安全性

`JsonlTransportError` は固定の content-free
message を使い、frame、ID、path、Stream Error、Provider
Payload を保持しません。inbound object は untrusted
data なので、Event、Error、Fixture、log にする前に Adapter が検証・redact します。

process manager、request/response protocol、Provider Adapter、retry layer、Agent
Loop ではありません。全設定と lifecycle は[英語の詳細ドキュメント](./README.md)
を参照してください。
