# Agent Note: Native Session history operations across existing Adapters

Status: implemented

## Problem

The existing Codex, OpenCode, Hermes, OpenClaw and Pi Adapters already implement
resume and native cancellation. Their upstreams also expose history operations,
but these differ in copied history, parent lifetime and transport. A uniform
portable fork would hide those differences or imply checkpoint portability. The
DSH Gateway strategy already keeps its operations in a typed extension.

## Decision

Core stays unchanged. Each existing Adapter exposes a typed native Session
extension returning an ordinary owned `HarnessSession`. The Provider READMEs own
the public contracts and the
[verification record](../../../../docs/provider-session-fork-evidence.md) owns
versions and reproducible evidence. Portable `session.fork` remains unsupported.

Codex reads the persisted source before stable `thread/fork` and verifies child
lineage. Stable `excludeTurns` avoids transferring the copied history in the
fork receipt and preserves the existing transport message-size bound. OpenCode
copies full stored history without a message anchor, verifies the same directory
and keeps the host's local prompt defaults. OpenCode does not copy per-Session
permissions or revert state, so the Adapter refuses those sources before
writing. An unknown native message anchor silently means full history upstream;
no anchor option is offered.

Hermes exposes `branch`, because its native API retires the parent before
creating the child. Harapter rejects the parent after that branch and after
reconnecting. The native operation does not copy stored model configuration;
source `has_model_config` must explicitly be false. Even a failed HTTP response
can follow parent retirement, so every failure after dispatch quarantines the
source. It is not described as a parent-preserving fork.

Pi opens the exact persisted source in a separate owned process, then uses RPC
`clone` and verifies a new idle identity. The original process remains bound to
its Session. Only the active branch is copied. Opening with CLI `--fork` would
copy the source file's broader branch structure and skip the explicit source
identity check before cloning, so it is not the selected operation.

OpenClaw ACP has no fork method. An optional, typed host-owned Gateway binding
supplements ACP: its Profile must match, and the host supplies the authenticated
hello's method inventory and bounded request implementation. Harapter requires
`sessions.list` and `sessions.create`, finds the exact isolated source route,
checks execution/access constraints and native lineage, then attaches the child
through ACP with `requireExisting`. No input or command hooks are submitted. The
host owns the same-Gateway/store binding, authentication and disposal. Harapter
does not introduce another Gateway transport or inspect credentials. Exact route
comparison allows only a single canonical Agent prefix. Busy checks use the
native `status` and `hasActiveRun` projections. The native operation does not
copy per-Session `sendPolicy`; any defined value is rejected before writing
rather than relaxing or silently replacing the source sending policy.

The source must be quiescent across all writers. Adapters reserve their local
source while forking; local status probes do not lock another process. Child
ownership, remote identity, lineage where available, policy preservation and
closed-Client checks all precede returning a child. Ambiguous writes are never
retried automatically. They close the owning process connection or quarantine
the source as described by each Provider contract. Pi can dispose only the
independent child attempt. A timeout or connection close never becomes native
Run cancellation.

## Alternatives considered

### Add portable `HarnessSession.fork`

This would require common history boundaries and parent lifecycle semantics that
these interfaces do not share. A future portable contract needs separate review
and migration evidence. Typed operations make those differences explicit without
branching on provider identity in Core.

### Clone history in Harapter

Replaying prompts, copying provider files or exporting/importing checkpoints
would give Harapter ownership of native storage, risk private content exposure
and claim fidelity it cannot establish. Native interfaces remain authoritative.

### Change OpenClaw ACP or own a second Gateway connection

Inventing an ACP extension cannot establish official support. A new generic
Gateway transport would add authentication, device pairing and reconnection
ownership beyond this task. The explicit host binding reaches the published RPC
surface while keeping these responsibilities with the application that already
operates the Gateway.

## Consequences

Applications select native semantics through typed extensions. No existing
portable contract or runtime dependency changes. Sources with unpreserved
settings are rejected, and all writers must obey the host's exclusive-access
boundary. This gives up arbitrary historical anchors, ephemeral forks and
transparent copying of unsupported execution policies.

Deterministic tests cover receipts, ownership, conflicts, failure containment,
child resume and parent retirement. A dedicated opt-in test runs all five fixed
official runtimes with a loopback synthetic model, native persistence and actual
machine interfaces. It verifies inherited history, independent parents where
supported, child resume and authoritative native cancellation. Production model
authentication, external tools and multi-host persistence remain outside that
local evidence. Fixture provenance and README language triads are synchronized
with the implementation.
