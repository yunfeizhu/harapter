<!-- markdownlint-disable MD033 MD041 -->

<p align="center">
  <img src="./docs/assets/harapter-banner.png" alt="1 つのポータブル Core と複数の Agent Harness Runtime を接続する Harapter" width="1200">
</p>

<h1 align="center">Harapter</h1>

<p align="center">
  <strong>複数の Agent Harness を利用するアプリケーション向けの、Provider に依存しない統一 TypeScript API。</strong><br>
  ホストは同一の Client、Session、Run、ストリーミング Event、Capability、Error ライフサイクルで各 Runtime を扱い、Adapter は Provider の状態所有権、観測した Capability、ネイティブ Extension を保持します。
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./docs/api-reference.ja.md">API リファレンス</a> ·
  <a href="./docs/design/README.ja.md">設計</a> ·
  <a href="./examples/README.md">サンプル</a> ·
  <a href="./CONTRIBUTING.md">コントリビューション</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm バージョン"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/releases"><img src="https://img.shields.io/github/v/release/yunfeizhu/harapter?display_name=tag&amp;include_prereleases&amp;sort=semver&amp;style=flat-square&amp;label=release" alt="GitHub Release"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以降">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
</p>

<!-- markdownlint-enable MD033 -->

Harapter は、複数の Agent
Harness を利用するアプリケーション向けのオープンソース Adapter レイヤーです。ホストは Client、Session、Run、ストリーミング Event、Interaction、Capability、Error を 1 つの TypeScript 契約で扱い、独立した Provider
Adapter が公式 SDK やマシンプロトコルへ変換します。

これはアプリケーションと選択した Runtime の間に置く基盤であり、新しい Agent
Loop ではありません。各 Runtime の選択、インストール、認証、セキュリティは引き続きホストが管理します。

## 一つの SDK

**`harapter`** だけをインストールし、ルートから `run()`
を呼び出します。タスクごとに Harness を選ぶと、Harapter がプロトコルの選択、接続、実行、ハンドルの解放を行います。単発の呼び出しに Adapter の import、Registry、設定ファイルは不要です。

## クイックスタート

Node.js 24+ と ESM アプリケーションを使用します：

```sh
npm install harapter
```

`run()` は `harapter@1.0.0`
の後に追加された API です。1.0.0 には含まれないため、この API を含む後続リリースまたはソースビルドを使用してください。

このマシンですでに Pi を使用していますか？次を `app.ts`
として保存します。Harapter は `PATH` から `pi`
を探し、既存のモデルとログイン設定を使用します。

<!-- sdk-example: quick-run.ts -->

```ts
import { run, isHarnessError } from 'harapter';

try {
  const result = await run({ harness: 'pi', input: 'Hello!' });
  // Return result.finalMessage to your application's caller.
  console.log({ status: result.status });
  if (result.status !== 'completed') process.exitCode = 1;
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

`result.finalMessage` は任意の回答、`result.status`
は最終状態です。この例は状態だけを表示します。SDK がイベントを読み取り、Client と Session を閉じます。

新規プロジェクトでは先に `npm init -y` と `npm pkg set type=module`
を実行します。Node.js 24 でファイルを実行します：

```sh
node app.ts
```

選択した Harness はインストールとログインが済んでいるか、HTTP サービスが稼働している必要があります。Harapter は Runtime 本来のツールと権限ポリシーを使用します。タスクは選択した Workspace にアクセスし、モデル利用料金が発生する場合があります。

[SDK](./packages/harapter/README.ja.md) · [API](./docs/api-reference.ja.md#run)
· [DSH](./packages/harapter/README.ja.md#同じ呼び出しで-dsh-を使う)

## 会話を続ける

`openSession()` を一度呼び、各メッセージを `send()` で送信します。同じ native
Session が履歴を保持します。この API は 1.0.0 より後の追加であり、1.0.0 リリースには含まれません。

<!-- sdk-example: quick-chat.ts -->

```ts
import { openSession, isHarnessError } from 'harapter';

