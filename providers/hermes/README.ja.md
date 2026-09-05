<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-hermes</code></h1>

<p align="center"><strong>Hermes Agent API Server を HTTP/SSE で Harapter に接続します。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-hermes"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-hermes/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-hermes"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-hermes?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-hermes` は公式 Hermes Agent API
Server の Session、Run、Status、SSE
Event、Stop、Approval を Harapter に mapping します。Hermes の導入、認証、起動、停止、設定はホストが所有し、Adapter は指定 HTTP
Endpoint にだけ接続します。

## インストール

```bash
pnpm add @harapter/core@next @harapter/adapter-hermes@next
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  HERMES_PROVIDER_ID,
  createHermesProviderFactory,
} from '@harapter/adapter-hermes';

const registry = new HarnessRegistry();
registry.register(createHermesProviderFactory());

const client = await registry.connect({
  profileId: profileId('hermes-local'),
  providerId: HERMES_PROVIDER_ID,
  displayName: 'Hermes Agent',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:8642/',
    transport: 'http',
    ownership: 'host',
  },
});

const session = await client.createSession();
try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'Describe the current project.' }],
  });
  for await (const event of run.events()) console.log(event.type);
  console.log((await run.result()).status);
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
}
```

認証する場合、Factory にホスト実装の `resolveAuthHeaders` を渡し、Connection は
`authRef`
だけを保持します。Harapter は実 Header を読み取り・出力・保存しません。

## Session と Run

- Connection は `/v1/capabilities` で必要 Route を宣言する必要があります；
- Session 作成は System Context と Model を受け、Resume は native
  ownership を再検証します；
- Workspace は unsupported、close は local handle の解放だけです；
- Session ごとに active Run は一つで、現在の portable input は text のみです；
- Submit Ack は終端ではなく、SSE と Run Status Route を照合します；
- `completed` は Session/Run ownership と最後の `run.completed`
  evidence も必要です；
- SSE
  EOF、disconnect、重複・矛盾 terminal、不正 payload は success になりません；
- Stop と Approval は Runtime が feature と exact
  Route を宣言した時だけ利用できます。

non-idempotent
mutation の response が失われると Session を quarantine し、安全でない retry を防ぎます。Harapter
timeout は emulated control で、Provider の authoritative `cancelled`
Status だけが cancellation terminal です。

## Compatibility と制限

Capability は Provider 名や Version ではなく `/v1/capabilities`
から得ます。Lifecycle authority に使う Response と SSE Event はすべて runtime
validation されます。API Server は protocol version negotiation を持たないため
`experimental` ですが、実 Runtime の completion、Resume、Native
Cancel は検証済みです。新 Version は試行し、不互換 structure で fail
closed します。

Portable Workspace、remote Session delete、automatic SSE
reconnect、未宣言 Route は対象外です。全 options、Approval、Native Client、live
test、検証 Version は [英語の詳細ドキュメント](./README.md)を参照してください。
