# `@harapter/transport-jsonl-process`

`@harapter/transport-jsonl-process` is a bounded strict-JSONL transport for
Provider Adapters that communicate with a host-supplied harness process.

The package owns UTF-8 framing, ordered inbound delivery, serialized writes,
backpressure, local write waits, connection disposal, and explicit resource
limits. It does not spawn or discover executables, correlate protocol requests,
interpret Provider messages, or assign Harapter Session, Run, Event, error, or
cancellation semantics.

## Installation

```bash
pnpm add @harapter/transport-jsonl-process@next
```

## Public entrypoints

- `JsonlProcessTransport` sends JSON objects and exposes received objects as one
  ordered async iterable.
- `JsonlMessage` is the untyped JSON object boundary that a consuming Provider
  must validate before interpreting or exposing it.
- `JsonlSendOptions` controls only the local wait for a complete write through
  an optional timeout or `AbortSignal`.
- `JsonlTransportError` provides stable, content-free failure codes for Provider
  error mapping.

## Framing and limits

Each message is one UTF-8 JSON object followed by LF (`\n`). Inbound CRLF is
accepted by stripping one trailing delimiter CR. Other Unicode separators,
including U+2028 and U+2029 inside JSON strings, are data and never delimit
records. Empty records, arrays, primitives, invalid UTF-8, malformed JSON, and
truncated final records fail the connection.

Defaults are finite:

- `maxMessageBytes`: 1 MiB per encoded message, excluding LF and an optional
  delimiter CR;
- `maxBufferedMessages`: 128 unread inbound messages;
- `maxPendingWrites`: 128 active or queued outbound writes;
- `writeTimeoutMs`: 30 seconds for the caller's local write wait.

Every limit must be a positive safe integer. Timeouts cannot exceed
2,147,483,647 milliseconds, the maximum delay Node timers preserve without
overflow.

## Lifecycle

The caller supplies and owns the readable and writable streams. The transport
does not end or destroy them. An optional `cleanup` callback lets the Provider
Connection stop or detach its surrounding process policy; it runs at most once
after explicit close, malformed input, stream failure, premature EOF, or another
terminal transport failure.

Exactly one consumer may claim `incoming()`. Returning from that consumer closes
the logical transport because unread Provider output would otherwise have no
owner. Explicit close completes a waiting iterator normally. After an unexpected
stream or protocol boundary, complete records already received remain ordered
and observable before iteration rejects with a safe transport error.

Writes are serialized until each Node write callback settles. A local abort or
timeout skips a queued frame only when writing has not started. Once a write has
started, the Provider may receive it even if the local wait ends. The transport
does not emit an abort message and supplies no evidence of native Run
cancellation. Close retains one bounded terminal error guard until cleanup and
every already-started write callback settle.

## Errors and sensitive data

Transport errors contain fixed messages and never retain a frame, stream error,
identifier, or Provider payload. Received objects remain untrusted and may
contain sensitive data. The consuming Provider Adapter must validate and redact
them before producing Harapter events, errors, diagnostics, logs, fixtures, or
raw-channel observations.

## Example

```ts
import { JsonlProcessTransport } from '@harapter/transport-jsonl-process';

const transport = new JsonlProcessTransport({
  readable: controlledProcess.stdout,
  writable: controlledProcess.stdin,
  cleanup: () => stopControlledProcess(controlledProcess),
});

const inbound = (async () => {
  for await (const message of transport.incoming()) {
    await validateAndMapProviderMessage(message);
  }
})();

await transport.send({ id: 'request-1', type: 'prompt', message: 'Hello' });
await transport.close();
await inbound;
```

Process creation, request correlation, startup negotiation, Session ownership,
Run terminality, Provider-native cancellation, redaction, compatibility, and
capabilities belong to the consuming Provider Adapter.

## Limitations

- This is not a process manager, request/response protocol, Provider Adapter,
  retry layer, logger, or agent loop.
- Exactly one inbound consumer is supported.
- Messages must be JSON objects that fit on one LF-delimited record.
- A successful `send()` proves only that Node completed the local write
  callback; it does not prove Provider acceptance or execution.
- No Provider support claim follows from this package alone.
