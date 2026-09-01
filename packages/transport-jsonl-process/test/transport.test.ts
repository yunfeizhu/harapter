import { once } from 'node:events';
import { PassThrough, Readable, Writable } from 'node:stream';
import { setImmediate as scheduleImmediate } from 'node:timers/promises';
import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  JsonlProcessTransport,
  JsonlTransportError,
  type JsonlMessage,
  type JsonlProcessTransportOptions,
} from '../src/index.js';

class ControlledWritable extends Writable {
  readonly frames: string[] = [];
  private readonly callbacks: ((error?: Error | null) => void)[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.frames.push(chunk.toString('utf8'));
    this.callbacks.push(callback);
  }

  release(error?: Error): void {
    const callback = this.callbacks.shift();
    if (!callback) throw new Error('No pending write.');
    callback(error);
  }
}

function createTransport(
  overrides: Partial<JsonlProcessTransportOptions> = {},
): {
  readonly inbound: PassThrough;
  readonly outbound: PassThrough;
  readonly transport: JsonlProcessTransport;
} {
  const inbound = new PassThrough();
  const outbound = new PassThrough();
  return {
    inbound,
    outbound,
    transport: new JsonlProcessTransport({
      readable: inbound,
      writable: outbound,
      ...overrides,
    }),
  };
}

function expectMessage(result: IteratorResult<JsonlMessage>): JsonlMessage {
  expect(result.done).toBe(false);
  if (result.done) throw new Error('Expected an inbound message.');
  return result.value;
}

async function expectTransportError(
  promise: Promise<unknown>,
  code: JsonlTransportError['code'],
): Promise<JsonlTransportError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(JsonlTransportError);
    expect(error).toMatchObject({ code });
    return error as JsonlTransportError;
  }
  throw new Error('Expected a transport error.');
}

