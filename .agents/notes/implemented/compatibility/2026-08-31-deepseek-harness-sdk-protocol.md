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

## Consequences

- Harapter can create a lazy SDK Session, stream portable events, and settle a
  Run without a Provider package dependency or Provider identity logic in Core.
- Compatibility evidence consists of structural runtime validation, recorded
  official protocol provenance at `4e84901e6471b79ec0338099867ebb4606d12bb5`
  (`@deepseek-ai/dsh-sdk-protocol` `0.1.2-alpha.4`), synthetic redacted
  fixtures, Provider-negative tests, shared conformance, and a successful
  isolated live run of the matching official SDK Profile. Live revalidation
  remains opt-in.
- Hosts must supply an isolated SDK Profile. Native calls that inject competing
  work into the owned Session interval fall outside the compatibility boundary.
- Harapter gives up native mid-Run cancellation, Session resume, Session
  deletion, portable attachments, interactions, and plugin management until an
  official interface and corresponding evidence support them.
- Upstream protocol changes can require synchronized mapping, fixtures, tests,
  documentation, and compatibility review even when the Runtime version string
  itself changes harmlessly.
