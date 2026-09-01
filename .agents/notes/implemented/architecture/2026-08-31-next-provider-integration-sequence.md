# Agent Note: Next provider integration sequence

Status: implemented

## Problem

The first reference Provider group covers process RPC, an external HTTP/SSE
service, and a host-supplied SDK. Harapter also needs complete modules for
DeepSeek Harness, Hermes Agent, OpenClaw, and Pi Agent without coupling Core to
a Provider runtime, duplicating an agent loop, or combining several unfinished
Adapters in one pull request.

The official interfaces have different dependency and lifecycle properties.
Their ordering must preserve the existing transport boundaries, make unsupported
cancellation explicit, and establish reusable ACP infrastructure before an
ACP-based Provider depends on it.

## Decision

The second Provider group is implemented as six independently reviewed modules,
in this dependency order:

1. DeepSeek Harness integration over its official SDK stdio JSON-RPC interface;
2. Hermes Agent Adapter over its authenticated API Server HTTP/SSE interface;
3. a Provider-neutral stable ACP client composed over the bounded JSON-RPC stdio
   transport;
4. OpenClaw Adapter over the official `openclaw acp` bridge;
5. a Provider-neutral strict JSONL process transport;
6. Pi Agent Adapter over the official `pi --mode rpc` interface.

Each module owns its public README, redacted fixtures, shared conformance
evidence, compatibility declaration, and risk-matched live-runtime test. The
Provider runtime remains host-supplied under the
[Provider Adapter ownership rules](../../../../docs/design/provider-adapter-guide.md).
Provider SDK and runtime packages do not enter the default Workspace
dependencies.

The Provider boundaries are defined by the
[DeepSeek Harness SDK protocol note](../compatibility/2026-08-31-deepseek-harness-sdk-protocol.md),
[Hermes API Server lifecycle note](../compatibility/2026-08-31-hermes-api-server-lifecycle.md),
[stable ACP client note](./2026-08-31-stable-acp-v1-protocol-client.md), and
[OpenClaw ACP lifecycle note](../compatibility/2026-09-01-openclaw-acp-session-and-run-lifecycle.md),
[strict JSONL process transport note](./2026-09-01-bounded-strict-jsonl-process-transport.md),
and
[Pi Agent RPC lifecycle note](../compatibility/2026-09-01-pi-agent-rpc-session-and-run-lifecycle.md).
No module weakens Provider process ownership, terminal authority, capability
evidence, or Session compatibility requirements.

## Alternatives considered

### Implement OpenClaw directly against the Gateway WebSocket protocol

The Gateway protocol exposes a broader control plane, but also adds
Gateway-specific authentication, device identity, reconnect reconciliation,
protocol negotiation, and event routing. The official ACP bridge exposes the
portable Session and Run path while keeping Gateway details inside OpenClaw.

### Implement Hermes through an interactive or dashboard interface

The authenticated API Server exposes a documented machine interface with
capability discovery and pollable Run status. Terminal parsing or dashboard
automation would add an unstable UI dependency without improving the portable
contract.

### Implement all modules in one pull request

The Adapters exercise independent upstream interfaces and evidence sets. A
combined change would make review, compatibility claims, rollback, and failure
isolation harder, and would prevent the ACP layer from being reviewed as a
Provider-neutral module.

## Consequences

- DeepSeek Harness, Hermes Agent, ACP, OpenClaw, strict JSONL Process Transport,
  and Pi Agent remain independently registrable, testable, and replaceable
  without Provider branches in Core.
- The shared JSON-RPC, ACP, and JSONL Process packages own communication
  mechanics while each Adapter retains Provider identity, process policy,
  lifecycle, capability, compatibility, and redaction semantics.
- Default Workspace installation contains no DeepSeek Harness, Hermes Agent,
  OpenClaw, or Pi Agent Runtime package.
- Each Provider has deterministic synthetic fixtures and shared conformance;
  missing opt-in live evidence keeps its source status experimental rather than
  expanding the support claim.
- Direct Gateway controls and other connection strategies can be added only as
  separate evidence-backed modules or strategies.
