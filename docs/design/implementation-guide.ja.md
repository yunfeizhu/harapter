[English](./implementation-guide.md) ·
[简体中文](./implementation-guide.zh-CN.md) ·
[日本語](./implementation-guide.ja.md)

# Harapter 実装ガイド

この文書は Target Repository の形態と Delivery
Sequence を説明し、一部の項目は実装に先行する場合があります。現在の動作は Package/Provider
README、Export、Source、Test、Released
Artifact で定義されます。ここに記載された Directory や Provider は、実装済みまたはサポート済みであることの証拠ではありません。

## 1. 独立 Repository 構成

```text
harapter/
├── docs/
├── packages/
│   ├── core/
│   ├── schema/
│   ├── conformance/
│   ├── transport-acp/
│   ├── transport-jsonrpc-stdio/
│   ├── transport-jsonl-process/
│   ├── transport-http-sse/
│   └── transport-local-socket/
├── providers/
│   ├── claude/
│   ├── codex/
│   ├── opencode/
│   ├── goose/
│   ├── qwen/
│   ├── crush/
│   ├── copilot/
│   ├── cursor/
│   ├── dsh/
│   ├── hermes/
│   ├── openclaw/
│   └── pi/
├── examples/
│   ├── single-provider/
│   └── multi-provider-client/
├── fixtures/
└── licenses/
```

Core、Transport、Provider
Package は独立します。Transport は Framing、Connection、Backpressure、Lifecycle だけを実装し、Provider
Semantics を含みません。Provider
Package は Transport を再利用できますが、Session、Event、Capability、Error
Mapping を独立して所有します。

Portable Contract は 1 つの Schema または同等の Canonical
Types で定義すべきです。将来複数のプログラミング言語の SDK を提供する場合、互いに一致しない Contract を手書きするのではなく、可能な限り Portable
Schema から Language Binding を生成します。

## 2. Build 順序

### 2.1 Portable Contract と Fake Provider

最初に実装するもの：

- Provider Registry
- Harness Profile
- HarnessClient、HarnessSession、HarnessRun
- HarnessInput と HarnessEvent
- Interaction
- Capability Manifest
- HarnessError
- Provider Extension Registry
- Native Escape Hatch

Fake Provider で次の動作を固定します。

- Multiple Profile の Register と Select
- Session と Provider/Profile の Binding
- Event Ordering と Unique Terminality
- Native Cancel と Connection Abort の区別
- Capability Rejection
- Unknown Event と Raw
- Extension と Error Classification

### 2.2 最初の Reference Provider

Brand 数を増やすのではなく、異なる Connection
Topology をカバーできる Provider を優先します。

1. **Codex**：Bidirectional Process
   RPC、Session/Turn、Approval、Interrupt、Schema-driven Compatibility を検証
2. **OpenCode**：HTTP/OpenAPI、SSE、Long-running Service、External Lifecycle
   Ownership を検証
3. **Claude Code**：Official SDK、SDK-managed Process、Streaming Tool
   Event を検証

SDK、Process、Service の 3 種類の Topology で自然に実装できる場合にのみ、Portable
API は Stabilization に適します。

### 2.3 次の Vertical Slice

最初の Reference Provider 完了後、次の Module をこの順で独立して実装します。

1. **DeepSeek Harness**：Official SDK stdio JSON-RPC
   Interface で制約された Process Harness を検証する。Native In-progress
   Cancellation の証拠がない場合は Connection のみを Close して Connection
   Abort を報告する
2. **Hermes Agent**：Host が用意する API Server で Session REST、Run
   Status、SSE、Stop、Approval Control Plane を検証する
3. **ACP Transport**：既存 JSON-RPC stdio
   Transport を組み合わせ、Provider-neutral な ACP
   Schema、Method、Negotiation、Capability Validation を実装する
4. **OpenClaw**：Host が用意する `openclaw acp` で ACP Transport を再利用し、ACP
   Session と Gateway Session の Ownership Mapping を保持する
5. **JSONL Process Transport**：非 JSON-RPC 双方向 Process Protocol に Strict LF
   Framing、Bounded Queue、Serialized Write、Backpressure、Connection
   Cleanup を提供する
6. **Pi Agent**：Host が用意する `pi --mode rpc` で JSONL Process
   Transport を再利用し、`agent_settled` と Authoritative Assistant
   Result で Run Terminality を固定する