try {
  const chat = await openSession({ harness: 'pi' });
  try {
    const first = await chat.send('My name is Alex.');
    // Return finalMessage to your application's authorized conversation UI.
    console.log({
      status: first.status,
      hasText: first.finalMessage !== undefined,
    });
    const second = await chat.send('What is my name?');
    console.log({
      status: second.status,
      hasText: second.finalMessage !== undefined,
    });
  } finally {
    await chat.close();
  }
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

## Harapter を使う理由

| 原則                               | ホストアプリケーションにとっての意味                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **1 つのライフサイクル**           | オーケストレーションを一度実装し、タスクごとに Harness Profile を選択できます。                           |
| **状態には所有者があります**       | Session は、作成元の Provider、接続 Profile、ネイティブ状態に結び付いたままです。                         |
| **Capability は観測に基づきます**  | `native`、`emulated`、`adapter_controlled`、`unsupported`、`unknown` を明確に区別します。                 |
| **終端結果を正確に表現します**     | プロセスや接続の中断を、ネイティブな Run キャンセルや成功完了として扱いません。                           |
| **ネイティブ機能にも到達できます** | 型付き Extension と明示的な Native Escape Hatch により、ポータブルではない有用な動作も保持します。        |
| **未知の Event も観測できます**    | リソース上限を持ち機密情報を除去した Provider Channel に上流の変更を残し、成功 Event へ推測変換しません。 |

## アーキテクチャ

<!-- markdownlint-disable MD033 -->

<p align="center">
  <img src="./docs/assets/harapter-architecture.ja.svg" alt="Harapter のポータブルライフサイクルと Provider Adapter アーキテクチャ" width="1200">
</p>

<!-- markdownlint-enable MD033 -->

Core は Provider SDK を import せず、Provider 名による分岐や Provider
ID による Capability 推測を行いません。プロトコル変換、互換性検証、リソース上限を持つ Transport、機密情報を除去した Fixture は各 Adapter が所有します。

### ポータビリティの境界

| Harapter が共通化するもの                                                  | Provider またはホストが引き続き所有するもの                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Profile の選択と Adapter の動的登録                                        | Runtime のインストール、更新、認証、ライセンス                                |
| Client、Session、Run、順序付き Event Stream、信頼できる Terminal Result    | Agent Loop、Prompt、Model、Tool、Plugin、Skill、ネイティブ設定                |
| Capability Mode、ポータブルな Error、Interaction、ライフサイクル所有権検証 | ネイティブ Checkpoint、Provider ストレージ、サービス可用性                    |
| 型付き Provider Extension と明示的な Native Escape Hatch                   | ホストのタスク保存、Credential 解決、ホストアプリケーションの Security Policy |

## 実装済みモジュール

| 領域                 | 役割とガイド                                                                                                                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portable API**     | [`harapter`](./packages/core/README.ja.md) — 契約、Registry、Capability Requirement、所有権検証、Error、Extension、Native Access                                                                                                                                                  |
| **Conformance**      | [適合性テスト](./packages/conformance/README.ja.md) — 再利用可能なポータブル動作スイートと決定論的 Fake Provider                                                                                                                                                                  |
| **Transport**        | [JSON-RPC stdio](./packages/transport-jsonrpc-stdio/README.ja.md)、[strict JSONL process RPC](./packages/transport-jsonl-process/README.ja.md)、[HTTP/SSE](./packages/transport-http-sse/README.ja.md)、[ACP v1](./packages/transport-acp/README.ja.md)                           |
| **Provider Adapter** | [Codex](./providers/codex/README.ja.md)、[OpenCode](./providers/opencode/README.ja.md)、[DeepSeek Harness](./providers/dsh/README.ja.md)、[Hermes Agent](./providers/hermes/README.ja.md)、[OpenClaw](./providers/openclaw/README.ja.md)、[Pi Agent](./providers/pi/README.ja.md) |
| **リファレンス**     | [Single-Provider ライフサイクル](./examples/single-provider/README.md)と[並行 Multi-Provider Client](./examples/multi-provider-client/README.md)                                                                                                                                  |

## サポートを宣言する前に証拠を揃える

マトリクスに行があるだけではサポートを意味しません。Harapter がインターフェースをソース上でサポート済みと表現するには、Adapter 実装、機密情報を除去した Fixture、Protocol
Mapping とライフサイクルテスト、Provider-negative テスト、共通 Conformance、明示的な互換性境界、live-runtime 証拠が必要です。

| Provider                                         | 公式インターフェース      | 現在の証拠ステータス                                                              |
| ------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------- |
| [Codex](./providers/codex/README.ja.md)          | stable App Server         | **ソース上でサポート** — Fixture、Conformance、互換性、live 証拠あり              |
| [OpenCode](./providers/opencode/README.ja.md)    | stable HTTP/OpenAPI + SSE | **ソース上でサポート** — Fixture、Conformance、互換性、live 証拠あり              |
| [DeepSeek Harness](./providers/dsh/README.ja.md) | SDK Runtime JSON-RPC      | **ソース上で Experimental** — live 証拠あり、Runtime の互換 Version 交渉なし      |
| [Hermes Agent](./providers/hermes/README.ja.md)  | API Server HTTP/SSE       | **ソース上で Experimental** — 0.21.0 で live 検証済み、Runtime 互換性は未交渉     |
| [OpenClaw](./providers/openclaw/README.ja.md)    | ACP v1 bridge             | **ソース上で Supported** — Fixture、Conformance、互換性、live text Run の証拠あり |
| [Pi Agent](./providers/pi/README.ja.md)          | strict JSONL RPC mode     | **ソース上で Experimental** — 0.84.4 で live 検証済み、Runtime 互換性は未交渉     |

「ソース上でサポート」はソース Adapter が保持する証拠を示すもので、公開 Package の保証ではありません。「ソース上で Experimental」は Adapter の実装と、宣言したインターフェースに対する決定論的テストは完了しているものの、必要な live-runtime 証拠が未記録か、接続した Runtime を検証済み証拠へ安全に対応付けられない状態です。

Harapter のライブラリは、ホストアプリケーションに Provider
Runtime をインストールしません。信頼済み Live Canary だけが、一時的な GitHub
Runner 内で選択された現行 Runtime をインストールし、継続的な検証証拠を収集します。

Capability と互換性境界の詳細は、[Provider マトリクス](./docs/design/provider-matrix.ja.md)と各 Provider
README を参照してください。

## その他のサンプル

アプリへの組み込みには[独立した SDK アプリ](./examples/sdk-application/README.ja.md)から始めてください。

- [Single-Provider リファレンス](./examples/single-provider/README.md) — Client
  → Session → Run → Event →
  Result の完全なライフサイクルと安全な Cleanup を示します。
- [Multi-Provider リファレンス](./examples/multi-provider-client/README.md) —
  Profile
  Routing、並行 Stream、Session 単位の Control、所有権検証、明示的な Provider
  Extension 境界を示します。

2 つのリファレンスは既定で決定論的です。テストはサードパーティ Runtime の検出、インストール、認証、実行を行いません。ホストが Runtime 設定を明示的に指定した場合のみ、任意の Live
Entry Point が実行されます。

### リポジトリのサンプルを実行する（貢献者向け、任意）

Harapter 自体や参照アプリを開発する場合だけリポジトリを clone します。Workspace は pnpm
11.23.0 を固定しています。

```sh
git clone https://github.com/yunfeizhu/harapter.git
cd harapter
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

## プロジェクトの状態

npm に公開するのは `harapter` だけで、`latest`
を使用します。Core、Adapter、Transport、Conformance、Workspace ルート、サンプルは非公開です。Release
Please が公開バージョンを管理し、Tarball 検証、Provenance、復旧制御を維持します。PyPI パッケージや独立 CLI は公開しません。

現在は、利用者からのフィードバック、ホストが実行する Experimental
Adapter の Live Evidence、リリース準備に集中しています。Portable Wire
Schema、TypeScript 以外の SDK、Local-socket
Transport は、実際の利用者が必要とした時点で追加します。Goose、Qwen
Code、Crush、GitHub Copilot CLI、Cursor Agent CLI は現在の実装範囲外です。

## ドキュメント

| はじめに読むもの                                                  | 確認できる内容                                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| [アーキテクチャと設計](./docs/design/README.ja.md)                | システム境界、不変条件、契約、設計順序                     |
| [Portable Core 契約](./packages/core/README.ja.md)                | Public TypeScript API と所有権セマンティクス               |
| [Provider マトリクス](./docs/design/provider-matrix.ja.md)        | Provider ごとの Interface、Evidence、Capability ステータス |
| [Provider 実装ガイド](./docs/design/provider-adapter-guide.ja.md) | ポータブルな事実を弱めずに Adapter を構築する方法          |
| [開発ワークフロー](./docs/development.md)                         | Toolchain、Branch、Validation、Review、Pull Request        |
| [コントリビューション](./CONTRIBUTING.md)                         | Contribution の要件と Repository Workflow                  |
| [セキュリティポリシー](./SECURITY.md)                             | Vulnerability の報告とサポート対象の Security Boundary     |
| [リリースポリシー](./RELEASING.md)                                | Release Please、Versioning、公開準備                       |

## よくある質問

### Harapter は Agent Runtime をインストールまたは管理しますか？

いいえ。Runtime の選択、インストール、認証、Credential、ライセンス、Security
Policy はホストが管理します。

### Session を別の Provider や接続 Profile に移動できますか？

できません。Session は、作成元の Provider、Profile、不透明なネイティブ状態に結び付いたままです。作業を移すには新しい Session を作成する必要があり、Harapter は Checkpoint のポータビリティを意味しません。

### プロセスを切断すると Run はキャンセルされますか？

Provider がネイティブキャンセルを証明できる場合を除き、キャンセルされません。Transport
Abort と Provider が確認した Cancellation は異なるライフサイクル結果です。

### Experimental Adapter はプレースホルダーですか？

いいえ。実装、リソース上限と機密情報除去を備えた Fixture、Mapping とライフサイクルテスト、Provider-negative
Coverage、共通 Conformance、明示的な互換性境界が含まれます。Experimental ラベルは、決定論的な実装証拠の不足ではなく、live-runtime 証拠または Runtime 互換性 Probe の未解決境界を示します。

### Package の Versioning と Publishing はどのように行われますか？

Release Please が単一の `harapter`
パッケージをバージョン管理し、検証済み Tarball、SPDX
SBOM、SHA-256 チェックサムを含む不変 GitHub
Release を作成します。別途承認された Workflow が同じ Tarball を Provenance 付きで npm の
`latest` に公開します。内部モジュールに独立したリリース系列はありません。

## 対象外

Harapter は Agent Loop の実装、Provider
Runtime のインストールや更新、Harness 間のネイティブ Checkpoint 変換、ホストのタスク保存、Provider
Plugin Marketplace の管理、Credential の解決、ホストアプリケーションの Security
Policy の暗黙的な変更を行いません。

## ライセンス

[Apache License 2.0](./LICENSE) の下で提供されます。
