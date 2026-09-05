<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-opencode</code></h1>

<p align="center"><strong>ホスト運用の OpenCode HTTP/SSE Server を Harapter に接続します。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-opencode"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-opencode/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-opencode"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-opencode?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-opencode` は stable `opencode serve`
HTTP/OpenAPI と SSE を Harapter
lifecycle に mapping します。Server の導入、認証、起動、停止はホストが行い、Adapter は指定 Endpoint だけに接続して remote
Session を暗黙削除しません。

## インストール

```bash
pnpm add @harapter/core@next @harapter/adapter-opencode@next
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from '@harapter/adapter-opencode';

const registry = new HarnessRegistry();
registry.register(createOpenCodeProviderFactory());

const client = await registry.connect({
  profileId: profileId('opencode-local'),
  providerId: OPENCODE_PROVIDER_ID,
  displayName: 'OpenCode',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:4096/',
    transport: 'http',
    ownership: 'external',
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

認証する場合は Connection に `authRef` を置き、Factory の `resolveAuthHeaders`
でホストが解決します。Harapter は Header 値を記録・保存・返却しません。

## Session、Run、Input

- Session は Directory に束縛され、File Workspace URI は OpenCode
  Directory になります；
- `session.close()` は local handle だけを解放し、remote DELETE
  Route を呼びません；
- absolute URI と `mediaType` を持つ text/File/Image Reference を stable
  Part に mapping します；
- Session ごとに active Run は一つで、同期 Message
  Request の前に SSE を開きます；
- synchronous Message Response だけが success authority で、`session.idle`
  は代替できません；
- `run.cancel()` は Abort Route と `MessageAbortedError` の両方で native
  cancellation になります；
- Permission Event は Approval に mapping し、`once`、`reject`、明示的 `always`
  を区別します。

remote
settlement が不確実な場合、Adapter は Session を quarantine し、誤った再利用を防ぎます。stream
loss、HTTP Error、不正 Event、未知 Terminal は success になりません。

## Compatibility と制限

接続時に Health を検証し、使用する Session、Message、Abort、Permission、Event
Shape を実行時に検証します。Runtime
Version は診断情報であり allowlist ではありません。

stable interface には Fixture、negative test、shared conformance、live
evidence があります。automatic SSE reconnect、OpenCode process 管理、portable
close による remote deletion、Command/Plugin の Core
Capability 化は対象外です。詳細は
[英語のドキュメント](./README.md)を参照してください。
