<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/core</code></h1>

<p align="center"><strong>Harapter の Provider 非依存ライフサイクルとレジストリ。</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.ja.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/v/%40harapter%2Fcore?style=flat-square&amp;label=npm" alt="npm バージョン"></a>
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/dm/%40harapter%2Fcore?style=flat-square" alt="npm ダウンロード数"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI ステータス"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 以上">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 ライセンス"></a>
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/core` は複数の Agent Harness を同じ TypeScript
API で扱うための中心パッケージです。Client、Session、Run、イベント、終端結果、Capability、Error、Interaction、Provider 拡張を定義しますが、Provider
SDK を import せず、名前から機能を推測しません。

## 自分のアプリですぐに使う

Core をアプリ内の実際の Adapter に接続します。以下の完全な Codex 例は公開済みパッケージを使い、テスト Provider やリポジトリのビルドを必要としません。Codex を別途インストールして認証し、`HARAPTER_CODEX_COMMAND`
と絶対パスの `HARAPTER_WORKSPACE` を指定します。

```sh
npm init -y
npm pkg set type=module
npm install @harapter/core @harapter/adapter-codex
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

[完全なアプリ、レシピ、エラー処理](../../examples/sdk-application/README.ja.md)
· [公開パッケージ一覧](https://www.npmjs.com/org/harapter)

## このパッケージが適するケース

- Codex、OpenCode、その他の Adapter を切り替えてもアプリの流れを保ちたい；
- Provider 名ではなく、接続先で観測した Capability によってルーティングしたい；
- Provider Adapter を実装し、標準契約・所有権検証・Native Escape Hatch が必要。

## インストール

npm の既定の `latest` チャネルからインストールします。

```bash
pnpm add @harapter/core
```

次の Provider-free example では test package も追加します。

```bash
pnpm add -D @harapter/conformance
```

Node.js 24 以上が必要です。Core は Harness Runtime の導入や認証を行いません。

## 30 秒クイックスタート

次の例は `@harapter/conformance` の Fake
Provider を使うため、認証情報も実 Runtime も不要です。

```ts
import { HarnessRegistry } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';

const registry = new HarnessRegistry();
registry.register(createFakeProviderFactory());

const client = await registry.connect(createFakeProfile());
const session = await client.createSession();

try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'synthetic input' }],
  });

  for await (const event of run.events()) {
    console.log(event.type);
  }

  const result = await run.result();
  console.log(result.status);
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
}
```

実際のアプリでは Fake Provider を [実装済み Adapter](../../providers/README.md)
に置き換え、Runtime の導入・設定・認証はホストが行います。

## よくある使い方

### 接続前に必要な Capability を宣言する

`requiredCapabilities` は既定で `native`
だけを受け入れます。弱いモードを許可する場合はホストが明示します。

```ts
const client = await registry.connect({
  ...profile,
  requiredCapabilities: [
    { name: 'input.text' },
    { name: 'run.stream', acceptedModes: ['native', 'adapter_controlled'] },
  ],
});
```

### 終端結果を区別する

`run.result()` が権威ある結果です。`completed`、`cancelled`、`failed`、
`connection_aborted` は別の状態であり、プロセス終了は native
cancellation の証拠ではありません。

### Session を保存・再開する

Capability が許す場合だけ `session.ref()`
を保存します。参照は作成元と同じ Provider と Profile に戻す必要があり、Harapter は checkpoint を Provider 間で移動しません。

## 主なエクスポート

- `HarnessRegistry`：Adapter Factory の登録と Profile 接続；
- `HarnessClient`、`HarnessSession`、`HarnessRun`：可搬ライフサイクル；
- `HarnessEvent`、`RunResult`：順序付きイベントと一つの終端結果；
- `CapabilityManifest`：native、emulated、Adapter 制御、unsupported、unknown；
- `HarnessError`：安定した分類と明示的な `retryable`；
- `ExtensionRegistry`、`native()`：Provider に束縛された拡張境界；
- 所有権と互換性を確認する Session 検証関数。

## セキュリティと制限

- Core は `providerState`
  を解釈せず、認証情報、Runtime、プロセス、永続化を管理しません；
- raw
  Event、`providerState`、`providerResult`、Prompt、認証情報を既定で記録しないでください；
- resume、cancel、interaction、artifact、usage は現在の Capability に依存します；
- API は 0.x で、1.0 以前に破壊的変更が入る可能性があります。

正確な契約は[英語の詳細ドキュメント](./README.md)と
[API 設計](../../docs/design/api-design.ja.md)を参照してください。

## 関連パッケージ

[すべてのパッケージ](../../README.ja.md#npm-パッケージ一覧)

| パッケージ                                                                                             | ドキュメント                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| [`@harapter/transport-jsonrpc-stdio`](https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio) | [ガイド](../transport-jsonrpc-stdio/README.ja.md) |
| [`@harapter/transport-jsonl-process`](https://www.npmjs.com/package/@harapter/transport-jsonl-process) | [ガイド](../transport-jsonl-process/README.ja.md) |
| [`@harapter/transport-http-sse`](https://www.npmjs.com/package/@harapter/transport-http-sse)           | [ガイド](../transport-http-sse/README.ja.md)      |
| [`@harapter/transport-acp`](https://www.npmjs.com/package/@harapter/transport-acp)                     | [ガイド](../transport-acp/README.ja.md)           |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)                         | [ガイド](../conformance/README.ja.md)             |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)                     | [ガイド](../../providers/codex/README.ja.md)      |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)                         | [ガイド](../../providers/dsh/README.ja.md)        |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)                   | [ガイド](../../providers/hermes/README.ja.md)     |
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw)               | [ガイド](../../providers/openclaw/README.ja.md)   |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode)               | [ガイド](../../providers/opencode/README.ja.md)   |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)                           | [ガイド](../../providers/pi/README.ja.md)         |
