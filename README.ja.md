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
  <a href="./docs/design/README.ja.md">設計</a> ·
  <a href="./examples/README.md">サンプル</a> ·
  <a href="./CONTRIBUTING.md">コントリビューション</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/v/%40harapter%2Fcore?style=flat-square&amp;label=npm" alt="npm バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/dm/%40harapter%2Fcore?style=flat-square" alt="npm ダウンロード数"></a>
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

## npm パッケージ一覧

| パッケージ                                                                                             | ドキュメント                                              |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                                       | [ガイド](./packages/core/README.ja.md)                    |
| [`@harapter/transport-jsonrpc-stdio`](https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio) | [ガイド](./packages/transport-jsonrpc-stdio/README.ja.md) |
| [`@harapter/transport-jsonl-process`](https://www.npmjs.com/package/@harapter/transport-jsonl-process) | [ガイド](./packages/transport-jsonl-process/README.ja.md) |
| [`@harapter/transport-http-sse`](https://www.npmjs.com/package/@harapter/transport-http-sse)           | [ガイド](./packages/transport-http-sse/README.ja.md)      |
| [`@harapter/transport-acp`](https://www.npmjs.com/package/@harapter/transport-acp)                     | [ガイド](./packages/transport-acp/README.ja.md)           |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)                         | [ガイド](./packages/conformance/README.ja.md)             |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)                     | [ガイド](./providers/codex/README.ja.md)                  |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)                         | [ガイド](./providers/dsh/README.ja.md)                    |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)                   | [ガイド](./providers/hermes/README.ja.md)                 |
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw)               | [ガイド](./providers/openclaw/README.ja.md)               |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode)               | [ガイド](./providers/opencode/README.ja.md)               |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)                           | [ガイド](./providers/pi/README.ja.md)                     |

## クイックスタート

Node.js
24 以降を使用します。自分のプロジェクトから始め、通常のアプリには Core と選択した Adapter をインストールします。transport と conformance は主に Adapter 開発とテスト向けです。Harapter の clone は不要です。

### 1. 自分のプロジェクトに SDK を導入する

```sh
mkdir my-harapter-app
cd my-harapter-app
npm init -y
npm pkg set type=module
npm install @harapter/core @harapter/adapter-codex
npm install -D typescript @types/node
```

| Runtime          | 公開済み Adapter                                                  | Connection の所有者        |
| ---------------- | ----------------------------------------------------------------- | -------------------------- |
| Codex            | [`@harapter/adapter-codex`](./providers/codex/README.ja.md)       | Adapter-managed process    |
| OpenCode         | [`@harapter/adapter-opencode`](./providers/opencode/README.ja.md) | Host/external HTTP service |
| DeepSeek Harness | [`@harapter/adapter-dsh`](./providers/dsh/README.ja.md)           | Adapter-managed process    |
| Hermes Agent     | [`@harapter/adapter-hermes`](./providers/hermes/README.ja.md)     | Host/external HTTP service |
| OpenClaw         | [`@harapter/adapter-openclaw`](./providers/openclaw/README.ja.md) | Adapter-managed ACP bridge |
| Pi Agent         | [`@harapter/adapter-pi`](./providers/pi/README.ja.md)             | Adapter-managed process    |

### 2. Runtime を準備して認証する

