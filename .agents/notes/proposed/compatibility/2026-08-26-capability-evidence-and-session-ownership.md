# Agent Note: Capability evidence and session ownership

Status: proposed

## Problem

Harness versions, transports, and configurations expose different lifecycle
behavior even under the same product name. Static provider matrices and adapter
versions cannot prove that a connected runtime supports resume, cancellation,
interactions, terminal results, or a particular event stream.

## Proposal

Harapter will report capabilities from the connected runtime, public interface,
and active configuration. Capability declarations will distinguish native,
emulated, Adapter-controlled, unsupported, and unknown behavior where those
distinctions affect lifecycle or safety. A missing Capability name will remain
distinct from an explicit unknown result. Compatibility evidence will record the
upstream runtime version or protocol fingerprint that was exercised.

A session reference will remain bound to the provider, adapter connection
profile, and native state that created it. Resume will validate those bindings
before sending provider traffic. Native run cancellation, cooperative
cancellation, and whole connection abort will be separate declarations. EOF,
process exit, and unknown messages will not establish successful completion.

Provider acceptance and compatibility expectations are defined by the
[provider matrix](../../../../docs/design/provider-matrix.md) and
[compatibility design](../../../../docs/design/compatibility.md).

## Alternatives considered

### Infer capabilities from provider name

This is simple for hosts but fails when configuration, transport, deployment, or
upstream version changes behavior. It also turns a marketing identity into a
runtime guarantee and was rejected.

### Treat adapter version as the compatibility boundary

An adapter version identifies Harapter code but not the installed runtime or
remote service. It remains useful diagnostic metadata but is insufficient
compatibility evidence.

### Map connection termination to cancellation or success

Connection loss may leave upstream work running or may hide an unknown terminal
state. Mapping it to a stronger result would create false lifecycle guarantees.

## Acceptance criteria

The proposal is implemented when adapters expose runtime-derived capability and
compatibility evidence, session resume rejects mismatched ownership, and tests
distinguish native cancellation from cooperative cancellation and connection
abort. Provider support claims must include redacted fixtures, shared
conformance results, and a declared compatibility range.

## Risks

Some upstreams may expose only weak identity or abort semantics, producing a
smaller portable capability set than their interactive CLI experience. Until
those adapters and tests exist, hosts cannot rely on these declarations as a
current runtime contract.
