[English](./provider-matrix.md) · [简体中文](./provider-matrix.zh-CN.md) ·
[日本語](./provider-matrix.ja.md)

# Provider integration matrix

## 1. Scope of claims

This document records the programmatic interfaces published by target Harnesses
and how those interfaces affect Harapter's design. It is not a promise that a
Provider is available.

A target whose Harness implementation is not publicly reviewable requires a
separate provider-acceptance decision before implementation. Its presence in
this research matrix is not acceptance evidence.

A Provider can be marked available in a release only after its Adapter has an
implementation, compatibility probes, Conformance Tests, and real-Runtime tests.

“Integrable” means the portable main path can create a Session, submit input,
consume Events, and obtain a terminal result. Native advanced capabilities still
depend on the target Harness's published machine interface.

The interfaces for DeepSeek Harness, Hermes Agent, and OpenClaw were observed on
2026-08-31. The Pi Agent interface was observed on 2026-09-01. The actual
compatibility range is declared jointly by connection-time probes, redacted
Fixtures, Conformance Tests, real-Runtime Tests, and the corresponding Provider
README.

## 2. Target Providers

| Provider           | Provider ID          | Preferred interface                   | Expected portable coverage | Main limitation                                                                                    |
| ------------------ | -------------------- | ------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| Codex Harness      | `openai.codex`       | Codex App Server                      | Very high                  | The stable protocol keeps expanding; required structures and Runtime Schema must be validated      |
| OpenCode           | `opencode`           | Headless HTTP/OpenAPI; optional ACP   | Very high                  | The host manages HTTP service lifecycle and authentication                                         |
| Goose              | `goose`              | ACP Server or official API            | High                       | Extensions, Recipes, Subagents, and similar features remain Provider Extensions                    |
| Qwen Code          | `qwen.code`          | SDK, ACP, HTTP daemon, or Stream JSON | Medium-high                | Interfaces evolve quickly; some SDK and bidirectional-stream capabilities may remain experimental  |
| Crush              | `charm.crush`        | `crush serve` local API               | High                       | The service API is new; released-version and main-branch capabilities need separate probes         |
| GitHub Copilot CLI | `github.copilot-cli` | ACP Server                            | High                       | Some Tool and Reasoning settings are fixed at Server startup and cannot change per Session         |
| Cursor Agent CLI   | `cursor.agent-cli`   | Headless Stream JSON                  | Medium                     | Currently Beta; failure, approval, and native-cancel control surfaces are less complete            |
| DeepSeek Harness   | `deepseek.harness`   | SDK stdio JSON-RPC                    | Medium-high                | The official interface has no verified in-progress cancellation; process close is connection abort |
| Hermes Agent       | `nous.hermes-agent`  | API Server HTTP/SSE                   | Very high                  | Workspace selection and background Subagent terminality cannot be inferred from a parent Run       |
| OpenClaw           | `openclaw`           | `openclaw acp`                        | High                       | Bridge history, Tools, Approval, and shared-Session routing have partial support                   |
| Pi Agent           | `pi.agent`           | `pi --mode rpc` strict JSONL          | High                       | Separate process; no per-Session Workspace or Runtime Extension loading                            |

Cursor here means only the public `cursor-agent` CLI. The Cursor desktop IDE
cannot be declared fully integrated merely because a CLI exists.

## 3. Recommended Provider packages

