import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { inspect } from 'node:util';

import { JsonRpcTransportError } from '@harapter/transport-jsonrpc-stdio';
import { describe, expect, it, vi } from 'vitest';

import {
  ACP_PROTOCOL_VERSION,
  AcpClient,
  AcpClientError,
  type AcpEvent,
  type AcpPermissionRequest,
} from '../src/index.js';

type JsonRecord = Record<string, unknown>;

class FrameReader {
  private buffer = '';
  private readonly frames: JsonRecord[] = [];
  private readonly waiters: ((frame: JsonRecord) => void)[] = [];

  constructor(stream: PassThrough) {
    stream.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      for (;;) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) return;
        const encoded = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        const parsed: unknown = JSON.parse(encoded);
        if (!isRecord(parsed)) throw new Error('Expected a JSON object frame.');
        const waiter = this.waiters.shift();
        if (waiter) waiter(parsed);
        else this.frames.push(parsed);
      }
    });
  }

  next(): Promise<JsonRecord> {
    const frame = this.frames.shift();
    if (frame) return Promise.resolve(frame);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

interface ClientHarness {
  readonly client: AcpClient;
  readonly inbound: PassThrough;
  readonly outbound: PassThrough;
  readonly frames: FrameReader;
}

function harness(
  options: {
    readonly maxBufferedEvents?: number;
    readonly requestPermission?: (
      request: AcpPermissionRequest,
    ) => Promise<
      | { readonly outcome: 'cancelled' }
      | { readonly outcome: 'selected'; readonly optionId: string }
    >;
  } = {},
): ClientHarness {
  const inbound = new PassThrough();
  const outbound = new PassThrough();
  return {
    client: new AcpClient({
      readable: inbound,
      writable: outbound,
      ...options,
    }),
    frames: new FrameReader(outbound),
    inbound,
    outbound,
  };
}

async function initialize(
  value: ClientHarness,
  agentCapabilities: JsonRecord = {},
) {
  const pending = value.client.initialize({
    clientInfo: { name: 'harapter-test', version: 'synthetic' },
  });
  const request = await value.frames.next();
  expect(request).toMatchObject({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      clientCapabilities: {
        auth: { terminal: false },
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: 'harapter-test', version: 'synthetic' },
      protocolVersion: ACP_PROTOCOL_VERSION,
    },
  });
  value.inbound.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: request['id'],
      result: {
        agentCapabilities,
        authMethods: [],
        protocolVersion: ACP_PROTOCOL_VERSION,
      },
    })}\n`,
  );
  return pending;
}

async function closeHarness(value: ClientHarness): Promise<void> {
  await value.client.close();
  value.inbound.destroy();
  value.outbound.destroy();
}

function eventValue(result: IteratorResult<AcpEvent>): AcpEvent {
  expect(result.done).toBe(false);
  if (result.done) throw new Error('Expected an ACP event.');
  return result.value;
}

describe('AcpClient', () => {
  it('negotiates stable v1 and normalizes explicit agent capabilities', async () => {
    const value = harness();
    await expect(
      initialize(value, {
        loadSession: true,
        mcpCapabilities: { http: true, sse: false },
        promptCapabilities: {
          audio: false,
          embeddedContext: true,
          image: true,
        },
        sessionCapabilities: { close: {}, list: {}, resume: {} },
      }),
    ).resolves.toMatchObject({
      capabilities: {
        loadSession: true,
        mcp: { http: true, sse: false },
        prompt: { audio: false, embeddedContext: true, image: true },
        session: { close: true, list: true, resume: true },
      },
      protocolVersion: 1,
    });
    expect(value.client.capabilities()).toMatchObject({
      loadSession: true,
      session: { close: true, list: true, resume: true },
    });
    await closeHarness(value);
  });

  it('rejects unsupported protocol versions and cannot be used before negotiation', async () => {
    const value = harness();
    const pending = value.client.initialize();
    const request = await value.frames.next();
    value.inbound.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: request['id'],
        result: { agentCapabilities: {}, protocolVersion: 2 },
      })}\n`,
    );

    await expect(pending).rejects.toMatchObject({
      code: 'unsupported_protocol_version',
    });
    await expect(
      value.client.newSession({ cwd: '/synthetic/workspace', mcpServers: [] }),
    ).rejects.toMatchObject({ code: 'not_initialized' });
    await closeHarness(value);
  });

  it('validates inputs and capability-gates optional session operations', async () => {
    const value = harness();
    await initialize(value);

    await expect(
      value.client.newSession({ cwd: 'relative/path', mcpServers: [] }),
    ).rejects.toMatchObject({ code: 'invalid_params' });
    await expect(value.client.listSessions()).rejects.toMatchObject({
      code: 'capability_not_advertised',
    });
    await expect(
      value.client.resumeSession({
        cwd: '/synthetic/workspace',
        sessionId: 'synthetic-session',
      }),
    ).rejects.toMatchObject({ code: 'capability_not_advertised' });
    await expect(
      value.client.closeSession('synthetic-session'),
    ).rejects.toMatchObject({ code: 'capability_not_advertised' });
    await closeHarness(value);
  });

  it('runs the supported session and prompt method sequence', async () => {
    const value = harness();
    await initialize(value, {
      sessionCapabilities: { close: {}, list: {}, resume: {} },
    });

    const newSession = value.client.newSession({
      cwd: '/synthetic/workspace',
      mcpServers: [],
    });
    const createFrame = await value.frames.next();
    expect(createFrame).toMatchObject({
      jsonrpc: '2.0',
      method: 'session/new',
      params: { cwd: '/synthetic/workspace', mcpServers: [] },
    });
    value.inbound.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: createFrame['id'],
        result: { sessionId: 'synthetic-session' },
      })}\n`,
    );
    await expect(newSession).resolves.toEqual({
      sessionId: 'synthetic-session',
    });

    const prompt = value.client.prompt({
      prompt: [{ text: 'synthetic request', type: 'text' }],
      sessionId: 'synthetic-session',
    });
    const promptFrame = await value.frames.next();
    expect(promptFrame).toMatchObject({ method: 'session/prompt' });
    value.inbound.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: promptFrame['id'],
        result: { stopReason: 'end_turn' },
      })}\n`,
    );
    await expect(prompt).resolves.toEqual({ stopReason: 'end_turn' });

    const listing = value.client.listSessions({
      cwd: '/synthetic/workspace',
    });
    const listFrame = await value.frames.next();
    value.inbound.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: listFrame['id'],
        result: {
          sessions: [
            { cwd: '/synthetic/workspace', sessionId: 'synthetic-session' },
          ],
        },
      })}\n`,
    );
    await expect(listing).resolves.toMatchObject({
      sessions: [{ sessionId: 'synthetic-session' }],
    });

    const close = value.client.closeSession('synthetic-session');
    const closeFrame = await value.frames.next();
    value.inbound.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: closeFrame['id'],
        result: {},
      })}\n`,
    );
    await expect(close).resolves.toEqual({});
    await closeHarness(value);
  });

  it('delivers typed updates and bounded redacted unknown observations in wire order', async () => {
    const value = harness();
    await initialize(value);
    const manifest = JSON.parse(
      await readFile(
        new URL(
          '../../../fixtures/acp/v1-stable/manifest.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as unknown;
    expect(manifest).toMatchObject({ protocolVersion: 1 });
    const fixtures = JSON.parse(
      await readFile(
        new URL(
          '../../../fixtures/acp/v1-stable/unknown.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as JsonRecord;
    const events = value.client.events()[Symbol.asyncIterator]();

    value.inbound.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'synthetic-session',
          update: {
            content: { text: 'synthetic response', type: 'text' },
            sessionUpdate: 'agent_message_chunk',
          },
        },
      })}\n`,
    );
    value.inbound.write(`${JSON.stringify(fixtures['unknownNotification'])}\n`);
    value.inbound.write(
      `${JSON.stringify(fixtures['unknownSessionUpdate'])}\n`,
    );

    expect(eventValue(await events.next())).toMatchObject({
      kind: 'session_update',
      sessionId: 'synthetic-session',
      update: { sessionUpdate: 'agent_message_chunk' },
    });
    const unknownNotification = eventValue(await events.next());
    const unknownUpdate = eventValue(await events.next());
    expect(unknownNotification.kind).toBe('unknown');
    expect(unknownUpdate.kind).toBe('unknown');
    const encoded = JSON.stringify([unknownNotification, unknownUpdate]);
    expect(encoded.length).toBeLessThan(4_096);
    expect(encoded).not.toContain('synthetic-secret-must-not-survive');
    expect(encoded).not.toContain('synthetic-prompt-must-not-survive');
    expect(encoded).not.toContain('synthetic-content-must-not-survive');
    expect(encoded).not.toContain('true');
    await closeHarness(value);
  });

  it('cancels pending permission requests before sending session cancellation', async () => {
    let observedPermission: AcpPermissionRequest | undefined;
    const value = harness({
      requestPermission: (request) => {
        observedPermission = request;
        return new Promise(() => undefined);
      },
    });
    await initialize(value);
    const prompt = value.client.prompt({
      prompt: [{ text: 'synthetic request', type: 'text' }],
      sessionId: 'synthetic-session',
    });
    const promptFrame = await value.frames.next();
    value.inbound.write(
      `${JSON.stringify({
        id: 91,
        jsonrpc: '2.0',
        method: 'session/request_permission',
        params: {
          options: [
            { kind: 'allow_once', name: 'Allow', optionId: 'allow-once' },
          ],
          sessionId: 'synthetic-session',
          toolCall: { title: 'Synthetic tool', toolCallId: 'tool-1' },
        },
      })}\n`,
    );
    await vi.waitFor(() => {
      expect(observedPermission).toBeDefined();
    });

    await value.client.cancelSession('synthetic-session');
    expect(await value.frames.next()).toEqual({
      id: 91,
      jsonrpc: '2.0',
      result: { outcome: { outcome: 'cancelled' } },
    });
    expect(await value.frames.next()).toEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'synthetic-session' },
    });
    value.inbound.write(
      `${JSON.stringify({
        id: promptFrame['id'],
        jsonrpc: '2.0',
        result: { stopReason: 'cancelled' },
      })}\n`,
    );
    await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' });
    await closeHarness(value);
  });

  it('does not turn a local request abort into an ACP cancellation', async () => {
    const value = harness();
    await initialize(value);
    const controller = new AbortController();
    const prompt = value.client.prompt(
      {
        prompt: [{ text: 'synthetic request', type: 'text' }],
        sessionId: 'synthetic-session',
      },
      { signal: controller.signal },
    );
    const promptFrame = await value.frames.next();
    expect(promptFrame['method']).toBe('session/prompt');
    controller.abort();
    const failure = await prompt.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(JsonRpcTransportError);
    expect(failure).toMatchObject({ code: 'request_aborted' });
    await expect(
      value.client.prompt({
        prompt: [{ text: 'must remain blocked', type: 'text' }],
        sessionId: 'synthetic-session',
      }),
    ).rejects.toMatchObject({ code: 'invalid_params' });
    await closeHarness(value);
  });

  it('rejects non-v1 wire envelopes before ACP dispatch', async () => {
    const value = harness();
    const events = value.client.events()[Symbol.asyncIterator]();
    value.inbound.write(
      '{"method":"session/update","params":{"sessionId":"synthetic-session","update":{"sessionUpdate":"future"}}}\n',
    );
    await expect(events.next()).rejects.toMatchObject({
      code: 'malformed_message',
    });
    value.inbound.destroy();
    value.outbound.destroy();
  });

  it('fails closed when the ACP event buffer is exhausted', async () => {
    const value = harness({ maxBufferedEvents: 1 });
    await initialize(value);
    const frame = (text: string) =>
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'synthetic-session',
          update: {
            content: { text, type: 'text' },
            sessionUpdate: 'agent_message_chunk',
          },
        },
      })}\n`;
    value.inbound.write(frame('first'));
    value.inbound.write(frame('second'));
    await vi.waitFor(() => {
      expect(value.client.isOpen()).toBe(false);
    });
    const events = value.client.events()[Symbol.asyncIterator]();
    await expect(events.next()).rejects.toMatchObject({
      code: 'event_capacity_exceeded',
    });
    value.inbound.destroy();
    value.outbound.destroy();
  });

  it('keeps ACP errors content-free during JSON serialization', () => {
    const error = new AcpClientError(
      'invalid_message',
      'The ACP peer sent an invalid message.',
    );
    expect(JSON.stringify(error)).toBe(
      '{"message":"The ACP peer sent an invalid message.","name":"AcpClientError","code":"invalid_message"}',
    );
    expect(inspect(error)).toBe(
      'AcpClientError [invalid_message]: The ACP peer sent an invalid message.',
    );
  });
});

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