describe('JsonlProcessTransport inbound framing', () => {
  it('decodes fragmented UTF-8 and only treats LF as a delimiter', async () => {
    const { inbound, transport } = createTransport();
    const iterator = transport.incoming()[Symbol.asyncIterator]();
    const frame = Buffer.from('{"text":"a\u2028b\u2029😀"}\r\n', 'utf8');
    const emoji = Buffer.from('😀');
    const split = frame.indexOf(emoji) + 2;
    inbound.write(frame.subarray(0, split));
    inbound.write(frame.subarray(split));

    expect(expectMessage(await iterator.next())).toEqual({
      text: 'a\u2028b\u2029😀',
    });

    await transport.close();
  });

  it('delivers string and Uint8Array chunks to a waiting consumer', async () => {
    const readable = new Readable({ read: vi.fn() });
    const transport = new JsonlProcessTransport({
      readable,
      writable: new PassThrough(),
    });
    const iterator = transport.incoming()[Symbol.asyncIterator]();
    const stringMessage = iterator.next();
    readable.emit('data', '{"kind":"string"}\n');
    expect(expectMessage(await stringMessage)).toEqual({ kind: 'string' });

    const bytesMessage = iterator.next();
    readable.emit(
      'data',
      Uint8Array.from(Buffer.from('{"kind":"bytes"}\n', 'utf8')),
    );
    expect(expectMessage(await bytesMessage)).toEqual({ kind: 'bytes' });
    await transport.close();
  });

  it.each([
    ['empty frame', Buffer.from('\n'), 'malformed_message'],
    ['invalid JSON', Buffer.from('{nope}\n'), 'malformed_message'],
    ['invalid UTF-8', Buffer.from([0xc3, 0x28, 0x0a]), 'malformed_message'],
    ['array envelope', Buffer.from('[]\n'), 'malformed_message'],
    ['primitive envelope', Buffer.from('true\n'), 'malformed_message'],
  ] as const)('fails closed for an %s', async (_name, frame, code) => {
    const { inbound, transport } = createTransport();
    const next = transport.incoming()[Symbol.asyncIterator]().next();
    inbound.write(frame);

    const error = await expectTransportError(next, code);
    expect(error.message).not.toContain(frame.toString('utf8'));
    await transport.close();
  });

  it('bounds complete and fragmented inbound frames', async () => {
    const complete = createTransport({ maxMessageBytes: 7 });
    const completeNext = complete.transport
      .incoming()
      [Symbol.asyncIterator]()
      .next();
    complete.inbound.write('{"x":12}\n');
    const completeError = await expectTransportError(
      completeNext,
      'message_too_large',
    );
    expect(completeError.code).toBe('message_too_large');
    await complete.transport.close();

    const fragmented = createTransport({ maxMessageBytes: 7 });
    const fragmentedNext = fragmented.transport
      .incoming()
      [Symbol.asyncIterator]()
      .next();
    fragmented.inbound.write('{"x":');
    fragmented.inbound.write('12}');
    const fragmentedError = await expectTransportError(
      fragmentedNext,
      'message_too_large',
    );
    expect(fragmentedError.code).toBe('message_too_large');
    await fragmented.transport.close();
  });

  it('accepts an exact-limit JSON object with a CRLF delimiter', async () => {
    const { inbound, transport } = createTransport({ maxMessageBytes: 7 });
    const next = transport.incoming()[Symbol.asyncIterator]().next();
    inbound.write('{"x":1}\r\n');

    expect(expectMessage(await next)).toEqual({ x: 1 });
    await transport.close();
  });

  it('distinguishes truncated input from an unexpected clean boundary', async () => {
    const truncated = createTransport();
    const truncatedNext = truncated.transport
      .incoming()
      [Symbol.asyncIterator]()
      .next();
    truncated.inbound.end('{"type":"event"}');
    const truncatedError = await expectTransportError(
      truncatedNext,
      'truncated_message',
    );
    expect(truncatedError.code).toBe('truncated_message');
    await truncated.transport.close();

    const ended = createTransport();
    const endedNext = ended.transport.incoming()[Symbol.asyncIterator]().next();
    ended.inbound.end();
    const endedError = await expectTransportError(endedNext, 'stream_ended');
    expect(endedError.code).toBe('stream_ended');
    await ended.transport.close();
  });

  it('drains complete frames received before an unexpected EOF', async () => {
    const { inbound, transport } = createTransport();
    const iterator = transport.incoming()[Symbol.asyncIterator]();
    inbound.write('{"type":"progress"}\n');
    expect(expectMessage(await iterator.next())).toEqual({ type: 'progress' });

    const ended = once(inbound, 'end');
    inbound.end('{"type":"terminal"}\n');
    await ended;
    expect(expectMessage(await iterator.next())).toEqual({ type: 'terminal' });
    const error = await expectTransportError(iterator.next(), 'stream_ended');
    expect(error.code).toBe('stream_ended');
    await transport.close();
  });

  it('fails when unread inbound capacity is exceeded', async () => {
    const { inbound, transport } = createTransport({ maxBufferedMessages: 1 });
    inbound.write('{"sequence":1}\n{"sequence":2}\n');

    const iterator = transport.incoming()[Symbol.asyncIterator]();
    expect(expectMessage(await iterator.next())).toEqual({ sequence: 1 });
    const error = await expectTransportError(
      iterator.next(),
      'capacity_exceeded',
    );
    expect(error.code).toBe('capacity_exceeded');
    await transport.close();
  });

  it('allows exactly one inbound consumer', async () => {
    const { transport } = createTransport();
    transport.incoming();
    expect(() => transport.incoming()).toThrow(
      expect.objectContaining({ code: 'consumer_conflict' }),
    );
    await transport.close();
  });

  it('closes when the sole inbound consumer returns', async () => {
    const { transport } = createTransport();
    const iterator = transport.incoming()[Symbol.asyncIterator]();
    await iterator.return?.();
    expect(transport.isOpen()).toBe(false);
  });

  it('closes before propagating an inbound consumer throw', async () => {
    const { transport } = createTransport();
    const iterator = transport.incoming()[Symbol.asyncIterator]();
    const sentinel = new Error('consumer stopped');

    await expect(iterator.throw?.(sentinel)).rejects.toBe(sentinel);
    expect(transport.isOpen()).toBe(false);
  });
});

