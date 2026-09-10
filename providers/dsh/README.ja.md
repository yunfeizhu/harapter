<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/dsh</code></h1>

<p align="center"><strong>公式 DeepSeek Harness SDK Runtime protocol を Harapter に mapping します。</strong></p>

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
SDK に含まれるモジュールを説明します。通常のアプリケーション接続は[アプリケーションガイド](../../packages/harapter/README.ja.md)から始めてください。`harapter`
をインストールすれば利用でき、このモジュール用の npm 依存を追加する必要はありません。

同じパッケージに [SDK process](#sdk-process-strategy) と
[Gateway endpoint](#gateway-endpoint-戦略)
があり、Gateway はネイティブ再開、fork、Session 単位の取消を提供します。

`harapter/dsh` は DeepSeek Harness SDK Runtime の newline-delimited JSON-RPC 2.0
Server に接続し、Session、Run、Event、Interaction、cancellation、Error を Harapter に mapping します。Agent
Loop 自体は埋め込みません。

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

| 環境変数                | 設定値                                                                  |
| ----------------------- | ----------------------------------------------------------------------- |
| `HARAPTER_DSH_COMMAND`  | sdk-minimal Profile を設定済みの DSH 実行ファイル。                     |
| `HARAPTER_DSH_PROVIDER` | その DSH Profile に設定されたモデル Provider のルート。                 |
| `HARAPTER_DSH_MODEL`    | そのルートで利用可能なモデル ID。                                       |
| `HARAPTER_WORKSPACE`    | 既存の空テストディレクトリの絶対パス。OpenCode はサーバー側のパスです。 |

認証情報は Runtime またはホスト環境に保持し、ソースや Session 参照へ書き込みません。初回は空のテスト Workspace と、ホストが確認したツール無効／読み取り専用設定を使います。

下表の設定を用意して `node app.ts`
を実行します。イベントを消費し、最終テキストを `result.finalMessage`
から取得し、必ずリソースを解放します。stdout はメタデータのみで、内容は認可されたアプリの応答へ渡します。モデル呼び出しはトークンを消費し、ネイティブ Session データを作成する場合があります。

<!-- sdk-example: quick-dsh.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from 'harapter';
import { DSH_PROVIDER_ID, createDshProviderFactory } from 'harapter/dsh';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createDshProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-dsh'),
    providerId: DSH_PROVIDER_ID,
    displayName: 'Application dsh',
    connection: {
      kind: 'process',
      command: required('HARAPTER_DSH_COMMAND'),
      args: ['--profile', 'sdk-minimal'],
      cwd: workspace,
      ownership: 'adapter',
    },
    providerOptions: {
      provider: required('HARAPTER_DSH_PROVIDER'),
      model: required('HARAPTER_DSH_MODEL'),
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
· [Harapter npm](https://www.npmjs.com/package/harapter)

## 前提条件とインストール

DeepSeek
Harness の導入、composition、設定、認証はホストが行います。Harapter は DSH
CLI、SDK package、Cordis Application、Plugin、Model
Adapter、Credential を同梱しません。

```bash
pnpm add harapter
```

## SDK process strategy

### クイックスタート

```ts
import { HarnessRegistry, profileId } from 'harapter';
import { DSH_PROVIDER_ID, createDshProviderFactory } from 'harapter/dsh';

const registry = new HarnessRegistry();
registry.register(createDshProviderFactory());

const client = await registry.connect({
  profileId: profileId('dsh-local'),
  providerId: DSH_PROVIDER_ID,
  displayName: 'Local DeepSeek Harness',
  connection: {
    kind: 'process',
    command: 'dsh',
    args: ['--profile', 'sdk'],
    ownership: 'adapter',
  },
  providerOptions: {
    provider: 'host-configured-provider',
    model: 'host-configured-model',
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

### Profile とライフサイクル

- Adapter-owned `process` Connection のみで、Shell は使用しません；
- Profile に非空 `provider` と `model` が必要で、Reasoning、Token、bounded
  transport 値も設定できます；
- Workspace は Runtime 初期化 Directory と一致する必要があります；
- 現 protocol に Resume と Native Session Close はなく、close は local
  handle 解放です；
- Connection 全体で active Run は一つです；
- `session/prompt` が返すのは永続的な Inbox `messageId`
  だけで、Result や終端の authority ではありません。所有する activity 区間内の唯一有効な
  `turn/end.data.reason` が終端を決め、EOF と Process
  Exit は success になりません；
- 現 protocol に Prompt Cancel はなく、`run.cancel`
  は未対応です。Timeout は所有する Connection を閉じて `connection_aborted`
  となります。upstream で観測した `aborted` は `run.cancelled`
  に mapping できますが、Harapter が Native
  Cancel を要求した証拠にはなりません；
- 未知 notification は bounded redacted
  observation に残り、終端には変換されません。

### Compatibility と Evidence

接続は `deepseek-harness-sdk-runtime`
identity と、使用する Response、Event、Terminal の structure を検証します。Runtime は診断 Version を返しますが protocol
version
negotiation がないため allowlist は使いません。新 Runtime は既定で試し、互換でない構造を使用した時点で fail
closed します。

公式 SDK Profile は Fixture、mapping test、shared conformance、real Runtime
lifecycle で検証済みです。`experimental`
は「未実装」ではなく、任意 Runtime を実行前に既存 evidence へ自動対応付けできないことを示します。production
host は記録済み Version を pin して再現性を得られます。

Native Client、Interaction、cancel、検証 Version、live test、全制限は
[英語の詳細ドキュメント](./README.md)を参照してください。

## Gateway endpoint 戦略

ネイティブ永続化、再開、fork が必要な場合はホスト管理の Gateway を使います。上記の SDK
process 戦略も利用できます。Gateway は実験的サポートであり、公式コミット
[`d347e703908d0406b7a7ef80e3a0e594d86b2215`](https://github.com/deepseek-ai/deepseek-harness/tree/d347e703908d0406b7a7ef80e3a0e594d86b2215)
の Session v2 プロトコルのみを対象とします。ソースパッケージは
`@deepseek-ai/dsh-api-session-controller@0.1.3-alpha.1`
で、同じ npm バージョンの公開を意味しません。ホストは `DSH_GATEWAY_PROTOCOL`
で対応する構成を明示します。`session/modelCatalog`
と構造の検証は、Runtime バージョン、ストア識別、排他アクセス、ツール方針の証明にはなりません。

### 認証とホストの責任

ホストが DSH を起動し、ネイティブストア、モデル、ツール、対話方針を管理します。
`resolveGatewayCookie` は設定された `SecretRef` と期限付き `AbortSignal`
を受け取り、署名された browser-session
cookie を返します。公式ルートページでの launch
token 交換と資格情報の保存はホストの責任です。Bearer API
key は Gateway 認証の代わりになりません。Harapter はブラウザ設定や Runtime の資格情報ファイルを読みません。HTTP と WebSocket は同じ cookie と明示された Origin を使い、リダイレクトを拒否します。URL は HTTPS の root
authority、または loopback
HTTP に限定され、埋め込み資格情報、query、fragment は禁止です。Ownership は
`host` または `external`、transport は省略または `websocket`
のみを受け付けます。

`storeId`
は同じネイティブストアを保持している間だけ安定する、ホスト指定の不透明な識別子です。
`exclusiveSessions: true` は、別のクライアント、DSH
UI、プラグインが競合する仕事を投入しないというホストの保証です。上流のロックではありません。対話方針はホストが明示し、portable
interaction response は使えません。

```ts
import { profileId, type SecretRef } from 'harapter';
import {
  createDshProviderFactory,
  DSH_PROVIDER_ID,
  DSH_GATEWAY_PROTOCOL,
  DSH_GATEWAY_SESSION_EXTENSION,
  type DshGatewaySessions,
} from 'harapter/dsh';

// Supplied by the host's credential service.
declare function resolveCookie(
  ref: SecretRef,
  signal: AbortSignal,
): Promise<string>;
const factory = createDshProviderFactory({
  resolveGatewayCookie: resolveCookie,
});
const client = await factory.connect({
  providerId: DSH_PROVIDER_ID,
  profileId: profileId('dsh-gateway'),
  displayName: 'Host DSH Gateway',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:3000',
    ownership: 'external',
    authRef: { scheme: 'host-vault', id: 'dsh-cookie' },
  },
  providerOptions: {
    protocol: DSH_GATEWAY_PROTOCOL,
    storeId: 'host-managed-store-identity',
    exclusiveSessions: true,
  },
});
try {
  const session = await client.createSession();
  const run = await session.start({
    parts: [{ type: 'text', text: 'Hello.' }],
  });
  for await (const event of run.events()) {
    /* Host rendering. */
  }
  const result = await run.result();
  if (result.status === 'completed') {
    const controls = client
      .extensions()
      .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION);
    const child = await controls?.fork(session.ref());
    // Persist child.ref() under the host's Session storage policy.
    await child?.close();
  }
  await session.close();
} finally {
  await client.close();
}
```

### ライフサイクルとネイティブ制御

正確な inbox 挿入と canceled でない claim が要求の所有権を確立するため、`user/message`
前の取消や pre-step 拒否も正しく終端化します。公式
`@deepseek-ai/dsh-system-prompt`
の文脈メッセージは所有する step 内でのみ許可し、他のプラグイン入力は unsupported です。`turn/end`
後で受理応答前の連続した非同期タイトルイベントは、検証済み結果を変更しません。容量超過は Run 所有前に拒否し、確定した上流前提条件エラーでは Client を閉じずに所有権を解放します。

`createSession()`
は Session オプションを受け付けず、ホストの既定値を使います。Adapter は先に
`session/follow` を開き、連続する Session
v2 履歴を検証してから queue モードでテキストを送信します。
`user/message.source.rpcId`
を自身の request と照合し、履歴を新しい Run の出力にしません。Client ごとに同時実行は一つです。永続化された完了メッセージを出力し、瞬間的な token
delta は扱いません。検証済みで対応する `turn/end`
だけが終端結果を確定でき、受理だけでは成功になりません。

`resumeSession(ref)`
は元の Provider、Profile、endpoint、protocol、store、header の一致を要求します。Session が存在しない場合に create へ切り替えません。通常の Session の完全な opening
history のみを扱い、上限は 4096 イベント、要求は 200 メッセージまでで、フレーム容量も適用します。切り詰められた履歴と subagent-owned
reference は拒否します。ストアを保持し認証を更新すれば Runtime 再起動後のネイティブ状態を明示的に再開できますが、透過的な再接続や Run の回復は行いません。

`DSH_GATEWAY_SESSION_EXTENSION` は `deepseek.harness.gateway.sessions` です。
`DshGatewaySessions.fork(ref)`
は最後の完了 turn の prefix から独立したネイティブ子 Session を作成します。親の attachment と返却された lineage を検証し、任意の cursor は受け付けません。Core に fork メソッドがないため portable
`session.fork` は unsupported です。`cancelSession(ref)`
は inbox を保持する Session 全体のネイティブ取消を要求し、`{ accepted: true }`
を返します。受理と実際の取消終端は別に観測します。Turn 開始前の取消は入力を保持したまま取消終端を生成しない場合があり、ローカル Run の期限は引き続き適用されます。上流に条件付き Run
selector がないため portable `run.cancel` は unsupported のままです。
`DshGatewayNativeClient`
は同じ限定された操作、protocol、ハッシュ化した binding を公開し、任意の RPC は公開しません。

Handle close は観測だけを解除します。Client
close、切断、Run のローカル期限、未知の必須イベント、バッファ超過は活動中の Run を
`connection_aborted`
にしますが、外部 Agent は継続する可能性があります。Session の削除や DSH の停止は行いません。書き込みの結果が不確かな Client は隔離し、自動再試行しません。確定した前提条件の拒否なら再利用できます。Session
mutation の完了前に新しい Run は開始できません。

### 制限、エラー、検証

追加オプションの既定値は `requestTimeoutMs: 30000`、`runTimeoutMs: 120000`、
`maxMessageBytes: 262144`（最大 1048576）、`maxBufferedEvents: 32`（最大 256）、
`maxRunEvents: 128`（最大 4096）、`maxSessions: 4`（最大 16）です。Timer は 2147483647 以下の正の安全な整数です。キューは終端用容量を予約し、Stream と Run の合計受信予算は最大 64
MiB です。未消費イベントを黙って破棄しません。 `DSH_NOTIFICATION_EXTENSION`
は attachment の snapshot と idle イベントも脱敏して通知し、リスナーは最大 16 個です。未知の必須イベントも接続中止前にこのチャネルへ入り、リスナーの失敗はライフサイクルを変更しません。Raw は SDK と同じ有界な脱敏を使います。

エラーは
`profile_invalid`、`authentication_failed`、`provider_api_incompatible`、
`session_not_found`、`session_provider_mismatch`、`run_conflict`
などの安定した分類を使います。固定メッセージと許可リストの provider
code のみを公開し、上流のエラー本文や資格情報を含めません。接続を閉じてもホストの cookie は失効しません。

[Gateway fixtures](../../fixtures/dsh/gateway-session-v2/manifest.json)、wire/mapping/lifecycle 異常系と shared
conformance が決定的な証拠です。2026-09-07 に固定コミットの公式 CLI、Gateway、Agent
Loop、JSONL
persistence を隔離環境で構築し、ローカル模擬モデルで作成、完了、fork、子の継続、再接続/再開、Session
cancel、Runtime プロセス再起動後の再開を確認しました。ツールプラグインはなく、実際の外部モデルの証拠ではありません。

`pnpm vitest run providers/dsh/test/gateway-live.test.ts` は
`HARAPTER_DSH_GATEWAY_LIVE=1`、`HARAPTER_DSH_GATEWAY_URL`、
`HARAPTER_DSH_GATEWAY_STORE_ID`、`HARAPTER_DSH_GATEWAY_COOKIE_FILE`
を必要とします。最後はホストが専用に作成したテスト資格情報ファイルで、Runtime の資格情報ストアではありません。隔離したツールなしの固定版 Gateway と、最初の二回に
`HARAPTER_DSH_GATEWAY_LIVE_OK`
を返し、三回目に取消を待つ模擬モデルを用意します。このテストは Client の再接続を扱い、プロセス全体の再起動は別のホスト検証です。スキップは互換性の証拠になりません。インストール、プラグイン管理、任意の Session オプション、画像/ファイル、対話、競合する書き込み、履歴ページング、精密な portable
cancellation は対象外です。

## 関連パッケージ

[SDK ガイド](../../README.ja.md#一つの-sdk)

| パッケージ                                                       | ドキュメント                                      |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| [`harapter`](https://www.npmjs.com/package/harapter)             | [ガイド](../../packages/core/README.ja.md)        |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter) | [ガイド](../../packages/conformance/README.ja.md) |
| [`harapter/codex`](https://www.npmjs.com/package/harapter)       | [ガイド](../codex/README.ja.md)                   |
| [`harapter/hermes`](https://www.npmjs.com/package/harapter)      | [ガイド](../hermes/README.ja.md)                  |
| [`harapter/openclaw`](https://www.npmjs.com/package/harapter)    | [ガイド](../openclaw/README.ja.md)                |
| [`harapter/opencode`](https://www.npmjs.com/package/harapter)    | [ガイド](../opencode/README.ja.md)                |
| [`harapter/pi`](https://www.npmjs.com/package/harapter)          | [ガイド](../pi/README.ja.md)                      |
