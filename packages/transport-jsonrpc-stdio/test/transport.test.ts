import { PassThrough, Writable } from 'node:stream';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  JsonRpcRemoteError,
  JsonRpcStdioTransport,
  JsonRpcTransportError,
  type JsonRpcDiagnostic,
  type JsonRpcInboundMessage,
  type JsonRpcStdioTransportOptions,
} from '../src/index.js';

interface TransportPair {
  readonly first: JsonRpcStdioTransport;
  readonly second: JsonRpcStdioTransport;
  readonly firstToSecond: PassThrough;
  readonly secondToFirst: PassThrough;
}

function createPair(
  firstOptions: Partial<JsonRpcStdioTransportOptions> = {},
  secondOptions: Partial<JsonRpcStdioTransportOptions> = {},
): TransportPair {
  const firstToSecond = new PassThrough();
  const secondToFirst = new PassThrough();
  return {
    first: new JsonRpcStdioTransport({
      readable: secondToFirst,
      writable: firstToSecond,
      ...firstOptions,
    }),
    second: new JsonRpcStdioTransport({
      readable: firstToSecond,
      writable: secondToFirst,
      ...secondOptions,
    }),
    firstToSecond,
    secondToFirst,
  };
}

async function disposePair(pair: TransportPair): Promise<void> {
  await Promise.all([pair.first.close(), pair.second.close()]);
  pair.firstToSecond.destroy();
  pair.secondToFirst.destroy();
}

function iterator(transport: JsonRpcStdioTransport) {
  return transport.incoming()[Symbol.asyncIterator]();
}

function expectMessage(
  result: IteratorResult<JsonRpcInboundMessage>,
): JsonRpcInboundMessage {
  expect(result.done).toBe(false);
  if (result.done) throw new Error('Expected an inbound message.');
  return result.value;
}