describe('JsonlProcessTransport outbound writes', () => {
  it('serializes one bounded JSON object per LF-delimited frame', async () => {
    const { outbound, transport } = createTransport();
    const frames: string[] = [];
    outbound.on('data', (chunk: Buffer) => frames.push(chunk.toString('utf8')));

    await transport.send({ id: 'one', type: 'prompt' });
    expect(frames).toEqual(['{"id":"one","type":"prompt"}\n']);
    await transport.close();
  });

  it.each([
    ['array', []],
    ['primitive', true],
    ['undefined', undefined],
    [
      'circular value',
      (() => {
        const value: Record<string, unknown> = {};
        value['self'] = value;
        return value;
      })(),
    ],
    ['object converted to a primitive', { toJSON: () => 'hidden' }],
  ])('rejects an invalid outbound %s', async (_name, value) => {
    const { transport } = createTransport();
    const error = await expectTransportError(
      transport.send(value as JsonlMessage),
      'invalid_outbound_message',
    );
    expect(error.code).toBe('invalid_outbound_message');
    await transport.close();
  });

  it('rejects an oversized outbound frame without closing', async () => {
    const { transport } = createTransport({ maxMessageBytes: 7 });
    await expectTransportError(transport.send({ x: 12 }), 'message_too_large');
    expect(transport.isOpen()).toBe(true);
    await transport.close();
  });

  it('serializes pending writes and enforces their capacity', async () => {
    const readable = new PassThrough();
    const writable = new ControlledWritable();
    const transport = new JsonlProcessTransport({
      maxPendingWrites: 2,
      readable,
      writable,
    });

    const first = transport.send({ sequence: 1 });
    const second = transport.send({ sequence: 2 });
    await expectTransportError(
      transport.send({ sequence: 3 }),
      'capacity_exceeded',
    );
    expect(writable.frames).toEqual(['{"sequence":1}\n']);
    writable.release();
    await first;
    await vi.waitFor(() => {
      expect(writable.frames).toEqual(['{"sequence":1}\n', '{"sequence":2}\n']);
    });
    writable.release();
    await second;
    await transport.close();
  });

  it('skips a locally aborted write that has not started', async () => {
    const readable = new PassThrough();
    const writable = new ControlledWritable();
    const transport = new JsonlProcessTransport({ readable, writable });
    const controller = new AbortController();
    const first = transport.send({ sequence: 1 });
    const second = transport.send(
      { sequence: 2 },
      { signal: controller.signal },
    );
    controller.abort();

    await expectTransportError(second, 'write_aborted');
    writable.release();
    await first;
    await scheduleImmediate();
    expect(writable.frames).toHaveLength(1);
    await transport.close();
  });

  it('rejects an already-aborted write before enqueueing it', async () => {
    const { transport } = createTransport();
    const controller = new AbortController();
    controller.abort();

    const error = await expectTransportError(
      transport.send({ sequence: 1 }, { signal: controller.signal }),
      'write_aborted',
    );
    expect(error.code).toBe('write_aborted');
    await transport.close();
  });

  it('does not retract a write that started before local abort', async () => {
    const readable = new PassThrough();
    const writable = new ControlledWritable();
    const transport = new JsonlProcessTransport({ readable, writable });
    const controller = new AbortController();
    const first = transport.send(
      { sequence: 1 },
      { signal: controller.signal },
    );
    const second = transport.send({ sequence: 2 });
    await vi.waitFor(() => {
      expect(writable.frames).toHaveLength(1);
    });
    controller.abort();

    await expectTransportError(first, 'write_aborted');
    expect(writable.frames).toEqual(['{"sequence":1}\n']);
    writable.release();
    await vi.waitFor(() => {
      expect(writable.frames).toHaveLength(2);
    });
    writable.release();
    await second;
    await transport.close();
  });

  it('times out a local write wait without claiming remote cancellation', async () => {
    const readable = new PassThrough();
    const writable = new ControlledWritable();
    const transport = new JsonlProcessTransport({
      readable,
      writable,
      writeTimeoutMs: 20,
    });
    const send = transport.send({ sequence: 1 });

    await expectTransportError(send, 'write_timeout');
    expect(writable.frames).toEqual(['{"sequence":1}\n']);
    writable.release();
    await transport.close();
  });
});

