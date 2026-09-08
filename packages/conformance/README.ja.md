<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/conformance</code></h1>

<p align="center"><strong>再利用可能な Harapter ライフサイクルテストと決定的 Fake Provider。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/v/%40harapter%2Fconformance?style=flat-square&amp;label=npm" alt="npm バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/dm/%40harapter%2Fconformance?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
</p>

<!-- markdownlint-enable MD033 -->

このパッケージは Adapter 作者と Harapter アプリのテスト向けです。共有 Vitest スイート、Run
Trace 検証、実 Runtime を必要としない Fake
Provider を提供します。共有スイートの成功は可搬契約の証拠であり、実 Provider の対応証拠ではありません。

## インストール

```bash
pnpm add -D @harapter/conformance vitest@^4.1.11
```

## Adapter テストで使う

テスト間で状態を共有しないよう、毎回新しい Factory と Profile を返します。

```ts
import { definePortableProviderConformanceSuite } from '@harapter/conformance';
import { createAdapterFactory, createTestProfile } from './test-support.js';

definePortableProviderConformanceSuite({
  name: 'Example Provider',
  createFactory: createAdapterFactory,
  createProfile: createTestProfile,
});
```

Client identity、Session/Run
ownership、Event 順序、唯一の終端、cancellation の強さ、connection
abort、resume、extension、native access、冪等 cleanup を確認します。Protocol
parser、不正入力、timeout、race、redaction、compatibility、live
Runtime は各 Provider のテストで補います。

## アプリテストで Fake Provider を使う

```ts
import { HarnessRegistry } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';

const registry = new HarnessRegistry();
registry.register(createFakeProviderFactory({ cancelMode: 'native' }));

const client = await registry.connect(createFakeProfile());
const session = await client.createSession();

try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'synthetic input' }],
  });
  await run.result();
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
}
```

Fake
Provider は合成テキストだけを扱い、一つの Session で同時に一つの Run を実行します。resume、複数の cancellation
mode、native access、制限済み未知 Provider
Event を設定でき、ホストの境界テストに使えます。

## Fixture の Run Trace を検証する

`validatePortableRunTrace()` は Provider
mapping テストで sequence の単調性、終端の一意性、Event と `RunResult`
の一致を確認します。上流の raw protocol 検証は Adapter の責任です。

## 制限

- 開発用パッケージであり、実 Provider の compatibility 証拠にはなりません；
- Fake Provider は第三者 Harness の実装を表しません；
- 共有スイートは Provider 固有の negative test と live
  evidence を置き換えません。

全テスト項目と設定は[英語の詳細ドキュメント](./README.md)を参照してください。

## 共有 Interaction スイート

`defineInteractionConformanceSuite()`
は明示的に有効化します。新しい Factory/Profile、合成 `input`、観測する
`kind`、空でない有効な `responses`
配列を渡します。Fixture は Run ごとに一つの Interaction を要求し、応答後に終了する必要があります。承認では、提供される場合に許可と拒否の両方を含めます。各ケースは二秒の Run 期限を使い、必ず Client を閉じます。

観測された Capability、Event の所有権、一度だけの解決、重複と別 Session からの応答拒否、取消の強さ、切断後の無効化を検証します。取消と確定済み終端の競合は許容します。不正な Native
Payload、有効期限、Transport 確認、Protocol 順序は Provider 固有テストで補います。Codex、OpenCode、Hermes、OpenClaw、Pi は合成 Protocol
Fixture でこのスイートを実行します。Pi は `kind: 'provider'`
を使い、DSH は現在 Host 応答 API を公開しないため対象外です。

```ts
import { defineInteractionConformanceSuite } from '@harapter/conformance';

defineInteractionConformanceSuite({
  name: 'Example approval fixture',
  createFactory: createApprovalFixtureFactory,
  createProfile: createApprovalFixtureProfile,
  input: { parts: [{ type: 'text', text: 'synthetic approval input' }] },
  kind: 'approval',
  responses: [
    { kind: 'approval', decision: 'approve' },
    { kind: 'approval', decision: 'deny' },
  ],
});
```

二つの Fixture 作成関数は Adapter のテスト側で用意します。

## Vitest 外で Fake Interaction を使う

公開サブパス `@harapter/conformance/fake` は `createFakeProfile`、
`createFakeProviderFactory`、既定の識別子、`FakeProviderOptions`
を Vitest の読み込みなしで公開します。オフライン Node デモで利用できます。既存のパッケージ入口も Vitest 向けに同じシンボルを公開します。

`interaction: { kind: 'approval' }`、または `user_input` / `provider`
を指定すると、各 Fake
Run が一つの要求を発行して明示的な応答を待ちます。追加の要求フィールドには合成 Fixture データだけを使います。省略時は通常の Echo 動作で、Interaction は未対応です。Run 識別子は Factory 内で一意であり、開始した Session ハンドルだけが応答できます。異なる種類、重複、別 Session、終了後、有効期限後の応答は拒否されます。

観測する `run.timeout` の mode は `adapter_controlled` です。

承認の拒否は要求を解決して合成 Run を正常終了させ、Run 取消を意味しません。Fake
User Input は空でない Text
Part 配列を受け付け、Native 応答は明示的な Provider 値を保ちます。`RunOptions.timeoutMs`
は 2,147,483,647 以下の正の安全な整数です。期限切れでは `interaction.resolved`
の後に `connection.aborted` を発行し、待機とタイマーを解放します。Native 取消は
`run.cancelled` のままです。

[オフライン Interaction デモ](../../examples/multi-provider-client/interactions.md)
は実ツール、Runtime、モデルを呼び出さずにこの流れを体験できます。

## 関連パッケージ

[すべてのパッケージ](../../README.ja.md#npm-パッケージ一覧)

| パッケージ                                                                                             | ドキュメント                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                                       | [ガイド](../core/README.ja.md)                    |
| [`@harapter/transport-jsonrpc-stdio`](https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio) | [ガイド](../transport-jsonrpc-stdio/README.ja.md) |
| [`@harapter/transport-jsonl-process`](https://www.npmjs.com/package/@harapter/transport-jsonl-process) | [ガイド](../transport-jsonl-process/README.ja.md) |
| [`@harapter/transport-http-sse`](https://www.npmjs.com/package/@harapter/transport-http-sse)           | [ガイド](../transport-http-sse/README.ja.md)      |
| [`@harapter/transport-acp`](https://www.npmjs.com/package/@harapter/transport-acp)                     | [ガイド](../transport-acp/README.ja.md)           |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)                     | [ガイド](../../providers/codex/README.ja.md)      |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)                         | [ガイド](../../providers/dsh/README.ja.md)        |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)                   | [ガイド](../../providers/hermes/README.ja.md)     |
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw)               | [ガイド](../../providers/openclaw/README.ja.md)   |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode)               | [ガイド](../../providers/opencode/README.ja.md)   |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)                           | [ガイド](../../providers/pi/README.ja.md)         |
