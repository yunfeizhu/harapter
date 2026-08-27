# Agent Note: Bounded bidirectional JSONL transport

Status: implemented

## Problem

Official harness machine interfaces can expose concurrent client requests,
server requests, and notifications over one newline-delimited stream. Provider
Adapters need to share safe framing and connection mechanics without moving
Provider methods, lifecycle meaning, process policy, or sensitive payload
handling into Core. Unbounded queues, ambiguous partial frames, and treating a
local wait abort as remote cancellation would violate Harapter's resource and
lifecycle guarantees.

## Decision

[`@harapter/transport-jsonrpc-stdio`](../../../../packages/transport-jsonrpc-stdio/README.md)
implements a Provider-neutral, stream-injected transport for bidirectional
JSON-RPC-shaped JSONL. It correlates outbound requests, serializes writes until
their Node callbacks complete, and exposes remote requests and notifications in
wire order through one async consumer. Message size, unread messages, outbound
requests, unanswered inbound requests, queued writes, and request wait time are
all explicitly bounded.

The caller owns process creation and both streams. The transport does not end or
destroy them; it invokes an optional caller-supplied cleanup operation at most
once after any terminal path. Explicit close completes inbound iteration, while
malformed input, premature EOF, stream failure, and inbound capacity violations
fail it with fixed, content-free diagnostics. Short-lived terminal guards also
contain stream errors racing with the terminal path or its awaited cleanup
without taking permanent ownership of caller streams.

Request timeout and `AbortSignal` end only the local response wait. A request
that has not started writing is skipped, but a request already handed to the
writable may continue remotely. The transport sends no cancellation method and
does not interpret either outcome as native Harapter cancellation. Late and
unknown responses produce only a bounded diagnostic; unknown remote methods
remain observable for Adapter-level mapping.

The transport keeps its Error object safe for ordinary JSON and Node inspection
and exposes remote error fields only through an explicit extraction method.
Those fields and inbound parameters remain untrusted and potentially sensitive;
the Provider Adapter must validate and redact them before exposing portable
errors, events, diagnostics, or logs. This keeps the transport boundary
consistent with the separation in the
[implementation guide](../../../../docs/design/implementation-guide.md).

## Alternatives considered

### Implement framing inside the first Codex Adapter

This would shorten the first integration but couple process mechanics to Codex
method semantics and invite duplicate correlation, bounds, and cleanup logic in
later bidirectional RPC Adapters. A separate package makes the lifecycle
contract independently testable without importing a Provider SDK or claiming
Provider support.

### Use Content-Length framing

Header framing is useful for some language-server protocols, but the targeted
official stdio interface uses one JSON value per line. Accepting two framings in
one initial transport would add detection ambiguity and malformed-input paths
without compatibility evidence.

### Deliver inbound messages through unbounded callbacks

Callbacks avoid an explicit queue API but provide no natural consumer
backpressure and allow a stalled Adapter to accumulate remote payloads without a
limit. A single bounded async iterable preserves ordering and makes ownership
and disposal observable.

## Consequences

- Codex and any later compatible Adapter can reuse framing, correlation,
  backpressure, and safe cleanup while owning its initialization, generated
  schemas, capabilities, lifecycle, compatibility range, and semantic mapping.
- The default wire form omits `jsonrpc`; callers can opt into the exact `"2.0"`
  member for compatible peers. Batch arrays and other framings fail closed.
- Queue limits can reject local work under load, and an inbound limit violation
  terminates the logical connection. Adapters must select overrides from
  compatibility evidence rather than disabling bounds.
- Only one inbound consumer is allowed. Returning from it closes the transport
  because no component would remain to answer server requests.
- Timeout and abort are deliberately weaker than native cancellation. Provider
  Adapters must invoke and prove an upstream cancellation method separately
  before declaring native cancellation capability.
- Unit evidence covers fragmented UTF-8, CRLF, out-of-order responses,
  bidirectional requests, bounds, timeout, abort, malformed and oversized
  frames, backpressure, stream failure, cleanup, and redaction-safe errors. A
  real Provider still requires redacted fixtures, conformance, live evidence
  where available, and a declared compatibility range.
