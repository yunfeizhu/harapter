# Agent Note: Portable Core and provider boundaries

Status: implemented

## Problem

Agent harnesses expose incompatible session, run, event, interaction, transport,
and extension concepts. Letting host applications or Core branch on Provider
identity would make every new Adapter a cross-package change and turn upstream
differences into implicit behavior.

## Decision

Harapter separates provider-agnostic contracts, Core runtime checks, transport
implementations, shared conformance tests, and independently owned Provider
Adapters. [`@harapter/core`](../../../../packages/core/README.md) owns canonical
clients, sessions, runs, events, interactions, capabilities, errors, ownership
validation, and extension dispatch without importing Provider packages or SDKs.

[`@harapter/conformance`](../../../../packages/conformance/README.md) exercises
those interfaces with a deterministic Fake Provider. The suite verifies identity
binding, capability requirements, event ordering, unique terminal results,
cancellation versus connection abort, extensions, native access, and cleanup
through public contracts rather than Provider internals.

Behavior without a portable semantic equivalent remains a typed Provider
extension or explicit native escape hatch. Capability modes distinguish native,
emulated, Adapter-controlled, unsupported, and unknown behavior; a missing
Capability entry is distinct from an explicit unknown result. Harapter does not
implement an agent loop or move native checkpoints between Providers. The
current structure is defined by the
[architecture](../../../../docs/design/architecture.md) and
[API design](../../../../docs/design/api-design.md).

## Alternatives considered

### Provider conditionals inside Core

Central conditionals initially reduce package count but make Core releases
depend on every upstream harness and allow Provider identity to become hidden
behavior. This prevents independent compatibility releases and was rejected.

### Lowest-common-denominator API only

Removing capabilities, extensions, and native access creates a small interface
but makes important Provider behavior unreachable and encourages untyped escape
through arbitrary metadata. Harapter instead keeps a small portable Core with
explicit optional capabilities and typed extensions.

### One universal checkpoint format

Native checkpoints encode Provider-owned execution state and cannot be
translated safely without implementing Provider internals. Sessions therefore
remain bound to their creating Provider and Profile.

## Consequences

- New Provider packages can implement the public SPI without adding their name,
  SDK, or behavior to Core.
- The Registry fails closed when Client or Capability identity differs from the
  requested Profile. It validates against an isolated Profile snapshot and
  probes Capability identity on every connection, closing Clients whose
  descriptor or Capability probe fails. Required capabilities accept only
  `native` unless the host explicitly opts into another mode.
- Native resume validates any declared runtime compatibility reference as well
  as Provider and Profile ownership. Native, emulated, and connection-abort
  cancellation outcomes remain distinct.
- The Fake Provider and shared suite are executable design evidence, not a real
  Provider compatibility claim. Each Provider still needs official-interface
  evidence, redacted fixtures, Provider negatives, a declared compatibility
  range, and applicable live tests.
- Core states event and terminal obligations but does not infer Provider
  outcomes or own transport buffering and redaction. Adapters and transports
  must implement and verify those behaviors.
- The initial packages remain private and pre-alpha until multiple semantically
  different Provider Adapters demonstrate that the contracts do not encode one
  Provider's lifecycle.
