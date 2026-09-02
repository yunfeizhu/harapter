[English](./architecture.md) · [简体中文](./architecture.zh-CN.md) ·
[日本語](./architecture.ja.md)

# Harapter アーキテクチャ

## 1. アーキテクチャの目標

Harapter が解決する課題は 1 つです。上位 Application が安定した Interface を通じて、複数の異なる Harness が公開している Machine
Interface に接続し、利用できるようにします。

Harapter 自体は Harness ではなく、既存の Harness の上に別の Agent Execution
Loop を構築しません。Graph、Agent Loop、Tool、Skill、Plugin、Session
Store、Checkpoint、内部 Security Mechanism は引き続き各 Harness が所有します。

設計は次の要件をすべて満たします。

- 1 つの Application が複数の Harness を登録して接続できる
- 1 つの Provider に複数の接続 Profile を構成できる
- Portable Core は特定の Provider に依存しない
- 共通化によって Provider 固有の動作を失わない
- Upstream の Breaking Change を 1 つの Provider Adapter 内に限定する
- 公式 Machine
  Interface に公開されていない Capability を正式な Support として模倣しない

## 2. 論理アーキテクチャ

```text
┌─────────────────────────────────────────────────────────────┐
│ Host Application                                            │
│ UI · Task Store · Product Policy · Artifact Index           │
└──────────────────────────────┬──────────────────────────────┘
                               │ Stable Harness API
┌──────────────────────────────▼──────────────────────────────┐
│ Core                                                        │
│ registry · profiles · contracts · capabilities · errors     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Provider Adapter Contract
┌──────────────────────────────▼──────────────────────────────┐
│ Provider Adapters                                           │
│ session mapping · event mapping · extensions · probes       │
└───────────────┬────────────────┬────────────────┬───────────┘
                │                │                │
        Official SDK      stdio / JSON-RPC    HTTP / ACP
                │                │                │
┌───────────────▼────────────────▼────────────────▼───────────┐
│ User-provided Harness Runtimes                              │
│ Qwen · OpenCode · Codex · Goose · Crush · DSH · ...         │
└─────────────────────────────────────────────────────────────┘
```

Core、Provider Adapter、Harness
Runtime は 3 つの独立した境界です。共通 Transport
Library は ACP、JSONL、JSON-RPC、HTTP、SSE、Process
Hosting を再利用できますが、Transport は通信だけを担当し、Provider
Semantics を決定しません。

## 3. Core

Core は特定の Provider に依存しない要素だけを含みます。

- Provider Registry と Adapter Factory
- Harness Profile と接続 Configuration の契約
- `HarnessClient`、`HarnessSession`、`HarnessRun` Interface
- Input、Event、Interaction、Capability、Error Type
- Provider Extension Registry
- 共通 Conformance Test Kit

Core は次の要素を含みません。

- Harness SDK への依存
- Provider 名の Enum または Provider 固有の Conditional Branch
- Provider-native API Field
- Runtime Installer または Third-party Account Login の実装
- Graph State、Checkpoint、Tool の内部 Object
- Host 製品の Database、Task、UI Type

## 4. Provider Registry と Profile

Provider Adapter は Registry へ Dynamic Registration されます。Provider ID は
`qwen.code` のような Adapter 実装を表し、Profile ID は `qwen-local`
のような Host 内の実際の接続 Configuration を表します。

```text
Provider: qwen.code
    ├── Profile: qwen-local
    └── Profile: qwen-team-account

Provider: opencode
    ├── Profile: opencode-local
    └── Profile: opencode-remote
```

Profile により、1 つの Application が異なる Harness へ同時に接続でき、1 つの Harness で異なる Account、Workspace、Deployment
Endpoint を利用できます。Core は Default
Profile を決定しません。これは Host の Setting と Task Creation の責務です。

## 5. Provider Adapter

各 Provider Adapter は、1 つの Harness が公開する Interface を Mapping します。

- SDK、Process、Socket、Service Connection を検証して確立する
- Runtime Identity、Protocol の特性、観測した Capability を読み取る
- Portable Session を Thread、Conversation、Agent Session、Provider
  Session へ Mapping する
