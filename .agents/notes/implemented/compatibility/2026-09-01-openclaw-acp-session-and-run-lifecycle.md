# Agent Note: OpenClaw ACP Session and Run lifecycle

Status: implemented

## Problem

The official OpenClaw ACP bridge exposes the portable Session and prompt path,
but Gateway routing metadata, unknown events without a Session identifier,
notification-only cancellation, partial approval discovery, and events racing a
terminal response require Provider-owned lifecycle rules. Harapter must preserve
those semantics without installing OpenClaw, implementing a Gateway client, or
inferring capabilities from the product identity.

## Decision

[`@harapter/adapter-openclaw`](../../../../providers/openclaw/README.md) starts
the exact adapter-owned `openclaw acp` command supplied by the host and composes
the Provider-neutral stable ACP client. The Workspace contains no OpenClaw
Runtime or SDK dependency. Connection accepts the stable ACP wire contract only,
validates the official `openclaw-acp` implementation identity, and derives
optional Session and prompt capabilities from the handshake. The adapter does
not inspect environment entries; its child process inherits the host-controlled
process environment that OpenClaw may use for Gateway authentication.

Every new Session receives an explicit isolated `acp-bridge:harapter-...`
Gateway key. Its native ACP identifier, working directory, route key, Provider,
Profile, and compatibility family remain bound in the Session reference. Resume
requires all of that state and asks OpenClaw to require the existing Gateway
Session. Shared-session startup arguments are rejected by this strategy. The
accepted ACP working directory remains bound in Session state, while
`session.workspace` stays `unknown` until live Gateway evidence verifies the
effective tool execution directory. Active and in-flight native Session
identifiers are reserved per connection. A close attempt synchronously marks its
handle as closing, blocks new Runs and approval responses, and restores the open
state only after a failed close.

One Run may be active per connection. Typed updates can be routed by ACP Session
identifier, while unknown observations cannot; allowing concurrent Runs would
require guessing ownership. The JSON-RPC inbound barrier and ACP event
checkpoint complete every update received before the prompt response, then use
that validated response as the sole terminal authority. Later messages cannot
append to or rewrite the terminal Run.

ACP cancellation is native only after `session/cancel` is followed by an
authoritative `cancelled` prompt response. Notification write success,
connection loss, Client close, process termination, and a cancellation
settlement timeout become connection aborts instead. A local Run timeout invokes
the same native operation but remains an emulated timer capability. If a local
ACP wait for Session mutation or prompt completion ends before an authoritative
response, the Adapter aborts the owning connection. It never releases an
uncertain prompt slot or reopens an uncertain closing Session for reuse.

ACP initialization does not advertise permission requests, so approval starts as
`unknown` and becomes `native` only after a valid request is observed. The
Adapter defaults portable decisions to matching one-time options. Persistent
options require an explicit, decision-compatible Provider option identifier.
Pending approval work settles when its Run terminates. Unknown events remain
visible through a bounded, content-free Provider event, typed observation
extension, and native observer. They never establish success.

## Alternatives considered

### Connect directly to the Gateway WebSocket

The Gateway control plane exposes more operations, but adds authentication,
device identity, reconnect, and routing ownership that the official ACP bridge
already encapsulates for the portable Session and prompt path. A Gateway
strategy requires an independent compatibility and evidence set.

### Allow shared Gateway Session routing in the first strategy

Multiple ACP clients attached to one Gateway Session weaken strict event and
cancellation isolation. Rejecting shared routing keeps each Session reference
honest until a separate strategy can reconcile those races.

### Drain events with a fixed delay after the prompt response

A timing delay can include events sent after the authoritative terminal and can
still miss earlier work under load. Wire-order and consumer checkpoints define
the boundary without depending on scheduling speed.

## Consequences

- Harapter can create, resume, close, prompt, cancel, and answer observed
  approvals through a host-operated OpenClaw bridge without owning the Runtime.
- Connection-wide Run serialization gives up safe parallelism but preserves
  unknown-event ownership and bounded observation.
- The Adapter follows the current compatible ACP surface instead of pinning one
  OpenClaw release; breaking upstream structures require synchronized mappings,
  fixtures, tests, documentation, and review.
- Synthetic fixtures and shared conformance establish source evidence. The
  Adapter remains experimental until opt-in live Gateway evidence is recorded.
- Shared Gateway routing, history replay, per-Session MCP, direct Gateway
  controls, generic files, audio, verified Gateway workspace execution, and
  client filesystem or terminal services remain outside the compatibility
  boundary.
