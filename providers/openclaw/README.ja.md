<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-openclaw</code></h1>

<p align="center"><strong>stable ACP v1 で isolated OpenClaw Gateway Session を駆動します。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-openclaw"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-openclaw/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-openclaw"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-openclaw?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-openclaw` は公式 `openclaw acp` stdio Bridge を起動し、stable
ACP
v1 の Session、Prompt、Event、Permission、Resume、cancellation を Harapter に mapping します。OpenClaw
Gateway の導入、設定、認証、運用はホストが行います。

## インストール

```bash
pnpm add @harapter/core@next @harapter/adapter-openclaw@next
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from '@harapter/adapter-openclaw';

const registry = new HarnessRegistry();
registry.register(createOpenClawProviderFactory());

const client = await registry.connect({
  profileId: profileId('openclaw-local'),
  providerId: OPENCLAW_PROVIDER_ID,
  displayName: 'OpenClaw',
  connection: {
    kind: 'process',
    command: 'openclaw',
    args: ['acp'],
    ownership: 'adapter',
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

## Session と Run

- initialize は stable ACP v1 と implementation name `openclaw-acp`
  を検証します；
- 新 Session は isolated Gateway Session Key を持ち、native
  ID と route は Profile に束縛されます；
- Resume には同じ Provider、Profile、Compatibility、isolated route が必要です；
- ACP Connection 全体で active Run は一つです；
- text と handshake が許す Image Reference を扱い、Generic File/Native
  Input は対象外です；
- validated ACP Prompt Response だけが terminal authority です；
- `run.cancel()` は authoritative `cancelled` Response で native
  cancellation になります；
- valid Permission Request を観測すると Approval Capability が `unknown` から
  `native` になります；
- 未知 ACP message は bounded redacted observation になり、Prompt、path、Tool
  content を保持しません。

local timeout/abort で remote
mutation を確認できない場合、Connection を abort し、cancellation や success にはしません。`end_turn`
は完了、`refusal`、`max_tokens`、 `max_turn_requests` は失敗、EOF、Process
Loss、Queue Overflow は `connection_aborted` です。

## Compatibility と制限

stable ACP v1 は negotiated protocol version を持つため、connection 時に Runtime
identity と必須 structure を検証できます。Fixture、Provider Negative、shared
conformance、real completion、cross-Client Resume、Native
Cancellation の evidence があります。

shared Gateway routing、History Replay、Session MCP、Audio、Generic
File、Filesystem/ Terminal Client Service、自動 Process Restart、直接 Gateway
WebSocket は対象外です。Workspace は ACP に渡しますが Tool の実行 Directory は
`unknown` です。詳細は [英語のドキュメント](./README.md)を参照してください。
