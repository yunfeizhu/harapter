<!-- markdownlint-disable MD033 MD041 -->

<p align="center">
  <img src="https://raw.githubusercontent.com/yunfeizhu/harapter/main/docs/assets/harapter-banner.png" alt="1 つのポータブル Core と複数の Agent Harness Runtime を接続する Harapter" width="1200">
</p>

<h1 align="center">Harapter</h1>

<p align="center">
  <strong>複数の Agent Harness を利用するアプリケーション向けの、Provider に依存しない統一 TypeScript API。</strong><br>
  ホストは同一の Client、Session、Run、ストリーミング Event、Capability、Error ライフサイクルで各 Runtime を扱い、Adapter は Provider の状態所有権、観測した Capability、ネイティブ Extension を保持します。
</p>

<p align="center">
  <a href="https://github.com/yunfeizhu/harapter/blob/main/packages/harapter/README.md">English</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/packages/harapter/README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/packages/harapter/README.ja.md">日本語</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.ja.md">API リファレンス</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/docs/design/README.ja.md">設計</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/examples/README.md">サンプル</a> ·
  <a href="https://github.com/yunfeizhu/harapter/blob/main/CONTRIBUTING.md">コントリビューション</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm バージョン"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/releases"><img src="https://img.shields.io/github/v/release/yunfeizhu/harapter?display_name=tag&amp;include_prereleases&amp;sort=semver&amp;style=flat-square&amp;label=release" alt="GitHub Release"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以降">
  <a href="https://github.com/yunfeizhu/harapter/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
</p>

<!-- markdownlint-enable MD033 -->

`harapter` は Agent Harness
Runtime を共通のアプリケーション API に適合させます。DSH、OpenCode、Codex、Hermes、OpenClaw、Pi を、同じ Client、Session、Run、イベントの外側の構造、最終結果の契約で扱えます。

インストールするのは **`harapter` 一つ**です。共通 API は全て **`harapter`**
からインポートします。アプリが設定済み Runtime を選ぶと、Harapter が内部のプロトコル実装を選択します。Harness ごとに Adapter をインポートする必要はありません。

[API リファレンス](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.ja.md)

## クイックスタート

Node.js
24+ と ESM アプリケーションを使用します。すでに利用している Runtime に合わせて、**DSH**、**Pi**、**OpenCode**
の例を選びます。

**必要なバージョン：**以下の例では `harapter@1.1.1` 以降を使用してください。

新しいアプリケーションのディレクトリでインストールします：

```sh
npm init -y
npm pkg set type=module
npm install harapter
```

Harapter は既存の Runtime に接続します。選択する Harness だけをインストールして認証するか、その HTTP サーバーを起動してください。タスクは Runtime のツールと権限を使用し、Workspace へのアクセスやモデル利用料金が発生する場合があります。

以下の完全な例から**一つだけ**を `app.ts` として保存し、実行します：

```sh
node app.ts
```

### 同じ呼び出しで DSH を使う

`PATH` に `dsh`
があり、利用するモデルルートが設定済みであることを確認します。`your-provider` と
`your-model`
を、そのルートの Provider とモデル ID に置き換えます。DSH の SDK ハンドシェイクには両方が必要です。マシンインターフェースの起動引数は Harapter が設定します。

<!-- sdk-example: quick-dsh-run.ts -->

```ts
import { run, isHarnessError } from 'harapter';

try {
  const result = await run({
    harness: 'dsh',
    input: 'Hello!',
    model: { provider: 'your-provider', id: 'your-model' },
  });
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

### Pi：ローカルの認証とモデル設定を使う

`PATH` に `pi`
があり、モデルと認証情報が設定済みであることを確認します。Pi はその設定を使用します。`run.model`
による上書きは受け付けません。

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

### OpenCode：既存の HTTP サーバーに接続する

以下は `http://127.0.0.1:4096`
で**起動済みの OpenCode サーバー**に接続する例です。実際のサーバーに合わせて
`url` を変更します。認証が必要な場合は、アプリケーションの Secret
Store から取得したヘッダーを `headers`
に渡します。モデルの認証情報は OpenCode が管理します。

