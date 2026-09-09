<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/codex</code></h1>

<p align="center"><strong>stable Codex App Server を Harapter の可搬ライフサイクルで実行します。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm バージョン"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
</p>

<!-- markdownlint-enable MD033 -->

このガイドは単一の `harapter`
SDK に含まれるモジュールを説明します。通常のアプリケーション接続は[アプリケーションガイド](../../packages/harapter/README.ja.md)から始めてください。単一パッケージの初回公開は未完了で、以下のインストール手順は公開後のものです。

`harapter/codex` は公式 stable App Server に接続し、Thread、Turn、stream
Event、Interaction、終端、native interrupt を Harapter
API に mapping します。人向け CLI output の scraping は行いません。

## 自分のアプリですぐに使う

Node.js 24+ の ESM プロジェクトで以下の完全な例を `app.ts`
として保存します。Harapter の checkout や非公開インポートは不要です。

```sh
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

### ホストが用意する設定

| 環境変数                 | 設定値                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| `HARAPTER_CODEX_COMMAND` | 認証済みの Codex 実行ファイル。例: codex。                              |
| `HARAPTER_WORKSPACE`     | 既存の空テストディレクトリの絶対パス。OpenCode はサーバー側のパスです。 |

認証情報は Runtime またはホスト環境に保持し、ソースや Session 参照へ書き込みません。初回は空のテスト Workspace と、ホストが確認したツール無効／読み取り専用設定を使います。

下表の設定を用意して `node app.ts`
を実行します。イベントを消費し、最終テキストを `result.finalMessage`
から取得し、必ずリソースを解放します。stdout はメタデータのみで、内容は認可されたアプリの応答へ渡します。モデル呼び出しはトークンを消費し、ネイティブ Session データを作成する場合があります。

<!-- sdk-example: quick-codex.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from 'harapter';
import { CODEX_PROVIDER_ID, createCodexProviderFactory } from 'harapter/codex';

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

[完全なアプリ、レシピ、エラー処理](../../examples/sdk-application/README.ja.md)
· [Harapter npm](https://www.npmjs.com/package/harapter)

## 前提条件

Codex の導入と認証はホストが行います。Adapter は Binary を含まず、credential や
`SecretRef` を読み取らず、Sandbox と Approval Policy を勝手に選びません。

```bash
pnpm add harapter
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from 'harapter';
import { CODEX_PROVIDER_ID, createCodexProviderFactory } from 'harapter/codex';

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

## 原生 Session 履歴操作

`openai.codex.sessions` は `CodexSessions.fork(ref)`
を提供します。永続化済みで idle または未ロードの親 Thread を確認し、新しい Turn を送らずに安定版
`thread/fork` を呼び出します。子 ID は親と異なり、`forkedFromId`
が一致する必要があります。一時 Thread と設定の上書きは対象外です。永続設定の継承は Codex が管理します。変更結果が不明な場合は接続を閉じ、明確な RPC 拒否では親を再利用できます。

親 Run の終了後に呼び出してください。別 Client や外部 writer も含め、親を同時変更しないことをホストが保証します。ローカル予約は別プロセスをロックしません。子参照は同じ Provider／Profile に属します。履歴範囲と親のライフサイクルが異なるため、portable
`session.fork` は引き続き非対応です。

```ts
import { CODEX_SESSION_EXTENSION, type CodexSessions } from 'harapter/codex';

const sessions = client
  .extensions()
  .get<CodexSessions>(CODEX_SESSION_EXTENSION);
if (sessions === undefined)
  throw new Error('Native Session extension unavailable.');
const child = await sessions.fork(session.ref());
// The child uses the normal HarnessSession lifecycle.
await child.close();
```

公式 Runtime、fixture、検証バージョンと再現コマンドは
[Session fork の証拠](../../docs/provider-session-fork-evidence.md)を参照してください。実 Runtime とローカル合成モデルを使用した検証であり、ホスト型モデルサービスの検証ではありません。

## 関連パッケージ

[すべてのパッケージ](../../README.ja.md#npm-パッケージ一覧)

| パッケージ                                                       | ドキュメント                                      |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| [`harapter`](https://www.npmjs.com/package/harapter)             | [ガイド](../../packages/core/README.ja.md)        |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter) | [ガイド](../../packages/conformance/README.ja.md) |
| [`harapter/dsh`](https://www.npmjs.com/package/harapter)         | [ガイド](../dsh/README.ja.md)                     |
| [`harapter/hermes`](https://www.npmjs.com/package/harapter)      | [ガイド](../hermes/README.ja.md)                  |
| [`harapter/openclaw`](https://www.npmjs.com/package/harapter)    | [ガイド](../openclaw/README.ja.md)                |
| [`harapter/opencode`](https://www.npmjs.com/package/harapter)    | [ガイド](../opencode/README.ja.md)                |
| [`harapter/pi`](https://www.npmjs.com/package/harapter)          | [ガイド](../pi/README.ja.md)                      |
