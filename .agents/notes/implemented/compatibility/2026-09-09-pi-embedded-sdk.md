# Agent Note: Adapt an explicitly owned Pi embedded SDK Session

Status: implemented

## Problem

Pi offers both RPC and an embedded SDK. A process-only Adapter makes hosts that
already embed the official Runtime launch another process and loses the direct
Session integration they need. The single application entry must expose actual
connection strategies without equating all harnesses with SDK subprocesses.

## Decision

The [Pi Adapter](../../../../providers/pi/README.md) adds an optional `sdk`
strategy for the public `@earendil-works/pi-coding-agent@0.85.1` AgentSession
interface, observed at commit `d981de1229ef899957bbe968bc8dcda02a21f477` under
MIT. This exact version is host-attested and validated before invoking the
factory. The RPC strategy and its separate compatibility contract remain intact.
The [SDK authoring boundary](../../../../docs/design/provider-adapter-guide.md)
continues to prohibit a default Runtime dependency. An explicit host factory
avoids adding Pi or its dependency graph to the Workspace and published package.

The factory transfers a fresh idle Session's exclusive ownership. It retains
shared ModelRuntime, credentials, configuration, tools and discovery policy in
the host. Harapter does not create an Agent Loop, discover host credentials,
install extensions or supply an approval policy. Each Session has at most one
active Run, and every message uses that same Session. Claimed handles cannot be
reused across Clients; changing native identity is rejected. Native resume/fork
and arbitrary mutation are deliberately absent in this strategy because Pi's
replacement Runtime is a distinct ownership contract. RPC controls remain
available to their existing consumers.

A Run subscribes to public events and waits for `prompt()` settlement plus an
authoritative final assistant outcome. Only `stop` means completion. `agent_end`
alone does not settle a Run because retry and compaction can continue. Missing,
malformed, deferred, error or other non-success outcomes fail. Text, reasoning,
tool and usage mappings reuse the existing Pi protocol mapper. Unknown events
remain bounded structural hashes rather than unredacted data or invented
success.

Native cancellation requires confirmed `abort()` and the corresponding aborted
assistant outcome. A pending abort retains Session ownership even if the prompt
finishes, preventing a new Run from racing the old abort. Rejection or failure
to establish an outcome downgrades to connection abort and closes the owned
Session. Local deadlines and event overflow also close the Session without
claiming native cancellation. Startup and cancellation have bounded waits; late
factory results are disposed. Closing a Session unsubscribes before native
disposal; shared host objects are never disposed. In-process SDK code cannot be
forcefully terminated if it ignores disposal or the startup signal.

Evidence consists of
[synthetic fixtures](../../../../fixtures/pi/sdk-0.85.1/manifest.json), shared
conformance, malformed/unknown events, factory ownership and timeout, queue
limits, cancellation races and cleanup tests. The opt-in
[sdk-native.mjs](../../../../providers/pi/test/sdk-native.mjs) command uses the
installed official 0.85.1 SDK with an in-memory synthetic model: two-turn
history, confirmed native abort and exactly-once disposal passed locally. No
real model service or credentials were used. This proves SDK integration at the
pinned version, not a new authenticated model compatibility claim.

## Alternatives considered

### Keep only RPC

RPC remains useful for process isolation. Requiring it for a host already using
the SDK adds a process and fails to adapt an existing official machine
interface.

### Load every provider SDK with Harapter

This installs unused Runtimes and transfers dependency and policy choices from
the host. Explicit binding preserves one Harapter package and optional native
Runtime ownership without adapter boilerplate in application code.

### Accept a shared host Session or expose replacement operations immediately

A shared mutable current Session permits races with external prompts, aborts and
replacement. This implementation requires exclusive factory ownership instead;
resume/fork need separate factory and native replacement evidence before
support.

## Consequences

- The addition is a minor API feature; existing RPC consumers keep their
  behavior.
- Embedded SDK and RPC capabilities differ. Neither a provider name nor the
  existence of another strategy upgrades the active connection's manifest.
- Hosts may retain their tools and extension UI policy. Portable interaction
  responses, model/workspace overrides, persisted resume/fork and unrestricted
  native handles are unsupported in the SDK strategy.
- Compatibility expansion requires new source, fixture and native SDK evidence.
  A missing optional Runtime is not replaced by an implicit process fallback.
