<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/pi</code></h1>

<p align="center"><strong>Pi Agent の strict JSONL RPC mode を Harapter から実行します。</strong></p>

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

`harapter/pi` は公式 Pi Agent `--mode rpc`
を Harapter に mapping します。Session ごとに独立 Process を使い、stream
Event、persisted Resume、native Abort を提供します。Extension、Skill、Prompt
Template discovery は無効化されます。

## 埋め込み SDK 戦略（0.85.1）

任意の `sdk` 接続は `@earendil-works/pi-coding-agent@0.85.1`
の公式公開 AgentSession
API を適応します（MIT、完全一致 Version）。下記 RPC 戦略も利用できます。Pi
Runtime は Harapter の既定依存や Workspace
Lockfile に入りません。Host が Runtime を用意して `PiSdkSessionFactory`
を渡し、共有 ModelRuntime、認証、設定を所有します。

SDK 戦略は新規 Session、多ターン Text Run、Message/Reasoning/Tool
Event、確認済み native
Abort、有界で秘匿化した未知 Event、所有 Resource の破棄をサポートします。Portable
Resume、Fork、Interaction Response、Model/Workspace 上書き、任意の Native
Access は対象外です。RPC 戦略は独自の対応 Control を保持します。SDK
Extension の UI は Host が用意し、Harapter は承認 Handler を設置したり Tool
Policy を変更したりしません。

成功には prompt
Promise の完了と最終 Assistant の stopReason=stop の両方が必要です。agent_end の後に Retry が続く可能性があるため、それだけでは成功しません。欠落・不正な結果は失敗です。Native
Cancellation には Abort 確認と対応する aborted 結果が必要です。確認不能・失敗の場合は Session を閉じ connection_aborted を返します。SDK
Session は Process 隔離されず、Host Code が破棄を無視すると強制終了できません。

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

既定上限：`operationTimeoutMs` は 30000 ms、`maxRunEvents`
は 128（範囲 2–4096）、Client ごとに最大 16 の実行中または作成中 Session、保持 Event ごとに最大 262144 文字です。`connection: { kind: 'sdk', ownership: 'adapter', factory }`
には `providerOptions: { sdkVersion: '0.85.1' }`
が必要です。他 Version と Host 所有の `connection.client`
は Factory 呼び出し前に拒否します。

[Official SDK contract](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)
· [Fixtures](../../fixtures/pi/sdk-0.85.1/manifest.json)

```sh
pnpm vitest run providers/pi/test/sdk.test.ts
pnpm build
node providers/pi/test/sdk-native.mjs "$PI_SDK_PACKAGE_ROOT"
```

この任意コマンドは外部にインストールした 0.85.1 SDK とメモリ内合成 Model
Stream で二ターンの履歴、native
Abort、破棄を確認します。Model 認証情報や Network は使用しません。SDK 統合の証拠であり、実際の Model
Service の検証ではありません。以降は RPC 戦略を説明します。

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

| 環境変数              | 設定値                                                                       |
| --------------------- | ---------------------------------------------------------------------------- |
| `HARAPTER_PI_COMMAND` | 認証済み Pi 実行ファイルの絶対パス。ツールとコンテキスト探索を無効にします。 |
| `HARAPTER_WORKSPACE`  | 既存の空テストディレクトリの絶対パス。OpenCode はサーバー側のパスです。      |

認証情報は Runtime またはホスト環境に保持し、ソースや Session 参照へ書き込みません。初回は空のテスト Workspace と、ホストが確認したツール無効／読み取り専用設定を使います。

下表の設定を用意して `node app.ts`
を実行します。イベントを消費し、最終テキストを `result.finalMessage`
から取得し、必ずリソースを解放します。stdout はメタデータのみで、内容は認可されたアプリの応答へ渡します。モデル呼び出しはトークンを消費し、ネイティブ Session データを作成する場合があります。

<!-- sdk-example: quick-pi.ts -->

```ts
import { isAbsolute } from 'node:path';
import { isHarnessError, profileId, type HarnessSession } from 'harapter';
import { PI_PROVIDER_ID, createPiProviderFactory } from 'harapter/pi';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createPiProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-pi'),
    providerId: PI_PROVIDER_ID,
    displayName: 'Application pi',
    connection: {
      kind: 'process',
      command: required('HARAPTER_PI_COMMAND'),
      args: ['--no-tools', '--no-context-files'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
  let session: HarnessSession | undefined;
  try {
    // Pi uses the Profile's cwd; per-Session Workspace selection is unsupported.
    session = await client.createSession();
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

Pi Agent の導入、設定、認証、Model、absolute executable
path はホストが所有します。Harapter は Session
File や Credential を読み取らず Runtime を導入しません。

```bash
pnpm add harapter
```

## クイックスタート

```ts
import { HarnessRegistry, profileId } from 'harapter';
import { PI_PROVIDER_ID, createPiProviderFactory } from 'harapter/pi';

const registry = new HarnessRegistry();
registry.register(createPiProviderFactory());

