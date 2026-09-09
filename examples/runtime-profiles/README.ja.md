# 一つの Harapter 入口から Runtime へ接続

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

この非公開サンプルは[アプリケーション入口ガイド](../../packages/harapter/README.ja.md)
の実行可能なソースです。DSH と OpenCode の設定は `runTask`
を共有し、`HARAPTER_HARNESS`
で接続を選びます。Runtime のインストール、認証、Workspace の安全設定、環境変数はガイドに従ってください。実際の呼び出しにはモデル利用料金が発生する場合があります。接続と所有プロセスを閉じますが、外部サーバーは停止せず、Session 状態は Harness 間で移行しません。

`harapter`
の初回 npm 公開は未完了です。開発時のリポジトリ例は Workspace の単一パッケージ構成を使用します。公開後は
`harapter` をインストールし、[src/quick-unified.ts](src/quick-unified.ts) を
`app.ts` としてコピーして `node app.ts` を実行します。

リポジトリをビルドした後のローカル確認は
`pnpm --filter @harapter/example-runtime-profiles start`
です。統合テストと隔離 Tarball コンシューマーは合成 DSH プロセスおよび認証付き OpenCode
HTTP Fixture で同じ業務関数を実行し、モデル認証情報を必要としません。