この例では Codex を使います。[公式手順](https://developers.openai.com/codex/cli/)でインストールし、最初に
`codex`
を実行してログインを完了してください。モデルの認証は Runtime が管理し、呼び出しでトークンを消費する可能性があります。Harapter はマシンインターフェースを使い、インストールや認証は行いません。空のテスト Workspace と既定の読み取り専用ポリシーを使います。

### 3. 完全な SDK 呼び出しを実行する

以下の完全なコードを `app.ts`
に保存します。上でインストールした npm パッケージのみをインポートし、Node.js
24 で直接実行できます。

<!-- sdk-example: quick-codex.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from '@harapter/core';
import {
  CODEX_PROVIDER_ID,
  createCodexProviderFactory,
} from '@harapter/adapter-codex';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createCodexProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-codex'),
    providerId: CODEX_PROVIDER_ID,
    displayName: 'Application codex',
    connection: {
      kind: 'process',
      command: required('HARAPTER_CODEX_COMMAND'),
      args: ['app-server', '--stdio'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({
      workspace: { uri: pathToFileURL(workspace).href },
      providerOptions: {
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
      },
    });
    const run = await session.start(
      {
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
          },
        ],
      },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      if (event.type === 'interaction.requested')
        throw new Error('Configure an explicit host interaction handler.');
      console.log({ type: event.type, sequence: event.sequence });
    }
    const result = await run.result();
    // Use result.finalMessage in your authorized application UI or response.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
    });
    if (result.status !== 'completed') process.exitCode = 1;
  } finally {
    // Client shutdown also releases an active Run if application event handling fails.
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

void main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
```

自分のプロジェクトで実行します。以下は POSIX
shell の例です。Windows では PowerShell で同名の環境変数を設定してください。

```sh
mkdir workspace
export HARAPTER_CODEX_COMMAND=codex
export HARAPTER_WORKSPACE="$PWD/workspace"
node app.ts
```

想定出力はライフサイクルのイベント種別と
`{ status: "completed", hasText: true }` です。`result.finalMessage`
がユーザーの管理された UI に返すモデルのテキストで、サンプルはメタデータだけをログに表示します。失敗やキャンセルは成功した回答ではありません。呼び出しには 60 秒の期限があり、すべてのリソースを閉じます。

### 4. 業務コードへ組み込む

接続設定をアプリの構成モジュールに置き、業務サービスとしてリクエストハンドラーやデスクトップアプリから呼び出します。[完全な SDK アプリ](./examples/sdk-application/README.ja.md)には独立した
`package.json`、TypeScript 設定、テキストと状態を返す service、再接続と再開、ネイティブ fork、キャンセル、並行 Provider、ホスト対話処理があります。公開済みパッケージを使い、独立したプロジェクトへコピーできます。

`isHarnessError(error)` で安定した `code` と `retryable`
を読み取ります。Runtime や認証が不足する場合は設定を修正してから再試行します。`run.events()`
を消費し続け、`run.result()`
を最終状態の根拠とします。Session 参照は元の Provider/Profile とアクセス制御されたホストの保存ポリシーに従って保存、再開してください。raw イベント、ネイティブ状態、認証情報、業務コンテンツをログに出さないでください。

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

| 領域                 | Package とモジュール                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portable API**     | [`@harapter/core`](./packages/core/README.ja.md) — 契約、Registry、Capability Requirement、所有権検証、Error、Extension、Native Access                                                                                                                                            |
| **Conformance**      | [`@harapter/conformance`](./packages/conformance/README.ja.md) — 再利用可能なポータブル動作スイートと決定論的 Fake Provider                                                                                                                                                       |
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

Harapter は同期した **0.x** パッケージバージョンと npm の既定の `latest`
チャネルを使用します。公開パッケージにはレビュー済みの Manifest、Tarball
Consumer
Check、Provenance、公開・ロールバック制御があります。API は 1.0 以前に変更される可能性があります。現在の公開バージョンは npm または GitHub
Releases で確認してください。Workspace
Root と Example は Private のままで、PyPI または Standalone CLI は公開しません。

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

Public Core、Conformance、Transport、Adapter
Package は 1.0 より前は同じ Version で進み、`latest` に公開されます。Workspace
Root と Example は Private のままです。Release Please が Version と GitHub
Release を管理し、各 Immutable Release に検証済みの 12 個の Tarball、SPDX
SBOM、SHA-256
Checksum を含めます。別途承認された Workflow が同じ Tarball を Provenance 付きで npm に公開します。

## 対象外

Harapter は Agent Loop の実装、Provider
Runtime のインストールや更新、Harness 間のネイティブ Checkpoint 変換、ホストのタスク保存、Provider
Plugin Marketplace の管理、Credential の解決、ホストアプリケーションの Security
Policy の暗黙的な変更を行いません。

## ライセンス

[Apache License 2.0](./LICENSE) の下で提供されます。
