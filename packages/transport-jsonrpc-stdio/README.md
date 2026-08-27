# `@harapter/transport-jsonrpc-stdio`

`@harapter/transport-jsonrpc-stdio` is a bounded, bidirectional JSONL transport
for Provider Adapters whose official machine interface exchanges JSON-RPC-shaped
messages over Node readable and writable streams. It is private and versioned
`0.0.0` while the first Provider integrations establish its compatibility
surface.

The package owns framing, request correlation, ordered inbound delivery,
backpressure, local wait controls, and connection disposal. It does not import
Provider SDKs or assign portable Harapter meaning to Provider methods and
payloads.

## Public entrypoints

- `JsonRpcStdioTransport` sends requests, notifications, and responses and
  exposes remote requests and notifications as one ordered async iterable.
- `JsonRpcInboundRequest` and `JsonRpcInboundNotification` preserve the remote
  method and optional parameters for Adapter-level validation and mapping.
- `JsonRpcTransportError` provides stable transport failure codes with bounded
  messages that do not include frames, stream errors, or identifiers.
- `JsonRpcRemoteError` remains safe under ordinary JSON and Node inspection;
  `getRemoteError()` explicitly extracts the bounded remote code, message, and
  data for Provider-owned validation and redaction.
- `JsonRpcDiagnostic` reports an unmatched or late response without exposing its
  identifier or body.
- `abandonInboundRequest()` releases a remote request that the Provider has
  authoritatively resolved without a client response; it emits no wire message.
- `isOpen()` distinguishes request-local failures from terminal transport state.

## Framing and limits

Each message is one UTF-8 JSON object followed by `\n`; inbound `\r\n` is also
accepted. The transport accepts either an omitted `jsonrpc` member or the exact
value `"2.0"`. It omits that member by default and can emit it with
`emitJsonRpcVersion`. This accommodates official interfaces such as
[Codex App Server](https://developers.openai.com/codex/app-server), whose stdio
mode uses newline-delimited JSON and omits the standard JSON-RPC version member
on the wire.

Defaults are deliberately finite:

- `maxMessageBytes`: 1 MiB per encoded message, excluding the newline;
- `maxBufferedMessages`: 128 unread remote requests and notifications;
- `maxPendingRequests`: 128 outbound requests awaiting a response;
- `maxPendingInboundRequests`: 128 remote requests awaiting a response;
- `maxPendingWrites`: 128 active or queued writes;
- `requestTimeoutMs`: 30 seconds.

Limits must be positive safe integers. Timeouts must also be no greater than
2,147,483,647 milliseconds, the maximum delay Node timers preserve without
overflow. A limit violation fails the affected operation or, when it proves the
peer has exceeded an inbound bound, fails the connection.

## Lifecycle

The caller supplies and owns the streams. The transport never spawns, kills, or
restarts a process and never ends or destroys caller-owned streams. A caller may
provide `cleanup` to close its surrounding process or connection policy; the
transport invokes that callback at most once after explicit closure, malformed
input, stream failure, premature EOF, or another terminal transport failure. It
temporarily guards both streams against errors racing with that terminal path or
its awaited cleanup, then removes those guards before `close()` settles.

`close()` is idempotent. It rejects outstanding requests and writes with
`transport_closed`, completes a waiting inbound iterator normally, and awaits
the optional cleanup. A protocol or stream failure rejects inbound iteration
with its safe transport error. Stopping the sole inbound iterator also closes
the logical transport, because remote requests would otherwise have no consumer.

Requests and all write-producing operations share a serialized, bounded queue.
The transport waits for each Node write callback before starting the next frame.
A request that times out or is locally aborted before its queued write starts is
not sent. Once a write has started, however, the peer may already have received
the request.

Each remote request remains capacity-accounted until a response finishes,
connection termination clears it, or the consuming Adapter calls
`abandonInboundRequest()` after an authoritative Provider-side resolution. A
request with an in-progress response records deferred abandonment and remains
capacity-accounted until that response attempt settles. Both successful and
failed response attempts then release its local ownership.

`AbortSignal` and request timeout control only the caller's local response wait.
They do not send a Provider cancellation method and are never evidence of native
Run cancellation. A later response becomes a bounded `unmatched_response`
diagnostic rather than a successful result.

## Errors and sensitive data

Malformed JSON, invalid UTF-8, structurally ambiguous envelopes, oversized
messages, duplicate outstanding remote request identifiers, and inbound capacity
violations fail closed. Transport errors contain fixed messages and never attach
an original stream error or frame body.

Remote JSON-RPC errors are different: `JsonRpcRemoteError.getRemoteError()` is
an explicit raw-data extraction boundary for the consuming Adapter. Its return
value may contain sensitive data and must be validated and redacted before
becoming a Harapter error, event, diagnostic, or log entry. Logging the Error
object itself through ordinary JSON serialization or Node inspection remains
content-free. Inbound `method` and `params` have the same Provider-owned
validation and redaction requirement.

## Example

```ts
import { JsonRpcStdioTransport } from '@harapter/transport-jsonrpc-stdio';

const transport = new JsonRpcStdioTransport({
  readable: controlledProcess.stdout,
  writable: controlledProcess.stdin,
  cleanup: () => stopControlledProcess(controlledProcess),
});

const inbound = (async () => {
  for await (const message of transport.incoming()) {
    // The Provider Adapter validates and maps each method and payload.
    await handleProviderMessage(message);
  }
})();

await transport.request('initialize', {
  clientInfo: { name: 'harapter-provider', version: '0.0.0' },
});
await transport.close();
await inbound;
```

The process policy, initialization sequence, generated schemas, method
semantics, retries, Provider compatibility range, and portable event/error
mapping belong to the consuming Provider Adapter.

## Limitations

- This is not a process manager, Provider Adapter, generic agent loop, logger,
  retry layer, or full JSON-RPC framework.
- Exactly one consumer may claim `incoming()`.
- Messages must fit on one JSONL frame; batch arrays and multiline framing are
  rejected.
- Generic request result types provide TypeScript ergonomics only. Each Adapter
  must validate untyped boundary data against its supported upstream schema.
- No Provider support claim follows from this package alone. A Provider still
  needs an implementation, redacted fixtures, shared conformance evidence, and a
  declared compatibility range.
