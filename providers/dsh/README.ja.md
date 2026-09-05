<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-dsh</code></h1>

<p align="center"><strong>公式 DeepSeek Harness SDK Runtime protocol を Harapter に mapping します。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-dsh"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-dsh/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-dsh"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-dsh?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-dsh` は DeepSeek Harness SDK Runtime の newline-delimited
JSON-RPC 2.0
Server に接続し、Session、Run、Event、Interaction、cancellation、Error を Harapter に mapping します。Agent
Loop 自体は埋め込みません。

## 前提条件とインストール

DeepSeek
Harness の導入、composition、設定、認証はホストが行います。Harapter は DSH
CLI、SDK package、Cordis Application、Plugin、Model
Adapter、Credential を同梱しません。

```bash
pnpm add @harapter/core@next @harapter/adapter-dsh@next
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  DSH_PROVIDER_ID,
  createDshProviderFactory,
} from '@harapter/adapter-dsh';

const registry = new HarnessRegistry();
registry.register(createDshProviderFactory());

const client = await registry.connect({
  profileId: profileId('dsh-local'),
  providerId: DSH_PROVIDER_ID,
  displayName: 'Local DeepSeek Harness',
  connection: {
    kind: 'process',
    command: 'dsh',
    args: ['--profile', 'sdk'],
    ownership: 'adapter',
  },
  providerOptions: {
    provider: 'host-configured-provider',
    model: 'host-configured-model',
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

## Profile とライフサイクル

- Adapter-owned `process` Connection のみで、Shell は使用しません；
- Profile に非空 `provider` と `model` が必要で、Reasoning、Token、bounded
  transport 値も設定できます；
- Workspace は Runtime 初期化 Directory と一致する必要があります；
- 現 protocol に Resume と Native Session Close はなく、close は local
  handle 解放です；
- Connection 全体で active Run は一つです；
- `session/prompt` が返すのは永続的な Inbox `messageId`
  だけで、Result や終端の authority ではありません。所有する activity 区間内の唯一有効な
  `turn/end.data.reason` が終端を決め、EOF と Process
  Exit は success になりません；
- 現 protocol に Prompt Cancel はなく、`run.cancel`
  は未対応です。Timeout は所有する Connection を閉じて `connection_aborted`
  となります。upstream で観測した `aborted` は `run.cancelled`
  に mapping できますが、Harapter が Native
  Cancel を要求した証拠にはなりません；
- 未知 notification は bounded redacted
  observation に残り、終端には変換されません。

## Compatibility と Evidence

接続は `deepseek-harness-sdk-runtime`
identity と、使用する Response、Event、Terminal の structure を検証します。Runtime は診断 Version を返しますが protocol
version
negotiation がないため allowlist は使いません。新 Runtime は既定で試し、互換でない構造を使用した時点で fail
closed します。

公式 SDK Profile は Fixture、mapping test、shared conformance、real Runtime
lifecycle で検証済みです。`experimental`
は「未実装」ではなく、任意 Runtime を実行前に既存 evidence へ自動対応付けできないことを示します。production
host は記録済み Version を pin して再現性を得られます。

Native Client、Interaction、cancel、検証 Version、live test、全制限は
[英語の詳細ドキュメント](./README.md)を参照してください。
