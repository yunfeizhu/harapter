[English](./compatibility.md) · [简体中文](./compatibility.zh-CN.md) ·
[日本語](./compatibility.ja.md)

# 互換性設計

## 1. 基本的な判断

Core は特定の Harness Version に依存すべきではありませんが、Provider
Adapter は Version を完全に無視できません。

Adapter は Third-party
SDK/API を呼び出します。Method、Field、Event、Error、Lifecycle が変更される可能性がある限り、Mapping
Layer は現在のインターフェースが引き続き互換かを認識する必要があります。Version を無視しても Breaking
Change は消えません。User Task 実行中まで失敗を先送りし、Empty
Event、誤った Error Mapping、State Loss として現れるだけです。

正しい境界は次のとおりです。

- Core は Qwen、Codex、DSH などの特定 Harness Version を知らない
- 各 Provider Adapter は自身の Protocol Compatibility を独立して処理する
- Host は最新 Runtime を選択できるが、「最新」を「検証済み互換」と自動的に同義にできない
- Compatibility は Handshake、Schema、Behavior Probe を主な根拠とし、Version
  Number は証拠の 1 つにすぎない

## 2. 3 種類の Version

次の Version 責務を区別します。

| 対象             | Version 責務                                             |
| ---------------- | -------------------------------------------------------- |
| Core             | Stable Portable Contract と Provider Adapter SPI         |
| Provider Adapter | 対象 Harness Interface Mapping と Compatibility Strategy |
| Harness Runtime  | 実際の SDK、CLI、Service、Protocol Implementation        |

3 者は独立して Release できます。Qwen Code Adapter の Update に新しい Core
Release を必要とせず、Cursor Event Parsing の修正が OpenCode
Adapter に影響してはいけません。

## 3. Connection 時の Compatibility Probe

`connect()` は User
Session を作成する前に、インターフェースが許す Side-effect-free または Low-side-effect
Validation を行います。

1. Runtime または Endpoint の存在を確認する
2. 公開 Protocol Compatibility Promise、Handshake
   Information、利用可能な Runtime Schema を読む
3. Fixture と Conformance Evidence を持つ Compatibility Strategy を選択する
4. Handshake 時に Probe 可能な Required Structure を検証する
5. Client Descriptor と Capability Manifest を生成する
6. 既知 Incompatible Interface に `provider_api_incompatible` を返す

Handshake で列挙できない Response と Event
Structure は、対応する Operation が最初に現れた時点で構造検証します。Required
Field の欠落は `provider_api_incompatible` を返します。New Optional
Field は Upstream が公開する Forward Compatibility Rule に従います。実 User
Task の実行で Capability を Probe できません。安全に判断できない場合は
`experimental`、`unknown` とするか、Fail Closed します。

## 4. Schema 優先

Provider が Machine-readable
Schema を生成または公開できる場合、それを優先します。

- Codex App Server は現在の Runtime から TypeScript または JSON
  Schema を生成し、Fixture、Mapping、Conformance Evidence に使用する
- OpenCode は OpenAPI を公開する
- ACP Provider は Base ACP Protocol に従い、Provider
  Notification と Extension も Probe する
- JSONL CLI は公開 Event Schema と Recorded Fixture を使用する
- SDK Provider は Official Exported Type と最小 Runtime Feature Probe を使用する

Version Range が示すのは「互換の可能性」だけです。Official Stable Protocol
Promise、Current Schema、Operation-time Structural
Validation、Conformance が共同で Adapter の Support Interface を定義します。

## 5. Compatibility Strategy

Provider Package は、異なる Protocol Family に独立 Strategy を保持できます。

```text
adapter-qwen
    ├── strategy-sdk
    ├── strategy-acp
    ├── strategy-daemon
    └── strategy-stream-json

adapter-opencode
    ├── strategy-http-openapi
    └── strategy-acp
```

異なる Strategy は Portable Provider Semantics
Test を共有しますが、異なる Capability を生成できます。Strategy は Provider
Package の Internal Implementation であり、Core Enum に入りません。

Upstream に Breaking Change が発生した場合、通常は次の対応を行います。

1. User が引き続き使用する Old Strategy を保持する
2. New Protocol Strategy を追加または置換する
3. Event、Error、Capability Mapping を更新する
4. Old/New Fixture と Live Conformance を追加する
5. その Provider Adapter を Release する
6. Core と他の Provider Package を変更しない

これにより Replacement を十分速くできますが、未知の将来変更がすべて Code
Change 不要であることは保証できません。

## 6. Runtime Version は必ず Pin するのか

Adapter Design は User に特定 Harness
Version の永久的な Pin を要求しませんが、Production
Deployment には Reproducibility が必要です。

3 つの Host Policy をサポートします。

### 6.1 Verified

Adapter CI が検証済みの Runtime Version または Protocol
Fingerprint だけを実行します。Enterprise と Stable Client に適します。

### 6.2 Compatible Range