```ts
import { run, isHarnessError } from 'harapter';

try {
  const result = await run({
    harness: 'opencode',
    url: 'http://127.0.0.1:4096',
    input: 'Hello!',
  });
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

三つの例は同じ `RunResult` を返します。`status` は終端状態、`finalMessage`
は呼び出し元や会話 UI に渡す任意の回答です。例では状態だけを出力します。各
`run()`
は新しい Session を作成し、イベントを消費して、所有する Client と Session を解放します。返された
`failed` と接続時の例外は別々に処理します。

### Codex、Hermes、OpenClaw

上記の import、結果処理、`try/catch` を維持し、`run()`
の呼び出しだけを必要なものに置き換えます：

| Harness  | 置き換える呼び出し                                    | Runtime の準備                                                                        |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Codex    | `await run({ harness: 'codex', input: 'Hello!' })`    | 認証済みの `codex` が `PATH` に必要です。Harapter が App Server stdio を起動します。  |
| Hermes   | `await run({ harness: 'hermes', input: 'Hello!' })`   | `http://127.0.0.1:8642` の HTTP サーバーが必要です。必要に応じて `url` を変更します。 |
| OpenClaw | `await run({ harness: 'openclaw', input: 'Hello!' })` | 設定済みの `openclaw` が `PATH` に必要です。Harapter が `openclaw acp` を起動します。 |