各項目は 1 つの独立 Module と Pull Request です。Provider
Adapter は対応する Documentation、Redacted Fixture、Conformance
Test、Compatibility Evidence と一緒に提供します。Third-party
SDK、CLI、Gateway、Runtime は Host が Installation、Authentication、Management を担当し、Harapter の Default
Workspace Dependency に入れません。この順序とインターフェースを選ぶ理由は
[Corresponding Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-next-provider-integration-sequence.md)
に記録します。

### 2.4 Shared ACP Transport

Provider Semantics Layer の外側に ACP
Transport を実装し、次の Provider に個別に統合します。

- OpenClaw
- Goose
- GitHub Copilot CLI
- OpenCode ACP Strategy
- Qwen Code ACP Strategy

これらの Provider は Protocol Communication と Base ACP
Type を共有しますが、Provider ID、Startup
Argument、Capability、Command、Extension は共有しません。最初の OpenClaw
Adapter は Official ACP Bridge を使用し、Gateway WebSocket
Client を直接実装しません。

ACP Layer は `@harapter/transport-jsonrpc-stdio` の Framing、Request
Correlation、Backpressure、Bounded Queue、Wait Timeout、Connection
Cleanup を再利用します。2 つ目の JSON-RPC Transport を実装しません。Bridge
Process の Create、Terminate、Restart、Ownership は Provider
Connection が所有します。ACP Layer は Process Exit を Provider-native
Cancellation と解釈しません。

### 2.5 Headless JSONL と Local Service

- `@harapter/transport-jsonl-process` は非 JSON-RPC 双方向 Headless JSONL
  Protocol に Strict LF Framing、Bounded Queue、Serialized
  Write、Backpressure、Connection Cleanup を提供します。Request
  Correlation、Event Classification、Terminality は Provider
  Adapter が所有し続けます。Pi Agent Adapter はこの Transport を使い、RPC
  Command、Session、Retry、Interaction、Cancel、Terminal
  Semantics を独立して所有します
- Qwen Code は SDK、Daemon、Stream JSON Strategy 間の一致を検証する
- Cursor Agent CLI は制限された Headless Interface、Non-zero Exit、Incomplete
  Terminal State を検証する
- Crush は Unix Socket、Windows Named Pipe、Shared Workspace、Service Version
  Probe を検証する

このグループは、すべての Adapter に完全な Control
Plane の捏造を強制するのではなく、Core が制約された Provider を正確に表現できることを証明します。

### 2.6 その他の Harness

LangGraph、OpenHands、Pi-based Derived
Harness は同じ SPI で Adapter を追加します。Transport と Test
Utility を再利用できますが、Core の変更を必要としません。

## 3. Test 構成

```text
conformance/
├── registry
├── profile
├── connection
├── session
├── streaming
├── interaction
├── cancellation
├── errors
├── extensions
├── native
└── redaction
```

### Fake Provider Test

実 Harness に依存せず Core 自体を検証します。

- Provider の Dynamic Registration と Removal
- 1 Provider の Multiple Profile
- Provider 間の Parallel Session
- Session Provider/Profile Mismatch
- Event Ordering と Unique Terminality
- Capability Mode
- Connection Abort
- Provider Event、Raw、Extension、Error Classification

### Recorded Fixture Test

Redacted Native Message で Provider Mapping を検証します。

- Normal Event
- Unknown Event と Field
- Missing Required Field
- Error Response
- Connection Loss
- Interaction Request
- Terminal JSON のない CLI Non-zero Exit

### Live Provider Test

User が提供する Test Environment の実 Official SDK/API を呼び出します。

- Connection と Capability Probe
- Session Create
- Multi-turn Run
- Streaming
- Tool と Interaction
- Native Cancel または Explicit Unsupported
- Resume
- Adapter が表明する Provider Extension
- Adapter が表明する場合の Native Client
- Concurrency Limit と Resource Close

Live Test は Runtime Identity と Nonsensitive Test
Configuration を記録します。1 回の Local Success をすべての Version
Support に拡大してはいけません。

### Latest Canary

変更の速い Upstream に対し、Scheduled Test が Latest Runtime を Install し Live
Conformance を実行できます。Canary Failure は対応 Provider の New-version
Support だけに影響し、Core や他の Provider を Block しません。Canary が成功しても Release
Policy に従う Compatibility Range の更新が必要です。

## 4. Multi-provider Reference Application

