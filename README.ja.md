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

## npm パッケージ一覧

インストールするのは [`harapter`](https://www.npmjs.com/package/harapter)
だけです。下表は同じ SDK のモジュールで、独立した npm パッケージではありません。単一パッケージの初回公開は未完了です。

| API                                 | ガイド                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| `harapter`                          | [ガイド](./packages/harapter/README.ja.md)                |
| `harapter/transports/jsonrpc-stdio` | [ガイド](./packages/transport-jsonrpc-stdio/README.ja.md) |
| `harapter/transports/jsonl-process` | [ガイド](./packages/transport-jsonl-process/README.ja.md) |
| `harapter/transports/http-sse`      | [ガイド](./packages/transport-http-sse/README.ja.md)      |
| `harapter/transports/acp`           | [ガイド](./packages/transport-acp/README.ja.md)           |
| `harapter/conformance`              | [ガイド](./packages/conformance/README.ja.md)             |
| `harapter/codex`                    | [ガイド](./providers/codex/README.ja.md)                  |
| `harapter/dsh`                      | [ガイド](./providers/dsh/README.ja.md)                    |
| `harapter/hermes`                   | [ガイド](./providers/hermes/README.ja.md)                 |
| `harapter/openclaw`                 | [ガイド](./providers/openclaw/README.ja.md)               |
| `harapter/opencode`                 | [ガイド](./providers/opencode/README.ja.md)               |
| `harapter/pi`                       | [ガイド](./providers/pi/README.ja.md)                     |

## クイックスタート

Node.js 24+ のアプリケーションで既定の入口 `harapter`
を利用し、Runtime の接続設定を切り替えて共通のタスク処理を使います。初回 npm 公開は未完了で、以下のコマンドは初回公開後の手順です。Core、Adapter、Transport、Conformance は内部モジュールとして保守します。

### 1. Harapter を一つインストール

```sh
mkdir my-harapter-app
cd my-harapter-app
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

Harapter はプロトコルのマッピングを同梱し、選択した実装を読み込みます。DSH、Pi、Codex などの Runtime はインストールしません。アプリが使う Runtime だけを用意します。Tarball には全ての保守対象マッピングが含まれ、選択でダウンロード量は変わりません。高度な構成では同じ SDK の
`harapter/dsh` などのサブパスを利用します。

### 2. 使用する Runtime を設定

[DSH ガイド](./providers/dsh/README.ja.md) に従って公式 CLI、モデル認証情報、
`sdk-minimal` Profile、ツール無効の Patch を準備します。`HARAPTER_HARNESS=dsh`、
`HARAPTER_WORKSPACE`、`HARAPTER_DSH_COMMAND`、`HARAPTER_DSH_PATCH`、
`HARAPTER_DSH_PROVIDER`、`HARAPTER_DSH_MODEL` を設定します。

[OpenCode](./providers/opencode/README.ja.md)
の場合は、認証済みでツールを無効にしたサーバーを用意し、`HARAPTER_HARNESS=opencode`、`HARAPTER_WORKSPACE`（サーバー上の絶対ディレクトリ）、`HARAPTER_OPENCODE_URL`、`OPENCODE_SERVER_PASSWORD`、任意の
`OPENCODE_SERVER_USERNAME`（既定値
`opencode`）を設定します。選択した Profile の設定だけが必要です。空のテスト Workspace を使い、モデル利用料金に注意してください。

### 3. 共通のアプリケーション処理を実行

`app.ts` として保存します。両方の接続設定は同じ `runTask` を呼び、業務コードは
`harapter` だけをインポートします。

<!-- sdk-example: quick-unified.ts -->

```ts
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createHarapter,
  providerId,
  profileId,
  HarnessError,
  isHarnessError,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRegistry,
  type HarnessSession,
  type CreateSessionInput,
} from 'harapter';

