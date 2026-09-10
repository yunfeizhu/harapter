# 単発の呼び出しと明示的な Session

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

SDK ガイドは独立した二つの単一ファイル例から始まります。必要な方を `app.ts`
としてコピーします。どちらも Runtime 設定ファイルを import しません：

- [Pi: quick-run.ts](src/quick-run.ts)
- [DSH: quick-dsh-run.ts](src/quick-dsh-run.ts)

[SDK](../../packages/harapter/README.ja.md) ·
[API](../../docs/api-reference.ja.md#run)

`run()` は `harapter@1.0.0`
の後に追加された API です。1.0.0 には含まれないため、この API を含む後続リリースまたはソースビルドを使用してください。

選択した Harness はインストールとログインが済んでいるか、HTTP サービスが稼働している必要があります。Harapter は Runtime 本来のツールと権限ポリシーを使用します。タスクは選択した Workspace にアクセスし、モデル利用料金が発生する場合があります。

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
で失敗します。対話、複数ターン、再開、分岐、ネイティブキャンセル、独自の接続ポリシー、DSH
Gateway には以下の Client/Session
API を使用します。ハンドルの解放はネイティブ履歴の削除や外部サーバーの停止ではありません。

## 応用：アプリケーションが管理する接続 Profile

Session の所有権を明示的に管理する場合、`quick-start.ts` と `runtime-config.ts`
を一緒にコピーするか、再利用できる `runTask`
サービス例を使います。これらは応用例であり、`run()` の前提手順ではありません。

- [quick-start.ts](src/quick-start.ts)
- [runtime-config.ts](src/runtime-config.ts)
- [runTask](src/quick-unified.ts)

`pnpm --filter @harapter/example-runtime-profiles start`

単発 API は既存の六つの Adapter fixture で検証します。隔離された tarball
consumer は入口ファイルそのものをコンパイルし、インストールした `harapter`
だけで DSH、Pi、認証付き OpenCode のタスクを実行します。決定的テストは実 Runtime の証拠を置き換えません。

## 会話を続ける

`openSession()` を一度呼び、各メッセージを `send()` で送信します。同じ native
Session が履歴を保持します。この API は 1.0.0 より後の追加であり、1.0.0 リリースには含まれません。

[quick-chat.ts](./src/quick-chat.ts) ·
[Runtime guide](../../packages/harapter/README.ja.md)
