[English](./provider-adapter-guide.md) ·
[简体中文](./provider-adapter-guide.zh-CN.md) ·
[日本語](./provider-adapter-guide.ja.md)

# Provider Adapter 開発ガイド

## 1. 責務

Provider
Adapter は 1 つの Harness が公開する SDK/API を呼び出し、その外部 Semantics を Harapter
Core に Mapping します。

必須事項：

- 公式 SDK、RPC、HTTP API、または文書化された Machine Protocol を使用する
- Client、Session、Run の Mapping を確立する
- Streaming Event、Interaction Request、Error を変換する
- 現在の接続が実際にサポートする Capability を Probe する
- Provider-native 動作と Adapter の Connection Control を区別する
- 観測済み Capability がサポートする場合だけ Provider Extension、Native
  Client、任意の Raw Event を公開する。非対応の場合は Empty Registry または
  `undefined` を保ち、制限を文書化する
- 共通 Conformance Test Kit に合格する

禁止事項：

- 対象 Harness の Agent Loop を複製する
- TUI Text を Scrape したり GUI を操作したりする
- Third-party Runtime を自動的に Download、Select、Update する
- Harness の Plugin、Tool、Skill、Checkpoint、Sandbox を所有する
- Provider 固有 Type を Core に追加する
- 存在しない Capability の Compatibility Implementation を捏造する
- Process Termination を Provider が確認した Native Run Cancel と説明する

## 2. Package 構成

```text
providers/<provider-id>/
├── adapter
├── manifest
├── connections
├── compatibility
├── session-mapper
├── event-mapper
├── error-mapper
├── capabilities
├── extensions
├── native
├── fixtures
├── conformance
└── README
```

- `adapter`：Provider Adapter SPI の実装
- `manifest`：Stable Provider ID、Display Metadata、Connection Kind
- `connections`：SDK、Process、ACP、RPC、Socket、Service Connection のラップ
- `compatibility`：Runtime Probe と Strategy Selection
- `session-mapper`：SessionRef、RunRef、Resume Mapping
- `event-mapper`：Native Event から Portable Event への Mapping
- `error-mapper`：Portable Error の Classification と Redaction
- `capabilities`：現在の接続の Capability Manifest を生成
- `extensions`：Typed Provider-specific Interface
- `native`：公式 SDK Client または Protocol Client への Escape Hatch
- `fixtures`：Redaction 済み Protocol および Event Sample
- `conformance`：共通動作と Provider 固有動作の Test

## 3. 統合インターフェースの選択

推奨順：

1. 公式かつ文書化され、Embedding に適した SDK
2. 公式双方向 Machine Protocol または Agent Server
3. 公式 HTTP/OpenAPI、ACP、JSON-RPC、または Local Socket API
4. 公式 Headless JSON/JSONL CLI
5. Provider Maintainer が公開する Stable Shim
6. Interactive Terminal Text や UI
   Automation を正式インターフェースとして使用しない

選択前に次を確定します。

- Connection の Open と Close 方法
- Runtime Identity と Protocol の Discovery 方法
- Session の Create、Resume、Reference 方法
- 1 つの Input の Submit 方法
- Streaming Event の受信と唯一 Terminal State の判定方法
- Native Cancel、Approval、User Input の Support
- Concurrent Session または Run の許可
- Native Provider Error と固有動作へのアクセス方法
- 現在のインターフェースの License と Distribution 要件

1 つの Provider は複数の Connection
Strategy を実装できます。それぞれの Strategy は Portable Semantics
Test を共有し、Capability を別々に表明します。

## 4. Provider Manifest

```ts
const manifest = {
  providerId: 'vendor.harness',
  displayName: 'Vendor Harness',
  connectionKinds: ['sdk', 'process'],
  documentationUrl: 'https://example.com/provider-adapter',
};
```

