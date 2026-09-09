<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/openclaw</code></h1>

<p align="center"><strong>stable ACP v1 で isolated OpenClaw Gateway Session を駆動します。</strong></p>

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

`harapter/openclaw` は公式 `openclaw acp` stdio Bridge を起動し、stable ACP
v1 の Session、Prompt、Event、Permission、Resume、cancellation を Harapter に mapping します。OpenClaw
Gateway の導入、設定、認証、運用はホストが行います。

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

| 環境変数                    | 設定値                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| `HARAPTER_OPENCLAW_COMMAND` | インストール済み OpenClaw。ホストが先に Gateway を起動、認証します。    |
| `HARAPTER_WORKSPACE`        | 既存の空テストディレクトリの絶対パス。OpenCode はサーバー側のパスです。 |

認証情報は Runtime またはホスト環境に保持し、ソースや Session 参照へ書き込みません。初回は空のテスト Workspace と、ホストが確認したツール無効／読み取り専用設定を使います。

下表の設定を用意して `node app.ts`
を実行します。イベントを消費し、最終テキストを `result.finalMessage`
から取得し、必ずリソースを解放します。stdout はメタデータのみで、内容は認可されたアプリの応答へ渡します。モデル呼び出しはトークンを消費し、ネイティブ Session データを作成する場合があります。

<!-- sdk-example: quick-openclaw.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from 'harapter';
import {
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from 'harapter/openclaw';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createOpenClawProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-openclaw'),
    providerId: OPENCLAW_PROVIDER_ID,
    displayName: 'Application openclaw',
    connection: {
      kind: 'process',
      command: required('HARAPTER_OPENCLAW_COMMAND'),
      args: ['acp', '--no-prefix-cwd'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({
      workspace: { uri: pathToFileURL(workspace).href },
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
    // ACP session/close needs an open connection after the Run has settled.
    await session.close();
  } catch (error) {
    // On failure, abort any active Run and preserve the original error.
    await client.close().catch(() => undefined);
    await session?.close().catch(() => undefined);
    throw error;
  }
  await client.close();
}

await main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
```

[完全なアプリ、レシピ、エラー処理](../../examples/sdk-application/README.ja.md)
· [Harapter npm](https://www.npmjs.com/package/harapter)

## インストール

```bash
pnpm add harapter
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from 'harapter';
import {
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from 'harapter/openclaw';

const registry = new HarnessRegistry();
registry.register(createOpenClawProviderFactory());

const client = await registry.connect({
  profileId: profileId('openclaw-local'),
  providerId: OPENCLAW_PROVIDER_ID,
  displayName: 'OpenClaw',
  connection: {
    kind: 'process',
    command: 'openclaw',
    args: ['acp'],
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

## Session と Run

- initialize は stable ACP v1 と implementation name `openclaw-acp`
  を検証します；
- 新 Session は isolated Gateway Session Key を持ち、native
  ID と route は Profile に束縛されます；
- Resume には同じ Provider、Profile、Compatibility、isolated route が必要です；
- ACP Connection 全体で active Run は一つです；
- text と handshake が許す Image Reference を扱い、Generic File/Native
  Input は対象外です；
- validated ACP Prompt Response だけが terminal authority です；
- `run.cancel()` は authoritative `cancelled` Response で native
  cancellation になります；
- valid Permission Request を観測すると Approval Capability が `unknown` から
  `native` になります；
- 未知 ACP message は bounded redacted observation になり、Prompt、path、Tool
  content を保持しません。

local timeout/abort で remote
mutation を確認できない場合、Connection を abort し、cancellation や success にはしません。`end_turn`
は完了、`refusal`、`max_tokens`、 `max_turn_requests` は失敗、EOF、Process
Loss、Queue Overflow は `connection_aborted` です。

## Compatibility と制限

stable ACP v1 は negotiated protocol version を持つため、connection 時に Runtime
identity と必須 structure を検証できます。Fixture、Provider Negative、shared
conformance、real completion、cross-Client Resume、Native
Cancellation の evidence があります。

shared Gateway routing、History Replay、Session MCP、Audio、Generic
File、Filesystem/ Terminal Client Service、自動 Process
Restart、Adapter 所有の Gateway
WebSocket は対象外です。Workspace は ACP に渡しますが Tool の実行 Directory は
`unknown` です。詳細は [英語のドキュメント](./README.md)を参照してください。

## 原生 Session 履歴操作

ACP は fork を広告しません。`createOpenClawProviderFactory({ gateway })` に
`OpenClawGatewayBinding` を明示的に渡してください。`profileId` は ACP
Profile と一致し、`methods`
は同じ Gateway の hello、`request(method, params, { signal })`
は認証済み RPC に対応します。ACP と同じ Gateway／ストアへの接続、認証、再接続、破棄はホストが管理します。Harapter は接続を自動検出・インストールしません。
`sessions.list` と `sessions.create` を観測した場合のみ拡張を公開します。

`OpenClawSessions.fork(ref)` は正確な隔離ルートと親のポリシーを確認し、
`fork: true`、`forkFrom: last-completed` で `sessions.create`
を呼び出します。入力と command
hooks は送信しません。系譜・権限・ディレクトリを検証後、 `requireExisting: true`
で ACP に子を接続します。継承を保証できない worktree／session-root、リモート実行、子 Agent 所有、Session 単位の
`sendPolicy`、incognito、非公開アクセスは拒否します。処理中は新規 ACP 操作を拒否し、不確かな変更・接続では ACP
Client を閉じます。ホストが AbortSignal を無視しても各 RPC は
`operationTimeoutMs` で終了します。Gateway 接続の管理責任はホストに残ります。

親 Run の終了後に呼び出してください。別 Client や外部 writer も含め、親を同時変更しないことをホストが保証します。ローカル予約は別プロセスをロックしません。子参照は同じ Provider／Profile に属します。履歴範囲と親のライフサイクルが異なるため、portable
`session.fork` は引き続き非対応です。

```ts
import {
  OPENCLAW_SESSION_EXTENSION,
  type OpenClawSessions,
} from 'harapter/openclaw';

const sessions = client
  .extensions()
  .get<OpenClawSessions>(OPENCLAW_SESSION_EXTENSION);
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
| [`harapter/codex`](https://www.npmjs.com/package/harapter)       | [ガイド](../codex/README.ja.md)                   |
| [`harapter/dsh`](https://www.npmjs.com/package/harapter)         | [ガイド](../dsh/README.ja.md)                     |
| [`harapter/hermes`](https://www.npmjs.com/package/harapter)      | [ガイド](../hermes/README.ja.md)                  |
| [`harapter/opencode`](https://www.npmjs.com/package/harapter)    | [ガイド](../opencode/README.ja.md)                |
| [`harapter/pi`](https://www.npmjs.com/package/harapter)          | [ガイド](../pi/README.ja.md)                      |