- Portable Run を Turn、Prompt、Graph Run、Agent Prompt へ Mapping する
- Provider の Streaming Message を Portable Event へ変換する
- Native Cancellation、Approval、User Input、Close Semantics を Mapping する
- Provider Error を Portable Error Category に分類する
- Provider Extension、Native Client、Raw Event を公開する
- 共通 Conformance Test と Provider 固有 Test に合格する

Adapter は対象 Harness の内部実装を複製しません。公式 SDK を使用するか、公式に公開された RPC/HTTP
Protocol の Client を実装します。

## 6. 接続方式

### 6.1 Embedded SDK

```text
Host Process ──▶ Provider Adapter ──▶ Official Harness SDK
```

公式 SDK を提供する Harness に適しています。SDK
Object は Host から注入するか、Host が提供する機密情報を含まない Configuration から Provider
Adapter が作成します。

### 6.2 Managed Process

```text
Host Process ──▶ Provider Adapter ──▶ official stdio/RPC ──▶ Harness Process
```

Codex App Server、ACP Server、Headless JSONL
CLI に適しています。Adapter は Host が明示的に指定した Command を起動できますが、Executable の Download、Upgrade、Discovery は行いません。

Process Ownership は明示します。

- `adapter`：Adapter が Process の起動、Health Check、Close を担当する
- `host`：Host が Process を所有し、Adapter は通信 Channel だけを閉じる
- `external`：User または External
  Service が Process を管理し、Adapter は Lifecycle を制御しない

### 6.3 Service Endpoint

```text
Host Process ──▶ Provider Adapter ──▶ HTTP / SSE / WebSocket ──▶ Harness Service
```

OpenCode Server、OpenHands Agent Server などの Long-running
Service に適しています。Deployment、Authentication、Network Boundary、Service
Lifecycle は Host が所有します。

### 6.4 Local Socket

```text
Host Process ──▶ Provider Adapter ──▶ Unix Socket / Named Pipe ──▶ Harness Service
```

公開された Local Control API を持つ Harness に適しています。Socket Path、Access
Permission、Process Ownership は明示的に構成し、User
Directory を Scan して Active Service を推測しません。

## 7. Multi-Harness Runtime Topology

1 つの Client が Qwen
Code と OpenCode へ同時に接続する場合、次の Topology を使用します。

```text
Application
    │
    ├── HarnessClient(profile=qwen-local)
    │       └── Session q-123 ──▶ Qwen Code
    │
    └── HarnessClient(profile=opencode-local)
            └── Session o-456 ─▶ OpenCode
```

Host は 2 つの Session を並行実行でき、新しい Task には任意の Profile を選択できます。Portable
Event は同じ UI Rendering Layer に送れますが、Session、Run、Raw
Event、Authentication、Error は Provider Identity を保持します。

## 8. Session の Binding と Migration

`SessionRef` は少なくとも次の情報に結び付きます。

- `providerId`
- `profileId`
- Provider-native Session ID
- Reference 作成時に記録した Compatibility Identity Summary

Resume には同じ Provider
Adapter と互換性のある Profile を使用します。Core は Qwen の `SessionRef`
を OpenCode に渡さず、Chat History の Replay で Native Resume を模倣しません。

Harness をまたぐ Task の継続は、Host
Level の Export と Recreation です。Host は Task
Description、User が許可した Message Summary、File
Reference、Artifact を新しい Input として渡せます。ただし、新しい Harness は新しい Session を作成し、元の Harness の内部 State は移行しません。

## 9. 3 層の Capability Model

### 9.1 Portable Core

最低限の Portable Semantics は次のとおりです。

- Client の確立
- Session の作成
- Text Input の送信
- 順序付けられた Event の受信
- Completion、Failure、Connection Abort などの明示的な Terminal State の取得
- Session と Client の Close

### 9.2 Optional Capability

次の動作が Provider Semantics を持つと宣言できるのは、対応する Capability が
`native` の場合だけです。

- Session Resume または Fork
- Run Cancel または Interrupt
- Approval と User Input
- Reasoning、Tool、Artifact、Usage Event
- Dynamic Model、Mode、Permission の変更