公開された Provider ID は安定して維持します。Core は対応する Enum や Conditional
Branch を追加しません。異なる Protocol、Version Governance、Extension
Semantics を持つ Derived Harness は、基盤 Framework を詐称せず独立した Provider
ID を登録します。

## 5. Connection 実装

### SDK

- SDK Client を Host と Adapter のどちらが作成するかを明示する
- Provider Runtime を含む SDK は、Host が供給する Optional
  Peer である必要がある。既定 Workspace 依存または Lockfile に含めず、Adapter は Dynamic
  Loading または Explicit Binding を使用する
- 未宣言の Global Configuration や Environment Variable を読まない
- Close 時に Host 所有の SDK Client を Dispose しない
- 公式 SDK が内部で Child Process を起動する場合、Descriptor に実際の Runtime
  Topology を記載する

### Process

- Shell Concatenation を使わず、構造化した `command` と `args` を使用する
- stdout では公式 Protocol だけを解析し、stderr は Bounded Diagnostic
  Stream として扱う
- Startup Timeout、Health Check、Backpressure、Unexpected Exit、Idempotent
  Close を実装する
- Process Ownership が `adapter` の場合だけ Proactive Termination を許可する
- Non-zero Exit または Truncated
  Protocol は、影響を受けるすべての Run を終了させる

### Endpoint と Socket

- URL、Socket Kind、Authentication Reference、Connection Timeout を検証する
- Authorization、Cookie、完全な Sensitive Query を Log に出力しない
- Reconnection が Event Cursor を Resume できるかを明記する
- 未知 Local Port や User Directory を Scan して Service を推測しない
- Host または External System が Service を管理する場合、`close()` は Client
  Connection だけを閉じる

## 6. Session Mapping

| Core           | Provider が使用する可能性のある概念               |
| -------------- | ------------------------------------------------- |
| HarnessClient  | SDK Client、App Server Connection、Service Client |
| HarnessSession | Thread、Session、Conversation、Agent Session      |
| HarnessRun     | Turn、Prompt、Graph Run、Agent Prompt             |
| Interaction    | Approval Request、Interrupt、Server Request       |

Mapping 要件：

- SessionRef は `providerId`、`profileId`、Native Session ID を保持する
- Provider に Native Run
  ID がない場合、Client 内で一意の ID を生成できるが、Persistent
  Semantics を表明しない
- Provider に Resume がない場合は `unsupported_capability` を返す
- 完全な History を暗黙に Replay して Native Resume を捏造しない
- Resume 前に SessionRef の Provider、Profile、Compatibility Identity を検証する
- Session 間で Event や Interaction Request を混在させない

## 7. Event Mapping

すべての Native Message を明示的な Mapping Table に入れます。

| Native Message         | Core Event              | Portable でない情報      | 処理方法                           |
| ---------------------- | ----------------------- | ------------------------ | ---------------------------------- |
| Assistant text delta   | `message.delta`         | Provider Metadata        | Optional Raw                       |
| Tool begin             | `tool.started`          | Native Argument          | Portable Summary と Redacted Raw   |
| Approval request       | `interaction.requested` | Native Schema            | `providerState`                    |
| Unknown event          | `provider`              | 公開可能なすべての Field | `providerEventType` と Raw         |
| Unexpected exit or EOF | `connection.aborted`    | Redacted stderr          | 影響する Non-terminal Run を Abort |

Event 変換要件：

- Original Ordering を保持する
- 1 つの Run から Terminal State を正確に 1 つ生成する
- Display Text から Event Type を推測しない
- Provider が公開していない Reasoning を生成しない
- Raw の有効・無効にかかわらず Portable Event を維持する
- Unknown Event を保持し、Success として再解釈しない
- 公式インターフェースが Process Exit を権威ある Provider Failure
  Terminal と定義する場合だけ `run.failed` を使用する。Unexpected
  Exit、EOF、または Terminal Authority の欠落は `connection.aborted` を生成する
- Raw Event、Tool Argument、Error を Redact し、Length と Rate に上限を設ける