/** The same business function runs on every configured harness. */
export async function runTask(
  harapter: HarnessRegistry,
  profile: HarnessProfile,
  text: string,
  onEvent: (event: HarnessEvent) => void,
  sessionOptions: CreateSessionInput = {},
) {
  const client = await harapter.connect(profile);
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession(sessionOptions);
    const run = await session.start(
      { parts: [{ type: 'text', text }] },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      onEvent(event);
      if (event.type === 'interaction.requested')
        throw new HarnessError(
          'unsupported_capability',
          'This text example requires a non-interactive Runtime configuration.',
          { retryable: false },
        );
    }
    return { result: await run.result(), sessionRef: session.ref() };
  } finally {
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

/** Only connection configuration differs; Runtime preparation belongs to the host. */
function selectedProfile(): HarnessProfile {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const profiles = {
    dsh: (): HarnessProfile => ({
      profileId: profileId('local-dsh'),
      providerId: providerId('deepseek.harness'),
      displayName: 'Local DSH',
      connection: {
        kind: 'process',
        ownership: 'adapter',
        cwd: workspace,
        command: required('HARAPTER_DSH_COMMAND'),
        args: [
          '--profile',
          'sdk-minimal',
          '--patch',
          required('HARAPTER_DSH_PATCH'),
        ],
      },
      providerOptions: {
        provider: required('HARAPTER_DSH_PROVIDER'),
        model: required('HARAPTER_DSH_MODEL'),
      },
    }),
    opencode: (): HarnessProfile => ({
      profileId: profileId('local-opencode'),
      providerId: providerId('opencode'),
      displayName: 'Local OpenCode',
      connection: {
        kind: 'endpoint',
        ownership: 'external',
        transport: 'http',
        url: required('HARAPTER_OPENCODE_URL'),
        authRef: { scheme: 'env', id: 'opencode' },
      },
    }),
  };
  const name = required('HARAPTER_HARNESS');
  if (name !== 'dsh' && name !== 'opencode')
    throw new Error('Select dsh or opencode.');
  return profiles[name]();
}

async function main() {
  const harapter = await createHarapter({
    harnesses: ['dsh', 'opencode'],
    resolveAuthHeaders: (ref) => {
      if (ref.scheme !== 'env' || ref.id !== 'opencode')
        throw new Error('Unknown authentication reference.');
      return {
        authorization:
          'Basic ' +
          Buffer.from(
            (process.env['OPENCODE_SERVER_USERNAME'] ?? 'opencode') +
              ':' +
              required('OPENCODE_SERVER_PASSWORD'),
          ).toString('base64'),
      };
    },
  });
  const { result } = await runTask(
    harapter,
    selectedProfile(),
    'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
    (event) => {
      console.log({ type: event.type, sequence: event.sequence });
    },
    { workspace: { uri: pathToFileURL(required('HARAPTER_WORKSPACE')).href } },
  );
  // Return result.finalMessage to an authorized application UI; log metadata only.
  console.log({
    status: result.status,
    hasText: result.finalMessage !== undefined,
  });
  if (result.status !== 'completed') process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        error: isHarnessError(error) ? error.code : 'application_failed',
      }),
    );
    process.exitCode = 1;
  });
}
```

`node app.ts` を実行すると、イベント種別に続いて
`{ status: "completed", hasText: true }` を表示します。`result.finalMessage`
は認可済み UI に返す任意の最終テキストです。失敗した Run は失敗のまま扱います。イベントを消費し、60 秒の期限を設定してリソースを閉じますが、外部サーバーは停止しません。この例では対話不要の Runtime ポリシーを使用してください。

### 4. 実際のプロジェクトへの統合

リクエストハンドラーで `runTask`
をインポートします。接続と秘密情報の解決は構成層に置き、タスクごとに Profile を選択してタスクと結果の処理を共有します。
[入口ガイド](./packages/harapter/README.ja.md)
は設定、能力の境界、エラーを定義し、
[Runtime Profile の例](./examples/runtime-profiles/README.ja.md)
は実行可能なソースです。 [サービスの例](./examples/sdk-application/README.ja.md)
にはホストストレージ、再接続、キャンセル、承認 UI のレシピがあります。

Session は元の Provider、Profile、ネイティブ状態に固定されます。Runtime の変更後は新しい Session を作成します。イベントの外側の構造は共通ですが、`event.data`
は Adapter のマッピングに従います。名前からキャンセルや fork 能力を推測せず、私的な内容、認証情報、Session 状態をログへ出しません。

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
| **Portable API**     | [`harapter`](./packages/core/README.ja.md) — 契約、Registry、Capability Requirement、所有権検証、Error、Extension、Native Access                                                                                                                                                  |
| **Conformance**      | [`harapter/conformance`](./packages/conformance/README.ja.md) — 再利用可能なポータブル動作スイートと決定論的 Fake Provider                                                                                                                                                        |
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
Please が公開バージョンを管理し、Tarball 検証、Provenance、復旧制御を維持します。単一パッケージの初回公開は未完了です。PyPI パッケージや独立 CLI は公開しません。

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
