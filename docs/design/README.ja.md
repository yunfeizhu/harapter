[English](./README.md) · [简体中文](./README.zh-CN.md) ·
[日本語](./README.ja.md)

# Harapter

## プロジェクトの位置付け

Harapter は Agent Harness のための独立した Adapter Layer です。Desktop
Client、Web Service、CLI などの Agent 製品に、安定した Stateful Agent
API を提供します。独立した Provider
Adapter は、各 Harness が公開している SDK、RPC、HTTP API、Machine
Protocol を呼び出します。

LiteLLM の Provider
Adapter という考え方を参考にしていますが、対象は 1 回の Model
Request ではありません。Session、Run、Streaming Event、Tool Call、Human
Interaction を持つ Stateful Agent Runtime を扱います。

```text
Host Application
        │
        │ Stable Harness API
        ▼
Harapter Core
        │
        ├── adapter-qwen ──────▶ Qwen Code
        ├── adapter-opencode ──▶ OpenCode
        ├── adapter-codex ─────▶ Codex Harness
        ├── adapter-dsh ───────▶ DeepSeek Harness
        ├── adapter-hermes ────▶ Hermes Agent
        ├── adapter-openclaw ──▶ OpenClaw
        ├── adapter-pi ────────▶ Pi Agent
        └── other adapters ────▶ Other Harnesses
```

Harapter は完全に独立した Open-source
Project です。Host 製品の UI、Database、Task Model、Security 実装、Local
Runtime には依存しません。

> この文書は Target
> Design を説明するものであり、記載されたすべての Provider が実装済みであることを意味しません。実際のサポート範囲は、Release
> Package、Capability Manifest、Conformance Test、Provider
> README によって定義されます。

## 解決する課題

複数の Harness を組み込む Application が、SDK、Process Protocol、Event
Format を個別に処理しなくてもよいように、Harapter は次の共通経路を提供します。

- Provider Adapter の登録と検出
- 1 つ以上の Harness Profile の構成
- Client の確立と実際の Capability の検出
- Session の作成または Resume
- Run の送信と Streaming Event の消費
- Provider が公開する Approval または User Input Request への応答
- 構造化 Error、Usage、Artifact、Raw Provider Event の取得
- 共通化できない動作のための Provider Extension または Native
  Client へのアクセス

Application は Global
Provider を 1 つだけ選択するのではなく、複数の Harness へ同時に接続できます。たとえば
`qwen-local` と `opencode-local`
を同時に登録し、Task ごとに Harness を選択できます。

```text
Task A ──▶ profile: qwen-local ─────▶ Qwen Code
Task B ──▶ profile: opencode-local ─▶ OpenCode
```

上位層の Task List、Message Storage、UI は共有できますが、各 Harness
Session は作成元の Profile に結び付いたままです。

## Harapter の責務

- Registry、Profile、Client、Session、Run、Event、Interaction、Error の契約を定義する
- Portable Call を対象 Harness の公式 Machine Interface に変換する
- Native Streaming
  Message を安定した Event に Mapping し、共通化できない情報を保持する
- 現在の接続で観測した動作を Capability Manifest で表す
- Provider-native Capability、Adapter の接続制御、Unsupported
  Behavior を区別する
- Provider 固有動作のために Typed Extension と Native Escape Hatch を公開する
- Core の実行モデルを変更せず、独立した Provider
  Package で Harness を追加できるようにする

## Adapter の責務ではないもの

Harapter は次の処理を行いません。

- Agent Loop、Graph、Planner、Tool Loop、Checkpoint の実装または複製
- Third-party Harness Runtime の Package 化、Download、Update、配布
- Third-party Account への Login、License 購入、Runtime 構成の代行
- Harness ごとの Tool、Skill、Plugin、App、MCP、Sandbox、Permission
  System の再実装
- Harness 間での内部 State や Checkpoint の変換
- ある Provider の Session ID を別の Provider に渡して Resume すること
- Host 製品の Task、完全な Conversation、User Profile、Artifact の永続化
- Interactive
  TUI の Text を解析したり GUI を操作したりして、正式な API を模倣すること
- Provider の公式 Machine
  Interface に公開されていない動作をサポート済みと宣言すること

推奨される提供形態では、User または Host が、Installation と Authentication を完了した Runtime を用意します。Provider
Adapter は Host が提供した SDK Instance、Executable、Service
Endpoint へ接続できますが、Third-party
Distribution を自身の Package に含めません。

## Capability Model