既知 Schema と Behavior Probe に一致する Version
Range を許可します。通常の Desktop Product に適します。

### 6.3 Latest Canary

User が最新 Runtime に追従できますが、最初の接続を再 Probe し、Experimental
Status を明示します。Developer Preview に適しますが、Stable Support
Claim を自動的に拡大しません。

したがって `adapter-dsh 0.4.1` のような Adapter Package Version は、Harness
Runtime を永久に同じ Version へ Pin することを要求しません。Adapter は理解できる Protocol
Family を表明して Probe し、Host が Deployment の Runtime を Pin するかを決定します。

## 7. Capability は Runtime Result

Capability は Static Table にのみ記載できません。少なくとも次の影響を受けます。

- Runtime Version と Protocol
- Connection Strategy
- Startup Argument
- Account と License
- Enabled Plugin、Skill、App、MCP
- Server-side Feature Flag
- Operating System と Deployment Topology

同じ `github.copilot-cli` Provider でも Server Startup
Argument が異なれば Capability が異なる場合があります。同じ OpenCode
Provider でも HTTP と ACP で異なる場合があります。

Capability Cache は Runtime Identity と重要な Nonsensitive Configuration
Digest を Key とし、Provider ID だけを Key にしません。

Capability Result は `native`、Evidence-backed
`emulated`、`adapter_controlled`、`unsupported`、`unknown`
を区別します。Name が欠落する場合は現在の Adapter がその Capability を認識していないことを意味し、明示的な
`unknown`
は Name を認識しているものの Evidence が不十分であることを意味します。どちらも既定で
`native` だけを受け入れる Host Requirement を満たしません。

## 8. Runtime Identity

Diagnostic と Compatibility Cache は次の Nonsensitive Identity を使用できます。

```text
Runtime Identity =
  Provider ID
  + Adapter Version
  + Connection Strategy
  + Runtime Version or Protocol Fingerprint
  + Extension/Profile Fingerprint when relevant
```

Identity は Secret、完全な Environment Variable、User Prompt、File
Content、Local Credential Path を保存しません。

Plugin-based Harness では、Plugin Set が Event、Tool、Agent
Behavior を変更する可能性があります。Provider が Extension
Fingerprint を読める場合、Capability Cache と Session Compatibility
Ref に含めます。読めない場合は Limitation を文書化します。

## 9. Unknown Field と Event

- 文書が Field 追加を明示的に許可する場合、Unknown Optional Field を無視する
- Required Field の欠落は Protocol Incompatibility であり、Misleading Default
  Value を入れない
- Unknown Event を `provider` Event として保持し、`providerEventType`
  と安全かつ有界な Summary を保持する。Optional Raw
  Data はサイズと構造を有界にし、Redaction と Rate Limit を適用する
- Unknown Terminal State から Success を推論しない
- Authoritative Terminal Result のない CLI Non-zero Exit は `connection.aborted`
  に Mapping する。公式インターフェースがその Exit を権威ある Provider
  Failure と定義する場合だけ `run.failed` に Mapping する
- Native Provider Error を Redact および Bound し、Original Error
  Code を保持する

## 10. Rollback と Coexistence

Provider Adapter Package は Compatible
Strategy の共存を許可すべきです。Upgrade に失敗した場合、Host は次を実行できます。

- 1 つの Provider Adapter のみ Rollback する
- Old Strategy に切り替える
- Old Runtime を引き続き使用する
- New Runtime Profile を Unavailable とし、他の Provider に影響させない
- New Task に別の Harness Profile を選択する

作成済み Session は元の Provider、Profile、Compatibility
Identity に結び付いたままです。Rollback によって他の Provider または Profile がその Session を引き継ぐことはできず、New
Runtime が Old Checkpoint を Resume できることも保証しません。

## 11. Support Claim

各 Provider Release は次を表明します。

- Supported Connection Strategy
- Verified Runtime または Protocol Range
- Required/Optional Capability
- Known Incompatible Version または Feature
- Authentication と Runtime Installation Prerequisite
- Experimental Behavior
- Fixture と Live Conformance Coverage
- Provider Extension と Native Client の Stability Boundary

Static Documentation は Range を説明し、Runtime Capability
Manifest は現在の接続で可能なことを決定します。どちらも Brand 名で代用できません。

## 12. Compatibility Test

各 Provider は少なくとも次をカバーします。

- Oldest Supported Interface
- Current Mainstream Interface
- Unknown Added Field
- Required Field の Remove または Rename
- New Event Type と Changed Terminal State
- Changed Error Structure
- Connection Loss と Unexpected Process Exit
- Capability と Actual Behavior の一致
- Compatible/Incompatible Runtime 上での Old SessionRef の Resume Result
- Provider Extension が Portable Core に影響しない
- Secret と Sensitive Native Information が Fixture、Log、Error に入らない

Latest Upstream は Scheduled Canary
Test に入れられますが、Canary が通過する前に Stable Compatibility
Range を自動的に拡大しません。