describe('JsonRpcStdioTransport', () => {
  it('correlates concurrent requests even when responses arrive out of order', async () => {
    const pair = createPair();
    const incoming = iterator(pair.second);

    const firstResponse = pair.first.request('alpha', { value: 1 });
    const secondResponse = pair.first.request('beta', { value: 2 });
    const firstRequest = expectMessage(await incoming.next());
    const secondRequest = expectMessage(await incoming.next());

    expect(firstRequest).toMatchObject({
      kind: 'request',
      method: 'alpha',
      params: { value: 1 },
    });
    expect(secondRequest).toMatchObject({
      kind: 'request',
      method: 'beta',
      params: { value: 2 },
    });
    if (firstRequest.kind !== 'request' || secondRequest.kind !== 'request') {
      throw new Error('Expected requests.');
    }

    await pair.second.respond(secondRequest.id, { order: 2 });
    await pair.second.respond(firstRequest.id, { order: 1 });
    await expect(firstResponse).resolves.toEqual({ order: 1 });
    await expect(secondResponse).resolves.toEqual({ order: 2 });
    await disposePair(pair);
  });

  it('does not correlate a response until its request starts writing', async () => {
    const frames: string[] = [];
    const writeCallbacks: (() => void)[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        frames.push(chunk.toString('utf8'));
        writeCallbacks.push(callback);
      },
    });
    const readable = new PassThrough();
    const diagnostics: JsonRpcDiagnostic[] = [];
    const transport = new JsonRpcStdioTransport({
      onDiagnostic: (value) => diagnostics.push(value),
      readable,
      writable,
    });

    const held = transport.notify('held');
    await new Promise((resolve) => setImmediate(resolve));
    const response = transport.request<string>('correlated');
    let settled = false;
    void response.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    readable.write('{"id":1,"result":"premature"}\n');
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(diagnostics).toEqual([{ code: 'unmatched_response' }]);

    writeCallbacks.shift()?.();
    await held;
    await new Promise((resolve) => setImmediate(resolve));
    expect(frames).toHaveLength(2);
    readable.write('{"id":1,"result":"authentic"}\n');
    await expect(response).resolves.toBe('authentic');
    writeCallbacks.shift()?.();
    await transport.close();
    readable.destroy();
    writable.destroy();
  });

  it('preserves notification order and supports server-initiated requests', async () => {
    const pair = createPair();
    const firstIncoming = iterator(pair.first);
    const secondIncoming = iterator(pair.second);

    await pair.first.notify('event/first', { sequence: 1 });
    await pair.first.notify('event/second', { sequence: 2 });
    expect(expectMessage(await secondIncoming.next())).toMatchObject({
      kind: 'notification',
      method: 'event/first',
    });
    expect(expectMessage(await secondIncoming.next())).toMatchObject({
      kind: 'notification',
      method: 'event/second',
    });

    const response = pair.second.request('approval/request', {
      synthetic: true,
    });
    const request = expectMessage(await firstIncoming.next());
    expect(request).toMatchObject({
      kind: 'request',
      method: 'approval/request',
    });
    if (request.kind !== 'request') throw new Error('Expected a request.');
    await pair.first.respond(request.id, { decision: 'deny' });
    await expect(response).resolves.toEqual({ decision: 'deny' });
    await disposePair(pair);
  });

  it('surfaces remote errors without using the remote text as the Error message', async () => {
    const pair = createPair();
    const incoming = iterator(pair.second);
    const response = pair.first.request('overloaded');
    const request = expectMessage(await incoming.next());
    if (request.kind !== 'request') throw new Error('Expected a request.');

    await pair.second.respondError(request.id, {
      code: -32_001,
      message: 'synthetic upstream detail',
      data: { category: 'overloaded' },
    });

    const failure = await response.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JsonRpcRemoteError);
    expect(failure).toMatchObject({
      message: 'Remote JSON-RPC request failed.',
    });
    if (!(failure instanceof JsonRpcRemoteError)) {
      throw new Error('Expected a remote error.');
    }
    expect(failure.getRemoteError()).toEqual({
      code: -32_001,
      data: { category: 'overloaded' },
      message: 'synthetic upstream detail',
    });
    expect(JSON.stringify(failure)).not.toContain('synthetic upstream');
    expect(inspect(failure)).not.toContain('synthetic upstream');
    await disposePair(pair);
  });

  it('decodes fragmented UTF-8 and CRLF-delimited messages', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport = new JsonRpcStdioTransport({ readable, writable });
    const incoming = iterator(transport);
    const frame = Buffer.from(
      '{"method":"event/text","params":{"text":"synthetic-🙂"}}\r\n',
    );
    const emojiStart = frame.indexOf(Buffer.from('🙂'));

    readable.write(frame.subarray(0, emojiStart + 1));
    readable.write(frame.subarray(emojiStart + 1, emojiStart + 3));
    readable.write(frame.subarray(emojiStart + 3));

    expect(expectMessage(await incoming.next())).toEqual({
      kind: 'notification',
      method: 'event/text',
      params: { text: 'synthetic-🙂' },
    });
    await transport.close();
    readable.destroy();
    writable.destroy();
  });

  it('can emit the JSON-RPC version while accepting versioned input', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport = new JsonRpcStdioTransport({
      emitJsonRpcVersion: true,
      readable,
      writable,
    });
    const output = new Promise<Buffer>((resolve) => {
      writable.once('data', (chunk: Buffer) => {
        resolve(chunk);
      });
    });

    await transport.notify('initialized', {});
    expect(JSON.parse((await output).toString('utf8'))).toEqual({
      jsonrpc: '2.0',
      method: 'initialized',
      params: {},
    });

    const incoming = iterator(transport);
    readable.write('{"jsonrpc":"2.0","method":"event/ready","params":{}}\n');
    expect(expectMessage(await incoming.next())).toMatchObject({
      kind: 'notification',
      method: 'event/ready',
    });
    await transport.close();
    readable.destroy();
    writable.destroy();
  });

  it('times out locally and reports a late response without treating it as success', async () => {
    vi.useFakeTimers();
    try {
      const diagnostics: JsonRpcDiagnostic[] = [];
      const pair = createPair({
        onDiagnostic: (value) => diagnostics.push(value),
      });
      const incoming = iterator(pair.second);
      const response = pair.first.request('slow', undefined, { timeoutMs: 50 });
      const timedOut = response.catch((error: unknown) => error);
      const request = expectMessage(await incoming.next());
      if (request.kind !== 'request') throw new Error('Expected a request.');

      await vi.advanceTimersByTimeAsync(50);
      await expect(timedOut).resolves.toMatchObject({
        code: 'request_timeout',
      });
      await pair.second.respond(request.id, { tooLate: true });
      await vi.runAllTimersAsync();
      expect(diagnostics).toEqual([{ code: 'unmatched_response' }]);
      await disposePair(pair);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats AbortSignal as a local wait abort, not an upstream cancel message', async () => {
    const diagnostics: JsonRpcDiagnostic[] = [];
    const pair = createPair({
      onDiagnostic: (value) => diagnostics.push(value),
    });
    const incoming = iterator(pair.second);
    const controller = new AbortController();
    const response = pair.first.request(
      'work',
      {},
      { signal: controller.signal },
    );
    const request = expectMessage(await incoming.next());
    if (request.kind !== 'request') throw new Error('Expected a request.');

    controller.abort();
    await expect(response).rejects.toMatchObject({ code: 'request_aborted' });
    await pair.second.respond(request.id, { tooLate: true });
    expect(diagnostics).toEqual([{ code: 'unmatched_response' }]);

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      pair.first.request('never-sent', {}, { signal: preAborted.signal }),
    ).rejects.toMatchObject({ code: 'request_aborted' });
    await disposePair(pair);
  });

  it('observes an abort triggered during request serialization', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const frames: Buffer[] = [];
    writable.on('data', (chunk: Buffer) => {
      frames.push(chunk);
    });
    const transport = new JsonRpcStdioTransport({ readable, writable });
    const controller = new AbortController();
    const response = transport.request(
      'serialize/then-abort',
      {
        toJSON() {
          controller.abort();
          return { synthetic: true };
        },
      },
      { signal: controller.signal },
    );

    await expect(response).rejects.toMatchObject({ code: 'request_aborted' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(frames).toHaveLength(0);
    await transport.close();
    readable.destroy();
    writable.destroy();
  });

  it('bounds pending outbound and inbound work', async () => {
    const pendingPair = createPair({ maxPendingRequests: 1 });
    const pendingIncoming = iterator(pendingPair.second);
    const first = pendingPair.first.request('held');
    const heldRequest = expectMessage(await pendingIncoming.next());
    if (heldRequest.kind !== 'request') throw new Error('Expected a request.');
    await expect(pendingPair.first.request('overflow')).rejects.toMatchObject({
      code: 'capacity_exceeded',
    });
    await pendingPair.second.respond(heldRequest.id, { accepted: true });
    await expect(first).resolves.toEqual({ accepted: true });
    await disposePair(pendingPair);

    const bufferedPair = createPair({ maxBufferedMessages: 1 });
    await bufferedPair.second.notify('first');
    await bufferedPair.second.notify('second');
    await expect(iterator(bufferedPair.first).next()).rejects.toMatchObject({
      code: 'capacity_exceeded',
    });
    await expect(
      bufferedPair.first.notify('after-overflow'),
    ).rejects.toMatchObject({ code: 'capacity_exceeded' });
    await disposePair(bufferedPair);

    const inboundPair = createPair(
      { maxPendingInboundRequests: 1 },
      { emitJsonRpcVersion: true },
    );
    const inbound = iterator(inboundPair.first);
    const firstInboundResponse = inboundPair.second.request('approval/first');
    const firstInboundFailure = firstInboundResponse.catch(
      (error: unknown) => error,
    );
    const firstInbound = expectMessage(await inbound.next());
    if (firstInbound.kind !== 'request') throw new Error('Expected a request.');
    const secondInboundResponse = inboundPair.second.request('approval/second');
    const secondInboundFailure = secondInboundResponse.catch(
      (error: unknown) => error,
    );
    await expect(inbound.next()).rejects.toMatchObject({
      code: 'capacity_exceeded',
    });
    await inboundPair.second.close();
    await expect(firstInboundFailure).resolves.toMatchObject({
      code: 'transport_closed',
    });
    await expect(secondInboundFailure).resolves.toMatchObject({
      code: 'transport_closed',
    });
    await disposePair(inboundPair);
  });

  it('bounds queued writes and never sends a request rejected by that bound', async () => {
    let releaseWrite: (() => void) | undefined;
    const frames: string[] = [];
    const writable = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        frames.push(chunk.toString('utf8'));
        releaseWrite = callback;
      },
    });
    const readable = new PassThrough();
    const transport = new JsonRpcStdioTransport({
      maxPendingWrites: 1,
      readable,
      writable,
    });

    const held = transport.notify('held');
    await new Promise((resolve) => setImmediate(resolve));
    await expect(
      transport.notify('notification/overflow'),
    ).rejects.toMatchObject({
      code: 'capacity_exceeded',
    });
    await expect(transport.request('request/overflow')).rejects.toMatchObject({
      code: 'capacity_exceeded',
    });
    expect(frames).toHaveLength(1);

    releaseWrite?.();
    await held;
    await transport.close();
    readable.destroy();
    writable.destroy();
  });

  it('skips a queued request after its local wait times out', async () => {
    vi.useFakeTimers();
    try {
      let releaseWrite: (() => void) | undefined;
      const frames: string[] = [];
      const writable = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          frames.push(chunk.toString('utf8'));
          releaseWrite = callback;
        },
      });
      const readable = new PassThrough();
      const transport = new JsonRpcStdioTransport({
        maxPendingWrites: 2,
        readable,
        writable,
      });

      const held = transport.notify('held');
      await Promise.resolve();
      const response = transport.request('must/not/be/sent', undefined, {
        timeoutMs: 25,
      });
      const failure = response.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(25);
      await expect(failure).resolves.toMatchObject({ code: 'request_timeout' });
      releaseWrite?.();
      await held;
      await Promise.resolve();
      expect(frames).toHaveLength(1);

      await transport.close();
      readable.destroy();
      writable.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects duplicate outstanding server request identifiers', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport = new JsonRpcStdioTransport({ readable, writable });
    const incoming = iterator(transport);
    readable.write('{"id":7,"method":"approval","params":{}}\n');
    const request = expectMessage(await incoming.next());
    expect(request).toMatchObject({ kind: 'request', id: 7 });
    readable.write('{"id":7,"method":"approval","params":{}}\n');
    await expect(incoming.next()).rejects.toMatchObject({
      code: 'malformed_message',
    });
    await transport.close();
    readable.destroy();
    writable.destroy();
  });

  it.each([
    ['', 'malformed_message'],
    ['[]', 'malformed_message'],
    ['{"method":1}', 'malformed_message'],
    [
      '{"id":1,"result":{},"error":{"code":1,"message":"x"}}',
      'malformed_message',
    ],
    ['{"jsonrpc":"1.0","method":"event"}', 'malformed_message'],
    ['{"result":{}}', 'malformed_message'],
    ['{"id":{},"result":{}}', 'malformed_message'],
    ['{"id":1,"error":{"code":"bad","message":"x"}}', 'malformed_message'],
    ['{"id":null,"error":"invalid"}', 'malformed_message'],
    ['not-json-sensitive-body', 'malformed_message'],
  ] as const)('fails closed for invalid frame %j', async (line, code) => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport = new JsonRpcStdioTransport({ readable, writable });
    const next = iterator(transport).next();
    readable.write(`${line}\n`);
    const failure = await next.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JsonRpcTransportError);
    expect(failure).toMatchObject({ code });
    expect(JSON.stringify(failure)).not.toContain('sensitive-body');
    await transport.close();
    readable.destroy();
    writable.destroy();
  });

  it('fails closed for invalid UTF-8 and unsupported readable chunks', async () => {
    const invalidUtf8Readable = new PassThrough();
    const invalidUtf8Writable = new PassThrough();
    const invalidUtf8 = new JsonRpcStdioTransport({
      readable: invalidUtf8Readable,
      writable: invalidUtf8Writable,
    });
    const invalidUtf8Next = iterator(invalidUtf8).next();
    invalidUtf8Readable.write(Buffer.from([0xc3, 0x28, 0x0a]));
    await expect(invalidUtf8Next).rejects.toMatchObject({
      code: 'malformed_message',
    });
    await invalidUtf8.close();
    invalidUtf8Readable.destroy();
    invalidUtf8Writable.destroy();

    const unsupportedReadable = new PassThrough();
    const unsupportedWritable = new PassThrough();
    const unsupported = new JsonRpcStdioTransport({
      readable: unsupportedReadable,
      writable: unsupportedWritable,
    });
    const unsupportedNext = iterator(unsupported).next();
    unsupportedReadable.emit('data', { synthetic: true });
    await expect(unsupportedNext).rejects.toMatchObject({
      code: 'stream_failed',
    });
    await unsupported.close();
    unsupportedReadable.destroy();
    unsupportedWritable.destroy();
  });

  it('accepts string chunks and contains diagnostic callback failures', async () => {
    const readable = new PassThrough();
    readable.setEncoding('utf8');
    const writable = new PassThrough();
    const diagnostic = vi.fn(() => {
      throw new Error('synthetic-diagnostic-failure');
    });
    const transport = new JsonRpcStdioTransport({
      onDiagnostic: diagnostic,
      readable,
      writable,
    });

    readable.write('{"id":null,"result":{}}\n');
    readable.write('{"id":404,"result":{}}\n');
    const incoming = iterator(transport);
    readable.write('{"method":"event/after-diagnostic"}\n');
    expect(expectMessage(await incoming.next())).toMatchObject({
      kind: 'notification',
      method: 'event/after-diagnostic',
    });
    expect(diagnostic).toHaveBeenCalledTimes(2);
    await transport.close();
    readable.destroy();
    writable.destroy();
  });

  it('fails closed for oversized and truncated frames', async () => {
    const oversizedReadable = new PassThrough();
    const oversizedWritable = new PassThrough();
    const oversized = new JsonRpcStdioTransport({
      maxMessageBytes: 16,
      readable: oversizedReadable,
      writable: oversizedWritable,
    });
    const oversizedNext = iterator(oversized).next();
    oversizedReadable.write('{"method":"message-that-is-too-large"}\n');
    await expect(oversizedNext).rejects.toMatchObject({
      code: 'message_too_large',
    });
    await oversized.close();
    oversizedReadable.destroy();
    oversizedWritable.destroy();

    const truncatedReadable = new PassThrough();
    const truncatedWritable = new PassThrough();
    const truncated = new JsonRpcStdioTransport({
      readable: truncatedReadable,
      writable: truncatedWritable,
    });
    const truncatedNext = iterator(truncated).next();
    truncatedReadable.end('{"method":"partial"}');
    await expect(truncatedNext).rejects.toMatchObject({
      code: 'truncated_message',
    });
    await truncated.close();
    truncatedReadable.destroy();
    truncatedWritable.destroy();
  });

  it('reports clean EOF and stream failures with bounded diagnostics', async () => {
    const endedReadable = new PassThrough();
    const endedWritable = new PassThrough();
    const ended = new JsonRpcStdioTransport({
      readable: endedReadable,
      writable: endedWritable,
    });
    const endedNext = iterator(ended).next();
    endedReadable.end();
    await expect(endedNext).rejects.toMatchObject({ code: 'stream_ended' });
    await ended.close();
    endedReadable.destroy();
    endedWritable.destroy();

    const failedReadable = new PassThrough();
    const failedWritable = new PassThrough();
    const failed = new JsonRpcStdioTransport({
      readable: failedReadable,
      writable: failedWritable,
    });
    const failedNext = iterator(failed).next();
    failedReadable.destroy(new Error('synthetic-sensitive-stream-detail'));
    const failure = await failedNext.catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'stream_failed' });
    expect(String(failure)).not.toContain('synthetic-sensitive');
    await failed.close();
    failedWritable.destroy();

    const closedReadable = new PassThrough();
    const closedWritable = new PassThrough();
    const closed = new JsonRpcStdioTransport({
      readable: closedReadable,
      writable: closedWritable,
    });
    const closedNext = iterator(closed).next();
    closedReadable.destroy();
    await expect(closedNext).rejects.toMatchObject({ code: 'stream_ended' });
    await closed.close();
    closedWritable.destroy();
  });

  it('awaits writable backpressure and fails safely on write errors', async () => {
    let releaseWrite: (() => void) | undefined;
    const delayedWritable = new Writable({
      write(_chunk, _encoding, callback) {
        releaseWrite = callback;
      },
    });
    const readable = new PassThrough();
    const delayed = new JsonRpcStdioTransport({
      readable,
      writable: delayedWritable,
    });
    let settled = false;
    const notification = delayed.notify('held').then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    releaseWrite?.();
    await notification;
    expect(settled).toBe(true);
    await delayed.close();
    readable.destroy();
    delayedWritable.destroy();

    const failedWritable = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('synthetic-sensitive-write-detail'));
      },
    });
    const failedReadable = new PassThrough();
    const failed = new JsonRpcStdioTransport({
      readable: failedReadable,
      writable: failedWritable,
    });
    const failure = await failed
      .notify('write/fails')
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'write_failed' });
    expect(String(failure)).not.toContain('synthetic-sensitive');
    await failed.close();
    failedReadable.destroy();
    failedWritable.destroy();

    const throwingReadable = new PassThrough();
    const throwingWritable = new PassThrough();
    throwingWritable.write = (() => {
      throw new Error('synthetic-sensitive-synchronous-write-detail');
    }) as typeof throwingWritable.write;
    const throwing = new JsonRpcStdioTransport({
      readable: throwingReadable,
      writable: throwingWritable,
    });
    const throwingFailure = await throwing
      .notify('write/throws')
      .catch((error: unknown) => error);
    expect(throwingFailure).toMatchObject({ code: 'write_failed' });
    expect(String(throwingFailure)).not.toContain('synthetic-sensitive');
    await throwing.close();
    throwingReadable.destroy();
    throwingWritable.destroy();
  });

  it('guards stream errors racing with terminal cleanup without leaking listeners', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const transport = new JsonRpcStdioTransport({ readable, writable });
    expect(() => {
      readable.emit('error', new Error('synthetic-first-stream-error'));
      writable.emit('error', new Error('synthetic-second-stream-error'));
    }).not.toThrow();
    await transport.close();
    expect(readable.listenerCount('error')).toBe(0);
    expect(writable.listenerCount('error')).toBe(0);
    readable.destroy();
    writable.destroy();

    const cleanupReadable = new PassThrough();
    const cleanupWritable = new PassThrough();
    const cleanupTransport = new JsonRpcStdioTransport({
      cleanup() {
        cleanupReadable.destroy(new Error('synthetic-cleanup-readable-error'));
        cleanupWritable.destroy(new Error('synthetic-cleanup-writable-error'));
      },
      readable: cleanupReadable,
      writable: cleanupWritable,
    });
    await cleanupTransport.close();
    expect(cleanupReadable.listenerCount('error')).toBe(0);
    expect(cleanupWritable.listenerCount('error')).toBe(0);
  });

  it('closes once, rejects pending work, and contains cleanup failures', async () => {
    const pair = createPair();
    const response = pair.first.request('pending');
    const responseFailure = response.catch((error: unknown) => error);
    await pair.first.close();
    await pair.first.close();
    await expect(responseFailure).resolves.toMatchObject({
      code: 'transport_closed',
    });
    await expect(pair.first.notify('closed')).rejects.toMatchObject({
      code: 'transport_closed',
    });
    await pair.second.close();
    pair.firstToSecond.destroy();
    pair.secondToFirst.destroy();

    const readable = new PassThrough();
    const writable = new PassThrough();
    const cleanup = vi.fn(() => {
      throw new Error('synthetic-sensitive-cleanup-detail');
    });
    const failedCleanup = new JsonRpcStdioTransport({
      cleanup,
      readable,
      writable,
    });
    const failure = await failedCleanup
      .close()
      .catch((error: unknown) => error);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(failure).toMatchObject({ code: 'cleanup_failed' });
    expect(String(failure)).not.toContain('synthetic-sensitive');
    await expect(failedCleanup.close()).rejects.toMatchObject({
      code: 'cleanup_failed',
    });
    readable.destroy();
    writable.destroy();
  });

  it('rejects invalid API usage without writing ambiguous messages', async () => {
    const pair = createPair();
    expect(() => pair.first.incoming()).not.toThrow();
    expect(() => pair.first.incoming()).toThrow(
      expect.objectContaining({ code: 'consumer_conflict' }),
    );
    await expect(pair.first.notify('')).rejects.toMatchObject({
      code: 'invalid_outbound_message',
    });
    await expect(pair.first.notify('invalid', BigInt(1))).rejects.toMatchObject(
      {
        code: 'invalid_outbound_message',
      },
    );
    await expect(pair.first.respond('unknown', {})).rejects.toMatchObject({
      code: 'response_not_pending',
    });
    await expect(pair.first.respond(1, undefined)).rejects.toMatchObject({
      code: 'invalid_outbound_message',
    });
    await expect(pair.first.respond(Number.NaN, {})).rejects.toMatchObject({
      code: 'invalid_outbound_message',
    });
    await disposePair(pair);
  });

  it('reserves inbound response identifiers before serialization and permits retry', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const frames: Buffer[] = [];
    writable.on('data', (chunk: Buffer) => {
      frames.push(chunk);
    });
    const transport = new JsonRpcStdioTransport({ readable, writable });
    const incoming = iterator(transport);
    readable.write('{"id":8,"method":"approval"}\n');
    const request = expectMessage(await incoming.next());
    if (request.kind !== 'request') throw new Error('Expected a request.');

    let nestedResponse: Promise<void> | undefined;
    await transport.respond(request.id, {
      toJSON() {
        nestedResponse = transport.respond(request.id, { nested: true });
        return { outer: true };
      },
    });
    if (!nestedResponse) throw new Error('Expected a nested response attempt.');
    await expect(nestedResponse).rejects.toMatchObject({
      code: 'response_not_pending',
    });
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]?.toString('utf8') ?? '')).toMatchObject({
      id: 8,
      result: { outer: true },
    });

    readable.write('{"id":9,"method":"approval"}\n');
    const retryRequest = expectMessage(await incoming.next());
    if (retryRequest.kind !== 'request') throw new Error('Expected a request.');
    await expect(
      transport.respond(retryRequest.id, () => undefined),
    ).rejects.toMatchObject({ code: 'invalid_outbound_message' });
    await expect(
      transport.respondError(retryRequest.id, {
        code: 1.5,
        message: 'invalid',
      }),
    ).rejects.toMatchObject({ code: 'invalid_outbound_message' });
    await transport.respond(retryRequest.id, { retry: 'accepted' });
    expect(frames).toHaveLength(2);
    await transport.close();
    readable.destroy();
    writable.destroy();
  });

  it('finishes inbound iteration on explicit close and closes on consumer return', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const closed = new JsonRpcStdioTransport({ readable, writable });
    await closed.close();
    await expect(iterator(closed).next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    readable.destroy();
    writable.destroy();

    const pair = createPair();
    const incoming = iterator(pair.first);
    await pair.second.notify('one');
    expect(expectMessage(await incoming.next())).toMatchObject({
      method: 'one',
    });
    await incoming.return?.();
    await expect(pair.first.notify('closed-by-consumer')).rejects.toMatchObject(
      {
        code: 'transport_closed',
      },
    );
    await disposePair(pair);

    const unstartedPair = createPair();
    const unstarted = iterator(unstartedPair.first);
    await unstarted.return?.();
    await expect(
      unstartedPair.first.notify('closed-before-next'),
    ).rejects.toMatchObject({ code: 'transport_closed' });
    await disposePair(unstartedPair);
  });

  it('validates limits before attaching to streams', () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    expect(
      () =>
        new JsonRpcStdioTransport({
          maxBufferedMessages: 0,
          readable,
          writable,
        }),
    ).toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
    expect(
      () =>
        new JsonRpcStdioTransport({
          readable,
          requestTimeoutMs: 2_147_483_648,
          writable,
        }),
    ).toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
    readable.destroy();
    writable.destroy();
  });
});