describe('JsonlProcessTransport lifecycle', () => {
  it('keeps error serialization and inspection content-free', () => {
    const error = new JsonlTransportError(
      'stream_failed',
      'A transport stream reported a failure.',
    );

    expect(error.toJSON()).toEqual({
      code: 'stream_failed',
      message: 'A transport stream reported a failure.',
      name: 'JsonlTransportError',
    });
    expect(inspect(error)).toBe(
      'JsonlTransportError [stream_failed]: A transport stream reported a failure.',
    );
  });

  it('rejects unsupported readable chunks without exposing them', async () => {
    const readable = new Readable({ read: vi.fn() });
    const writable = new PassThrough();
    const transport = new JsonlProcessTransport({ readable, writable });
    const next = transport.incoming()[Symbol.asyncIterator]().next();
    readable.emit('data', { secret: 'do-not-expose' });

    const error = await expectTransportError(next, 'stream_failed');
    expect(error.message).not.toContain('secret');
    await transport.close();
  });

  it('recognizes a readable that ended before construction', async () => {
    const readable = new PassThrough();
    const ended = once(readable, 'end');
    readable.resume();
    readable.end();
    await ended;
    const transport = new JsonlProcessTransport({
      readable,
      writable: new PassThrough(),
    });

    expect(transport.isOpen()).toBe(false);
    const error = await expectTransportError(
      transport.incoming()[Symbol.asyncIterator]().next(),
      'stream_ended',
    );
    expect(error.code).toBe('stream_ended');
    await transport.close();
  });

  it('maps stream and write failures to content-free errors', async () => {
    const inbound = createTransport();
    const next = inbound.transport.incoming()[Symbol.asyncIterator]().next();
    inbound.inbound.emit('error', new Error('sensitive inbound failure'));
    const inboundError = await expectTransportError(next, 'stream_failed');
    expect(inboundError.message).not.toContain('sensitive');
    await inbound.transport.close();

    const readable = new PassThrough();
    const writable = new ControlledWritable();
    const outbound = new JsonlProcessTransport({ readable, writable });
    const send = outbound.send({ type: 'prompt' });
    await vi.waitFor(() => {
      expect(writable.frames).toHaveLength(1);
    });
    writable.release(new Error('sensitive write failure'));
    const outboundError = await expectTransportError(send, 'write_failed');
    expect(outboundError.message).not.toContain('sensitive');
    await outbound.close();
  });

  it('maps unexpected stream closure and unpaired writable errors', async () => {
    const closed = createTransport();
    const closedNext = closed.transport
      .incoming()
      [Symbol.asyncIterator]()
      .next();
    closed.inbound.emit('close');
    const closeError = await expectTransportError(closedNext, 'stream_ended');
    expect(closeError.code).toBe('stream_ended');
    await closed.transport.close();

    const failed = createTransport();
    const failedNext = failed.transport
      .incoming()
      [Symbol.asyncIterator]()
      .next();
    failed.outbound.emit('error', new Error('sensitive writable error'));
    const writeError = await expectTransportError(failedNext, 'stream_failed');
    expect(writeError.code).toBe('stream_failed');
    await failed.transport.close();
  });

  it('contains stream errors that race with terminal cleanup', async () => {
    let finishCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const { inbound, transport } = createTransport({
      cleanup: () => cleanup,
    });
    const close = transport.close();

    expect(() =>
      inbound.emit('error', new Error('late stream error')),
    ).not.toThrow();
    finishCleanup?.();
    await close;
  });

  it('keeps the terminal guard until an active write callback settles', async () => {
    const readable = new PassThrough();
    const writable = new ControlledWritable();
    const transport = new JsonlProcessTransport({ readable, writable });
    const send = transport.send({ type: 'prompt' });
    await vi.waitFor(() => {
      expect(writable.frames).toHaveLength(1);
    });

    const close = transport.close();
    const sendError = await expectTransportError(send, 'transport_closed');
    expect(sendError.code).toBe('transport_closed');
    expect(writable.listenerCount('error')).toBeGreaterThan(0);
    writable.release(new Error('late write failure'));
    await close;
    expect(writable.listenerCount('error')).toBe(0);
  });

  it('closes idempotently, preserves caller streams, and cleans up once', async () => {
    const cleanup = vi.fn(() => Promise.resolve());
    const { inbound, outbound, transport } = createTransport({ cleanup });
    const next = transport.incoming()[Symbol.asyncIterator]().next();

    await Promise.all([transport.close(), transport.close()]);
    await expect(next).resolves.toEqual({ done: true, value: undefined });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(inbound.destroyed).toBe(false);
    expect(outbound.destroyed).toBe(false);
    await expectTransportError(
      transport.send({ type: 'late' }),
      'transport_closed',
    );
  });

  it('reports cleanup failure without rerunning cleanup', async () => {
    const cleanup = vi.fn(() => {
      throw new Error('sensitive cleanup failure');
    });
    const { transport } = createTransport({ cleanup });

    const error = await expectTransportError(
      transport.close(),
      'cleanup_failed',
    );
    expect(error.message).not.toContain('sensitive');
    await expectTransportError(transport.close(), 'cleanup_failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['maxMessageBytes', 0],
    ['maxBufferedMessages', Number.NaN],
    ['maxPendingWrites', Number.MAX_SAFE_INTEGER + 1],
    ['writeTimeoutMs', 2_147_483_648],
  ] as const)('rejects invalid %s configuration', (key, value) => {
    const inbound = new PassThrough();
    const outbound = new PassThrough();
    expect(
      () =>
        new JsonlProcessTransport({
          readable: inbound,
          writable: outbound,
          [key]: value,
        }),
    ).toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
  });
});