Adapter は、すべての Harness を同一の Feature
Set に押し込みません。Harapter は 3 層の Capability Model を使用します。

1. **Portable Core**：Session 作成、Input 送信、Event 受信、明示的な Terminal
   Result 取得などの安定した共通 Semantics
2. **Optional Capability**：Resume、Fork、Native
   Cancel、Approval、Artifact、Usage など、Runtime で検出する共通動作
3. **Provider Extension**：Plugin Marketplace、Recipe、Goal、App、Slash
   Command などの Provider 固有 Interface

各 Capability は実装方式も宣言します。

- `native`：対象 Harness の公式 Interface が直接サポートする
- `emulated`：Portable
  Semantics と等価であることを Adapter が証拠で示すが、Provider-native
  State や Lifecycle は宣言しない
- `adapter_controlled`：Adapter が所有する接続または Process のみを制御し、それを Provider-native
  Behavior として表現しない
- `unsupported`：現在の Provider、Version、接続方式では確実に実装できない
- `unknown`：現在の接続は Capability 名を認識しているが、サポートを判断する証拠が不足している

Capability
Field が存在しない場合、現在の Manifest がその Capability 名を認識していないことを表します。明示的な
`unknown` とは異なります。Caller は受け入れる Mode を選択し、既定では `native`
のみを受け入れます。

したがって「複数の Harness を接続できる」とは、共通の Portable Task
Lifecycle に参加できるという意味です。すべてが Fork、Approval、Plugin
Marketplace、Run 中の Mode 変更をサポートするという意味ではありません。

## Session と切り替えの境界

- Application は新しい Session を作成するときに任意の Profile を選択できる
- 複数の独立した Task が同じ Profile を利用できる
- 1 つの Provider に、Account、Working Directory、Service
  Endpoint が異なる複数の Profile を設定できる
- 作成済み Session は `providerId` と `profileId`
  を保持し、互換性のある Adapter に戻す
- Active Session は Harness を透過的に切り替えられない
- Harness をまたいで作業を続ける場合は新しい Session を作成し、Portable な Task
  Description、Message Summary、File、Artifact を明示的に渡す

## ドキュメント索引

- [Architecture](./architecture.ja.md)：Component、Runtime Topology、State
  Ownership、Multi-provider の関係
- [Portable API](./api-design.ja.md)：Profile、Client、Session、Run、Event、Capability、Errorの契約
- [Provider Matrix](./provider-matrix.ja.md)：対象 Harness の公式 Machine
  Interface、Evidence Level、制限
- [Provider 固有 Capability](./provider-extensions.ja.md)：3 層の Capability
  Model、Extension Interface、Native Escape Hatch
- [Provider Adapter Guide](./provider-adapter-guide.ja.md)：新しい Provider
  Package を実装するための要件
- [Compatibility](./compatibility.ja.md)：Upstream 変更、Runtime Probe、Support
  Range、置換 Strategy
- [Implementation Guide](./implementation-guide.ja.md)：独立 Repository
  Structure、Build 順序、Acceptance 要件

## 独立 Project の制約

- Core は Harness SDK を Import しない
- Core は Provider 名の Enum や Provider 固有の Conditional Branch を持たない
- Provider ID と Profile ID は Dynamic Registration される Stable String である
- Provider Adapter は対象 Harness の Native Type と Version 差分を内包する
- Public Type は Host 製品の Task ID、Database Schema、UI Type を参照しない
- 公式 SDK/API の License、Authentication、Runtime 要件は各 Provider 文書が所有する
- 公開 Machine Interface がない動作をサポート済みと宣言しない
- Provider の追加に Core Source の変更を要求しない

## 用語

- **Harness**：Agent Execution Loop、State、Tool
  Orchestration を所有する Framework または Runtime
- **Core**：Stable Public Interface、Public Data Type、Capability
  Model、Provider Registry
- **Provider Adapter**：Portable Interface を 1 つの Harness の公式 Machine
  Interface へ変換する実装
- **Harness Profile**：`qwen-local` のように、Host が保存する選択可能な接続構成
- **Harness Client**：Profile から確立した 1 つの Active Connection
- **Harness Session**：Provider-native
  Thread、Session、Conversation への Portable Reference
- **Run**：Session に Input を送信して生じる 1 回の実行
- **Capability**：現在の Client、Version、Configuration が実際にサポートする動作
- **Provider Extension**：Typed Provider-specific Additional Interface
- **Native Escape Hatch**：公式 SDK Client、Protocol Client、Raw
  Event へ明示的にアクセスする経路