Runtime の準備と互換性：
[DSH](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.ja.md)
·
[Pi](https://github.com/yunfeizhu/harapter/blob/main/providers/pi/README.ja.md)
·
[OpenCode](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.ja.md)
·
[Codex](https://github.com/yunfeizhu/harapter/blob/main/providers/codex/README.ja.md)
·
[Hermes](https://github.com/yunfeizhu/harapter/blob/main/providers/hermes/README.ja.md)
·
[OpenClaw](https://github.com/yunfeizhu/harapter/blob/main/providers/openclaw/README.ja.md)

全オプション、イベント、Runtime Binding：
[API](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.ja.md#run)

## 会話を続ける

`openSession()` を一度呼び、各メッセージを `send()` で送信します。同じ native
Session が履歴を保持します。

`openSession()`
は上記と同じ Runtime オプションを受け取ります。必要に応じて DSH の
`model`、OpenCode の `url` / `headers` を渡し、その後の `chat.send()`
は共通のまま使えます。既存の Session は元の Runtime に紐付いたままです。

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

## Runtime の接続方式を選ぶ

`run()` と `openSession()` は同じ `RuntimeOptions` を使います。`runtime`
を省略すると文書化された CLI または HTTP の既定接続を使います。Harapter
adapter の追加 import は不要です。

埋め込み Pi では、使用する native
Runtime だけをインストールし（`npm install @earendil-works/pi-coding-agent@0.85.1`）、Factory を渡します。Host は認証、Model、Tool、Resource
Discovery、共有 ModelRuntime を管理します。Factory は毎回新しい idle
Session の排他的所有権を Harapter に移譲します。会話を閉じるとその Session だけが破棄され、共有 Host
Runtime は保持されます。

```ts
import { openSession, isHarnessError } from 'harapter';
import { createAgentSession } from '@earendil-works/pi-coding-agent';

try {
  const chat = await openSession({
    harness: 'pi',
    runtime: {
      kind: 'pi-sdk',
      version: '0.85.1',
      createSession: async () => (await createAgentSession()).session,
    },
  });
  try {
    const result = await chat.send('Hello!');
    // Return result.finalMessage to your application's authorized conversation UI.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
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

既存 DSH
Gateway は Host が認証した Server に接続します。`protocol`、`storeId`、`exclusiveSessions`
は Host による明示的な保証です。Cookie
Resolver はメモリ内だけで保持します。Harapter は Server の起動や launch
token の交換を行いません。この Binding に process/model/workspace/header の上書きを混在させず、Runtime 設定または native
Control を使用してください。

```ts
import { openSession, DSH_GATEWAY_PROTOCOL, isHarnessError } from 'harapter';

try {
  const chat = await openSession({
    harness: 'dsh',
    runtime: {
      kind: 'dsh-gateway',
      url: 'http://127.0.0.1:9345',
      protocol: DSH_GATEWAY_PROTOCOL,
      storeId: 'my-dsh-store',
      exclusiveSessions: true,
      resolveCookie: () => process.env.DSH_GATEWAY_COOKIE ?? '',
    },
  });
  try {
    const result = await chat.send('Hello!');
    // Return result.finalMessage to your application's authorized conversation UI.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
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

OpenCode と Hermes は HTTP/SSE を使用し、Harapter 管理の SDK
Subprocess は不要です。Codex は App Server stdio を使用します。OpenClaw の Run
Transport は ACP のままで、`runtime: { kind: "openclaw-acp", gateway }` に既存の
`OpenClawGatewayBinding`
を渡せます。profileId は保持されます。Gateway は対応する native Session
Control のみを追加し、Harapter は破棄しません。

一つの会話で同時に実行できる Run は一つです。`send()`
は Event を消費し、`{ timeoutMs, onEvent }` を受け付けます。既定期限は
`openSession()` の値（未指定なら 60000
ms）です。Observer、期限、Interaction の失敗時は所有 Connection を閉じます。これは native
Cancellation の証明ではありません。Interaction は継承した `start()` /
`respond()`、対応する取消は Run の `cancel()` を使います。`chat.client`
で同じ Connection の Capability、Extension、Resume、Native
Control にアクセスできます。chat の Close は Client も閉じるため、独立管理や Resume が必要なら Client/Session
API を使ってください。

## アプリケーションでイベントを受け取る

画面や Worker が進捗を必要とする場合は `onEvent`
を渡します。非同期コールバックも使用でき、Harapter は完了を待ちます。イベントの外枠は共通ですが、ペイロードは各 Adapter の文書に従います。非公開データはアプリケーション内部で扱ってください。

```ts
import { run } from 'harapter';

const result = await run({
  harness: 'pi',
  input: 'Hello!',
  onEvent(event) {
    console.log({ type: event.type });
  },
});
```

## 結果、期限、Session

各 `run()`
は新しい Session を作成し、`failed`、`cancelled`、`connection_aborted`
を含む確定した `RunResult`
を返します。結果が返っても成功とは限りません。接続、コールバック、解放の失敗は安全な
`HarnessError` になります。`isHarnessError` で確認して `error.code` を読みます。

呼び出し全体の既定期限は 60 秒で、`timeoutMs` で変更できます。期限切れは
`timeout`
を返し、所有する接続を閉じます。これはネイティブキャンセルの成功を意味せず、リモートタスクは継続する場合があります。解放処理は期限を超えることがあり、遅れて返った接続や Session は到着時に閉じます。

`run()` は承認やユーザー入力に自動応答しません。`interaction.requested` は
`unsupported_capability`
で失敗します。対話、再開、分岐、ネイティブキャンセル、独自の接続ポリシーは Client/Session
Control を使います。通常の複数ターン会話と DSH Gateway 接続は上記の
`openSession()`
を使えます。ハンドルの解放はネイティブ履歴の削除や外部サーバーの停止ではありません。

[全オプションの型、既定コマンド、URL とモデルの制限](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.ja.md#run)

## 応用：アプリケーションが管理する接続 Profile

Session の所有権を明示的に管理する場合、`quick-start.ts` と `runtime-config.ts`
を一緒にコピーするか、再利用できる `runTask`
サービス例を使います。これらは応用例であり、`run()` の前提手順ではありません。

[quick-start.ts](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/src/quick-start.ts)
·
[runtime-config.ts](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/src/runtime-config.ts)
·
[runTask](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/src/quick-unified.ts)

## 公開 API と設定

メソッド、引数、戻り値、エラーは以下で確認できます。
[API リファレンス](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.ja.md)。

組み込み Harness の共通 API は全て `harapter`
からインポートします。接続 Profile を切り替える際に、Provider のサブパスをインポートしたり、Adapter
Factory を手動で登録したりする必要はありません。

- `createHarapter(options?)` は `Promise<HarnessRegistry>`
  を返します。構成時に一度 await し、`connect(profile)`
  で対象 Runtime へ接続します。Registry の作成時には接続もプロセス起動も行いません。
- `HarapterOptions.harnesses`
  は組み込み実装を明示的に選び、重複は一度だけ読み込みます。引数省略では空の拡張可能な Registry を返し、設定オブジェクトを渡す場合には
  `harnesses` 配列が必要です。
- `resolveAuthHeaders(ref)` は OpenCode と Hermes のホスト所有 HTTP ヘッダーを、
  `resolveGatewayCookie(ref, signal)` は DSH Gateway
  Cookie を供給します。対応する Adapter が認証を必要とするときだけ呼び出し、正確な Secret 参照でホストが認可します。
- Profile、入力、イベント、結果、能力、エラー、拡張など、全ての
  [Core 公開 API](https://github.com/yunfeizhu/harapter/blob/main/packages/core/README.ja.md)
  を再公開します。Adapter 名前空間や上流 Runtime API は公開しません。

| 選択名     | Profile `providerId` | Runtime 接続と互換性の所有文書                                                                               |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `codex`    | `openai.codex`       | [Codex app-server](https://github.com/yunfeizhu/harapter/blob/main/providers/codex/README.ja.md)             |
| `dsh`      | `deepseek.harness`   | [DSH SDK プロセスまたは Gateway](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.ja.md) |
| `hermes`   | `nous.hermes-agent`  | [Hermes HTTP サーバー](https://github.com/yunfeizhu/harapter/blob/main/providers/hermes/README.ja.md)        |
| `openclaw` | `openclaw`           | [OpenClaw ACP プロセス](https://github.com/yunfeizhu/harapter/blob/main/providers/openclaw/README.ja.md)     |
| `opencode` | `opencode`           | [OpenCode HTTP サーバー](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.ja.md)    |
| `pi`       | `pi.agent`           | [Pi JSONL プロセス](https://github.com/yunfeizhu/harapter/blob/main/providers/pi/README.ja.md)               |

Profile は `connection`、`providerOptions`、任意の `requiredCapabilities`
で既存の機械インターフェースを指定します。任意の Runtime オブジェクトからプロトコルを推測しません。各組み込み実装の互換性と能力は、対応するガイドと検証証拠が定義します。

## ライフサイクル、エラー、ネイティブ連携

返すのは既存の Core
Registry です。Profile のスナップショット、接続種別、能力要件を検証し、Session を作成元の Provider、Profile、ネイティブ状態へ固定します。Harness の切り替え後は新しい Session を作成します。登録によってチェックポイント移行、ネイティブ fork/cancel、Runtime のツールや権限ポリシーの置き換えが可能になるわけではありません。

`run.events()` を継続的に消費し、`run.result()`
を最終状態の根拠とします。イベント種別と外側の構造は共通ですが、`event.data`
は Adapter のマッピングに従います。全 Payload を共通のテキスト差分やツール構造と仮定しません。共通ライフサイクルを超える操作は能力宣言と型付き拡張で扱います。私的な内容や Session 参照は認可済みホストストレージで管理し、汎用ログには記録しません。

不正な選択は `invalid_request`、同梱実装の初期化失敗は秘匿化した
`provider_api_incompatible`
です。設定またはインストールの修正前には再試行しません。未登録 Profile は
`provider_not_found`、接続・認証・ライフサイクルのエラーは既存 Core の分類です。

カスタム Adapter は `registry.register(factory)`
で登録します。OpenClaw のホスト所有 Gateway バインディングなどのネイティブ構成では、既定の組み込み項目を選択せず、`harapter/openclaw`
の Factory を明示的に登録します。全て同じ SDK のサブパスであり、Core とネイティブ拡張の契約は変わりません。

## 検証とパッケージリンク

[Runtime Profile の例](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/README.ja.md)
は DSH プロセスと認証付き OpenCode HTTP
Fixture で共通タスク処理、終端イベント、Session 所有権、終了処理を確認します。公開チェックは隔離プロジェクトに
`harapter`
Tarball だけを直接インストールし、独立 Adapter が存在しない状態で型検査と両 Fixture を実行します。これは決定的な統合証拠であり、新たな実 Runtime 検証ではありません。

[npm](https://www.npmjs.com/package/harapter) ·
[DSH](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.ja.md)
·
[OpenCode](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.ja.md)

## パッケージに含まれるもの

SDK は Core と保守対象の第一者プロトコル実装を全て同梱し、実行時依存は `ws`
だけです。Harness 選択は動的な読み込み範囲を制御し、Tarball のダウンロードサイズは変えません。上流 Harness
SDK や Runtime 配布物は `harapter` の依存関係ではありません。

ソースリポジトリの
`packages/core`、`packages/transport-*`、`packages/conformance`、`providers/*`
は非公開 Workspace モジュールです。それぞれの実装とテストで一つの公開パッケージを構築します。利用者が追加でインストールする npm パッケージではありません。役割は[ソースディレクトリの説明](https://github.com/yunfeizhu/harapter/blob/main/packages/README.md)を参照してください。

`harapter/testing` の Fake Provider は Vitest を必要としません。任意の
`harapter/conformance`
テストスイートを使う場合だけ Vitest を別途インストールします。

## 公開サブパス

以下は全て一つのインストール済みパッケージに含まれます。通常のアプリはルート入口を使用し、ネイティブ連携、カスタム Adapter、テストは明示的なサブパスを使用できます。

| Import                              | Guide                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `harapter`                          | [core](https://github.com/yunfeizhu/harapter/blob/main/packages/core/README.ja.md)                                       |
| `harapter/transports/jsonrpc-stdio` | [transport-jsonrpc-stdio](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-jsonrpc-stdio/README.ja.md) |
| `harapter/transports/jsonl-process` | [transport-jsonl-process](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-jsonl-process/README.ja.md) |
| `harapter/transports/http-sse`      | [transport-http-sse](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-http-sse/README.ja.md)           |
| `harapter/transports/acp`           | [transport-acp](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-acp/README.ja.md)                     |
| `harapter/conformance`              | [conformance](https://github.com/yunfeizhu/harapter/blob/main/packages/conformance/README.ja.md)                         |
| `harapter/codex`                    | [adapter-codex](https://github.com/yunfeizhu/harapter/blob/main/providers/codex/README.ja.md)                            |
| `harapter/dsh`                      | [adapter-dsh](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.ja.md)                                |
| `harapter/hermes`                   | [adapter-hermes](https://github.com/yunfeizhu/harapter/blob/main/providers/hermes/README.ja.md)                          |
| `harapter/openclaw`                 | [adapter-openclaw](https://github.com/yunfeizhu/harapter/blob/main/providers/openclaw/README.ja.md)                      |
| `harapter/opencode`                 | [adapter-opencode](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.ja.md)                      |
| `harapter/pi`                       | [adapter-pi](https://github.com/yunfeizhu/harapter/blob/main/providers/pi/README.ja.md)                                  |
| `harapter/testing`                  | [Fake Provider](https://github.com/yunfeizhu/harapter/blob/main/packages/conformance/README.ja.md)                       |

## 独立パッケージからの移行

`@harapter/*` 依存を `harapter` に置き換えます。組み込み Harness のアプリ接続は
`createHarapter({ harnesses: [...] })` を使い、共通の型を `harapter`
からインポートします。Adapter
Factory を一つずつインポート、登録する必要はありません。既存 Session の所有権とネイティブ互換条件は引き続き適用されます。

カスタム Adapter、ネイティブ拡張、低水準テストには上記のサブパスを使用できます。旧パッケージ名は互換エイリアスではないため、アプリの依存関係とインポートを同時に更新してください。
