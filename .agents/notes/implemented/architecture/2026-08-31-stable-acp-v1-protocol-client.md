# Agent Note: Stable ACP v1 protocol client

Status: implemented

## Problem

Several Provider Adapters can reuse the Agent Client Protocol, but JSON-RPC
framing alone does not establish ACP compatibility. Each Adapter otherwise has
to repeat protocol negotiation, capability validation, bidirectional request
handling, Session method schemas, unknown-message policy, and cancellation
rules. Moving those concerns into Core would couple portable Harapter contracts
to one upstream protocol, while implementing them first inside OpenClaw would
make a Provider-specific package the owner of shared protocol behavior.

## Decision

[`@harapter/transport-acp`](../../../../packages/transport-acp/README.md) owns a
Provider-neutral client for the stable ACP v1 wire profile. It composes
[`@harapter/transport-jsonrpc-stdio`](../../../../packages/transport-jsonrpc-stdio/README.md)
with exact JSON-RPC 2.0 emission and validation plus the stable v1 request ID
domain. The lower transport continues to own framing, correlation, queue and
write bounds, request-local timeout and abort, stream failure, and cleanup. The
ACP package owns only protocol methods, negotiation, capability gates, message
validation, permission settlement, and unknown ACP semantics. Neither package
owns process creation or termination.

The implemented client path covers initialization, Session creation, optional
load/list/delete/resume/close methods, prompt submission, native Session cancel,
all stable v1 Session update discriminators, permission requests, and explicitly
namespaced extension methods. Filesystem, terminal, terminal authentication,
elicitation, authentication, logout, Session mode, and Session configuration
client services are not advertised or implemented by this profile. Capability
input that claims one of those unimplemented client services fails before the
handshake.

Handshake capabilities are normalized from observed fields rather than Agent
identity. Optional methods, additional directories, prompt content variants, and
HTTP or SSE MCP connections fail locally unless the Agent advertised their
corresponding capability. A protocol version other than stable v1 is rejected;
the experimental ACP v2 wire contract is not accepted as v1.

One bounded event queue preserves validated Session updates in receipt order.
Unknown methods and future Session update discriminators stay observable as
bounded structural records after redaction and name hashing. They cannot create
a terminal result. Explicit extension callbacks remain a native, unredacted
boundary for callers that intentionally opt into Provider-specific behavior.

ACP Session cancellation is distinct from local transport control. The client
settles pending Session permission requests as cancelled before emitting
`session/cancel` and keeps the Session cancelling until both the prompt wait and
cancel write settle. Permission handler work that outlives settlement is
detached from client task tracking, and its late outcome or rejection is
ignored. Session closure also settles pending and racing permission requests
before the close request. Request timeout and `AbortSignal` only end the local
response wait and send no cancellation method. A detached prompt wait remains
blocked until advertised Session closure or connection closure. A detached
Session-close wait remains blocked until connection closure because its late
response cannot restore authority. Prompt success or cancellation requires a
validated authoritative prompt response.

The broader Provider order remains owned by the
[provider integration sequence](../../proposed/architecture/2026-08-31-next-provider-integration-sequence.md).

## Alternatives considered

### Implement ACP inside the OpenClaw Adapter

This would deliver the first Provider with fewer package files, but OpenClaw
would become the accidental owner of negotiation and message behavior needed by
Goose, Copilot, OpenCode, Qwen, and other ACP Agents. It would also combine
protocol and Provider lifecycle review in one pull request.

### Add the official TypeScript ACP SDK as a Workspace dependency

The SDK supplies generated protocol types and its own connection behavior, but
Harapter already has a reviewed bounded JSON-RPC stdio transport with explicit
cleanup and local-abort semantics. Depending on the SDK would introduce a second
transport owner and couple this foundational package to experimental API
surfaces that are unnecessary for the stable v1 path.

### Accept stable v1 and experimental v2 on one connection

The wire contracts have different stream and message models. Automatic dual
acceptance would expand dispatch, batching, ordering, and compatibility claims
without a Provider requiring them. A future v2 profile needs an independent
design and evidence set rather than silent fallback.

## Consequences

- ACP-based Provider Adapters reuse one tested negotiation, validation,
  permission, cancellation, and unknown-message implementation while retaining
  independent Provider IDs, process policies, capabilities, and event mapping.
- Strict JSON-RPC 2.0 input is now an opt-in lower-transport mode; existing
  JSON-RPC-shaped Provider integrations continue accepting omitted version
  fields.
- The initial stable profile deliberately gives up optional ACP client services
  and configuration methods. A consumer needing them must extend the public
  handlers, validation, capabilities, fixtures, and lifecycle evidence first.
- The event queue adds an independent finite bound because ACP dispatch must
  continue answering bidirectional requests even when a Provider Adapter is slow
  to consume Session updates.
- Stable Session updates validate and retain content annotations plus nested
  tool, plan, command, mode, and configuration structures. Unknown roots remain
  ignored, while malformed known structures fail closed.
- Known ACP payloads and explicit extensions remain untrusted and potentially
  sensitive. Only unknown structural observations are automatically redacted;
  consuming Adapters retain responsibility for portable redaction and logging
  policy.
- Synthetic fixtures and unit tests prove the shared protocol profile. Each
  Provider still needs its own implementation, redacted fixtures, conformance
  evidence, live-runtime evidence when available, and compatibility statement.