Adapter が所有する Process の終了は `connection.abort`
であり、自動的に Provider-native `run.cancel` にはなりません。

`emulated` は、Evidence により同等の Portable
Result が証明されたことだけを表し、Provider-native
State を継承しません。`adapter_controlled`
は Adapter が接続を制御することだけを表します。`unsupported`
は確実に実装できないことを確認済みです。`unknown`
は Evidence が不足しています。Manifest にない名前は現在の接続が認識していないため、`unknown`
と統合しません。

### 9.3 Provider Extension

DSH Plugin Marketplace、Goose Recipe、Qwen Goal、Codex App、Copilot Slash
Command などの Provider 固有動作は Provider
Namespace に入ります。Core はこれらの Interface を解釈せず、Extension を使用する Code が Provider を切り替えられるとは保証しません。

## 10. State Ownership

| State                     | Owner                        | Adapter の動作                                     |
| ------------------------- | ---------------------------- | -------------------------------------------------- |
| Agent Loop / Graph State  | Harness                      | 内部構造を読み取らず、Copy しない                  |
| Provider Session / Thread | Harness                      | Provider に結び付いた Opaque Reference を返す      |
| Checkpoint                | Harness                      | 変換も Migration もしない                          |
| Tool / Skill / Plugin     | Harness                      | 公開動作を観測するか Native Access を使う          |
| Raw Provider Event        | Harness                      | Redaction 後に必要に応じて保持する                 |
| Profile Configuration     | Host                         | Core は利用するが Configuration Store にはならない |
| Product Task/Message/Run  | Host                         | Adapter は永続化しない                             |
| User File と Artifact     | Host または Harness          | Adapter は Reference と Event を渡す               |
| Secret                    | Host Secret Store または SDK | Adapter は Plaintext を記録しない                  |

## 11. Event Boundary

安定して解釈できる Native Message は Portable Event に Mapping します。

```text
run.started
message.delta
message.completed
reasoning.delta
tool.started
tool.updated
tool.completed
interaction.requested
interaction.resolved
artifact.created
usage.updated
run.completed
run.cancelled
run.failed
connection.aborted
provider
```

各 Run の Event Stream では Sequence が単調増加し、Terminal
State は 1 つだけ生成されます。Unknown Event は `provider`
に Mapping し、`providerEventType` と必要に応じて Redaction 済み Raw
Payload を保持します。Adapter は TUI Display Text から Event
Type を推測しません。

## 12. Security と Trust Boundary

- Adapter は Serializable な Plaintext
  Secret を受け取らず、Configuration には Secret Reference だけを保存する
- Raw Provider Error、Environment Variable、Request Header、Raw
  Event は既定で Redaction する
- Runtime の Tool
  Permission と Sandbox は Runtime または Host 製品が引き続き管理する
- Interface の共通化によって、Harapter が Third-party
  Runtime や Plugin の Security を保証することはない
- Adapter は Structured Command と Argument で Process を起動し、User
  Input を Shell へ埋め込まない
- User が選択できる Profile、Working Directory、Network
  Endpoint、Runtime は Host が決定する

## 13. Host 製品との関係

Host 製品は、Task、Message、Run、Database、Artifact、Setting、Secret
Store、Approval Experience、Security Policy を引き続き所有します。Harapter
Event は Host 製品の Event へ一方向に投影できますが、Host 製品の Source of
Truth を置き換えません。

Production Harness の導入や置換では、Host 自身の Architecture
Decision に Cross-process Contract、Resume Semantics、Security
Boundary、Regression Test を記録します。Harapter はこれらの Product Level
Boundary を Host の代わりに決定しません。

## 14. 新しい Provider の追加

Harness を追加するには、次の作業が必要です。

1. 独立した Provider Package を作成し、Stable Provider ID を登録する
2. 対象 Harness の公式 Machine Interface を選択する
3. Connection、Session、Run、Event、Error の Mapping を実装する
4. 実際の Capability を検出して宣言する
5. 必要な Provider Extension と Native Client を公開する
6. 共通 Conformance Test と Real Runtime Test に合格する

Provider の追加に Core の変更や他 Provider の同時 Upgrade は必要ありません。
