# Agent Note: Bounded HTTP and SSE transport

Status: implemented

## Problem

Official Harness services can expose ordinary request/response routes together
with long-lived Server-Sent Events. Provider Adapters need shared network
mechanics without moving Provider routes, payload schemas, authentication
policy, reconnection, or lifecycle meaning into Core. Generic Fetch use alone
does not establish finite bodies, finite concurrent work, safe endpoint
resolution, incremental SSE parsing, or content-free failures.

## Decision

[`@harapter/transport-http-sse`](../../../../packages/transport-http-sse/README.md)
implements an endpoint-bound, Provider-neutral HTTP and SSE transport. It uses
the Node Fetch contract by default and accepts an injected compatible Fetch
implementation for host networking policy and deterministic tests.

The configured base URL is limited to HTTP or HTTPS without embedded
credentials, query data, or fragments. Each operation resolves a relative path
on the same origin and inside the base path. Redirect handling is manual. This
keeps default authentication headers bound to the host-selected endpoint.

Ordinary requests bound merged headers, outbound bodies, response bodies,
concurrent operations, and the complete local response wait. HTTP statuses and
bounded response bytes remain Adapter-owned data. SSE subscriptions separately
bound concurrent streams, connection wait, chunks, lines, and dispatched event
blocks. Parsing follows standard UTF-8, line, comment, `data`, `event`, `id`,
and `retry` behavior while leaving Provider payloads uninterpreted.

The SSE API is pull-driven and owns no event queue or reconnection loop. An
unexpected clean EOF is a transport failure, not evidence of a successful Run. A
caller signal or timeout controls only local network waiting. Provider-native
cancellation requires a separately invoked and proven Provider route.

The caller owns endpoint authentication and service lifecycle. Explicit close
aborts active operations and invokes optional cleanup at most once. Transport
errors retain no URL, path, header, body, credential, or upstream exception; raw
response and event content crosses only the explicit return boundary to a
Provider Adapter.

## Alternatives considered

### Use the platform EventSource client

EventSource supplies reconnection and event dispatch but does not expose the
response and chunk controls needed for host-selected authentication, explicit
connection ownership, finite event parsing, deterministic local disposal, and
Provider-specific recovery policy. Fetch response streams keep those decisions
observable and testable.

### Implement HTTP and SSE inside the OpenCode Adapter

OpenCode is an immediate consumer, while other documented Harness interfaces
also expose HTTP and SSE. A standalone transport keeps network bounds and safe
errors independently testable and leaves OpenCode route, OpenAPI, Session, Run,
and capability semantics in its Provider package.

### Automatically follow redirects and reconnect SSE

Automatic redirects can forward host-supplied authorization to an endpoint the
Profile did not select. Automatic SSE recovery needs Provider-specific replay,
cursor, snapshot, and duplicate-event semantics. Manual redirects and explicit
Adapter recovery preserve both security ownership and lifecycle truth.

### Buffer events in a callback queue

A callback pump needs a second capacity policy and can accumulate data while a
consumer is stalled. Pull-driven parsing retains only the current Fetch chunk,
line, and event block in package-controlled memory and makes consumer disposal
explicit.

## Consequences

- HTTP/SSE Provider Adapters share bounded request, parsing, timeout, endpoint,
  and cleanup behavior without importing Provider code into Core.
- Hosts can inject authentication headers and Fetch policy, but those values
  remain sensitive and must never enter diagnostics or fixtures.
- Adapters validate every returned status, body, Content-Type, SSE event name,
  and data payload against their supported machine interface.
- Slow consumers apply pull pressure at the response reader rather than filling
  a Harapter event queue; Fetch retains ownership of its internal buffering.
- Clean EOF, malformed UTF-8, read failure, and exceeded bounds fail one stream.
  They never become a portable success result.
- Reconnection, replay, deduplication, status polling, Provider cancellation,
  and service process management remain explicit Adapter or host policy.
- Unit evidence covers endpoint escapes, redirect policy, request and response
  bounds, concurrency, timeouts, caller abort, close, cleanup, fragmented SSE,
  malformed encoding, field parsing, unexpected EOF, and inspection-safe
  failures. Provider support still requires Provider fixtures, conformance,
  compatibility, and applicable live evidence.
