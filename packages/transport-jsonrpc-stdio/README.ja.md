<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-jsonrpc-stdio</code></h1>

<p align="center"><strong>呼び出し側が所有する Node Stream 上の bounded bidirectional JSONL RPC。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-jsonrpc-stdio/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-jsonrpc-stdio?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

stdin/stdout などの Node Stream で、一行一 JSON object の RPC を扱う Provider
Adapter 向け transport です。framing、request
correlation、順序付き inbound、backpressure、timeout、cleanup を担いますが、Provider
method を解釈せず、Harapter の Session、Run、終端結果を生成しません。

## インストール

```bash
pnpm add @harapter/transport-jsonrpc-stdio@next
```

## クイックスタート

```ts
import { JsonRpcStdioTransport } from '@harapter/transport-jsonrpc-stdio';

const transport = new JsonRpcStdioTransport({
  readable: controlledProcess.stdout,
  writable: controlledProcess.stdin,
  cleanup: () => stopControlledProcess(controlledProcess),
});

const incoming = (async () => {
  for await (const message of transport.incoming()) {
    await validateAndMapProviderMessage(message);
  }
})();

const initialized = await transport.request('initialize', {
  clientInfo: { name: 'harapter-provider', version: 'current' },
});

await validateInitializeResult(initialized);
await transport.close();
await incoming;
```

## よくある使い方

- `request()` は対応する response を待ち、`notify()`
  は notification だけを書きます；
- `incoming()` の consumer は一つだけです；
- 終端 response より前の Event 処理を待つ場合は `requestAfterInbound()`
  を使います；
- Provider 側で解決済みの remote request は `abandonInboundRequest()`
  で解放します；
- `getRemoteError()` は明示的 raw
  data 境界で、Adapter による検証と redaction が必要です。

## 既定の境界

- message、未読 inbound、pending request、remote request、write は有限です；
- request timeout は既定で 30 秒、timer は Node の安全範囲に制限されます；
- 一つの JSON object を含む JSONL frame のみで、batch
  array と複数行 frame は拒否します；
- JSON-RPC `"2.0"` の必須化・送信や整数 numeric ID の強制を選択できます。

Stream と process は呼び出し側が所有します。`close()`
は Stream を直接終了せず、logical connection を閉じ、任意の `cleanup`
を最大一回実行します。`AbortSignal` と timeout は local
wait だけを止め、Provider cancellation の証拠にはなりません。

## Error と機密データ

不正 JSON、無効 UTF-8、上限超過、重複 remote request ID、早期 EOF は fail
closed です。`JsonRpcTransportError` は frame、ID、Stream
Error を保持しません。remote error、`method`、`params` は untrusted Provider
data なので、記録や mapping の前に Adapter が検証・redact します。

このパッケージは process manager、Provider Adapter、retry layer、Agent
Loop ではありません。全設定と制限は[英語の詳細ドキュメント](./README.md)を参照してください。
