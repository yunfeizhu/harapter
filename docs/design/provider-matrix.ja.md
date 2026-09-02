[English](./provider-matrix.md) · [简体中文](./provider-matrix.zh-CN.md) ·
[日本語](./provider-matrix.ja.md)

# Provider 統合マトリクス

## 1. 表明の範囲

この文書は、対象 Harness が公開するプログラム用インターフェースと、それらが Harapter の設計に与える影響を記録します。Provider が利用可能であることの保証ではありません。

Provider をリリース上で利用可能と表示できるのは、対応する Adapter に実装、互換性 Probe、Conformance
Test、実 Runtime Test がそろった後だけです。

「統合可能」とは、Session の作成、Input の送信、Event の消費、Terminal
Result の取得という共通の主経路をカバーできることを意味します。Native な高度 Capability は引き続き対象 Harness の公開 Machine
Interface に依存します。

DeepSeek Harness、Hermes
Agent、OpenClaw のインターフェース観測日は 2026-08-31、Pi
Agent は 2026-09-01 です。実際の互換性範囲は、接続時 Probe、Redaction 済み Fixture、Conformance
Test、実 Runtime Test、対応する Provider README によって共同で表明されます。

## 2. 対象 Provider

| Provider           | Provider ID             | 推奨インターフェース               | 想定 Portable Coverage | 主な制限                                                                                             |
| ------------------ | ----------------------- | ---------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Claude Code        | `anthropic.claude-code` | Claude Agent SDK                   | 高                     | SDK と CLI Process の Lifecycle、Permission Mode を明示的に設定する必要がある                        |
| Codex Harness      | `openai.codex`          | Codex App Server                   | 非常に高い             | Stable Protocol は拡張が続くため、必須構造と Runtime Schema を検証する必要がある                     |
| OpenCode           | `opencode`              | Headless HTTP/OpenAPI、任意の ACP  | 非常に高い             | HTTP Service の Lifecycle と Authentication は Host が管理する                                       |
| Goose              | `goose`                 | ACP Server または公式 API          | 高                     | Extension、Recipe、Subagent などは Provider Extension として保持する                                 |
| Qwen Code          | `qwen.code`             | SDK、ACP、HTTP daemon、Stream JSON | 中高                   | Interface の変更が速く、一部の SDK や双方向 Stream Capability は Experimental の場合がある           |
| Crush              | `charm.crush`           | `crush serve` Local API            | 高                     | Service API が新しいため、Release Version と Main Branch の Capability を別々に Probe する必要がある |
| GitHub Copilot CLI | `github.copilot-cli`    | ACP Server                         | 高                     | 一部の Tool と Reasoning 設定は Server 起動時に固定され、Session ごとに変更できない                  |
| Cursor Agent CLI   | `cursor.agent-cli`      | Headless Stream JSON               | 中                     | 現在 Beta。Failure、Approval、Native Cancel の制御面は双方向 Protocol より不完全                     |
| DeepSeek Harness   | `deepseek.harness`      | SDK stdio JSON-RPC                 | 中高                   | 公式 Interface に検証済みの実行中 Cancel がなく、Process Close は Connection Abort にしかならない    |
| Hermes Agent       | `nous.hermes-agent`     | API Server HTTP/SSE                | 非常に高い             | Workspace 選択と Background Subagent の Terminal State は Parent Run から推論できない                |
| OpenClaw           | `openclaw`              | `openclaw acp`                     | 高                     | Bridge History、Tool、Approval、Shared Session Routing は一部のみサポート                            |
| Pi Agent           | `pi.agent`              | `pi --mode rpc` strict JSONL       | 高                     | 独立 Process。Per-session Workspace と Runtime Extension Loading はサポートしない                    |

ここでの Cursor は公開された `cursor-agent`
CLI のみを指します。CLI があるだけで Cursor Desktop
IDE が完全に統合済みだと表明することはできません。

## 3. 推奨 Provider Package

```text
adapter-claude
adapter-codex
adapter-opencode
adapter-goose
adapter-qwen
adapter-crush
adapter-copilot
adapter-cursor
adapter-dsh
adapter-hermes
adapter-openclaw
adapter-pi
```

これらの Package は Adaptation Logic だけを実装し、Third-party Runtime
Binary を含みません。User または Host が Installation、Authentication、License を担当し、Profile が具体的な Command、SDK
Instance、Socket、Endpoint を参照します。

