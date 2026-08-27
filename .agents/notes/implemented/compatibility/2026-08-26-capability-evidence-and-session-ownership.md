# Agent Note: Capability evidence and session ownership

Status: implemented

## Problem

Harness versions, transports, and configurations expose different lifecycle
behavior even under the same product name. Static provider matrices and Adapter
versions cannot prove that a connected runtime supports resume, cancellation,
interactions, terminal results, or a particular event stream.

## Decision

Harapter reports capabilities from the connected runtime, public interface, and
active configuration. Capability declarations distinguish native, emulated,
Adapter-controlled, unsupported, and unknown behavior where those distinctions
affect lifecycle or safety. A missing Capability name remains distinct from an
explicit unknown result. Compatibility evidence records the upstream runtime
version or protocol fingerprint that was exercised.

A Session reference remains bound to the Provider, connection Profile, and
native state that created it. Resume validates those bindings before sending
Provider traffic. Native Run cancellation, cooperative cancellation, and whole
connection abort are separate declarations. EOF, process exit, and unknown
messages do not establish successful completion.

An Adapter that receives a native cancellation acknowledgement waits for the
authoritative terminal event within a bounded interval. Expiry closes the owning
connection and reports `connection_aborted`; an acknowledgement alone does not
establish native cancellation.

Run-scoped traffic requires the native Run identifier. Missing, mismatched, or
connection-reused identifiers never fall back to the owning Session; an
ownership violation aborts the affected connection. An owning Client retains
ephemeral Session status independently of caller-provided serialized Provider
state.

The first Provider evidence is the
[`@harapter/adapter-codex`](../../../../providers/codex/README.md) strategy. It
selects capabilities only after validating the stable App Server handshake,
records the runtime version as diagnostic identity, binds Session references to
the stable protocol family and Provider-owned state, waits for the authoritative
Turn terminal after interrupt, and maps process loss separately from
cancellation. The general acceptance and compatibility rules remain defined by
the [provider matrix](../../../../docs/design/provider-matrix.md) and
[compatibility design](../../../../docs/design/compatibility.md).

## Alternatives considered

### Infer capabilities from Provider name

This is simple for hosts but fails when configuration, transport, deployment, or
upstream version changes behavior. It also turns a marketing identity into a
runtime guarantee and was rejected.

### Treat Adapter version as the compatibility boundary

An Adapter version identifies Harapter code but not the installed runtime or
remote service. It remains useful diagnostic metadata but is insufficient
compatibility evidence.

### Map connection termination to cancellation or success

Connection loss may leave upstream work running or may hide an unknown terminal
state. Mapping it to a stronger result would create false lifecycle guarantees.

## Consequences

- Provider support requires implementation, synthetic or redacted fixtures,
  shared conformance, Provider-specific negatives, a declared compatibility
  range, and applicable live evidence.
- Session resume rejects Provider, Profile, and declared runtime compatibility
  mismatches before native resume traffic.
- Stable protocol claims require structural validation, fixture evidence, and
  Provider-specific negative tests; a product name or runtime version alone is
  not evidence.
- Native cancellation is reported only after the upstream cancel method and
  authoritative cancelled terminal state agree. A missing terminal event has a
  bounded wait and settles through `connection_aborted`.
- Weak upstream identity or lifecycle evidence produces a smaller portable
  Capability set than an interactive CLI may appear to offer.