独立 Project は、Core だけに依存し、Semantics が異なる少なくとも 2 つの Harness に接続する Reference
Client を含む必要があります。

```text
Reference Client
    ├── codex-local ────▶ adapter-codex ────▶ Codex
    └── opencode-local ─▶ adapter-opencode ─▶ OpenCode
```

Reference Application は少なくとも次を実演します。

- 2 つの Profile を Configure し Select する
- Session を個別に Create する
- 2 つの Event Stream を同時に Consume する
- 1 つの UI Event Renderer を使用する
- Capability に基づいて Unsupported Action を隠す
- SessionRef を元の Provider と Profile に Binding し続ける
- New Task の Harness を切り替える
- OpenCode による Codex Session の Resume を拒否する
- Portable Core Example を汚染せずに 1 つの Provider Extension を使用する

これは Adapter の価値を検証する中心的な Acceptance Scenario です。

## 5. Example Configuration

```json
{
  "harnessProfiles": [
    {
      "profileId": "codex-local",
      "displayName": "Codex",
      "providerId": "openai.codex",
      "connection": {
        "kind": "process",
        "command": "/usr/local/bin/codex",
        "args": ["app-server", "--stdio"],
        "ownership": "adapter"
      }
    },
    {
      "profileId": "opencode-local",
      "displayName": "OpenCode",
      "providerId": "opencode",
      "connection": {
        "kind": "endpoint",
        "url": "http://127.0.0.1:4096",
        "transport": "http",
        "ownership": "external"
      }
    }
  ],
  "defaultHarnessProfile": "opencode-local"
}
```

この Configuration は User-supplied
Runtime のみを参照し、Adapter がそれらを自動的に Install することを意味しません。Production
Implementation は Controlled Settings System から Command、Endpoint、Secret
Reference を取得し、Arbitrary Project
File を信頼して Executable を起動しません。

## 6. Host 統合例

```text
Host Application Control Plane
        │
        ▼
Harapter Core
        │
        ├── Selected Provider Adapter A
        └── Selected Provider Adapter B
```

Host Application は引き続き次を所有します。

- Task、Run、Message、Product Event
- SQLite と Filesystem Data
- Artifact Index と Preview
- Settings と User Interface
- Secret Store
- Product Permission と Security Boundary

Host は Harapter が返す SessionRef と Event を Product
Data に単方向で Projection します。それらは Host Database を置き換えません。

Production Execution Path に統合する前に、Host は次を別途実施します。

- Harness Architecture ADR を更新する
- Cross-process Profile、SessionRef、Event、Capability Schema を定義する
- Old Task Resume と Provider Unavailable Behavior を設計する
- Harness 切り替えで Tool Policy、Sandbox、Network
  Boundary を迂回できないことを検証する
- LangGraph Adapter で Existing Behavior に Regression がないことを証明する
- 各 New Provider に Real Task と Failure Regression を追加する

## 7. 独立 Repository 要件

- Host Product Source がなくても Documentation を理解できる
- Core は Host Product または Harness SDK を Import しない
- Provider Package は Host Product Type を Import しない
- Public Fixture は User Prompt、File Content、Secret を含まない
- Third-party License と Official SDK Requirement を個別に記録する
- Core、Transport、Provider、Example は独立して Build および Test できる
- Host は実装 Source を長期的に Copy せず、正式 Package
  Dependency として Harapter を使用する
- Provider Package は独立して Release、Rollback、Disable できる

## 8. Acceptance Criteria

Core Design は次を満たすときに成立します。

- 1 つの Reference Application が Codex と OpenCode に同時接続する
- New Task は Profile の変更だけで Harness を選択できる
- Core は Provider 名判定を含まない
- Provider Adapter は Published SDK/API だけを呼び出す
- Session、Input、Event、Terminal Result、Error は Stable Portable
  Semantics を持つ
- SessionRef は Provider または Profile を越えて Resume できない
- Optional Behavior は Capability で検査する
- Native Cancel と Connection Abort を混同しない
- サポートする場合、Provider 固有動作に Extension または Native
  Client からアクセスできる
- Unknown Provider Event が失われない
- Runtime Installation、Plugin Marketplace、Framework Internal
  Execution は Core に入らない
- 公開するすべての Provider が Shared Conformance と Real-runtime
  Test に合格する
- Third-party Provider の追加で Core Source を変更しない
