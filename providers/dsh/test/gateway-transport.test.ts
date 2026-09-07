import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DshGatewayTransport } from '../src/gateway-transport.js';

let server: Server;
let sockets: WebSocketServer;
let url: string;
let receivedCookie: string | undefined;
let receivedOrigin: string | undefined;
let payload: unknown;
let peer: WebSocket | undefined;
let mode = 'normal';
const transports: DshGatewayTransport[] = [];

beforeEach(async () => {
  mode = 'normal';
  peer = undefined;
  payload = undefined;
  receivedCookie = undefined;
  receivedOrigin = undefined;
  server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.destroy();
    });
  });
  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    receivedCookie = request.headers.cookie;
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.from(chunk as Buffer));
    const envelope = JSON.parse(Buffer.concat(chunks).toString()) as {
      rpcId: string;
      payload: unknown;
    };
    payload = envelope.payload;
    if (mode === 'hang') return;
    if (mode === 'unauthorized') {
      response.writeHead(401).end('synthetic secret');
      return;
    }
    if (mode === 'redirect') {
      response.writeHead(302, { location: '/credential-target' }).end();
      return;
    }
    if (mode === 'bad-json') {
      response.end('{');
      return;
    }
    if (mode === 'oversized') {
      response.end(' '.repeat(8192));
      return;
    }
    if (mode === 'reset') {
      response.destroy();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        type: mode === 'bad-type' ? 'foreign' : 'server-response',
        rpcId: mode === 'wrong-id' ? 'foreign' : envelope.rpcId,
        result:
          mode === 'bad-result'
            ? { ok: 1 }
            : mode === 'no-result'
              ? null
              : ['remote-error', 'unknown-error', 'malformed-error'].includes(
                    mode,
                  )
                ? {
                    ok: false,
                    error: {
                      code:
                        mode === 'unknown-error'
                          ? 'synthetic secret'
                          : 'session/not-found',
                      message: 'synthetic secret',
                      details:
                        mode === 'malformed-error'
                          ? null
                          : { cookie: 'synthetic secret' },
                    },
                  }
                : { ok: true, value: { accepted: true } },
      }),
    );
  }
  sockets = new WebSocketServer({ server, path: '/api/remote.mux' });
  sockets.on('connection', (socket, request) => {
    peer = socket;
    receivedCookie = request.headers.cookie;
    receivedOrigin = request.headers.origin;
    socket.on('message', (data) => {
      if (!Buffer.isBuffer(data))
        throw new Error('Expected synthetic text frame.');
      const frame = JSON.parse(data.toString()) as {
        type: string;
        streamId: string;
      };
      payload = frame;
      if (frame.type === 'open') {
        socket.send(
          JSON.stringify({
            type: 'item',
            streamId: frame.streamId,
            value: { type: 'snapshot' },
          }),
        );
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing synthetic listener.');
  url = `http://127.0.0.1:${String(address.port)}`;
});

afterEach(async () => {
  for (const transport of transports.splice(0)) transport.close();
  for (const socket of sockets.clients) socket.terminate();
  await new Promise<void>((resolve) => {
    sockets.close(() => {
      resolve();
    });
  });
  server.closeAllConnections();
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

function connect(timeoutMs = 200): Promise<DshGatewayTransport> {
  return DshGatewayTransport.connect({
    url,
    cookie: 'synthetic=session',
    requestTimeoutMs: timeoutMs,
    maxMessageBytes: 4096,
    maxBufferedEvents: 8,
    maxSessions: 4,
  }).then((transport) => {
    transports.push(transport);
    return transport;
  });
}

describe('DSH Gateway authenticated wire transport', () => {
  it('authenticates both carriers and correlates the official HTTP envelope', async () => {
    const transport = await connect();
    expect(receivedOrigin).toBe(url);
    expect(receivedCookie).toBe('synthetic=session');
    await expect(
      transport.request('session/cancel', {
        request: { sessionId: 'synthetic' },
      }),
    ).resolves.toEqual({ accepted: true });
    expect(receivedCookie).toBe('synthetic=session');
    expect(payload).toEqual({ args: { request: { sessionId: 'synthetic' } } });
  });

  it('opens a multiplexed stream and explicitly cancels only that observation', async () => {
    const transport = await connect();
    const stream = transport.open('session/follow', {
      request: { address: { kind: 'session', sessionId: 'synthetic' } },
    });
    const reader = stream.events[Symbol.asyncIterator]();
    await expect(reader.next()).resolves.toEqual({
      done: false,
      value: { type: 'snapshot' },
    });
    if (peer === undefined) throw new Error('Missing synthetic peer.');
    const cancellation = once(peer, 'message');
    stream.close();
    await cancellation;
    expect(payload).toMatchObject({ type: 'cancel' });
    await expect(reader.next()).resolves.toMatchObject({ done: true });
  });

  it.each([
    ['wrong-id', 'provider_api_incompatible'],
    ['unauthorized', 'authentication_failed'],
    ['redirect', 'connection_failed'],
    ['remote-error', 'session_not_found'],
    ['hang', 'timeout'],
    ['bad-json', 'provider_api_incompatible'],
    ['oversized', 'provider_api_incompatible'],
    ['reset', 'connection_failed'],
    ['bad-type', 'provider_api_incompatible'],
    ['bad-result', 'provider_api_incompatible'],
    ['no-result', 'provider_api_incompatible'],
    ['unknown-error', 'provider_error'],
    ['malformed-error', 'provider_api_incompatible'],
  ])(
    'contains %s errors without disclosing upstream details',
    async (nextMode, code) => {
      const transport = await connect(40);
      mode = nextMode;
      const failure: unknown = await transport
        .request('session/cancel', { request: {} })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code, retryable: false });
      expect(JSON.stringify(failure)).not.toContain('synthetic secret');
    },
  );

  it('fails pending streams on malformed frames and physical loss', async () => {
    const transport = await connect();
    const stream = transport.open('session/follow', {});
    const reader = stream.events[Symbol.asyncIterator]();
    await reader.next();
    peer?.send('{');
    await expect(reader.next()).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
    await expect(transport.request('session/list', {})).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it.each([
    'binary',
    'oversized',
    'missing-id',
    'bad-type',
    'no-value',
    'end',
    'error',
    'bad-error',
    'overflow',
  ])('contains %s stream failures', async (failure) => {
    const transport = await connect();
    const stream = transport.open('session/follow', {});
    const reader = stream.events[Symbol.asyncIterator]();
    await reader.next();
    const { streamId } = payload as { streamId: string };
    if (failure === 'binary') peer?.send(Buffer.from('{}'));
    else if (failure === 'oversized') peer?.send(' '.repeat(8192));
    else if (failure === 'missing-id') peer?.send('{}');
    else if (failure === 'overflow') {
      for (let count = 0; count < 16; count++)
        peer?.send(JSON.stringify({ type: 'item', streamId, value: {} }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    } else
      peer?.send(
        JSON.stringify({
          type:
            failure === 'bad-type'
              ? 'foreign'
              : failure === 'no-value'
                ? 'item'
                : failure === 'bad-error'
                  ? 'error'
                  : failure,
          streamId,
          error:
            failure === 'bad-error'
              ? {}
              : {
                  code: 'session/not-found',
                  message: 'synthetic secret',
                  details: {},
                },
        }),
      );
    await expect(reader.next()).rejects.toBeInstanceOf(Error);
    stream.close();
  });

  it('ignores already cancelled stream frames without damaging another stream', async () => {
    const transport = await connect();
    const first = transport.open('session/follow', {});
    await first.events[Symbol.asyncIterator]().next();
    const { streamId } = payload as { streamId: string };
    first.close();
    peer?.send(JSON.stringify({ type: 'item', streamId, value: {} }));
    const second = transport.open('session/follow', {});
    await expect(
      second.events[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({ done: false });
    second.close();
  });

  it('bounds requests, stream count and serialized writes before accepting more work', async () => {
    const transport = await connect();
    await expect(transport.request('session/delete', {})).rejects.toMatchObject(
      { code: 'invalid_request' },
    );
    await expect(
      transport.request('session/prompt', { text: 'x'.repeat(8192) }),
    ).rejects.toMatchObject({ providerCode: 'request_capacity' });
    const streams = Array.from({ length: 4 }, () =>
      transport.open('session/follow', {}),
    );
    expect(() => transport.open('session/follow', {})).toThrow();
    for (const stream of streams) stream.close();
    mode = 'hang';
    const requests = Array.from({ length: 32 }, () =>
      transport.request('session/list', {}).catch((error: unknown) => error),
    );
    await expect(transport.request('session/list', {})).rejects.toMatchObject({
      providerCode: 'request_capacity',
    });
    transport.close();
    const failures = await Promise.all(requests);
    expect(failures).toHaveLength(32);
    for (const failure of failures)
      expect(failure).toMatchObject({ code: 'connection_aborted' });
  });

  it('bounds outgoing WebSocket frames and delivers close only to subscribed observers', async () => {
    const transport = await connect();
    let notifications = 0;
    const off = transport.onClose(() => {
      notifications++;
    });
    off();
    transport.onClose(() => {
      notifications++;
    });
    const stream = transport.open('session/follow', {
      value: 'x'.repeat(8192),
    });
    await expect(
      stream.events[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ providerCode: 'write_capacity' });
    transport.close();
    expect(notifications).toBe(1);
  });

  it.each(['', 'x\r\ny', 'x'.repeat(8193)])(
    'rejects invalid cookie material before connecting %#',
    async (cookie) => {
      await expect(
        DshGatewayTransport.connect({
          url,
          cookie,
          requestTimeoutMs: 30,
          maxMessageBytes: 4096,
          maxBufferedEvents: 8,
          maxSessions: 4,
        }),
      ).rejects.toMatchObject({ code: 'profile_invalid' });
    },
  );

  it.each([401, 403, 302, 500])(
    'contains an HTTP %i WebSocket upgrade rejection',
    async (status) => {
      const rejected = createServer();
      rejected.on('upgrade', (_request, socket) => {
        socket.end(
          `HTTP/1.1 ${String(status)} Rejected\r\nContent-Length: 0\r\n\r\n`,
        );
      });
      rejected.listen(0, '127.0.0.1');
      await once(rejected, 'listening');
      const address = rejected.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing synthetic listener.');
      try {
        await expect(
          DshGatewayTransport.connect({
            url: `http://127.0.0.1:${String(address.port)}`,
            cookie: 'synthetic=1',
            requestTimeoutMs: 100,
            maxMessageBytes: 4096,
            maxBufferedEvents: 8,
            maxSessions: 4,
          }),
        ).rejects.toMatchObject({
          code:
            status === 401 || status === 403
              ? 'authentication_failed'
              : 'connection_failed',
        });
      } finally {
        await new Promise<void>((resolve) => {
          rejected.close(() => {
            resolve();
          });
        });
      }
    },
  );

  it('contains connection refusal without leaking a native socket error', async () => {
    const closed = createServer();
    closed.listen(0, '127.0.0.1');
    await once(closed, 'listening');
    const address = closed.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing synthetic listener.');
    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });
    await expect(
      DshGatewayTransport.connect({
        url: `http://127.0.0.1:${String(address.port)}`,
        cookie: 'synthetic=1',
        requestTimeoutMs: 100,
        maxMessageBytes: 4096,
        maxBufferedEvents: 8,
        maxSessions: 4,
      }),
    ).rejects.toMatchObject({ code: 'connection_failed', retryable: false });
  });
});
