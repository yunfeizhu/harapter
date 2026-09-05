<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/core</code></h1>

<p align="center"><strong>Harapter の Provider 非依存ライフサイクルとレジストリ。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/v/%40harapter%2Fcore/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/dm/%40harapter%2Fcore?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/core` は複数の Agent Harness を同じ TypeScript
API で扱うための中心パッケージです。Client、Session、Run、イベント、終端結果、Capability、Error、Interaction、Provider 拡張を定義しますが、Provider
SDK を import せず、名前から機能を推測しません。

## このパッケージが適するケース

- Codex、OpenCode、その他の Adapter を切り替えてもアプリの流れを保ちたい；
- Provider 名ではなく、接続先で観測した Capability によってルーティングしたい；
- Provider Adapter を実装し、標準契約・所有権検証・Native Escape Hatch が必要。

## インストール

プレリリースは `next` タグで配布されます。

```bash
pnpm add @harapter/core@next
```

次の Provider-free example では test package も追加します。

```bash
pnpm add -D @harapter/conformance@next
```

Node.js 24 以上が必要です。Core は Harness Runtime の導入や認証を行いません。

## 30 秒クイックスタート

次の例は `@harapter/conformance` の Fake
Provider を使うため、認証情報も実 Runtime も不要です。

```ts
import { HarnessRegistry } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';

const registry = new HarnessRegistry();
registry.register(createFakeProviderFactory());

const client = await registry.connect(createFakeProfile());
const session = await client.createSession();

try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'synthetic input' }],
  });

  for await (const event of run.events()) {
    console.log(event.type);
  }

  const result = await run.result();
  console.log(result.status);
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
}
```

実際のアプリでは Fake Provider を [実装済み Adapter](../../providers/README.md)
に置き換え、Runtime の導入・設定・認証はホストが行います。

## よくある使い方

### 接続前に必要な Capability を宣言する

`requiredCapabilities` は既定で `native`
だけを受け入れます。弱いモードを許可する場合はホストが明示します。

```ts
const client = await registry.connect({
  ...profile,
  requiredCapabilities: [
    { name: 'input.text' },
    { name: 'run.stream', acceptedModes: ['native', 'adapter_controlled'] },
  ],
});
```

### 終端結果を区別する

`run.result()` が権威ある結果です。`completed`、`cancelled`、`failed`、
`connection_aborted` は別の状態であり、プロセス終了は native
cancellation の証拠ではありません。

### Session を保存・再開する

Capability が許す場合だけ `session.ref()`
を保存します。参照は作成元と同じ Provider と Profile に戻す必要があり、Harapter は checkpoint を Provider 間で移動しません。

## 主なエクスポート

- `HarnessRegistry`：Adapter Factory の登録と Profile 接続；
- `HarnessClient`、`HarnessSession`、`HarnessRun`：可搬ライフサイクル；
- `HarnessEvent`、`RunResult`：順序付きイベントと一つの終端結果；
- `CapabilityManifest`：native、emulated、Adapter 制御、unsupported、unknown；
- `HarnessError`：安定した分類と明示的な `retryable`；
- `ExtensionRegistry`、`native()`：Provider に束縛された拡張境界；
- 所有権と互換性を確認する Session 検証関数。

## セキュリティと制限

- Core は `providerState`
  を解釈せず、認証情報、Runtime、プロセス、永続化を管理しません；
- raw
  Event、`providerState`、`providerResult`、Prompt、認証情報を既定で記録しないでください；
- resume、cancel、interaction、artifact、usage は現在の Capability に依存します；
- API は pre-alpha で、1.0 以前に破壊的変更が入る可能性があります。

正確な契約は[英語の詳細ドキュメント](./README.md)と
[API 設計](../../docs/design/api-design.ja.md)を参照してください。
