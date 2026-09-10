# Agent Note: DeepSeek Harness SDK protocol boundary

Status: implemented

## Problem

DeepSeek Harness exposes a public SDK machine interface, but its prompt method
returns only an inbox receipt and its current protocol has neither cancellation
nor compatibility negotiation. A portable Adapter needs an authoritative Run
interval and terminal result without installing the Provider Runtime, copying
its Agent Loop, or turning process disposal into a stronger capability claim.

## Decision

[`@harapter/adapter-dsh`](../../../../providers/dsh/README.md) speaks the
current official newline-delimited JSON-RPC 2.0 protocol through Harapter's
existing bounded stdio transport. The host supplies the Runtime command,
authentication, Provider route, model, working directory, and isolated SDK
Profile. No DeepSeek Harness Runtime or SDK package is a Harapter Workspace
dependency.

One connection permits one active owned Harapter Run. The Adapter correlates the
`session/prompt` message identifier with its durable inbox insertion, rejects
competing insertions in that Session interval, and closes the interval on the
following whole-Agent idle state. Exactly one validated `turn/end` reason is
required, and only `completed` produces portable success. Unknown required
events quarantine the connection; bounded ignorable or Provider-local activity
remains observable after redaction.

Session events observed before the exact inbox insertion are outside Run
ownership. They remain available to the bounded notification observer but do not
enter portable mapping or sequence authority. After correlation, the Adapter
validates the complete contiguous event interval. The current `session/title`
structure is a recognized, redacted Provider event; an unknown required event
still fails closed.

The SDK 0.1.5 `system/message` and `assistant/attempt` events retain only
redacted Provider observations after outer structure validation. System
instructions, empty system-message clears, and uncommitted model attempts never
supply portable response text or terminal authority. SDK 0.1.5 embeds stream
records in its settled Assistant Message instead of emitting stdio
`assistant/chunk` notifications. Harapter maps the committed message and usage;
it does not replay stored chunks as live deltas. Legacy chunk mapping remains
valid for Profiles that still emit those notifications.

Prompt timeouts, transport interruptions, and malformed prompt receipts have an
uncertain upstream acceptance state and quarantine the connection. Explicit
JSON-RPC rejection is authoritative and leaves it reusable. Subagent ownership
is scoped to the active Run, cleared on `subagent.finished` and terminal Run
settlement, established only after receipt correlation, and never inherited by a
later Run. Root Session events after that receipt must preserve the upstream
contiguous sequence before they can supply portable or terminal authority.

The current interface declares Run cancellation and Session resume unsupported.
Client close, local timeout, process exit, and transport loss are connection
aborts. Runtime identity is checked structurally and retained as a diagnostic;
there is no executable version allowlist because the upstream handshake has no
protocol negotiation. The Client reports experimental compatibility: current
official SDK Profile evidence cannot classify an arbitrary same-name older or
future Runtime as supported. Runtime versions and unsafe diagnostic strings use
bounded stable hashes, and Run event capacity has a fixed maximum of 4096.

## Alternatives considered

### Install the official TypeScript SDK client

The SDK client already drives the wire protocol, but adding it to the Workspace
would make a host Runtime package part of Harapter's dependency and lockfile
surface. Harapter needs only the small public machine contract, while the
existing transport already owns bounded framing, request correlation, timeout,
and process cleanup.

### Embed a Cordis application and DeepSeek Harness Agent Loop

This would give the Adapter direct control of plugins and Agent internals, but
it would duplicate a Provider Runtime inside Harapter and transfer Profile,
plugin, authentication, filesystem, and security-policy ownership away from the
host.

### Treat idle or the last Assistant Message as success

Both observations can occur after blocked, aborted, failed, interrupted, or
unrecognized work. The durable `turn/end` reason is the available upstream
terminal authority, so weaker observations cannot safely produce success.

### Accept every new event or replay stored attempts as Assistant output

Unknown required events can alter ownership or terminal semantics. Recognizing
the two reviewed nonterminal event types keeps new required events fail-closed;
replaying uncommitted attempt text or system instructions would corrupt the
portable response. The compact stream belongs to Provider-native diagnostics,
not a reconstructed real-time transport.

## Consequences

- Harapter can create a lazy SDK Session, stream portable events, and settle a
  Run without a Provider package dependency or Provider identity logic in Core.
- Compatibility evidence consists of structural runtime validation, recorded
  official protocol provenance at `4e84901e6471b79ec0338099867ebb4606d12bb5`
  (`@deepseek-ai/dsh-sdk-protocol` `0.1.2-alpha.4`), synthetic redacted
  fixtures, Provider-negative tests, shared conformance, and a successful
  isolated live run of the matching official SDK Profile. The trusted 2026-09-03
  run used `@deepseek-ai/dsh@0.1.2-alpha.5` with
  `@deepseek-ai/dsh-sdk-minimal@0.1.2-rc.1` and
  `@deepseek-ai/dsh-sdk-app@0.1.2-rc.1`, and verified an exact text result,
  started and completed Events, the authoritative completed terminal, and no
  tool or interaction Events. Live revalidation remains opt-in.
- The
  [SDK 0.1.5 fixtures](../../../../fixtures/dsh/sdk-jsonrpc-0.1.5/manifest.json)
  fingerprint the exact published protocol and Session packages with npm
  integrity values. They cover committed text and failed uncommitted attempts.
  The live-canary configuration checker accepts only the complete reviewed
  legacy composition or the 0.1.5 composition without its two retired filesystem
  rows; missing services, unknown rows and enabled tools still fail validation.
- On 2026-09-10, a standalone local candidate tarball passed six real DeepSeek
  text submissions through the public `run()` and persistent
  `ChatSession.send()` APIs. The tested CLI versions were `0.1.5-alpha.2`
  (minimal Profile and SDK Runtime `0.1.5-rc.1`) and `0.1.2-rc.1` (Profile and
  SDK Runtime `0.1.2-rc.1`). Each completed one independent task and two chat
  turns with exact replies, authoritative terminal Events, Session/process
  reuse, no tool or interaction Events, and no surviving Runtime process. Twelve
  controlled cases with those real Runtimes and a local model separately covered
  isolation, unsupported native cancellation, active close, timeout, and
  callback-failure cleanup. This evidence covers the SDK process strategy.
- Hosts must supply an isolated SDK Profile. Native calls that inject competing
  work into the owned Session interval fall outside the compatibility boundary.
- Harapter gives up native mid-Run cancellation, Session resume, Session
  deletion, portable attachments, interactions, and plugin management until an
  official interface and corresponding evidence support them.
- Upstream protocol changes can require synchronized mapping, fixtures, tests,
  documentation, and compatibility review even when the Runtime version string
  itself changes harmlessly.
