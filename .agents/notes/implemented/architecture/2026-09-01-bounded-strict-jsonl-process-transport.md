# Agent Note: Bounded strict JSONL process transport

Status: implemented

## Problem

Documented headless harness interfaces can exchange Provider-defined JSON
objects over process stdin and stdout without using JSON-RPC envelopes. Their
Adapters need reusable strict framing, resource bounds, backpressure, and
connection cleanup, but reusing a JSON-RPC transport would reject valid native
messages or force Provider semantics into a shared package. Implementing the
same stream mechanics in every Adapter would duplicate sensitive lifecycle and
failure handling.

## Decision

[`@harapter/transport-jsonl-process`](../../../../packages/transport-jsonl-process/README.md)
implements a Provider-neutral strict-JSONL transport over caller-owned Node
streams. It accepts one UTF-8 JSON object per LF-delimited record, strips an
optional trailing delimiter CR, preserves every other Unicode separator as data,
delivers inbound objects in wire order, and serializes outbound writes until
their Node callbacks settle. Message bytes, unread messages, queued writes, and
local write waits are all bounded.

The transport does not spawn a process or interpret a message envelope. The
Provider Connection owns executable selection, process creation, cleanup policy,
stderr, exit status, and ownership. The Provider Adapter owns request
correlation, runtime detection, schema validation, redaction, Session and Run
mapping, event terminality, errors, capabilities, and native escape hatches.

Timeout and `AbortSignal` end only the caller's local write wait. A queued frame
is skipped when writing has not started; a started write may still reach the
Provider. Neither path emits a Provider cancellation message or proves native
Run cancellation. Malformed input, invalid UTF-8, oversized frames, capacity
violations, unexpected EOF, stream errors, and write failures terminate the
logical connection with fixed, content-free errors. An optional cleanup hook
runs at most once, and the caller retains ownership of both streams. Complete
records received before an unexpected terminal boundary drain before iteration
reports that boundary. Terminal error guards remain bounded to the two supplied
streams and are released only after cleanup and already-started write callbacks
settle.

## Alternatives considered

### Extend the JSON-RPC stdio transport with Pi-specific envelopes

The existing transport correlates JSON-RPC-shaped `method`, `result`, and
`error` messages. Accepting unrelated command, response, and event shapes there
would weaken its validation and couple a shared package to one Provider
protocol.

### Put strict JSONL mechanics in the first consuming Adapter

This would avoid a package initially but duplicate framing, bounds, write
serialization, cleanup, and safe-error behavior in later documented headless
JSONL integrations. The repository design already identifies this boundary as a
shared Transport concern.

### Add generic request correlation callbacks to the transport

Different non-JSON-RPC protocols identify commands, asynchronous acceptance,
events, and terminal boundaries differently. A configurable classifier would
move untrusted Provider envelope interpretation into the Transport API before a
second compatible consumer proves a common contract. Raw ordered messages keep
that semantic boundary explicit.

## Consequences

- Non-JSON-RPC process Adapters can reuse strict LF framing, resource bounds,
  backpressure, local wait controls, safe termination, and cleanup.
- Each Adapter must implement and test its own correlation and lifecycle state
  machine; the shared transport cannot claim that a sent frame was accepted or
  completed.
- Arrays, primitives, empty records, multiline records, invalid UTF-8, and
  truncated final records fail closed.
- Returning from the sole inbound consumer closes the transport because no
  component remains to own Provider output.
- Unit evidence covers fragmented UTF-8, CRLF, Unicode separators, malformed and
  oversized input, queue and write capacity, abort, timeout, stream failure,
  disposal, and redaction-safe errors. Provider support still requires its own
  official-interface evidence, redacted fixtures, conformance, compatibility
  declaration, and available live tests.
