# Harapter

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

`harapter` は複数の Harness Runtime に共通の Client / Session / Run
API で接続するためのアプリケーション入口です。Runtime 接続設定を切り替え、タスク、イベントの外側の構造、最終結果の処理を共有できます。

公開するパッケージは `harapter`
だけです。Core、Adapter、Transport、Conformance は非公開ソースモジュールとして同梱します。単一パッケージの初回 npm 公開は未完了で、以下のインストール手順は公開後に利用できます。

## アプリケーションへインストール

Node.js 24+ と ESM を使い、Harapter パッケージを一つインストールします。

```sh
npm install harapter
npm install -D typescript @types/node
npm pkg set type=module
```

Core と保守対象の第一者プロトコルマッピングを同梱し、実行時依存は小さな `ws`
通信ライブラリだけです。選択した実装を動的に読み込み、上流 Harness
SDK や Runtime はインストールしません。Tarball は全マッピングを含み、選択は読み込み範囲を変えますがダウンロード量は変わりません。`harapter/conformance`
の利用時だけ Vitest を別途インストールします。`harapter/testing`
は Vitest を必要としません。

## DSH または OpenCode を設定して同じコードを実行

以下を `app.ts` として保存します。`runTask` は共通の業務処理で、Runtime の違いは
`selectedProfile`
とホスト認証設定にまとめます。サービスのリクエストハンドラーから `runTask`
を呼び出し、`result.finalMessage` を権限のある UI に返します。

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

## 選択した Runtime の準備

空のテスト Workspace を使います。[DSH ガイド](../../providers/dsh/README.ja.md)
に従い、公式 CLI、`sdk-minimal`
Profile、モデル認証情報、ツールを無効にした Patch を準備します。
`HARAPTER_HARNESS=dsh`、`HARAPTER_WORKSPACE`、`HARAPTER_DSH_COMMAND`、
`HARAPTER_DSH_PATCH`、`HARAPTER_DSH_PROVIDER`、`HARAPTER_DSH_MODEL`
を設定します。

または [OpenCode ガイド](../../providers/opencode/README.ja.md)
に従い、認証済みでツールを無効にしたサーバーを用意します。`HARAPTER_HARNESS=opencode`、
`HARAPTER_WORKSPACE`（サーバー上の絶対ディレクトリ）、`HARAPTER_OPENCODE_URL`、
`OPENCODE_SERVER_PASSWORD`、必要に応じて `OPENCODE_SERVER_USERNAME`（既定値
`opencode`）を設定します。選択した Profile の設定だけが必要です。秘密情報を Profile やログに含めません。

`node app.ts` を実行すると、イベント種別に続いて
`{ status: "completed", hasText: true }`
が表示されます。モデル利用料金が発生する場合があります。60 秒の Run 期限はネイティブキャンセルの証明ではありません。例はホスト UI を必要とする対話を拒否し、終了時に Client と Session を閉じます。外部 OpenCode サーバーは停止しません。

## 公開 API と設定

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
  [Core 公開 API](../core/README.ja.md)
  を再公開します。Adapter 名前空間や上流 Runtime API は公開しません。

| 選択名     | Profile `providerId` | Runtime 接続と互換性の所有文書                                     |
| ---------- | -------------------- | ------------------------------------------------------------------ |
| `codex`    | `openai.codex`       | [Codex app-server](../../providers/codex/README.ja.md)             |
| `dsh`      | `deepseek.harness`   | [DSH SDK プロセスまたは Gateway](../../providers/dsh/README.ja.md) |
| `hermes`   | `nous.hermes-agent`  | [Hermes HTTP サーバー](../../providers/hermes/README.ja.md)        |
| `openclaw` | `openclaw`           | [OpenClaw ACP プロセス](../../providers/openclaw/README.ja.md)     |
| `opencode` | `opencode`           | [OpenCode HTTP サーバー](../../providers/opencode/README.ja.md)    |
| `pi`       | `pi.agent`           | [Pi JSONL プロセス](../../providers/pi/README.ja.md)               |

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

[Runtime Profile の例](../../examples/runtime-profiles/README.ja.md)
は DSH プロセスと認証付き OpenCode HTTP
Fixture で共通タスク処理、終端イベント、Session 所有権、終了処理を確認します。公開チェックは隔離プロジェクトに
`harapter`
Tarball だけを直接インストールし、独立 Adapter が存在しない状態で型検査と両 Fixture を実行します。これは決定的な統合証拠であり、新たな実 Runtime 検証ではありません。

[npm](https://www.npmjs.com/package/harapter) ·
[DSH](../../providers/dsh/README.ja.md) ·
[OpenCode](../../providers/opencode/README.ja.md)

## 公開サブパス

以下は全て一つのインストール済みパッケージに含まれます。通常のアプリはルート入口を使用し、ネイティブ連携、カスタム Adapter、テストは明示的なサブパスを使用できます。

| Import                              | Guide                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `harapter`                          | [core](../../packages/core/README.ja.md)                                       |
| `harapter/transports/jsonrpc-stdio` | [transport-jsonrpc-stdio](../../packages/transport-jsonrpc-stdio/README.ja.md) |
| `harapter/transports/jsonl-process` | [transport-jsonl-process](../../packages/transport-jsonl-process/README.ja.md) |
| `harapter/transports/http-sse`      | [transport-http-sse](../../packages/transport-http-sse/README.ja.md)           |
| `harapter/transports/acp`           | [transport-acp](../../packages/transport-acp/README.ja.md)                     |
| `harapter/conformance`              | [conformance](../../packages/conformance/README.ja.md)                         |
| `harapter/codex`                    | [adapter-codex](../../providers/codex/README.ja.md)                            |
| `harapter/dsh`                      | [adapter-dsh](../../providers/dsh/README.ja.md)                                |
| `harapter/hermes`                   | [adapter-hermes](../../providers/hermes/README.ja.md)                          |
| `harapter/openclaw`                 | [adapter-openclaw](../../providers/openclaw/README.ja.md)                      |
| `harapter/opencode`                 | [adapter-opencode](../../providers/opencode/README.ja.md)                      |
| `harapter/pi`                       | [adapter-pi](../../providers/pi/README.ja.md)                                  |
| `harapter/testing`                  | [Fake Provider](../conformance/README.ja.md)                                   |

## 独立パッケージからの移行

`@harapter/*` 依存を `harapter` に置き換えます。Core 型は
`harapter`、ネイティブ Factory と拡張は該当 Harness サブパス、Transport は
`harapter/transports/*`、Fake Provider は `harapter/testing`、適合性テストは
`harapter/conformance`
からインポートします。アプリ内のインポートを同時に更新してください。旧名の互換エイリアスは提供しません。Session 所有権とネイティブ互換条件は維持します。旧 npm パッケージの削除は別途承認されたレジストリ操作として、代替入口が利用可能になった後に実施します。
