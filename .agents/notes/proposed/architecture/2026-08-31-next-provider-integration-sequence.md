# Agent Note: Next provider integration sequence

Status: proposed

## Problem

The first reference Provider group covers process RPC, an external HTTP/SSE
service, and a host-supplied SDK. Harapter now needs an ordered set of complete
modules for DeepSeek Harness, Hermes Agent, and OpenClaw without coupling Core
to a Provider runtime, duplicating an agent loop, or combining several
unfinished Adapters in one pull request.

The available official interfaces have different dependency and lifecycle
properties. The implementation order must preserve the existing transport
boundaries, make unsupported cancellation explicit, and create reusable ACP
infrastructure before an ACP-based Provider depends on it.

## Proposal

Implement the next modules in this order:

1. Adapter for DeepSeek Harness over its official SDK stdio JSON-RPC interface;
2. Hermes Agent Adapter over its authenticated API Server HTTP/SSE interface;
3. a Provider-neutral ACP protocol client composed over the existing bounded
   JSON-RPC stdio transport;
4. OpenClaw Adapter over the official `openclaw acp` bridge.

Each module is delivered in a separate pull request with its own public README,
redacted fixtures, shared conformance evidence, compatibility declaration, and
risk-matched live-runtime evidence. The Provider runtime remains host-supplied
under the existing
[Provider Adapter ownership rules](../../../../docs/design/provider-adapter-guide.md).
Provider SDK and runtime packages do not enter the default Workspace
dependencies.

The Adapter for DeepSeek Harness treats process termination as connection abort.
It does not claim native mid-run cancellation while the official SDK protocol
does not expose a verified prompt-cancel operation. The initial connection
permits at most one active Harapter Run and accepts only Session activity that
the Adapter owns exclusively. A host-supplied Cordis composition with competing
prompts, steering, or injected queued work is outside the compatible profile
unless it can prove that isolation.

The DSH prompt response is an enqueue receipt, not a prompt result. Whole-agent
idle and the last Assistant Message cannot establish Harapter success. The
Adapter requires exactly one structurally valid `turn/end.data.reason.kind`
inside the owned activity interval and maps only a tested, explicit success
reason to `run.completed`. A missing, duplicate, unknown, or contradictory
terminal fails closed. Process loss settles every active Run on that connection
as `connection.aborted`.

The Hermes Agent Adapter uses runtime capability discovery and the documented
Session, Run, event-stream, stop, and approval endpoints. It does not infer
workspace selection, cancellation settlement, or other behavior from the product
name. The authoritative parent terminal remains the last event in its portable
Run trace. Child events received afterward are observable only through a typed
`nous.hermes-agent.subagents` extension or Native Session observer keyed by
`child_session_id`; they do not delay, rewrite, or append to the parent Run
terminal.

`@harapter/transport-jsonrpc-stdio` continues to own framing, request
correlation, ordered delivery, backpressure, bounded queues, local wait
timeouts, and connection disposal. The ACP module composes that transport and
owns only ACP schemas, methods, negotiation, capability validation, and unknown
ACP message semantics. Process creation and termination belong to the Provider
Connection that supplies the streams. The OpenClaw Adapter owns OpenClaw session
mapping, capabilities, events, interactions, errors, and compatibility. Its
initial connection strategy uses isolated bridge sessions; binding multiple ACP
clients to one Gateway session cannot be presented as strictly isolated routing.

The interface observations were checked on 2026-08-31 against the official
[DeepSeek Harness SDK client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md),
[Hermes Agent API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server),
[OpenClaw ACP bridge](https://docs.openclaw.ai/cli/acp), and
[Agent Client Protocol](https://agentclientprotocol.com/protocol/overview).
Implementations must still validate the connected runtime and declare the actual
compatibility evidence they test.

## Alternatives considered

### Implement OpenClaw directly against the Gateway WebSocket protocol

The Gateway protocol exposes a broader OpenClaw control plane, but it also adds
Gateway-specific authentication, device identity, reconnect reconciliation,
protocol negotiation, and event ordering before Harapter has a shared ACP
module. The official ACP bridge already exposes the portable Session and Run
path and keeps Gateway details inside OpenClaw.

### Implement Hermes through an interactive or dashboard interface

The authenticated API Server already exposes a machine interface with capability
discovery and reconnectable Run status. Parsing a terminal or driving dashboard
behavior would add an unstable UI dependency and would not improve the portable
contract.

### Implement all three Providers in one pull request

The Adapters exercise independent upstream interfaces and evidence sets. One
combined change would make review, compatibility claims, rollback, and failure
isolation harder, and would prevent the ACP transport from being reviewed as a
Provider-neutral module.

## Acceptance criteria

- The design implementation order and Provider matrix name DeepSeek Harness,
  Hermes Agent, ACP, and OpenClaw consistently.
- Each Adapter remains independently registrable and Core contains no Provider
  identity branch or Provider SDK dependency.
- Default Workspace installation does not install any of the three Provider SDK
  or runtime packages.
- DeepSeek Harness tests enforce one active owned interval per Connection,
  correlate the inbox receipt to one Session activity, map the authoritative
  `turn/end` reason, fail missing, duplicate, unknown, or contradictory
  terminals, and distinguish process abort from native cancellation.
- Hermes tests reconcile SSE events with authoritative Run status and do not
  convert stream EOF into success. They cover parent-terminal, late-child-event,
  and reconnect races while keeping the terminal last in the parent trace.
- ACP tests cover schemas, methods, negotiation, capability validation,
  malformed and unknown ACP messages, and propagation of existing Transport
  failures before the OpenClaw Adapter depends on it.
- OpenClaw tests cover isolated Session ownership, cancellation settlement,
  partial capabilities, and bounded redacted unknown events.
- No Provider is marked supported until implementation, fixtures, shared
  conformance, and live-runtime evidence satisfy the Provider acceptance rules.

## Risks

- The upstream interfaces can evolve after the evidence date, so runtime
  validation and compatibility fingerprints remain mandatory.
- DeepSeek Harness cannot expose native mid-run cancellation until its official
  interface provides and tests that operation.
- Hermes background subagents may outlive a parent Run. Their late events
  require a separate Provider-owned observer and cannot be described as
  completion of every delegated task or appended to the terminated parent trace.
- OpenClaw bridge history and approval coverage are partial, and shared Gateway
  session keys weaken strict client isolation.
- Choosing ACP first for OpenClaw gives up direct access to some Gateway-only
  controls; those controls remain eligible for a later typed Provider extension
  or connection strategy with independent evidence.
