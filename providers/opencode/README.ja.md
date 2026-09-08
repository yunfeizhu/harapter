<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-opencode</code></h1>

<p align="center"><strong>ホスト運用の OpenCode HTTP/SSE Server を Harapter に接続します。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-opencode"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-opencode?style=flat-square&amp;label=npm" alt="npm バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-opencode"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-opencode?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-opencode` は stable `opencode serve`
HTTP/OpenAPI と SSE を Harapter
lifecycle に mapping します。Server の導入、認証、起動、停止はホストが行い、Adapter は指定 Endpoint だけに接続して remote
Session を暗黙削除しません。

## 自分のアプリですぐに使う

Node.js 24+ の ESM プロジェクトで以下の完全な例を `app.ts`
として保存します。Harapter の checkout や非公開インポートは不要です。

```sh
npm init -y
npm pkg set type=module
npm install @harapter/core @harapter/adapter-opencode
npm install -D typescript @types/node
```

### ホストが用意する設定

| 環境変数                   | 設定値                                                                  |
| -------------------------- | ----------------------------------------------------------------------- |
| `HARAPTER_OPENCODE_URL`    | 起動済みの OpenCode HTTP サーバー URL。                                 |
| `OPENCODE_SERVER_USERNAME` | Basic-auth ユーザー名。既定値は opencode。                              |
| `OPENCODE_SERVER_PASSWORD` | ホストの認証情報ストレージから取得するサーバーパスワード。              |
| `HARAPTER_WORKSPACE`       | 既存の空テストディレクトリの絶対パス。OpenCode はサーバー側のパスです。 |

認証情報は Runtime またはホスト環境に保持し、ソースや Session 参照へ書き込みません。初回は空のテスト Workspace と、ホストが確認したツール無効／読み取り専用設定を使います。

下表の設定を用意して `node app.ts`
を実行します。イベントを消費し、最終テキストを `result.finalMessage`
から取得し、必ずリソースを解放します。stdout はメタデータのみで、内容は認可されたアプリの応答へ渡します。モデル呼び出しはトークンを消費し、ネイティブ Session データを作成する場合があります。

<!-- sdk-example: quick-opencode.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from '@harapter/core';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from '@harapter/adapter-opencode';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createOpenCodeProviderFactory({
    resolveAuthHeaders: () =>
      Promise.resolve({
        authorization:
          'Basic ' +
          Buffer.from(
            (process.env['OPENCODE_SERVER_USERNAME'] ?? 'opencode') +
              ':' +
              required('OPENCODE_SERVER_PASSWORD'),
          ).toString('base64'),
      }),
  });
  const client = await factory.connect({
    profileId: profileId('my-opencode'),
    providerId: OPENCODE_PROVIDER_ID,
    displayName: 'Application opencode',
    connection: {
      kind: 'endpoint',
      url: required('HARAPTER_OPENCODE_URL'),
      transport: 'http',
      ownership: 'external',
      authRef: { scheme: 'env', id: 'opencode' },
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
· [公開パッケージ一覧](https://www.npmjs.com/org/harapter)

## インストール

```bash
pnpm add @harapter/core @harapter/adapter-opencode
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from '@harapter/adapter-opencode';

const registry = new HarnessRegistry();
registry.register(createOpenCodeProviderFactory());

const client = await registry.connect({
  profileId: profileId('opencode-local'),
  providerId: OPENCODE_PROVIDER_ID,
  displayName: 'OpenCode',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:4096/',
    transport: 'http',
    ownership: 'external',
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

認証する場合は Connection に `authRef` を置き、Factory の `resolveAuthHeaders`
でホストが解決します。Harapter は Header 値を記録・保存・返却しません。

## Session、Run、Input

- Session は Directory に束縛され、File Workspace URI は OpenCode
  Directory になります；
- `session.close()` は local handle だけを解放し、remote DELETE
  Route を呼びません；
- absolute URI と `mediaType` を持つ text/File/Image Reference を stable
  Part に mapping します；
- Session ごとに active Run は一つで、同期 Message
  Request の前に SSE を開きます；
- synchronous Message Response だけが success authority で、`session.idle`
  は代替できません；
- `run.cancel()` は Abort Route と `MessageAbortedError` の両方で native
  cancellation になります；
- Permission Event は Approval に mapping し、`once`、`reject`、明示的 `always`
  を区別します。

remote
settlement が不確実な場合、Adapter は Session を quarantine し、誤った再利用を防ぎます。stream
loss、HTTP Error、不正 Event、未知 Terminal は success になりません。

## Compatibility と制限

接続時に Health を検証し、使用する Session、Message、Abort、Permission、Event
Shape を実行時に検証します。Runtime
Version は診断情報であり allowlist ではありません。

stable interface には Fixture、negative test、shared conformance、live
evidence があります。automatic SSE reconnect、OpenCode process 管理、portable
close による remote deletion、Command/Plugin の Core
Capability 化は対象外です。詳細は
[英語のドキュメント](./README.md)を参照してください。

## 原生 Session 履歴操作

`opencode.sessions` の `OpenCodeSessions.fork(ref)`
は、状態・ID・ディレクトリを確認して原生 `POST /session/{id}/fork`
を呼び出します。履歴をコピーし、別の子 ID と同じ Harapter モデル／system 既定値を保持します。上流がコピーしない Session 権限規則または revert 状態がある場合は変更前に拒否します。未知のメッセージ位置で全履歴をコピーする上流の動作を避けるため、位置指定は受け付けません。不確かな書き込みでは親を隔離し、明確な前提条件の HTTP 拒否では再利用できます。

親 Run の終了後に呼び出してください。別 Client や外部 writer も含め、親を同時変更しないことをホストが保証します。ローカル予約は別プロセスをロックしません。子参照は同じ Provider／Profile に属します。履歴範囲と親のライフサイクルが異なるため、portable
`session.fork` は引き続き非対応です。

```ts
import {
  OPENCODE_SESSION_EXTENSION,
  type OpenCodeSessions,
} from '@harapter/adapter-opencode';

const sessions = client
  .extensions()
  .get<OpenCodeSessions>(OPENCODE_SESSION_EXTENSION);
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

| パッケージ                                                                               | ドキュメント                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                         | [ガイド](../../packages/core/README.ja.md)        |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)           | [ガイド](../../packages/conformance/README.ja.md) |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)       | [ガイド](../codex/README.ja.md)                   |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)           | [ガイド](../dsh/README.ja.md)                     |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)     | [ガイド](../hermes/README.ja.md)                  |
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw) | [ガイド](../openclaw/README.ja.md)                |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)             | [ガイド](../pi/README.ja.md)                      |