## 4. 統合方針

### 4.1 Claude Code

公式 Claude Agent SDK を優先し、Claude Code の Interactive
Terminal は解析しません。Adapter は SDK Session、Message Stream、Tool
Event、Result を Portable
Contract に Mapping し、SDK 設定を通じて許可する Tool と Permission
Mode を公開します。

重点的に検証する項目は次のとおりです。

- SDK が管理する Process の Ownership と Exit Semantics
- Session 作成および Resume Reference
- Partial Message、Tool Call、Result の順序
- External Client が Permission Request に確実に応答できるか
- SDK が既定で読み込む Local Setting を明示的に無効化または固定する必要があるか

公式参照：[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)、
[Streaming Output](https://code.claude.com/docs/en/agent-sdk/streaming-output)。

### 4.2 Codex Harness

`codex app-server` を優先します。Open-source Codex
Harness を双方向 JSON-RPC 形式の Protocol として公開し、Thread、Turn、Item、Streaming
Delta、Interrupt、Approval、Skill、App、Authentication などを提供します。

Codex Adapter は現在の Stable App Server Interface を対象とし、Codex Executable
Version を固定しません。現在の Runtime が生成する TypeScript または JSON
Schema を Fixture、Mapping、Conformance の証拠とします。Handshake と使用するすべての Response、Event の必須構造を Runtime
Validation します。Thread は Session、Turn は Run、Server
Request は Interaction に Mapping します。

公式参照：[Codex App Server](https://developers.openai.com/codex/app-server)、
[Codex Harness](https://openai.com/index/unlocking-the-codex-harness/)。

### 4.3 OpenCode

`opencode serve` の HTTP/OpenAPI Interface を優先し、Event
Stream には公式 Service Event を使用します。ACP
Client 互換が必要な場合、同じ Provider Package に ACP Connection
Strategy を追加できます。

HTTP と ACP は Connection Strategy であり、別々の Provider
ID ではありません。両者が異なる Capability を公開することはあります。

公式参照：[OpenCode Server](https://opencode.ai/docs/server/)、
[OpenCode CLI](https://opencode.ai/docs/cli/)。

### 4.4 Goose

Goose は ACP Server として実行でき、CLI と API も公開しています。Portable
Session/Run の主経路は ACP または正式 API を優先します。Goose の Extension、Recipe、MCP
App、Subagent を Core Field に圧縮せず、`goose.*` Extension または Native
Client で公開します。

公式参照：[Goose](https://block.github.io/goose/)。

### 4.5 Qwen Code

Qwen Code は Headless、Stream JSON、SDK、ACP、Long-running
Service などのインターフェースを提供します。Provider
Package は導入形態に応じて複数の Connection
Strategy を実装できますが、Session、Event、Error の Mapping Test は共有します。

推奨順は次のとおりです。

1. 現在の Release が明示的にサポートする正式 SDK または Long-running API
2. ACP
3. 文書化された Headless Stream JSON
4. Interactive TUI は解析しない

Qwen Goal、Custom Subagent、Skill などの固有動作は `qwen.code.*`
Extension に含めます。Interface が Experimental の場合、Capability と Client
Descriptor は `experimental` と示す必要があります。

公式参照：[Qwen Code Architecture](https://qwenlm.github.io/qwen-code-docs/en/developers/architecture/)、
[Headless Mode](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)。

### 4.6 Crush

Crush は現在、`crush serve` で Shared Backend を提供します。Local API は Unix
Socket または Windows Named
Pipe を通じて Workspace、Session、Agent、LSP、MCP などの Resource を公開します。Adapter は正式 Service
API に接続し、TUI を操作しません。

この Client/Server 分離 Interface は新しいため、Release 前に対象 Distribution が必要な Command と Route を実際に含むことを確認します。Main
Branch の Source だけで Support Range を拡大してはいけません。

公式参照：[Crush](https://github.com/charmbracelet/crush)、
[Crush API Entry Point](https://github.com/charmbracelet/crush/blob/main/main.go)。

### 4.7 GitHub Copilot CLI

`copilot --acp` を優先します。ACP Server は stdio と TCP
Transport をサポートします。Adapter は共通 ACP
Transport を再利用できますが、Copilot の Startup Argument、Slash
Command、Session Limit は独立した Provider Semantics
Layer が引き続き所有します。

一部の Tool Filter と Reasoning
Effort は Server 起動時に固定されます。Adapter はこれらを Session ごとに動的に変更可能と表現してはいけません。

公式参照：[Copilot CLI ACP Server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)。

### 4.8 Cursor Agent CLI

`cursor-agent --print --output-format stream-json`
を優先します。Adapter は Initialization、Assistant Message、Tool
Call、成功 Result を Mapping し、公開された Resume
Argument で既存 Conversation を復帰できます。

現在公開されている Cursor Interface は Task Execution と Progress
Display に適していますが、双方向 Approval、Provider-native
Cancel、Fork、完全な Reasoning を暗黙に表明しません。Process が非ゼロで終了して Terminal
JSON Event がない場合、Adapter は Exit Code と Standard Error から `run.failed`
または `connection.aborted` を生成します。

公式参照：[Cursor Headless](https://docs.cursor.com/en/cli/headless)、
[Output Format](https://docs.cursor.com/en/cli/reference/output-format)、
[Parameters](https://docs.cursor.com/en/cli/reference/parameters)。

### 4.9 DeepSeek Harness

公式 SDK の stdio JSON-RPC
Interface を優先します。Adapter は Host が用意した Runtime
Command と Configuration に接続します。既定 Workspace 依存に DSH SDK や Runtime
Package を追加せず、Cordis Application を作成せず、DSH Agent
Loop を複製しません。Session、Prompt、Notification、Terminal、Close
Semantics は公式 Protocol Structure と Redaction 済み Fixture で検証します。

現在の公式 TypeScript
SDK には、実行中 Prompt を Cancel する検証済み Operation がありません。SDK
Process の Close は Connection Abort にしかならず、Capability は Native Run
Cancel を表明できません。DSH Plugin、Profile、Cordis Lifecycle は Provider
Extension または Native Client に保持し、Core に含めません。

`session/prompt`
は Message が永続化され Queue に入ったことだけを確認し、その Prompt の Result を返しません。最初の Adapter は 1 つの DSH
Connection で Active Harapter Run を最大 1 つに制限し、対象 Session の Active
Interval 中に Host や Plugin が競合する Prompt、Steering、Queued
Work を注入しないことを要求します。Custom Cordis
Composition が互換性範囲に入るのは、この独占境界を証明できる場合だけです。

Whole-agent `idle` と最後の Assistant Message は成功 Terminal
State ではありません。Adapter は Active Interval に属する Session
Event の中から、構造が正しい `turn/end.data.reason.kind`
を正確に 1 つ見つけ、Test 済み Reason で Terminal
State を Mapping します。明示的な Success Reason だけが `run.completed`
を生成できます。Terminal Data がない、複数ある、未知である、または Error
Event と矛盾する場合は Fail Closed し、Success と推測しません。Shared DSH
Process が終了した場合、その接続上で実行中のすべての Run は `connection.aborted`
として終了します。

公式参照：[DeepSeek Harness SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)、
[SDK Protocol](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/sdk/protocol)。

### 4.10 Hermes Agent

Host が提供する Hermes API Server を優先します。Adapter は
`GET /v1/capabilities` で現在の Endpoint を Probe し、Session REST、Run
API、SSE を通じて Session、Run、Event、Stop、Approval を Mapping します。Bearer
Secret、Endpoint Lifecycle、Model Configuration、Tool Execution、Authentication
Policy は Host と Hermes が所有します。

SSE EOF は Success Terminal State ではありません。Disconnect 後は Run
Status で Reconcile します。`stopping` は Stop
Request が受理されたことだけを示し、Authoritative Terminal State だけが
`run.cancelled` に Mapping されます。Parent Run の Portable
Trace は Authoritative Terminal
State で終了し、それが最後の Event です。終了前に受信した Subagent
Event は Parent Run の Provider Event として扱えます。終了後の Child Event は
`child_session_id` で関連付けられた `nous.hermes-agent.subagents` Typed
Extension または Native Session Observer だけに入り、終了済み Parent
Run に追加したり、その終了を遅延または書き換えたりできません。HTTP
API で検証済み Workspace Selection がない場合、Adapter は Native Workspace
Support を表明できません。

公式参照：[Hermes Agent API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)、
[Hermes Agent](https://github.com/NousResearch/hermes-agent)。

### 4.11 OpenClaw

Host が用意する `openclaw acp` を優先し、共通 ACP stdio
Transport で接続します。OpenClaw Adapter は Session と Gateway
Session の Mapping、Event、Capability、Interaction、Error、Compatibility を所有します。ACP
Transport に OpenClaw 名の判定や Gateway Semantics は含まれません。

既定で Bridge が作成する隔離 Session を使います。既存 Gateway
Session の明示的な Binding は、まだ実装されていない独立 Connection
Strategy です。現在の Profile は Shared Session Routing
Option を拒否します。Session Routing を持たない未知 ACP Event を Concurrent
Run に推測で割り当てないよう、Adapter は 1 接続に Active
Run を 1 つだけ許可します。History Loading、Tool
Stream、Usage、Approval は、現在の Handshake と検証済み Event が証明する動作だけを表明します。ACP
Prompt Response が Terminality の権威であり、Response が明示的に `cancelled`
と示す場合だけ Native Cancellation が成立します。Connection Exit や Notification
Write は Cancellation の証拠ではありません。最初の Adapter は Gateway WebSocket
Client を直接実装しません。ACP は Session Working
Directory を受け入れますが、実 Gateway Run が Tool Execution
Directory を証明するまで Workspace Capability は `unknown` のままです。Session
Mutation または Prompt が Authoritative Response を待つ間に Local Wait
Timeout となった場合、その Connection を Abort し、不確実な Session や Run を再開してはいけません。

公式参照：[OpenClaw ACP](https://docs.openclaw.ai/cli/acp)、
[Agent Client Protocol](https://agentclientprotocol.com/protocol/overview)。

### 4.12 Pi Agent

Host が用意する `pi --mode rpc` を優先し、共通 JSONL Process
Transport で公式双方向 RPC Mode に接続します。Pi Agent Adapter は Command
Correlation、Session
Ownership、Event、Retry、Interaction、Capability、Error、Terminality を所有します。Transport は厳密な LF
Framing、Bounded Queue、Serialized Write、Backpressure、Connection
Cleanup だけを所有します。

各 Harapter Session は 1 つの Pi RPC Process を起動し、それを独占します。Session
Reference は Session ID、Persistence Mode、Provider、Profile、Compatibility
Family を結び付けます。Persistent Session は Native ID で Resume して
`get_state` を検証し、Temporary Session は Resume Support を表明しません。1
Session で同時に Active Run を 1 つだけ許可し、Pi の Mutable Current
State を複数 Session 間で共有しません。Process は Profile Working
Directory を使用します。Connection Probe の前に、Adapter は未設定または Relative
Directory を固定 Absolute Path に解決します。Per-session
Workspace はサポートしません。

`prompt` Response は Command が受理されたことだけを示し、`agent_end`
の後に Retry が起こる場合があります。Adapter は安定した `agent_settled`
を待ち、構造が正しい最新の Assistant `message_end` を Terminal
Source とします。明示的な `stop` だけが Success を生成します。`aborted`
は関連付けられた Abort
Response が成功した後だけ Cancellation を生成します。Harapter が開始していない
`aborted`、その他、欠落、未知の Stop Reason は Fail Closed します。EOF、Process
Exit、未確認 Abort は Connection Abort であり、Native
Cancellation を模倣しません。Adapter は Extension、Skill、Prompt Template
Discovery を無効にします。Portable
Text は Slash で始めることができず、Pi が Input を Command または Session
Mutation と解釈するのを防ぎます。

公式 Extension UI の Select、Confirm、Input、Editor は Provider
Interaction に入り、共通 Approval や User Input
Capability と推論しません。未知 RPC Event は Bounded、Redaction 済み Raw
Channel で観測可能性を保ち、Success
Terminality を確立できません。Host が Pi の Installation、Authentication、Configuration を担当します。既定 Workspace は Pi
Runtime や SDK 依存を含みません。

公式参照：[Pi Agent RPC Mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、
[Pi Agent](https://github.com/earendil-works/pi)。

## 5. 想定 Portable Capability

| Capability         | Claude   | Codex    | OpenCode | Goose    | Qwen     | Crush    | Copilot  | Cursor   |
| ------------------ | -------- | -------- | -------- | -------- | -------- | -------- | -------- | -------- |
| Task Session 作成  | 評価可能 | 評価可能 | 評価可能 | 評価可能 | 評価可能 | 評価可能 | 評価可能 | 評価可能 |
| Streaming Event    | 評価可能 | 評価可能 | 評価可能 | 評価可能 | 評価可能 | 評価可能 | 評価可能 | 評価可能 |
| Session Resume     | 実測必要 | 評価可能 | 実測必要 | 実測必要 | 評価可能 | 実測必要 | 実測必要 | 評価可能 |
| Native Run Cancel  | 実測必要 | 評価可能 | 実測必要 | 実測必要 | 実測必要 | 実測必要 | 実測必要 | 未確認   |
| External Approval  | 実測必要 | 評価可能 | 実測必要 | 実測必要 | 実測必要 | 実測必要 | 実測必要 | 未確認   |
| Provider Extension | 定義可能 | 定義可能 | 定義可能 | 定義可能 | 定義可能 | 定義可能 | 定義可能 | 定義可能 |

「評価可能」は、公式インターフェースに Adapter 実装と Conformance に進むための十分な情報があることを意味します。「実測必要」は、文書だけでは完全な Semantics を確認できないことを意味します。「未確認」は Capability で
`native` と表示できません。

最終的な Release Matrix は対象 Version の Automated
Test から生成します。この表を Runtime Capability
Manifest として使用してはいけません。

次の Provider グループの設計上の想定は次のとおりです。

| Capability         | DeepSeek Harness | Hermes Agent | OpenClaw | Pi Agent |
| ------------------ | ---------------- | ------------ | -------- | -------- |
| Task Session 作成  | 評価可能         | 評価可能     | 評価可能 | 評価可能 |
| Streaming Event    | 評価可能         | 評価可能     | 評価可能 | 評価可能 |
| Session Resume     | 非対応           | 実測必要     | 評価可能 | 評価可能 |
| Native Run Cancel  | 非対応           | 評価可能     | 実測必要 | 評価可能 |
| External Approval  | 非対応           | 評価可能     | 実測必要 | 非対応   |
| Provider Extension | 定義可能         | 定義可能     | 定義可能 | 定義可能 |

「非対応」は、現在の公式 Machine
Interface に検証可能な対応動作が明確にないことを意味します。Process
Close、Disconnect、または Local Run
Handle の破棄によって、その Capability が Native
Cancellation に昇格することはありません。

## 6. Shared Transport と独立 Semantics Layer

再利用可能な Transport Package は次のとおりです。

```text
transport-acp
transport-jsonrpc-stdio
transport-jsonl-process
transport-http-sse
transport-local-socket
```

ACP は OpenClaw、Goose、Copilot、OpenCode、Qwen の Communication 実装の重複を減らせますが、1 つの Provider
Adapter を共有できるわけではありません。各 Provider は引き続き次を個別に扱います。

- Startup と Authentication Argument
- Session と Run Lifecycle
- Capability
- Provider Command、Extension、Error
- Version Compatibility と Test Fixture

`transport-acp` は `@harapter/transport-jsonrpc-stdio` を組み合わせ、ACP
Schema、Method、Protocol Negotiation、Capability
Semantics だけを所有します。JSON-RPC Framing、Request
Correlation、Backpressure、Queue Bound、Wait Timeout、Connection
Cleanup は既存 Transport が所有し続けます。Process Policy は呼び出し元 Provider
Connection が所有します。

`@harapter/transport-jsonl-process` は、非 JSON-RPC Process
Protocol の厳密な JSONL Send/Receive と Connection Boundary を所有します。Pi
Agent Adapter はその上で Provider RPC
Correlation、Session、Retry、Interaction、Cancel、Terminality を実装し、Transport に Pi の名前や Event
Semantics を書き込みません。

## 7. その他の Provider

LangGraph、OpenHands、Pi ベースのその他 Harness も同じ Contract で Adapter を追加できます。Core
Enum に入れる必要はありません。

```text
adapter-langgraph
adapter-openhands
adapter-pi-derived-harness
```

同じ基盤 Framework に基づく複数の Harness は Transport と Mapping
Utility を共有できます。それでも、公開 Behavior、Version
Governance、または Extension System が異なる場合は、独立した Provider
ID と Compatibility Claim を維持します。