## 8. Capability Mapping

Capability は現在の接続から生成し、Provider
Brand 名から推測しません。証拠には次を使用できます。

- Official Handshake と Capability List
- 現在の Runtime が生成する Schema
- SDK Object が公開する Method と Type
- 現在の Connection Strategy
- Startup Configuration と License State
- Side-effect-free Feature Probe
- 検証済み Compatibility Strategy

実 User Task を実行して Capability を Probe してはいけません。

Cancel は別々に判定します。

```text
run.cancel = native
connection.abort = adapter_controlled
```

Process を Kill するだけの Adapter は `run.cancel = native` を表明できません。

## 9. Provider Extension

Provider 固有動作は Namespace を使用します。

```ts
extensions.register('goose.recipes', gooseRecipes);
extensions.register('qwen.code.goal', qwenGoals);
```

Extension は公式 Interface を直接呼び出します。Adapter は Plugin
Marketplace、App System、Package Manager を再実装しません。

公式 SDK/API がサポートする動作に Adapter がまだ Typed
Extension を提供していない場合、Caller は Native Client からアクセスできます。

## 10. Error Mapper

Error Mapper は次を区別します。

- Runtime が利用できない
- Connection または Handshake 失敗
- Authentication 失敗
- Provider API 非互換
- Unsupported Capability
- Invalid Input
- Session が利用できない、または Provider/Profile Mismatch
- Provider Execution 失敗
- Timeout
- Adapter による Connection Abort

未知 Provider Failure を Success、Empty
Response、または通常の Timeout に変換できません。`providerCode`
は保持できますが、Error Body を先に Redact します。

## 11. Conformance Test

### Connection

- Successful Connection と Idempotent Close
- Runtime Unavailable、Authentication Failure、Incompatible Protocol
- Adapter、Host、External が所有する Process
- Startup Timeout、Connection Loss、Unexpected Exit

### Session

- Create、Multi-turn Call、Close
- Support 時の Resume、Unsupported 時の明示的拒否
- Profile と Provider Mismatch
- Session 間の Isolation
- Provider Concurrency Limit

### Streaming

- Text Delta Ordering
- Tool、Interaction、Artifact、Usage
- Unknown Event と Raw
- Slow Consumer と Buffer Limit
- Unique Terminality
- Truncated Event Stream

### Cancel と Interaction

- Native Cancel、Connection Abort、Terminal 後の Cancel
- Approval、Deny、User Input、Invalid Request ID
- Unsupported 時の Capability と Error の一致
- Auto-approval Mode を Interaction Capability として報告しない

### Extension と Native

- Extension Registry と Namespace
- Extension は公式 Interface を直接呼び出す
- Native Client の Provenance が明確
- Extension は Portable Core Semantics を変更しない

### Redaction

- Secret、Authorization、Cookie、Environment Variable
  Value が Log、Error、Fixture に入らない
- Raw が既定で無効のとき、Raw Event と Provider Error が漏洩しない
- User Prompt、File Content、大きな Tool Output が Public Fixture に入らない

## 12. 完了基準

Provider Adapter を Release する前に次を満たします。

- Official Interface、License、Runtime Prerequisite が明確
- Connection Strategy、Session、Run、Event、Capability、Error Mapping を文書化
- Shared Conformance Test が成功
- 対象 Runtime の Live Test が成功
- Adapter が表明するすべての Provider Extension に独立した Type と Test がある
- Native Escape Hatch が使用可能、または提供しないことを明記
- Known Limitation と Experimental Behavior が明確
- Connection Failure や Unsupported Behavior を暗黙に Degrade しない
- 新 Provider のために Core に名前判定を追加する必要がない

## 13. 公式資料

最初の Provider の Machine Interface と制限は
[Provider 統合マトリクス](./provider-matrix.ja.md)に記録します。実装時は Provider
Package README に対象 Official Documentation、Protocol Schema、License、Live
Test Environment も固定します。
