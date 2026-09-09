# 実際のアプリケーションで Harapter を使う

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

Node.js 24+／TypeScript アプリでは単一の `harapter`
SDK を使用します。この非公開サンプルは開発中 Workspace 依存を使い、初回公開は未完了です。公開後は本ディレクトリをコピーし、package.json の
`harapter: "workspace:*"` 依存を削除してから `npm install harapter`
を実行します。独立ビルドは `tsconfig.build.json` を使い、`tsconfig.json`
はリポジトリ内のソース検査専用です。

## プロジェクトを作成して実行する

単一ファイルの入門は[ルート README](../../README.ja.md#クイックスタート)を参照してください。業務モジュールとして使う場合は、このディレクトリを自分のプロジェクトにコピーするか、下記のファイルを保存し、その独立したディレクトリで実行します。

```sh
npm install harapter
npm run build
npm run offline
```

## Runtime を準備する

Codex の[公式手順](https://developers.openai.com/codex/cli/)でインストールと認証を行います。最初に
`codex`
を起動してログインを完了してください。空のテスト Workspace を作成し、アプリを起動するターミナルで次の変数を設定します。Windows では PowerShell で同名の変数を設定します。Harapter は指定されたプロセスを起動し、インストールやログインは行いません。

```sh
mkdir -p /tmp/harapter-example-workspace
export HARAPTER_CODEX_COMMAND=codex
export HARAPTER_WORKSPACE=/tmp/harapter-example-workspace
npm start
```

想定出力はイベント種別に続く `{"status":"completed","hasText":true}`
です。モデルが失敗したりテキストを返さない場合も実際の結果を保持します。Ctrl+C はネイティブキャンセルを要求し、未完了の結果は失敗終了になります。`npm run offline`
は Runtime やモデル認証なしで `offline application passed` を出力します。

## プロジェクトのファイル

| ファイル                                   | 用途                                          |
| ------------------------------------------ | --------------------------------------------- |
| [package.json](package.json)               | npm 依存と実行コマンド                        |
| [tsconfig.build.json](tsconfig.build.json) | 独立した厳密 ESM ビルド                       |
| [src/main.ts](src/main.ts)                 | 実際の Codex 呼び出し、SIGINT、安全な状態表示 |
| [src/service.ts](src/service.ts)           | 業務操作、再開、期限、結果                    |
| [src/interactions.ts](src/interactions.ts) | 非同期ホスト対話オブザーバー                  |
| [src/codex.ts](src/codex.ts)               | Codex 接続と読み取り専用 Session 設定         |
| [src/endpoints.ts](src/endpoints.ts)       | HTTP と DSH Gateway の構成                    |
| [src/processes.ts](src/processes.ts)       | DSH SDK、OpenClaw、Pi の構成                  |
| [src/recipes.ts](src/recipes.ts)           | 再開、Codex ネイティブ fork、並行 Provider    |
| [src/approval.ts](src/approval.ts)         | 明示的な端末承認                              |
| [src/offline.ts](src/offline.ts)           | オフラインアプリ検査                          |

## 業務モジュールに組み込む

アプリ内の service モジュールから `runTask`
をインポートし、認証済みユーザーの入力を渡して `result.finalMessage`
をそのユーザーの管理された UI に返します。SDK は Node.js サーバーやデスクトップのメインプロセスで使い、信頼できないブラウザー内では直接実行しません。呼び出し元は
`finally`
で Client を閉じます。タスクの例外時も Client を閉じ、元のエラーを保持するため、その接続を再利用しないでください。

```ts
import { connectCodex } from './codex.js';
import { runTask } from './service.js';

export async function answerUser(
  text: string,
  command: string,
  workspace: string,
) {
  const { client, session } = await connectCodex(command, workspace);
  try {
    const { result } = await runTask(client, text, { session });
    return { status: result.status, text: result.finalMessage };
  } finally {
    await client.close();
  }
}
```

## 結果、状態、キャンセル

イベントを継続して消費してください。`result.finalMessage`
は任意の最終テキストで、`result.status`
が最終状態の根拠です。イベントの payload は全 Adapter 共通のテキスト差分形式ではないため、`event.data`
を扱う前に対応するマッピングを確認します。サンプルの端末はイベント種別と状態のみ表示しますが、アプリに返すテキストは保持します。Result 全体を一般ログに出力しないでください。

Session 参照はアクセス制御されたアプリのストレージに、認証済みユーザーと元の Provider/Profile をキーとして保存します。参照には非公開のネイティブ状態が含まれます。再開には元の保存領域、互換 Runtime、Session の能力と同じ Profile 設定が必要です。JSON の保存は Provider 間の移行ではありません。このサンプルは参照をメモリに保持し、永続化とマルチテナント認可はホストが担当します。

明示的なユーザーキャンセルは AbortSignal で渡します。このサービスは観測済みのネイティブキャンセル能力を要求し、不明または弱いモードなら開始前に失敗します。タイムアウトは別の Run 期限であり、Adapter により
`failed` または `connection_aborted`
になります。最終結果を確認し、接続終了をネイティブキャンセル成功に読み替えないでください。

## 用途別レシピ

| 用途                     | 入口                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| 単発呼び出しとストリーム | `runTask(client, text, { onEvent })` → `result.finalMessage`           |
| 再接続後の再開           | `runTask(client, text, { resume: savedRef })`                          |
| fork して続行            | `forkCodexConversation(client, savedRef, text)`                        |
| キャンセルと期限         | `runTask(client, text, { signal, timeoutMs: 60_000 })`                 |
| 複数 Provider の並行実行 | `runAcrossProviders(first, second, text)`                              |
| 承認対話                 | `runTask(client, text, { onInteraction: terminalApproval(describe) })` |

## 完全なレシピを実行する

`npm run build` の後、各コマンドをそのまま実行できます。

| コマンド           | 実行内容                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `npm start`        | Codex を実際に一度呼び出してイベントを消費。Ctrl+C でネイティブキャンセルを要求。                |
| `npm run sessions` | Codex を三度呼び出す：作成、終了と再接続による再開、ネイティブ fork と続行。                     |
| `npm run multi`    | Codex と OpenCode を並行実行し、各結果を独立して処理。                                           |
| `npm run cancel`   | オフライン Fake のキャンセルと期限。`cancelled` と `connection_aborted` を表示。                 |
| `npm run approval` | TTY でオフライン Fake の承認。`approve` または `deny` と正確に入力。実際のコマンドは実行しない。 |

Session レシピは `npm start`
と同じ Codex 設定を使い、ネイティブの Session データを保持します（`ephemeral: false`）。非公開の参照はメモリにのみ保存します。三回の呼び出しにはモデル料金が発生する場合があります。複数 Provider のレシピには
`HARAPTER_OPENCODE_URL`、`HARAPTER_OPENCODE_WORKSPACE`（サーバー上の既存の絶対パス）、
`OPENCODE_SERVER_PASSWORD`、任意の `OPENCODE_SERVER_USERNAME`（既定値
`opencode`）も必要です。[OpenCode ガイド](../../providers/opencode/README.ja.md)に従って認証とツール無効化を設定します。アプリは接続を閉じますが、外部サーバーは動作を続けます。

完全なソース：[session-main.ts](src/session-main.ts)、[multi-main.ts](src/multi-main.ts)、
[cancel-demo.ts](src/cancel-demo.ts)、[approval-demo.ts](src/approval-demo.ts)。Fake の承認は既知の架空操作だけを扱います。実際の承認では固定説明をホストによるリクエストごとの検証に置き換えます。Fake は拒否後も echo
Run を完了します。操作の拒否は Run のキャンセルではありません。

## 承認 UI

`terminalApproval`
は、そのリクエストに対応する検証済みで安全な操作説明をホストが提供できる場合だけ TTY を開きます。説明を確認できなければ拒否し、未対応の対話種別は明示的に失敗します。一般的なタイトルや編集済み schema だけでコマンドを承認しないでください。解決、タイムアウト、Run 終了時にコールバックのシグナルで UI を閉じます。この端末はポータブル承認のみを処理します。Pi はネイティブの
`select`／`confirm`／`input`／`editor`
応答を必要とし、DSH には現在ホスト応答経路がありません。Codex の既定設定は読み取り専用で承認を無効にしています。承認を試すには、ホストが確認した権限ポリシーを明示的に選択します。

## 別の Provider を選ぶ

六つの `quick-*.ts`
は公開 SDK のみをインポートする独立した単一ファイルの入口です。各 Adapter
README に設定手順があります。`endpoints.ts` と `processes.ts`
はアプリの構成関数を提供し、接続関数を呼ぶまで Runtime は起動しません。DSH
Gateway は別のエンドポイント構成であり、保存領域の識別子と Session の独占宣言は実際の配置と一致する必要があります。OpenClaw の履歴操作には Adapter に記載された追加のホスト所有 Gateway 接続が必要です。

- [codex](../../providers/codex/README.ja.md):
  [quick-codex.ts](src/quick-codex.ts)
- [opencode](../../providers/opencode/README.ja.md):
  [quick-opencode.ts](src/quick-opencode.ts)
- [dsh](../../providers/dsh/README.ja.md): [quick-dsh.ts](src/quick-dsh.ts)
- [hermes](../../providers/hermes/README.ja.md):
  [quick-hermes.ts](src/quick-hermes.ts)
- [openclaw](../../providers/openclaw/README.ja.md):
  [quick-openclaw.ts](src/quick-openclaw.ts)
- [pi](../../providers/pi/README.ja.md): [quick-pi.ts](src/quick-pi.ts)

## 検証範囲

アプリは Workspace 外に新しく作成した単一 SDK の Tarball をインストールしてコンパイル、実行します。オフラインテストはアプリの動作を検証し、実際の Provider 互換性は[公式 Runtime の証拠](../../docs/provider-interaction-evidence.md)で管理します。実際の入口は既存の認証を使い、トークンを消費してネイティブ Session データを作成する可能性があります。空のテスト Workspace と Runtime 自身のツール／サンドボックスポリシーを使ってください。Client を閉じても外部 HTTP サーバーや Gateway は停止しません。

今回のパッケージ移行前の 2026-09-08、Workspace 外の npm アプリで Harapter
0.3.0 と公式 Codex CLI 0.153.4 を使い、 `quick-codex`、`main`、`session-main`
を実行しました。再接続、再開、ネイティブ fork を含む五回の実際の Runtime
Run が完了しました。隔離したループバックの合成モデルが応答し、ツール呼び出しやモデル認証情報は使っていません。これはアプリ統合の証拠であり、全 Provider の新たな互換性表明や有料モデルの canary ではありません。

## リポジトリへの貢献

Workspace 全体が必要なのはリポジトリ開発の場合だけです。ルートで次を実行します。

```sh
pnpm install --frozen-lockfile
pnpm --filter harapter-sdk-application build
pnpm --filter harapter-sdk-application offline
```
