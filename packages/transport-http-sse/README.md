<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/transports/http-sse</code></h1>

<p align="center"><strong>Bounded HTTP requests and pull-driven Server-Sent Events for Adapters.</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 license"></a>
</p>

<!-- markdownlint-enable MD033 -->

This guide describes a module included in the single `harapter` SDK. For
ordinary application setup, start with the
[application guide](../../packages/harapter/README.md). The first single-package
release is pending; the installation commands apply after that release.

`harapter/transports/http-sse` is a bounded, Provider-neutral transport for
Harness machine interfaces exposed through HTTP requests and Server-Sent Events.

The package owns endpoint-safe URL resolution, request and response byte limits,
local wait controls, incremental SSE framing, operation capacity, and transport
disposal. It does not import Provider SDKs or assign Session, Run, Event,
interaction, error, or cancellation meaning to upstream routes and payloads.

## Application or Adapter development?

Most applications use `createHarapter` from `harapter`. Use this transport
subpath when implementing or testing a machine-interface integration. The
following complete offline example uses only published imports. It does not
start a real Runtime and is not Provider compatibility evidence.

```sh
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

Save the following as `app.ts`. It imports only the npm packages installed
above; Node.js 24 can execute this TypeScript directly.

<!-- sdk-example: transport-http-sse.ts -->

```ts
import { HttpSseTransport } from 'harapter/transports/http-sse';

// Inject Fetch for an offline application test; no HTTP request leaves this process.
const transport = new HttpSseTransport({
  baseUrl: 'https://example.invalid/',
  fetch: (_input, init) =>
    Promise.resolve(
      init?.method === 'POST'
        ? new Response('{"accepted":true}', { status: 200 })
        : new Response('event: ready\ndata: {}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
    ),
});
try {
  const response = await transport.request('task', {
    method: 'POST',
    body: '{}',
  });
  if (response.status !== 200)
    throw new Error('Unexpected synthetic response.');
  let count = 0;
  for await (const _event of transport.subscribe('events')) {
    count += 1;
    break; // This example needs one event; an unexpected remote EOF is an error.
  }
  console.log({ httpStatus: response.status, eventsReceived: count });
} finally {
  await transport.close();
}
```

```sh
node app.ts
```

For a real integration, replace the synthetic stream/Fetch peer with the
host-owned process or endpoint described below. The consuming Adapter still owns
startup, payload validation, authentication, redaction and terminal semantics. A
transport write or EOF does not establish Run success or native cancellation.

[Complete application, recipes and error handling](../../examples/sdk-application/README.md)
· [Harapter on npm](https://www.npmjs.com/package/harapter)

## Use this package when

- a harness exposes commands over HTTP and streams progress over SSE;
- your Adapter needs origin-safe URL handling, finite body/event limits, and
  explicit operation capacity; or
- EOF, redirects, timeouts, and aborts must remain transport outcomes rather
  than invented Provider lifecycle results.

## Installation

```bash
pnpm add harapter
```

## Public entrypoints

- `HttpSseTransport` sends bounded HTTP requests and opens pull-driven SSE
  subscriptions against one base URL.
- `HttpTransportResponse` exposes the numeric HTTP status, bounded response
  bytes, and a bounded Content-Type value when available.
- `SseEvent` preserves standard `data`, last event ID, optional event name, and
  a valid retry field from the dispatched SSE block.
- `HttpTransportError` provides stable, content-free transport failure codes.
- `isOpen()` reports whether new operations can be accepted.

Request bodies, response bodies, SSE data, Content-Type values, and headers are
untrusted transport data. A consuming Provider Adapter validates and redacts
them before they enter portable errors, events, diagnostics, fixtures, or logs.

## Configuration and limits

The constructor accepts an HTTP or HTTPS `baseUrl`, an optional Fetch
implementation, optional default headers, an optional cleanup callback, and
finite limit overrides. Default headers are snapshotted and may contain
credentials, but the transport never copies them into an Error.

Defaults are:

- `maxConcurrentRequests`: 64 active ordinary requests;
- `maxConcurrentStreams`: 8 active SSE subscriptions;
- `maxHeaderBytes`: 64 KiB after default and per-operation headers are merged;
- `maxRequestBytes`: 1 MiB per outbound body;
- `maxResponseBytes`: 1 MiB per ordinary response body;
- `maxSseChunkBytes`: 1 MiB per chunk returned by Fetch;
- `maxSseLineBytes`: 64 KiB per SSE line;
- `maxSseEventBytes`: 1 MiB between SSE dispatch boundaries;
- `requestTimeoutMs`: 30 seconds through ordinary response body completion;
- `sseConnectTimeoutMs`: 30 seconds through SSE response headers.

Limits must be positive safe integers. Timer values must not exceed
2,147,483,647 milliseconds. Per-operation timeout overrides use the same timer
range.

The base URL cannot contain credentials, a query, or a fragment. A base path is
normalized with a trailing slash. Operation paths must be relative, contain no
fragment or control character, remain on the configured origin, and remain
inside the configured base path. Redirects are not followed automatically, so
default headers cannot be forwarded to a different endpoint.

## HTTP requests

`request()` accepts `DELETE`, `GET`, `HEAD`, `OPTIONS`, `PATCH`, `POST`, and
`PUT`. Bodies are strings or byte arrays; `GET` and `HEAD` reject bodies. The
transport incrementally reads and copies the response under its byte limit. HTTP
statuses remain data for Provider-level validation and error mapping.

A caller signal or timeout ends the local Fetch and response wait even when an
injected Fetch implementation ignores its signal. Neither control sends a
Provider cancellation route or proves that remote work stopped.

## Server-Sent Events

`subscribe()` opens a `GET` request with `Accept: text/event-stream` unless the
caller supplied an Accept header. The connect timeout ends after valid response
headers arrive; an active stream has no implicit wall-clock deadline.

The parser accepts UTF-8 with an optional initial byte-order mark, `LF`, `CR`,
or `CRLF` line endings, comments, fragmented characters, multiple `data` lines,
`event`, `id`, and non-negative safe-integer `retry` values. Unknown SSE fields
follow the SSE standard and are ignored. Provider event types and JSON inside
`data` remain uninterpreted.

Subscriptions are pull-driven. The transport reads the next upstream chunk only
while the consumer requests another item and does not maintain an event queue.
Returning from one iterator cancels only that response body and releases its
stream capacity. Invalid UTF-8, an exceeded bound, a body read failure, an
invalid HTTP response, or unexpected clean EOF fails that subscription with a
fixed transport error. Clean EOF is never a successful Provider terminal result.

## Lifecycle and errors

`close()` is idempotent. It stops accepting work, aborts active operations, and
runs optional caller cleanup at most once. Ordinary requests reject with
`transport_closed`; an explicitly closed SSE subscription completes normally so
an Adapter event pump can dispose without manufacturing a Provider failure.
Caller-aborted subscriptions still fail with `request_aborted`.

`HttpTransportError` does not retain a URL, path, header, body, credential,
upstream exception, or cleanup exception. A safe numeric HTTP status is exposed
only for `http_status`. Ordinary JSON serialization and Node inspection contain
only the stable name, code, fixed message, and optional status.

## Compose a real transport

```ts
import { HttpSseTransport } from 'harapter/transports/http-sse';

const transport = new HttpSseTransport({
  baseUrl: 'http://127.0.0.1:4096/',
  defaultHeaders: resolveHostOwnedHeaders(profile.authRef),
});

const events = (async () => {
  for await (const event of transport.subscribe('event')) {
    await validateAndMapProviderEvent(event);
  }
})();

const response = await transport.request('session', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Harapter session' }),
});
await validateProviderResponse(response);

