# Harapter

> Agent Harness のための、ポータブルでステートフルな API。

[![CI](https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml/badge.svg)](https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml)
[![ライセンス: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
![ステータス: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)

[English](./README.md) · [简体中文](./README.zh-CN.md) ·
[日本語](./README.ja.md) · [設計](./docs/design/README.md) ·
[サンプル](./examples/README.md) · [コントリビューション](./CONTRIBUTING.md)

Harapter は、複数の Agent
Harness を利用するアプリケーション向けのオープンソース Adapter レイヤーです。アプリケーションは Client、Session、Run、ストリーミング Event、Interaction、Capability、Error を 1 つの TypeScript 契約で扱い、独立した Provider
Adapter が公式 SDK やマシンプロトコルへ変換します。

Harapter は Agent
Runtime を置き換えません。各 Runtime の選択、インストール、認証、セキュリティはホストが管理します。

## Harapter を使う理由

- **1 つのライフサイクルで複数の Harness を扱えます。**
  ホスト側のフローを一度実装し、タスクごとに Harness Profile を選択できます。
- **状態の所有者を変えません。**
  各 Session は、作成元の Provider、接続 Profile、ネイティブ状態に結び付いたままです。
- **Capability は推測ではなく証拠に基づきます。**
  `native`、`emulated`、`adapter_controlled`、 `unsupported`、`unknown`
  を明確に区別します。
- **ライフサイクルの結果を正確に表現します。**
  プロセスや接続の中断をネイティブな Run キャンセルとして扱いません。
- **Provider 固有機能にもアクセスできます。** 型付き Extension と明示的な Native
  Escape Hatch により、ポータブルではない機能も保持します。
- **未知のイベントも観測できます。**
  成功結果へ推測変換せず、サイズとリソースの上限を設け、機密情報を除去した Provider
  Channel に残します。

## アーキテクチャ

```text
ホストアプリケーション
        │
        │  @harapter/core
        ▼
HarnessRegistry ──▶ Client ──▶ Session ──▶ Run ──▶ Event + Result
        │
        ├── Codex Adapter ─────▶ App Server / JSON-RPC stdio
        ├── OpenCode Adapter ──▶ HTTP + SSE
        ├── Claude Adapter ────▶ Agent SDK
        ├── DSH Adapter ───────▶ SDK Runtime / JSON-RPC stdio
        ├── Hermes Adapter ────▶ API Server / HTTP + SSE
        ├── OpenClaw Adapter ──▶ ACP v1 / JSON-RPC stdio
        └── Pi Adapter ────────▶ strict JSONL process RPC
```

Core は Provider SDK を import せず、Provider 名による分岐や Provider
ID による Capability 推測を行いません。プロトコル変換、互換性検証、リソース上限を持つ Transport、機密情報を除去した Fixture は各 Adapter が所有します。

## 現在の実装

| レイヤー         | 実装済みモジュール                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Portable API     | Client、Session、Run、Event、Interaction、Capability、Error、Extension、Native Access の Core 契約と Registry |
| Transport        | JSON-RPC stdio、strict JSONL process RPC、リソース上限を持つ HTTP/SSE、ACP v1                                 |
| Provider Adapter | Codex、OpenCode、Claude、DeepSeek Harness、Hermes Agent、OpenClaw、Pi Agent                                   |
| 証拠             | 機密情報を除去した Fixture、Mapping とライフサイクルテスト、Provider-negative テスト、共通 Conformance        |
| リファレンス     | Single-Provider ライフサイクルアプリと並行 Multi-Provider Client                                              |

### Provider の証拠ステータス

| Provider                                      | 公式インターフェース      | 現在のステータス                                                |
| --------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| [Codex](./providers/codex/README.md)          | stable App Server         | Fixture、Conformance、live-runtime 証拠を持つソース Adapter     |
| [OpenCode](./providers/opencode/README.md)    | stable HTTP/OpenAPI + SSE | Fixture、Conformance、live-runtime 証拠を持つソース Adapter     |
| [Claude](./providers/claude/README.md)        | Claude Agent SDK          | Experimental。決定論的な証拠はあるが、live-runtime 証拠は未記録 |
| [DeepSeek Harness](./providers/dsh/README.md) | SDK Runtime JSON-RPC      | Experimental。決定論的な証拠はあるが、live-runtime 証拠は未記録 |
| [Hermes Agent](./providers/hermes/README.md)  | API Server HTTP/SSE       | Experimental。決定論的な証拠はあるが、live-runtime 証拠は未記録 |
| [OpenClaw](./providers/openclaw/README.md)    | ACP v1 bridge             | Experimental。決定論的な証拠はあるが、live-runtime 証拠は未記録 |
| [Pi Agent](./providers/pi/README.md)          | strict JSONL RPC mode     | Experimental。決定論的な証拠はあるが、live-runtime 証拠は未記録 |

「証拠あり」はソース Adapter が保持する証拠の範囲を示すもので、公開パッケージの保証ではありません。各 Adapter は、対象インターフェースを最初に使用する互換性境界で現在の Runtime またはインターフェース構造を検証し、互換性がなければ fail
closed します。「Experimental」は Adapter の実装と、機密情報を除去した証拠または合成証拠によるテストは完了しているものの、対象インターフェースの live-runtime 証拠がまだ記録されていない状態です。Harapter が証拠取得のために Runtime を自動インストールすることはありません。

Capability と互換性境界の詳細は、[Provider マトリクス](./docs/design/provider-matrix.md)と各 Provider
README を参照してください。

## リファレンスを確認する

- [Single-Provider リファレンス](./examples/single-provider/README.md) — Client
  → Session → Run → Event →
  Result の完全なライフサイクルと安全なクリーンアップを示します。
- [Multi-Provider リファレンス](./examples/multi-provider-client/README.md) —
  Profile ルーティング、並行ストリーム、Session 単位のコントロール、所有権検証、明示的な Provider
  Extension 境界を示します。

デフォルトのテストスイートは、サードパーティ Runtime の検出、インストール、認証、実行を行いません。

## プロジェクトの状態

Harapter は現在 **pre-alpha**
です。TypeScript 実装はこの Workspace から評価できますが、すべてのパッケージは private
`0.0.0`
のままで、npm、PyPI、CLI の配布物はまだ公開されていません。最初の公開リリースは、API、Packaging、Provenance、Publishing、Rollback のレビュー後に行います。

現在は、利用者からのフィードバック、ホストが実行する Experimental
Adapter の live evidence、リリース準備に集中しています。Portable wire
schema、TypeScript 以外の SDK、local-socket
Transport は、実際の利用者が必要とした時点で追加します。Goose、Qwen
Code、Crush、GitHub Copilot CLI、Cursor Agent CLI は現在の実装範囲外です。

## ソースから開発する

前提条件は Node.js
24 と Corepack です。pnpm のバージョンはリポジトリで固定されています。

```bash
git clone https://github.com/yunfeizhu/harapter.git
cd harapter
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` は Format、型情報付き Lint、strict
TypeScript、Coverage、全 Workspace の Build、Markdown、Link、Repository
consistency、Agent governance の各チェックを実行します。

## ドキュメント

- [アーキテクチャと設計](./docs/design/README.md)
- [Portable Core 契約](./packages/core/README.md)
- [Provider 実装ガイド](./docs/design/provider-adapter-guide.md)
- [開発ワークフロー](./docs/development.md)
- [コントリビューション](./CONTRIBUTING.md)
- [セキュリティポリシー](./SECURITY.md)
- [リリースポリシー](./RELEASING.md)

## 対象外

Harapter は Agent Loop の実装、Provider
Runtime のインストールや更新、Harness 間のネイティブ Checkpoint 変換、ホストのタスク保存、Provider
Plugin Marketplace の管理、Credential の解決、ホストアプリケーションの Security
Policy の暗黙的な変更を行いません。

## ライセンス

[Apache License 2.0](./LICENSE) の下で提供されます。
