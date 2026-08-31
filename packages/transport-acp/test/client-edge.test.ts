import { PassThrough, type TransformCallback } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  AcpClient,
  type AcpClientOptions,
  type AcpEvent,
} from '../src/index.js';

type JsonRecord = Record<string, unknown>;

class FrameReader {
  private buffer = '';
  private readonly frames: JsonRecord[] = [];
  private readonly waiters: ((value: JsonRecord) => void)[] = [];

  constructor(stream: PassThrough) {
    stream.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) return;
        const value: unknown = JSON.parse(this.buffer.slice(0, newline));
        this.buffer = this.buffer.slice(newline + 1);
        if (!isRecord(value)) throw new Error('Expected a JSON object.');
        const waiter = this.waiters.shift();
        if (waiter) waiter(value);
        else this.frames.push(value);
      }
    });
  }

  next(): Promise<JsonRecord> {
    const value = this.frames.shift();
    if (value) return Promise.resolve(value);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

class GatedPassThrough extends PassThrough {
  private gateNextWrite = false;
  private releaseCallback: TransformCallback | undefined;

  holdNextWrite(): void {
    this.gateNextWrite = true;
  }

  releaseWrite(): void {
    const callback = this.releaseCallback;
    if (!callback) throw new Error('Expected a gated ACP write.');
    this.releaseCallback = undefined;
    callback();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.push(chunk);
    if (this.gateNextWrite) {
      this.gateNextWrite = false;
      this.releaseCallback = callback;
    } else {
      callback();
    }
  }
}

interface Harness {
  readonly client: AcpClient;
  readonly inbound: PassThrough;
  readonly outbound: PassThrough;
  readonly frames: FrameReader;
}

function createHarness(
  options: Partial<AcpClientOptions> = {},
  outbound = new PassThrough(),
): Harness {
  const inbound = new PassThrough();
  return {
    client: new AcpClient({
      ...options,
      readable: inbound,
      writable: outbound,
    }),
    frames: new FrameReader(outbound),
    inbound,
    outbound,
  };
}

async function initialize(
  value: Harness,
  agentCapabilities: JsonRecord = {},
): Promise<void> {
  const result = value.client.initialize();
  const request = await value.frames.next();
  value.inbound.write(
    `${JSON.stringify({
      id: request['id'],
      jsonrpc: '2.0',
      result: { agentCapabilities, protocolVersion: 1 },
    })}\n`,
  );
  await result;
}

async function respondEmpty(value: Harness, pending: Promise<unknown>) {
  const frame = await value.frames.next();
  value.inbound.write(
    `${JSON.stringify({ id: frame['id'], jsonrpc: '2.0', result: {} })}\n`,
  );
  return pending;
}

async function dispose(value: Harness): Promise<void> {
  await value.client.close();
  value.inbound.destroy();
  value.outbound.destroy();
}

function eventValue(result: IteratorResult<AcpEvent>): AcpEvent {
  if (result.done) throw new Error('Expected an ACP event.');
  return result.value;
}

function activeHandlerTaskCount(client: AcpClient): number {
  return (
    client as unknown as {
      readonly handlerTasks: ReadonlySet<Promise<void>>;
    }
  ).handlerTasks.size;
}

describe('AcpClient edge behavior', () => {
  it('supports advertised load, resume, delete, and extension methods', async () => {
    const value = createHarness();
    await initialize(value, {
      loadSession: true,
      sessionCapabilities: { delete: {}, resume: {} },
    });

    const load = value.client.loadSession({
      cwd: '/synthetic/workspace',
      mcpServers: [],
      sessionId: 'synthetic-session',
    });
    const loadFrame = await value.frames.next();
    expect(loadFrame['method']).toBe('session/load');
    value.inbound.write(
      `${JSON.stringify({
        id: loadFrame['id'],
        jsonrpc: '2.0',
        result: { modes: null },
      })}\n`,
    );
    await expect(load).resolves.toEqual({ modes: null });

    const resume = value.client.resumeSession({
      cwd: '/synthetic/workspace',
      sessionId: 'synthetic-session',
    });
    const resumeFrame = await value.frames.next();
    expect(resumeFrame['method']).toBe('session/resume');
    value.inbound.write(
      `${JSON.stringify({
        id: resumeFrame['id'],
        jsonrpc: '2.0',
        result: { configOptions: [] },
      })}\n`,
    );
    await expect(resume).resolves.toEqual({ configOptions: [] });

    await expect(
      respondEmpty(value, value.client.deleteSession('synthetic-session')),
    ).resolves.toEqual({});

    const extension = value.client.requestExtension<{ readonly ok: boolean }>(
      '_synthetic.dev/status',
      { synthetic: true },
    );
    const extensionFrame = await value.frames.next();
    value.inbound.write(
      `${JSON.stringify({
        id: extensionFrame['id'],
        jsonrpc: '2.0',
        result: { ok: true },
      })}\n`,
    );
    await expect(extension).resolves.toEqual({ ok: true });
    await value.client.notifyExtension('_synthetic.dev/observed', {});
    expect(await value.frames.next()).toMatchObject({
      method: '_synthetic.dev/observed',
    });
    await dispose(value);
  });

  it('rejects unsupported optional methods and duplicate initialization', async () => {
    const value = createHarness();
    const first = value.client.initialize();
    expect(value.client.initialize()).toBe(first);
    const frame = await value.frames.next();
    value.inbound.write(
      `${JSON.stringify({
        id: frame['id'],
        jsonrpc: '2.0',
        result: { protocolVersion: 1 },
      })}\n`,
    );
    await first;
    await expect(value.client.initialize()).rejects.toMatchObject({
      code: 'already_initialized',
    });
    await expect(
      value.client.loadSession({
        cwd: '/synthetic/workspace',
        mcpServers: [],
        sessionId: 'synthetic-session',
      }),
    ).rejects.toMatchObject({ code: 'capability_not_advertised' });
    await expect(
      value.client.deleteSession('synthetic-session'),
    ).rejects.toMatchObject({ code: 'capability_not_advertised' });
    await expect(
      value.client.requestExtension('session/not-an-extension'),
    ).rejects.toMatchObject({ code: 'invalid_params' });
    await dispose(value);
  });

  it('fails the connection when a known response or notification is malformed', async () => {
    const responseValue = createHarness();
    await initialize(responseValue);
    const prompt = responseValue.client.prompt({
      prompt: [{ text: 'synthetic', type: 'text' }],
      sessionId: 'synthetic-session',
    });
    const promptFrame = await responseValue.frames.next();
    responseValue.inbound.write(
      `${JSON.stringify({
        id: promptFrame['id'],
        jsonrpc: '2.0',
        result: { stopReason: 'future-success' },
      })}\n`,
    );
    await expect(prompt).rejects.toMatchObject({ code: 'invalid_message' });
    expect(responseValue.client.isOpen()).toBe(false);
    responseValue.inbound.destroy();
    responseValue.outbound.destroy();

    const notificationValue = createHarness();
    await initialize(notificationValue);
    const events = notificationValue.client.events()[Symbol.asyncIterator]();
    notificationValue.inbound.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'synthetic-session',
          update: { sessionUpdate: 'agent_message_chunk' },
        },
      })}\n`,
    );
    await expect(events.next()).rejects.toMatchObject({
      code: 'invalid_message',
    });
    notificationValue.inbound.destroy();
    notificationValue.outbound.destroy();
  });

  it('handles selected, malformed, missing, and failed permission handlers safely', async () => {
    const selected = createHarness({
      requestPermission: () => ({
        optionId: 'allow-once',
        outcome: 'selected',
      }),
    });
    await initialize(selected);
    selected.inbound.write(
      `${JSON.stringify({
        id: 'permission-1',
        jsonrpc: '2.0',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'allow_once', name: 'Allow', optionId: 'allow-once' },
          ],
          sessionId: 'synthetic-session',
          toolCall: { toolCallId: 'tool-1' },
        },
      })}\n`,
    );
    await expect(selected.frames.next()).resolves.toMatchObject({
      id: 'permission-1',
      result: { outcome: { optionId: 'allow-once', outcome: 'selected' } },
    });
    await dispose(selected);

    const missing = createHarness();
    await initialize(missing);
    missing.inbound.write(
      '{"id":2,"jsonrpc":"2.0","method":"session/request_permission","params":{}}\n',
    );
    expect(await missing.frames.next()).toMatchObject({
      error: { code: -32_602 },
      id: 2,
    });
    missing.inbound.write(
      `${JSON.stringify({
        id: 3,
        jsonrpc: '2.0',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
          ],
          sessionId: 'synthetic-session',
          toolCall: { toolCallId: 'tool-2' },
        },
      })}\n`,
    );
    expect(await missing.frames.next()).toMatchObject({
      error: { code: -32_601 },
      id: 3,
    });
    await dispose(missing);

    const failed = createHarness({
      requestPermission: () => {
        throw new Error('synthetic sensitive failure');
      },
    });
    await initialize(failed);
    failed.inbound.write(
      `${JSON.stringify({
        id: 4,
        jsonrpc: '2.0',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
          ],
          sessionId: 'synthetic-session',
          toolCall: { toolCallId: 'tool-3' },
        },
      })}\n`,
    );
    const failure = await failed.frames.next();
    expect(failure).toMatchObject({ error: { code: -32_603 }, id: 4 });
    expect(JSON.stringify(failure)).not.toContain('sensitive');
    await dispose(failed);
  });

  it('routes extensions explicitly and observes unknown requests safely', async () => {
    const notifications: string[] = [];
    const value = createHarness({
      extensionNotification: (method) => notifications.push(method),
      extensionRequest: (method) => ({ observed: method }),
    });
    await initialize(value);
    const events = value.client.events()[Symbol.asyncIterator]();
    value.inbound.write(
      '{"jsonrpc":"2.0","method":"_synthetic.dev/event","params":{"secret":"redacted"}}\n',
    );
    expect(eventValue(await events.next())).toMatchObject({
      kind: 'unknown',
      observation: { method: '_synthetic.dev/event' },
    });
    expect(notifications).toEqual(['_synthetic.dev/event']);

    value.inbound.write(
      '{"id":7,"jsonrpc":"2.0","method":"_synthetic.dev/request","params":{}}\n',
    );
    expect(await value.frames.next()).toMatchObject({
      id: 7,
      result: { observed: '_synthetic.dev/request' },
    });
    value.inbound.write(
      '{"id":8,"jsonrpc":"2.0","method":"future/request","params":{"secret":"redacted"}}\n',
    );
    expect(eventValue(await events.next())).toMatchObject({
      kind: 'unknown',
      observation: { kind: 'unknown_request' },
    });
    expect(await value.frames.next()).toMatchObject({
      error: { code: -32_601 },
      id: 8,
    });
    await dispose(value);
  });

  it('contains failing extension callbacks and invalid permission decisions', async () => {
    const value = createHarness({
      extensionNotification: () => {
        throw new Error('synthetic observer failure');
      },
      extensionRequest: () => {
        throw new Error('synthetic request failure');
      },
      requestPermission: () => ({
        optionId: 'not-advertised',
        outcome: 'selected',
      }),
    });
    await initialize(value);
    const events = value.client.events()[Symbol.asyncIterator]();
    value.inbound.write(
      '{"jsonrpc":"2.0","method":"_synthetic.dev/event","params":{}}\n',
    );
    expect(eventValue(await events.next())).toMatchObject({ kind: 'unknown' });

    value.inbound.write(
      '{"id":21,"jsonrpc":"2.0","method":"_synthetic.dev/request","params":{}}\n',
    );
    expect(await value.frames.next()).toMatchObject({
      error: { code: -32_603 },
      id: 21,
    });
    value.inbound.write(
      `${JSON.stringify({
        id: 22,
        jsonrpc: '2.0',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'allow_once', name: 'Allow', optionId: 'allow-once' },
          ],
          sessionId: 'synthetic-session',
          toolCall: { toolCallId: 'tool-22' },
        },
      })}\n`,
    );
    expect(await value.frames.next()).toMatchObject({
      error: { code: -32_603 },
      id: 22,
    });
    await dispose(value);
  });

  it('contains rejected asynchronous extension notification observers', async () => {
    const value = createHarness({
      extensionNotification: () =>
        Promise.reject(new Error('synthetic asynchronous observer failure')),
    });
    await initialize(value);
    const events = value.client.events()[Symbol.asyncIterator]();
    value.inbound.write(
      '{"jsonrpc":"2.0","method":"_synthetic.dev/async-event","params":{}}\n',
    );
    expect(eventValue(await events.next())).toMatchObject({ kind: 'unknown' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(value.client.isOpen()).toBe(true);
    await dispose(value);
  });

  it('answers permission requests racing after cancellation as cancelled', async () => {
    const value = createHarness({
      requestPermission: () => ({ outcome: 'cancelled' }),
    });
    await initialize(value);
    const prompt = value.client.prompt({
      prompt: [{ text: 'synthetic', type: 'text' }],
      sessionId: 'synthetic-session',
    });
    const promptFrame = await value.frames.next();
    await value.client.cancelSession('synthetic-session');
    expect(await value.frames.next()).toMatchObject({
      method: 'session/cancel',
    });
    value.inbound.write(
      `${JSON.stringify({
        id: 31,
        jsonrpc: '2.0',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
          ],
          sessionId: 'synthetic-session',
          toolCall: { toolCallId: 'tool-31' },
        },
      })}\n`,
    );
    expect(await value.frames.next()).toMatchObject({
      id: 31,
      result: { outcome: { outcome: 'cancelled' } },
    });
    value.inbound.write(
      `${JSON.stringify({
        id: promptFrame['id'],
        jsonrpc: '2.0',
        result: { stopReason: 'cancelled' },
      })}\n`,
    );
    await prompt;
    await dispose(value);
  });

  it('keeps a Session cancelling until the prompt and cancel write both settle', async () => {
    let permissionCalls = 0;
    const outbound = new GatedPassThrough();
    const value = createHarness(
      {
        requestPermission: () => {
          permissionCalls += 1;
          return new Promise(() => undefined);
        },
      },
      outbound,
    );
    await initialize(value);
    const prompt = value.client.prompt({
      prompt: [{ text: 'synthetic', type: 'text' }],
      sessionId: 'synthetic-session',
    });
    const promptFrame = await value.frames.next();
    value.inbound.write(
      `${JSON.stringify({
        id: 41,
        jsonrpc: '2.0',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
          ],
          sessionId: 'synthetic-session',
          toolCall: { toolCallId: 'tool-41' },
        },
      })}\n`,
    );
    await vi.waitFor(() => {
      expect(permissionCalls).toBe(1);
    });
    expect(activeHandlerTaskCount(value.client)).toBe(1);

    outbound.holdNextWrite();
    const cancelling = value.client.cancelSession('synthetic-session');
    expect(await value.frames.next()).toMatchObject({
      id: 41,
      result: { outcome: { outcome: 'cancelled' } },
    });
    await vi.waitFor(() => {
      expect(activeHandlerTaskCount(value.client)).toBe(0);
    });
    value.inbound.write(
      `${JSON.stringify({
        id: promptFrame['id'],
        jsonrpc: '2.0',
        result: { stopReason: 'cancelled' },
      })}\n`,
    );
    await prompt;

    const conflict = value.client.prompt({
      prompt: [{ text: 'must remain blocked', type: 'text' }],
      sessionId: 'synthetic-session',
    });
    let conflictError: unknown;
    void conflict.catch((error: unknown) => {
      conflictError = error;
    });
    await vi.waitFor(() => {
      expect(conflictError).toMatchObject({ code: 'invalid_params' });
    });

    value.inbound.write(
      `${JSON.stringify({
        id: 42,
        jsonrpc: '2.0',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
          ],
          sessionId: 'synthetic-session',
          toolCall: { toolCallId: 'tool-42' },
        },
      })}\n`,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(permissionCalls).toBe(1);

    outbound.releaseWrite();
    expect(await value.frames.next()).toMatchObject({
      id: 42,
      result: { outcome: { outcome: 'cancelled' } },
    });
    expect(await value.frames.next()).toMatchObject({
      method: 'session/cancel',
    });
    await cancelling;
    await dispose(value);
  });

  it('settles pending Session permissions before authoritative close', async () => {
    let resolvePermission: (() => void) | undefined;
    const value = createHarness({
      requestPermission: async () => {
        await new Promise<void>((resolve) => {
          resolvePermission = resolve;
        });
        return { outcome: 'cancelled' };
      },
    });
    await initialize(value, { sessionCapabilities: { close: {} } });
    value.inbound.write(
      `${JSON.stringify({
        id: 51,
        jsonrpc: '2.0',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
          ],
          sessionId: 'synthetic-session',
          toolCall: { toolCallId: 'tool-51' },
        },
      })}\n`,
    );
    await vi.waitFor(() => {
      expect(resolvePermission).toBeTypeOf('function');
    });

    const closing = value.client.closeSession('synthetic-session');
    expect(await value.frames.next()).toMatchObject({
      id: 51,
      result: { outcome: { outcome: 'cancelled' } },
    });
    const closeFrame = await value.frames.next();
    expect(closeFrame['method']).toBe('session/close');
    value.inbound.write(
      `${JSON.stringify({
        id: closeFrame['id'],
        jsonrpc: '2.0',
        result: {},
      })}\n`,
    );
    await closing;
    resolvePermission?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    value.inbound.write(
      '{"id":51,"jsonrpc":"2.0","method":"future/request","params":{}}\n',
    );
    expect(await value.frames.next()).toMatchObject({
      error: { code: -32_601 },
      id: 51,
    });
    await dispose(value);
  });

  it('enforces one prompt and one event consumer per connection', async () => {
    const value = createHarness();
    await initialize(value);
    const prompt = value.client.prompt({
      prompt: [{ text: 'first', type: 'text' }],
      sessionId: 'synthetic-session',
    });
    const promptFrame = await value.frames.next();
    await expect(
      value.client.prompt({
        prompt: [{ text: 'second', type: 'text' }],
        sessionId: 'synthetic-session',
      }),
    ).rejects.toMatchObject({ code: 'invalid_params' });
    value.inbound.write(
      `${JSON.stringify({
        id: promptFrame['id'],
        jsonrpc: '2.0',
        result: { stopReason: 'end_turn' },
      })}\n`,
    );
    await prompt;

    const events = value.client.events();
    expect(() => value.client.events()).toThrow(
      expect.objectContaining({ code: 'invalid_configuration' }),
    );
    await events.return?.();
    expect(value.client.isOpen()).toBe(false);
    value.inbound.destroy();
    value.outbound.destroy();
  });

  it('settles concurrent event reads in order without losing a waiter', async () => {
    const value = createHarness();
    await initialize(value);
    const events = value.client.events()[Symbol.asyncIterator]();
    const first = events.next();
    const second = events.next();
    value.inbound.write(
      '{"jsonrpc":"2.0","method":"future/first","params":{}}\n',
    );
    value.inbound.write(
      '{"jsonrpc":"2.0","method":"future/second","params":{}}\n',
    );
    await expect(first).resolves.toMatchObject({ done: false });
    await expect(second).resolves.toMatchObject({ done: false });
    await dispose(value);
  });

  it('requires authoritative Session closure after a prompt wait detaches', async () => {
    const value = createHarness();
    await initialize(value, { sessionCapabilities: { close: {} } });
    const controller = new AbortController();
    const detached = value.client.prompt(
      {
        prompt: [{ text: 'synthetic', type: 'text' }],
        sessionId: 'synthetic-session',
      },
      { signal: controller.signal },
    );
    await value.frames.next();
    controller.abort();
    await expect(detached).rejects.toMatchObject({ code: 'request_aborted' });
    await expect(
      value.client.prompt({
        prompt: [{ text: 'blocked', type: 'text' }],
        sessionId: 'synthetic-session',
      }),
    ).rejects.toMatchObject({ code: 'invalid_params' });

    await respondEmpty(value, value.client.closeSession('synthetic-session'));
    const resumed = value.client.prompt({
      prompt: [{ text: 'allowed after close', type: 'text' }],
      sessionId: 'synthetic-session',
    });
    const resumedFrame = await value.frames.next();
    value.inbound.write(
      `${JSON.stringify({
        id: resumedFrame['id'],
        jsonrpc: '2.0',
        result: { stopReason: 'end_turn' },
      })}\n`,
    );
    await expect(resumed).resolves.toEqual({ stopReason: 'end_turn' });
    await dispose(value);
  });

  it('keeps a Session blocked when the local close wait detaches', async () => {
    const value = createHarness();
    await initialize(value, { sessionCapabilities: { close: {} } });
    const controller = new AbortController();
    const closing = value.client.closeSession('synthetic-session', {
      signal: controller.signal,
    });
    await value.frames.next();
    controller.abort();
    await expect(closing).rejects.toMatchObject({ code: 'request_aborted' });

    const prompt = value.client.prompt({
      prompt: [{ text: 'must remain blocked', type: 'text' }],
      sessionId: 'synthetic-session',
    });
    let conflictError: unknown;
    void prompt.catch((error: unknown) => {
      conflictError = error;
    });
    await vi.waitFor(() => {
      expect(conflictError).toMatchObject({ code: 'invalid_params' });
    });
    await dispose(value);
  });

  it('validates construction and runs caller cleanup once on premature EOF', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    expect(
      () =>
        new AcpClient({
          maxBufferedEvents: 0,
          readable,
          writable,
        }),
    ).toThrow(expect.objectContaining({ code: 'invalid_configuration' }));
    readable.destroy();
    writable.destroy();

    const cleanup = vi.fn();
    const value = createHarness({ cleanup });
    const events = value.client.events()[Symbol.asyncIterator]();
    value.inbound.end();
    await expect(events.next()).rejects.toMatchObject({ code: 'stream_ended' });
    await value.client.close();
    await value.client.close();
    expect(cleanup).toHaveBeenCalledOnce();
    value.outbound.destroy();
  });

  it('rejects operations on closed clients and resolves a pending event read on close', async () => {
    const unopened = createHarness();
    await unopened.client.close();
    await expect(unopened.client.initialize()).rejects.toMatchObject({
      code: 'client_closed',
    });
    unopened.inbound.destroy();
    unopened.outbound.destroy();

    const value = createHarness();
    await initialize(value);
    const events = value.client.events()[Symbol.asyncIterator]();
    const pending = events.next();
    await value.client.close();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    await expect(
      value.client.newSession({ cwd: '/synthetic/workspace', mcpServers: [] }),
    ).rejects.toMatchObject({ code: 'client_closed' });
    value.inbound.destroy();
    value.outbound.destroy();
  });

  it('supports iterator throw disposal', async () => {
    const value = createHarness();
    await initialize(value);
    const events = value.client.events()[Symbol.asyncIterator]();
    const first = events.next();
    value.inbound.write(
      '{"jsonrpc":"2.0","method":"future/event","params":{}}\n',
    );
    await expect(first).resolves.toMatchObject({ done: false });
    await expect(events.throw?.(new Error('synthetic stop'))).rejects.toThrow(
      'synthetic stop',
    );
    expect(value.client.isOpen()).toBe(false);
    value.inbound.destroy();
    value.outbound.destroy();
  });
});

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