await transport.close();
await events;
```

## Limitations

- This is not a Provider Adapter, OpenAPI client, authentication manager, cookie
  jar, retry policy, reconnection policy, process manager, cache, or logger.
- It does not follow redirects or accept endpoint escapes.
- SSE retry fields are observable but do not trigger automatic reconnection.
- Fetch and its internal network buffers remain owned by the supplied runtime;
  Harapter bounds the chunks and accumulated data visible to this package.
- No Provider support claim follows from this transport. A Provider still needs
  an implementation, redacted fixtures, conformance evidence, a declared
  compatibility range, and applicable live-runtime evidence.

## Related packages

[All packages](../../README.md#packages-on-npm)

| Package                                                                       | Documentation                                 |
| ----------------------------------------------------------------------------- | --------------------------------------------- |
| [`harapter`](https://www.npmjs.com/package/harapter)                          | [Guide](../core/README.md)                    |
| [`harapter/transports/jsonrpc-stdio`](https://www.npmjs.com/package/harapter) | [Guide](../transport-jsonrpc-stdio/README.md) |
| [`harapter/transports/jsonl-process`](https://www.npmjs.com/package/harapter) | [Guide](../transport-jsonl-process/README.md) |
| [`harapter/transports/acp`](https://www.npmjs.com/package/harapter)           | [Guide](../transport-acp/README.md)           |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter)              | [Guide](../conformance/README.md)             |