const client = await registry.connect({
  profileId: profileId('pi-local'),
  providerId: PI_PROVIDER_ID,
  displayName: 'Pi Agent',
  connection: {
    kind: 'process',
    command: '/opt/harapter-runtimes/bin/pi',
    args: [],
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

## Process、Session、Run

- `--version` probe 後、Session ごとに独立 RPC Process を起動します；
- `--no-extensions --no-skills --no-prompt-templates --mode rpc` を追加します；
- `persistSessions: false` は `--no-session` を追加して Resume を無効にします；
- Resume は Native ID で新 Process を開き、同じ Session の返却を要求します；
- Workspace、System Context、Session Model、Metadata は unsupported です；
- Run は text のみで、複数 part は改行結合し、`/`
  から始まる input は拒否します；
- `prompt` Response は受付だけで、`agent_settled` と最後の valid Assistant
  `message_end` が terminal authority です；
- `run.cancel()` は `abort` Response と `stopReason: 'aborted'`
  の相関で native になります；
- Tool ID は hash され、Tool Argument/Result は portable Event に残りません。

Pi Extension UI の select、confirm、input、editor は Provider
Interaction ですが、generic Approval/User Input
Capability にはしません。未知 Event は bounded redacted
observation に残り、Native Client は ownership-preserving read
command のみです。

同じ Pi
Interaction 要求への応答送信は同時に一つだけです。重複は書き込み前に拒否し、不正な入力は修正して再試行できます。書き込み失敗時は配信状態が不明なため接続を中止します。遅延した応答で解決済み要求を再度解決することはありません。

## Compatibility と制限

Pi RPC は Runtime Version を返しますが negotiated protocol
version はありません。Version は lock せず、使用する Response、Event、Terminal
Structure を検証します。そのため状態は `experimental` ですが、real
completion、Resume、Native Cancel、cleanup の evidence はあります。

Image/File、Portable Model、Workspace、generic Approval、Runtime
Extension/Skill、shared Process、Session multiplex、auto restart、Session
File、任意 native mutation は対象外です。全 options、live test、検証 Version は
[英語の詳細ドキュメント](./README.md)を参照してください。

## 原生 Session 履歴操作

永続化が有効な場合、`pi.agent.sessions` は `PiSessions.fork(ref)`
を公開します。別の Adapter 所有 RPC プロセスで正確な親 Session を開き、idle を確認して原生
`clone` を実行し、`get_state`
で別の idle な子を確認します。親プロセスの Session は切り替えません。コピー対象は現在の活動分岐であり、ファイル内の全分岐ではありません。拒否・キャンセル・不正応答・タイムアウトでは試行中の子プロセスだけを破棄します。実行設定は同じホスト Profile に属します。

親 Run の終了後に呼び出してください。別 Client や外部 writer も含め、親を同時変更しないことをホストが保証します。ローカル予約は別プロセスをロックしません。子参照は同じ Provider／Profile に属します。履歴範囲と親のライフサイクルが異なるため、portable
`session.fork` は引き続き非対応です。

```ts
import { PI_SESSION_EXTENSION, type PiSessions } from 'harapter/pi';

const sessions = client.extensions().get<PiSessions>(PI_SESSION_EXTENSION);
if (sessions === undefined)
  throw new Error('Native Session extension unavailable.');
const child = await sessions.fork(session.ref());
// The child uses the normal HarnessSession lifecycle.
await child.close();
```

公式 Runtime、fixture、検証バージョンと再現コマンドは
[Session fork の証拠](../../docs/provider-session-fork-evidence.md)を参照してください。実 Runtime とローカル合成モデルを使用した検証であり、ホスト型モデルサービスの検証ではありません。

## 関連パッケージ

[SDK ガイド](../../README.ja.md#一つの-sdk)

| パッケージ                                                       | ドキュメント                                      |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| [`harapter`](https://www.npmjs.com/package/harapter)             | [ガイド](../../packages/core/README.ja.md)        |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter) | [ガイド](../../packages/conformance/README.ja.md) |
| [`harapter/codex`](https://www.npmjs.com/package/harapter)       | [ガイド](../codex/README.ja.md)                   |
| [`harapter/dsh`](https://www.npmjs.com/package/harapter)         | [ガイド](../dsh/README.ja.md)                     |
| [`harapter/hermes`](https://www.npmjs.com/package/harapter)      | [ガイド](../hermes/README.ja.md)                  |
| [`harapter/openclaw`](https://www.npmjs.com/package/harapter)    | [ガイド](../openclaw/README.ja.md)                |
| [`harapter/opencode`](https://www.npmjs.com/package/harapter)    | [ガイド](../opencode/README.ja.md)                |

公式 Runtime
0.85.1 の[合成モデルによる対話の証拠](../../docs/provider-interaction-evidence.md)は、ホスト所有の実行ファイルで一つのテスト拡張を明示的に読み込み、四つの UI メソッドを検証します。確認待機中の中断は現在
`failed` と `stopReason: error`、`run.cancel()` は `already_terminal`
を返します。この経路は native
cancellation の証拠ではなく、Adapter の拡張読み込み機能や認証済み拡張の証拠も追加しません。
