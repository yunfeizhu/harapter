<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-hermes</code></h1>

<p align="center"><strong>Hermes Agent API Server を HTTP/SSE で Harapter に接続します。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-hermes"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-hermes?style=flat-square&amp;label=npm" alt="npm バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-hermes"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-hermes?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-hermes` は公式 Hermes Agent API
Server の Session、Run、Status、SSE
Event、Stop、Approval を Harapter に mapping します。Hermes の導入、認証、起動、停止、設定はホストが所有し、Adapter は指定 HTTP
Endpoint にだけ接続します。

## 自分のアプリですぐに使う

Node.js 24+ の ESM プロジェクトで以下の完全な例を `app.ts`
として保存します。Harapter の checkout や非公開インポートは不要です。

```sh
npm init -y
npm pkg set type=module
npm install @harapter/core @harapter/adapter-hermes
npm install -D typescript @types/node
```

### ホストが用意する設定

| 環境変数                  | 設定値                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| `HARAPTER_HERMES_URL`     | 起動済み Hermes API Server の URL。                               |
| `HARAPTER_HERMES_API_KEY` | API Server の bearer 認証情報。モデル認証は Hermes が管理します。 |

認証情報は Runtime またはホスト環境に保持し、ソースや Session 参照へ書き込みません。初回は空のテスト Workspace と、ホストが確認したツール無効／読み取り専用設定を使います。

下表の設定を用意して `node app.ts`
を実行します。イベントを消費し、最終テキストを `result.finalMessage`
から取得し、必ずリソースを解放します。stdout はメタデータのみで、内容は認可されたアプリの応答へ渡します。モデル呼び出しはトークンを消費し、ネイティブ Session データを作成する場合があります。

<!-- sdk-example: quick-hermes.ts -->

```ts
import { isHarnessError, profileId, type HarnessSession } from '@harapter/core';
import {
  HERMES_PROVIDER_ID,
  createHermesProviderFactory,
} from '@harapter/adapter-hermes';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const factory = createHermesProviderFactory({
    resolveAuthHeaders: () =>
      Promise.resolve({
        authorization: 'Bearer ' + required('HARAPTER_HERMES_API_KEY'),
      }),
  });
  const client = await factory.connect({
    profileId: profileId('my-hermes'),
    providerId: HERMES_PROVIDER_ID,
    displayName: 'Application hermes',
    connection: {
      kind: 'endpoint',
      url: required('HARAPTER_HERMES_URL'),
      transport: 'http',
      ownership: 'external',
      authRef: { scheme: 'env', id: 'hermes' },
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({});
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
pnpm add @harapter/core @harapter/adapter-hermes
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  HERMES_PROVIDER_ID,
  createHermesProviderFactory,
} from '@harapter/adapter-hermes';

const registry = new HarnessRegistry();
registry.register(createHermesProviderFactory());

const client = await registry.connect({
  profileId: profileId('hermes-local'),
  providerId: HERMES_PROVIDER_ID,
  displayName: 'Hermes Agent',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:8642/',
    transport: 'http',
    ownership: 'host',
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

認証する場合、Factory にホスト実装の `resolveAuthHeaders` を渡し、Connection は
`authRef`
だけを保持します。Harapter は実 Header を読み取り・出力・保存しません。

## Session と Run

- Connection は `/v1/capabilities` で必要 Route を宣言する必要があります；
- Session 作成は System Context と Model を受け、Resume は native
  ownership を再検証します；
- Workspace は unsupported、close は local handle の解放だけです；
- Session ごとに active Run は一つで、現在の portable input は text のみです；
- Submit Ack は終端ではなく、SSE と Run Status Route を照合します；
- `completed` は Session/Run ownership と最後の `run.completed`
  evidence も必要です；
- SSE
  EOF、disconnect、重複・矛盾 terminal、不正 payload は success になりません；
- Stop と Approval は Runtime が feature と exact
  Route を宣言した時だけ利用できます。

non-idempotent
mutation の response が失われると Session を quarantine し、安全でない retry を防ぎます。Harapter
timeout は emulated control で、Provider の authoritative `cancelled`
Status だけが cancellation terminal です。

## Compatibility と制限

Capability は Provider 名や Version ではなく `/v1/capabilities`
から得ます。Lifecycle authority に使う Response と SSE Event はすべて runtime
validation されます。API Server は protocol version negotiation を持たないため
`experimental` ですが、実 Runtime の completion、Resume、Native
Cancel は検証済みです。新 Version は試行し、不互換 structure で fail
closed します。

Portable Workspace、remote Session delete、automatic SSE
reconnect、未宣言 Route は対象外です。全 options、Approval、Native Client、live
test、検証 Version は [英語の詳細ドキュメント](./README.md)を参照してください。

## 原生 Session 履歴操作

`session_fork` と正確な endpoint が広告された場合のみ、
`nous.hermes-agent.sessions` の `HermesSessions.branch(ref)`
を公開します。Hermesは親を `end_reason: branched`
にしてから、メッセージと system
context を継承する子を作ります。Harapter は再接続後も親の継続を拒否するため、操作名は明示的に
`branch` です。上流が保存済みモデル設定をコピーしないため、事前に
`has_model_config`
が false であることを確認します。送信後の失敗では、親の終了がエラー応答より先に起きる可能性があるため親を隔離します。

親 Run の終了後に呼び出してください。別 Client や外部 writer も含め、親を同時変更しないことをホストが保証します。ローカル予約は別プロセスをロックしません。子参照は同じ Provider／Profile に属します。履歴範囲と親のライフサイクルが異なるため、portable
`session.fork` は引き続き非対応です。

```ts
import {
  HERMES_SESSION_EXTENSION,
  type HermesSessions,
} from '@harapter/adapter-hermes';

const sessions = client
  .extensions()
  .get<HermesSessions>(HERMES_SESSION_EXTENSION);
if (sessions === undefined)
  throw new Error('Native Session extension unavailable.');
const child = await sessions.branch(session.ref());
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
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw) | [ガイド](../openclaw/README.ja.md)                |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode) | [ガイド](../opencode/README.ja.md)                |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)             | [ガイド](../pi/README.ja.md)                      |
