<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/conformance</code></h1>

<p align="center"><strong>再利用可能な Harapter ライフサイクルテストと決定的 Fake Provider。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/v/%40harapter%2Fconformance/next?style=flat-square&amp;label=npm%20next" alt="npm next バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/dm/%40harapter%2Fconformance?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha ステータス">
</p>

<!-- markdownlint-enable MD033 -->

このパッケージは Adapter 作者と Harapter アプリのテスト向けです。共有 Vitest スイート、Run
Trace 検証、実 Runtime を必要としない Fake
Provider を提供します。共有スイートの成功は可搬契約の証拠であり、実 Provider の対応証拠ではありません。

## インストール

```bash
pnpm add -D @harapter/conformance@next vitest@^4.1.11
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