```text
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

These packages contain only adaptation logic, not third-party Runtime binaries.
The user or host owns installation, authentication, and licensing; the Profile
references a concrete command, SDK instance, Socket, or Endpoint.

## 4. Integration strategies

### 4.1 Codex Harness

Prefer `codex app-server`. It exposes the open-source Codex Harness through a
bidirectional JSON-RPC-style protocol with Thread, Turn, Item, streaming Delta,
Interrupt, Approval, Skill, App, authentication, and related interfaces.

The Codex Adapter targets the current stable App Server interface and does not
pin a Codex executable version. TypeScript or JSON Schema generated by the
current Runtime provides Fixture, Mapping, and Conformance evidence. The
handshake and every used response and Event undergo Runtime validation for
required structure. A Thread maps to a Session, a Turn maps to a Run, and a
Server Request maps to an Interaction.

Official references:
[Codex App Server](https://developers.openai.com/codex/app-server),
[Codex Harness](https://openai.com/index/unlocking-the-codex-harness/).

### 4.2 OpenCode

Prefer the HTTP/OpenAPI interface from `opencode serve`, with the official
service Event stream. An ACP Connection Strategy can be added to the same
Provider package when ACP Client compatibility is required.

HTTP and ACP are connection strategies, not separate Provider IDs. The two
strategies may expose different Capabilities.

Official references: [OpenCode Server](https://opencode.ai/docs/server/),
[OpenCode CLI](https://opencode.ai/docs/cli/).

### 4.3 Goose

Goose can run as an ACP Server and also publishes a CLI and API. The portable
Session/Run path should prefer ACP or a formal API. Goose Extensions, Recipes,
MCP Apps, and Subagents should not be compressed into Core fields; expose them
through `goose.*` Extensions or the Native Client.

Official reference: [Goose](https://block.github.io/goose/).

### 4.4 Qwen Code

Qwen Code offers Headless, Stream JSON, SDK, ACP, and long-running-service
interfaces. A Provider package may implement multiple Connection Strategies for
different deployments, but they share Session, Event, and Error mapping tests.

Preferred order:

1. a formal SDK or long-running API explicitly supported by the current release;
2. ACP;
3. documented Headless Stream JSON; and
4. never parse the interactive TUI.

Qwen-specific behavior such as Goal, Custom Subagent, and Skill belongs in
`qwen.code.*` Extensions. When an interface is experimental, the Capability and
Client Descriptor must say `experimental`.

Official references:
[Qwen Code architecture](https://qwenlm.github.io/qwen-code-docs/en/developers/architecture/),
[Headless Mode](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/).

### 4.5 Crush

Crush currently provides a shared backend through `crush serve`. Its local API
exposes Workspace, Session, Agent, LSP, MCP, and related resources through a
Unix Socket or Windows Named Pipe. The Adapter connects to the formal service
API and does not operate the TUI.

Because this Client/Server split is new, a release must verify that the target
distribution actually contains each required command and route. Main-branch
source alone cannot broaden the support range.

Official references: [Crush](https://github.com/charmbracelet/crush),
[Crush API entry point](https://github.com/charmbracelet/crush/blob/main/main.go).

### 4.6 GitHub Copilot CLI

Prefer `copilot --acp`. The ACP Server supports stdio and TCP transports. The
Adapter may reuse a general ACP Transport, while an independent Provider
semantic layer still owns Copilot startup arguments, Slash Commands, and Session
limits.

Some Tool Filters and Reasoning Effort settings are fixed at Server startup. The
Adapter must not present them as per-Session dynamic settings.

Official reference:
[Copilot CLI ACP Server](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server).

### 4.7 Cursor Agent CLI

Prefer `cursor-agent --print --output-format stream-json`. The Adapter can map
initialization, Assistant messages, Tool Calls, and successful Results, and use
the published resume argument for an existing conversation.

The currently published Cursor interface is suitable for task execution and
progress display, but it does not imply bidirectional Approval, Provider-native
Cancel, Fork, or complete Reasoning. A nonzero process exit may have no terminal
JSON Event; the Adapter uses the exit code and standard error to produce
`run.failed` or `connection.aborted`.

Official references: [Cursor Headless](https://docs.cursor.com/en/cli/headless),
[output format](https://docs.cursor.com/en/cli/reference/output-format),
[parameters](https://docs.cursor.com/en/cli/reference/parameters).

### 4.8 DeepSeek Harness

Prefer the official SDK's stdio JSON-RPC interface. The Adapter connects to a
Runtime command and configuration supplied by the host. It does not add the DSH
SDK or Runtime package to the default Workspace dependencies, create a Cordis
application, or copy the DSH Agent Loop. Official protocol structures and
redacted Fixtures must validate Session, Prompt, notification, terminal, and
close semantics.

The current official TypeScript SDK has no verified operation for cancelling an
in-progress Prompt. Closing the SDK process can only abort the connection, so
the Capability cannot claim native Run Cancel. DSH plugins, Profiles, and the
Cordis lifecycle remain Provider Extensions or Native Client behavior and do not
enter Core.

`session/prompt` only confirms that a message was persisted and queued; it does
not return that Prompt's result. The first Adapter permits at most one active
Harapter Run on one DSH Connection and requires the target Session's active
interval to receive no competing Prompt, Steering, or queued work injected by
the host or a plugin. A custom Cordis composition enters the compatibility range
only when it can prove this exclusivity boundary.

Whole-agent `idle` and the last Assistant Message are not successful terminal
states. The Adapter must find exactly one structurally valid
`turn/end.data.reason.kind` in Session Events belonging to the active interval,
then map the terminal state through tested reasons. Only an explicit success
reason can produce `run.completed`. Missing, duplicate, unknown, or
error-conflicting terminal data fails closed and is never guessed as success.
When a shared DSH process exits, every still-active Run on that connection ends
as `connection.aborted`.

Official references:
[DeepSeek Harness SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md),
[SDK Protocol](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/sdk/protocol).

### 4.9 Hermes Agent

Prefer a Hermes API Server supplied by the host. The Adapter probes the current
Endpoint through `GET /v1/capabilities`, then maps Session, Run, Event, Stop,
and Approval through the Session REST API, Run API, and SSE. The host and Hermes
own the Bearer Secret, Endpoint lifecycle, model configuration, Tool execution,
and authentication policy.

SSE EOF is not a successful terminal state; after disconnect, the Adapter
reconciles through Run status. `stopping` only acknowledges the stop request;
only an authoritative terminal state maps to `run.cancelled`. A parent Run's
portable trace ends at its authoritative terminal state, which must be its last
Event. Subagent Events received before that terminal state may be Provider
Events on the parent Run. Child Events received later can appear only through a
typed `nous.hermes-agent.subagents` Extension or Native Session Observer keyed
by `child_session_id`; they cannot extend, delay, or rewrite the terminated
parent Run. Without verified Workspace selection in the HTTP API, the Adapter
must not claim native Workspace support.

Official references:
[Hermes Agent API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server),
[Hermes Agent](https://github.com/NousResearch/hermes-agent).

### 4.10 OpenClaw

Prefer `openclaw acp` supplied by the host and connect through the general ACP
stdio Transport. The OpenClaw Adapter owns Session-to-Gateway-Session mapping,
Events, Capabilities, Interactions, Errors, and compatibility. The ACP Transport
contains no OpenClaw name checks or Gateway semantics.

By default, use an isolated Session created by the bridge. Explicitly binding an
existing Gateway Session is a separate, unimplemented Connection Strategy; the
current Profile rejects shared-Session routing options. The Adapter allows only
one active Run per connection so that an unknown ACP Event without Session
routing is never guessed onto a concurrent Run. History loading, Tool streams,
Usage, and Approval claim only the behavior proved by the current handshake and
verified Events. The ACP prompt response is authoritative for terminality;
native cancellation exists only when that response explicitly says `cancelled`.
Connection exit and notification writes do not prove cancellation. The first
Adapter does not implement a Gateway WebSocket Client directly. ACP accepts a
Session working directory, but Workspace remains `unknown` until a real Gateway
Run proves the Tool execution directory. A local wait timeout while a Session
mutation or Prompt awaits an authoritative response must abort its connection;
it cannot reopen an uncertain Session or Run.

Official references: [OpenClaw ACP](https://docs.openclaw.ai/cli/acp),
[Agent Client Protocol](https://agentclientprotocol.com/protocol/overview).

### 4.11 Pi Agent

Prefer `pi --mode rpc` supplied by the host and connect to its official
bidirectional RPC mode through the general JSONL Process Transport. The Pi Agent
Adapter owns Command correlation, Session ownership, Events, Retry,
Interactions, Capabilities, Errors, and terminality. The Transport owns only
strict LF framing, bounded queues, serialized writes, backpressure, and
connection cleanup.

Each Harapter Session starts and exclusively owns one Pi RPC process. The
Session reference binds the Session ID, persistence mode, Provider, Profile, and
compatibility family. A persistent Session resumes by native ID and validates
`get_state`; a temporary Session does not claim resume support. One Session
permits only one active Run and never shares Pi's mutable current state across
Sessions. The process uses the Profile Working Directory. Before connection
probing, the Adapter resolves a missing or relative directory to a fixed
absolute path; per-Session Workspace is unsupported.

A `prompt` response only says that a Command was accepted, and Retry may occur
after `agent_end`. The Adapter waits for a stable `agent_settled` and uses the
latest structurally valid Assistant `message_end` as the terminal source. Only
an explicit `stop` produces success. `aborted` produces cancellation only after
a correlated Abort Response succeeds. An `aborted` not initiated by Harapter, or
another, missing, or unknown stop reason, fails closed. EOF, process exit, and
unconfirmed Abort are connection aborts and never imitate native cancellation.
The Adapter disables Extension, Skill, and Prompt Template Discovery. Portable
Text cannot begin with a Slash, preventing Pi from interpreting input as a
Command or Session Mutation.

The official Extension UI's Select, Confirm, Input, and Editor enter a Provider
Interaction and are not inferred as portable Approval or User Input
capabilities. Unknown RPC Events remain observable through the bounded, redacted
Raw Channel and cannot establish successful terminality. The host owns Pi
installation, authentication, and configuration; the default Workspace has no Pi
Runtime or SDK dependency.

Official references:
[Pi Agent RPC mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md),
[Pi Agent](https://github.com/earendil-works/pi).

## 5. Expected portable capabilities

| Capability          | Codex       | OpenCode    | Goose       | Qwen        | Crush       | Copilot     | Cursor      |
| ------------------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| Create task Session | Evaluatable | Evaluatable | Evaluatable | Evaluatable | Evaluatable | Evaluatable | Evaluatable |
| Streaming Events    | Evaluatable | Evaluatable | Evaluatable | Evaluatable | Evaluatable | Evaluatable | Evaluatable |
| Session Resume      | Evaluatable | Live test   | Live test   | Evaluatable | Live test   | Live test   | Evaluatable |
| Native Run Cancel   | Evaluatable | Live test   | Live test   | Live test   | Live test   | Live test   | Unconfirmed |
| External Approval   | Evaluatable | Live test   | Live test   | Live test   | Live test   | Live test   | Unconfirmed |
| Provider Extension  | Definable   | Definable   | Definable   | Definable   | Definable   | Definable   | Definable   |

“Evaluatable” means the official interface has enough information to enter
Adapter implementation and Conformance. “Live test” means documentation alone
cannot establish the full semantics. “Unconfirmed” cannot be declared `native`
in a Capability.

The final release matrix must be generated from automated tests against the
target version. This table is not a Runtime Capability Manifest.

The next group of Providers has this design expectation:

| Capability          | DeepSeek Harness | Hermes Agent | OpenClaw    | Pi Agent    |
| ------------------- | ---------------- | ------------ | ----------- | ----------- |
| Create task Session | Evaluatable      | Evaluatable  | Evaluatable | Evaluatable |
| Streaming Events    | Evaluatable      | Evaluatable  | Evaluatable | Evaluatable |
| Session Resume      | Unsupported      | Live test    | Evaluatable | Evaluatable |
| Native Run Cancel   | Unsupported      | Evaluatable  | Live test   | Evaluatable |
| External Approval   | Unsupported      | Evaluatable  | Live test   | Unsupported |
| Provider Extension  | Definable        | Definable    | Definable   | Definable   |

“Unsupported” means that the current official machine interface has no
verifiable corresponding behavior. Closing a process, disconnecting, or
discarding a local Run Handle never promotes it to native cancellation.

## 6. Shared Transports and independent semantic layers

Reusable Transport packages include:

```text
transport-acp
transport-jsonrpc-stdio
transport-jsonl-process
transport-http-sse
transport-local-socket
```

ACP can reduce communication-layer duplication across OpenClaw, Goose, Copilot,
OpenCode, and Qwen, but it does not let them share one Provider Adapter. Each
Provider still owns:

- startup and authentication arguments;
- Session and Run lifecycle;
- Capabilities;
- Provider Commands, Extensions, and Errors; and
- version compatibility and test Fixtures.

`transport-acp` composes `@harapter/transport-jsonrpc-stdio` and owns only the
ACP Schema, methods, protocol negotiation, and Capability semantics. JSON-RPC
framing, request correlation, backpressure, queue bounds, wait timeouts, and
connection cleanup remain with the existing Transport. The calling Provider
Connection owns process policy.

`@harapter/transport-jsonl-process` owns strict JSONL send/receive and
connection boundaries for non-JSON-RPC process protocols. The Pi Agent Adapter
implements Provider RPC correlation, Sessions, Retry, Interactions, Cancel, and
terminality above it without adding Pi names or Event semantics to the
Transport.

## 7. Other Providers

LangGraph, OpenHands, and other Pi-based Harnesses can add Adapters under the
same contract. They do not enter a Core enum:

```text
adapter-langgraph
adapter-openhands
adapter-pi-derived-harness
```

Multiple Harnesses based on the same underlying framework may share Transports
and mapping utilities. They still retain independent Provider IDs and
compatibility claims whenever their published behavior, version governance, or
Extension systems differ.
