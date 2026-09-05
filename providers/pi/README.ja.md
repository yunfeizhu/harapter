<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-pi</code></h1>

<p align="center"><strong>Pi Agent の strict JSONL RPC mode を Harapter から実行します。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-pi"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-pi/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-pi"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-pi?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-pi` は公式 Pi Agent `--mode rpc`
を Harapter に mapping します。Session ごとに独立 Process を使い、stream
Event、persisted Resume、native Abort を提供します。Extension、Skill、Prompt
Template discovery は無効化されます。

## 前提条件とインストール

Pi Agent の導入、設定、認証、Model、absolute executable
path はホストが所有します。Harapter は Session
File や Credential を読み取らず Runtime を導入しません。

```bash
pnpm add @harapter/core@next @harapter/adapter-pi@next
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import { PI_PROVIDER_ID, createPiProviderFactory } from '@harapter/adapter-pi';

const registry = new HarnessRegistry();
registry.register(createPiProviderFactory());

const client = await registry.connect({
  profileId: profileId('pi-local'),
  providerId: PI_PROVIDER_ID,
  displayName: 'Pi Agent',
  connection: {
    kind: 'process',
    command: '/opt/harapter-runtimes/bin/pi',
    args: [],
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

## Process、Session、Run

- `--version` probe 後、Session ごとに独立 RPC Process を起動します；
- `--no-extensions --no-skills --no-prompt-templates --mode rpc` を追加します；
- `persistSessions: false` は `--no-session` を追加して Resume を無効にします；
- Resume は Native ID で新 Process を開き、同じ Session の返却を要求します；
- Workspace、System Context、Session Model、Metadata は unsupported です；
- Run は text のみで、複数 part は改行結合し、`/`
  から始まる input は拒否します；
- `prompt` Response は受付だけで、`agent_settled` と最後の valid Assistant
  `message_end` が terminal authority です；
- `run.cancel()` は `abort` Response と `stopReason: 'aborted'`
  の相関で native になります；
- Tool ID は hash され、Tool Argument/Result は portable Event に残りません。

Pi Extension UI の select、confirm、input、editor は Provider
Interaction ですが、generic Approval/User Input
Capability にはしません。未知 Event は bounded redacted
observation に残り、Native Client は ownership-preserving read
command のみです。

## Compatibility と制限

Pi RPC は Runtime Version を返しますが negotiated protocol
version はありません。Version は lock せず、使用する Response、Event、Terminal
Structure を検証します。そのため状態は `experimental` ですが、real
completion、Resume、Native Cancel、cleanup の evidence はあります。

Image/File、Portable Model、Workspace、generic Approval、Runtime
Extension/Skill、shared Process、Session multiplex、auto restart、Session
File、任意 native mutation は対象外です。全 options、live test、検証 Version は
[英語の詳細ドキュメント](./README.md)を参照してください。
