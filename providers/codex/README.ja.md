<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-codex</code></h1>

<p align="center"><strong>stable Codex App Server を Harapter の可搬ライフサイクルで実行します。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-codex"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-codex/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-codex"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-codex?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-codex` は公式 stable App
Server に接続し、Thread、Turn、stream Event、Interaction、終端、native
interrupt を Harapter API に mapping します。人向け CLI
output の scraping は行いません。

## 前提条件

Codex の導入と認証はホストが行います。Adapter は Binary を含まず、credential や
`SecretRef` を読み取らず、Sandbox と Approval Policy を勝手に選びません。

```bash
pnpm add @harapter/core@next @harapter/adapter-codex@next
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  CODEX_PROVIDER_ID,
  createCodexProviderFactory,
} from '@harapter/adapter-codex';

const registry = new HarnessRegistry();
registry.register(createCodexProviderFactory());

const client = await registry.connect({
  profileId: profileId('codex-local'),
  providerId: CODEX_PROVIDER_ID,
  displayName: 'Local Codex',
  connection: {
    kind: 'process',
    command: 'codex',
    args: ['app-server', '--stdio'],
    ownership: 'adapter',
  },
  requiredCapabilities: [{ name: 'input.text' }, { name: 'run.stream' }],
});

const session = await client.createSession({
  providerOptions: {
    approvalPolicy: 'never',
    sandbox: 'read-only',
    ephemeral: true,
  },
});

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

## Mapping と利用例

- Codex Thread が Session、Turn が Run で、一つの Thread に active
  Turn は一つです；
- text と Image Reference は portable、任意 File Reference は unsupported です；
- stable Command/File Change Request は Approval
  Interaction に mapping されます；
- `session.ref()` は同じ Provider、Profile、互換 App
  Server だけに resume できます；
- `run.cancel()` は `turn/interrupt` 後の authoritative `interrupted`
  でだけ native cancellation です；
- `CodexNativeClient` は明示的 Provider 機能を提供しますが portable
  guarantee は持ちません。

`turn/completed`
だけが終端 authority です。未知・不正な terminal は success にならず、process
exit、EOF、Client Close、未確認 interrupt は `connection_aborted` になります。

## 設定と安全性

Profile は Adapter-owned `process`
connection のみです。message、queue、request、cancel settlement、Run
Event の上限を設定でき、未知 option は拒否します。Event
consumer が止まり queue が満杯になると、drop せず connection を abort します。

Error は Provider Message、Prompt、file content、credential、environment、local
path を含みません。未知 notification は bounded redacted raw
channel に残ります。

stable App Server には Fixture、mapping test、shared conformance、live Runtime
Evidence があります。正確な compatibility、options、live test、制限は
[英語の詳細ドキュメント](./README.md)を参照してください。
