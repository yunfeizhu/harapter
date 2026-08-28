import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpSseTransport,
  HttpTransportError,
  type HttpSseTransportOptions,
  type SseEvent,
} from '../src/index.js';

const encoder = new TextEncoder();

function asFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response> | Response,
): typeof fetch {
  return (input, init) => Promise.resolve(implementation(input, init));
}

function bodyStream(
  chunks: readonly (string | Uint8Array)[],
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
}

function response(
  chunks: readonly (string | Uint8Array)[],
  init: ResponseInit = {},
): Response {
  return new Response(bodyStream(chunks), init);
}

function pendingFetch(): {
  readonly fetch: typeof fetch;
  readonly signals: AbortSignal[];
} {
  const signals: AbortSignal[] = [];
  return {
    signals,
    fetch: asFetch((_input, init) => {
      const signal = init?.signal;
      if (signal !== undefined && signal !== null) signals.push(signal);
      return new Promise(() => undefined);
    }),
  };
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

async function collect(iterable: AsyncIterable<SseEvent>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const transports: HttpSseTransport[] = [];

function createTransport(
  options: Partial<HttpSseTransportOptions> = {},
): HttpSseTransport {
  const transport = new HttpSseTransport({
    baseUrl: 'https://provider.invalid/root/',
    fetch: asFetch(() => response([], { status: 204 })),
    ...options,
  });
  transports.push(transport);
  return transport;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    transports
      .splice(0)
      .map((transport) => transport.close().catch(() => undefined)),
  );
});

describe('HttpSseTransport requests', () => {
  it('sends bounded same-origin requests and returns bytes with safe metadata', async () => {
    const requests: { input: string; init: RequestInit }[] = [];
    const transport = createTransport({
      defaultHeaders: { authorization: 'Bearer synthetic-secret' },
      fetch: asFetch((input, init = {}) => {
        const requestUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requests.push({ input: requestUrl, init });
        return response(['{"ok":', 'true}'], {
          headers: { 'content-type': 'application/json; charset=utf-8' },
          status: 201,
        });
      }),
    });

    const result = await transport.request('sessions?directory=synthetic', {
      body: '{"title":"Harapter"}',
      headers: { 'content-type': 'application/json', 'x-trace': 'bounded' },
      method: 'POST',
    });

    expect(result).toEqual({
      body: encoder.encode('{"ok":true}'),
      contentType: 'application/json; charset=utf-8',
      status: 201,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(
      'https://provider.invalid/root/sessions?directory=synthetic',
    );
    expect(requests[0]?.init.method).toBe('POST');
    expect(requests[0]?.init.redirect).toBe('manual');
    expect(new Headers(requests[0]?.init.headers).get('authorization')).toBe(
      'Bearer synthetic-secret',
    );
    expect(new TextDecoder().decode(requests[0]?.init.body as Uint8Array)).toBe(
      '{"title":"Harapter"}',
    );
  });

  it('rejects endpoint escapes, fragments, unsafe methods, and bodies on GET', async () => {
    const transport = createTransport();
    const requests = [
      transport.request('https://other.invalid/session'),
      transport.request('../session'),
      transport.request('session#private-fragment'),
      transport.request('session', { method: 'TRACE' as 'GET' }),
      transport.request('session', { body: 'not-allowed', method: 'GET' }),
    ];

    for (const request of requests) {
      await expect(request).rejects.toMatchObject({ code: 'invalid_request' });
    }
  });

  it('bounds request bodies, response bodies, and merged headers', async () => {
    const bodyTransport = createTransport({ maxRequestBytes: 4 });
    await expect(
      bodyTransport.request('session', { body: '12345', method: 'POST' }),
    ).rejects.toMatchObject({ code: 'request_too_large' });

    const responseTransport = createTransport({
      fetch: asFetch(() => response(['123', '45'])),
      maxResponseBytes: 4,
    });
    await expect(responseTransport.request('session')).rejects.toMatchObject({
      code: 'response_too_large',
    });

    const headerTransport = createTransport({ maxHeaderBytes: 8 });
    await expect(
      headerTransport.request('session', {
        headers: { authorization: 'Bearer too-large' },
      }),
    ).rejects.toMatchObject({ code: 'headers_too_large' });
  });

  it('distinguishes caller abort, timeout, close, capacity, and network failure', async () => {
    vi.useFakeTimers();
    const pending = pendingFetch();
    const transport = createTransport({
      fetch: pending.fetch,
      maxConcurrentRequests: 1,
      requestTimeoutMs: 25,
    });

    const timedOut = capture(transport.request('slow'));
    await vi.advanceTimersByTimeAsync(25);
    await expect(timedOut).resolves.toMatchObject({ code: 'request_timeout' });

    const controller = new AbortController();
    const aborted = transport.request('aborted', { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: 'request_aborted' });

    const held = transport.request('held', { timeoutMs: 100 });
    await expect(transport.request('overflow')).rejects.toMatchObject({
      code: 'capacity_exceeded',
    });
    await transport.close();
    await expect(held).rejects.toMatchObject({ code: 'transport_closed' });
    expect(pending.signals.every((signal) => signal.aborted)).toBe(true);

    const failure = await capture(
      createTransport({
        fetch: asFetch(() => {
          throw new Error('https://private.invalid?token=synthetic-secret');
        }),
      }).request('session'),
    );
    expect(failure).toMatchObject({ code: 'network_failure' });
    expect(inspect(failure)).not.toContain('synthetic-secret');
    expect(inspect(failure)).not.toContain('private.invalid');
  });

  it('settles local abort without waiting for response-body cancellation', async () => {
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const transport = createTransport({
      fetch: asFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel,
              pull() {
                markReadStarted?.();
                return new Promise<void>(() => undefined);
              },
            }),
          ),
      ),
    });
    const controller = new AbortController();
    const request = transport.request('session', {
      signal: controller.signal,
    });
    await readStarted;

    controller.abort();

    await expect(request).rejects.toMatchObject({ code: 'request_aborted' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a response that arrives after a local abort', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const controller = new AbortController();
    const transport = createTransport({ fetch: asFetch(() => pending) });
    const request = transport.request('session', {
      signal: controller.signal,
    });

    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'request_aborted' });
    resolveFetch?.(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel,
          pull() {
            return new Promise<void>(() => undefined);
          },
        }),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('runs cleanup once and keeps cleanup failures content-free', async () => {
    const cleanup = vi.fn(() =>
      Promise.reject(new Error('synthetic cleanup secret')),
    );
    const transport = createTransport({ cleanup });

    const first = await capture(transport.close());
    const second = await capture(transport.close());
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first).toMatchObject({ code: 'cleanup_failed' });
    expect(inspect(first)).not.toContain('synthetic cleanup secret');
  });

  it('handles empty bodies, binary requests, stream read failures, and closed state', async () => {
    const requestBodies: Uint8Array[] = [];
    const transport = createTransport({
      fetch: asFetch((_input, init) => {
        requestBodies.push(new Uint8Array(init?.body as Uint8Array));
        return new Response(null, { status: 204 });
      }),
    });
    expect(transport.isOpen()).toBe(true);
    await expect(
      transport.request('session', {
        body: Uint8Array.of(1, 2, 3),
        method: 'POST',
      }),
    ).resolves.toEqual({ body: new Uint8Array(), status: 204 });
    expect(requestBodies).toEqual([Uint8Array.of(1, 2, 3)]);

    const failure = await capture(
      createTransport({
        fetch: asFetch(
          () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error('synthetic response secret'));
                },
              }),
            ),
        ),
      }).request('session'),
    );
    expect(failure).toMatchObject({ code: 'response_stream_failed' });
    expect(inspect(failure)).not.toContain('synthetic response secret');

    await transport.close();
    expect(transport.isOpen()).toBe(false);
    await expect(transport.request('session')).rejects.toMatchObject({
      code: 'transport_closed',
    });
  });

  it('rejects malformed runtime request values without retaining them', async () => {
    const transport = createTransport();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const sensitive = 'synthetic-secret';
    const requests = [
      transport.request('session', { signal: alreadyAborted.signal }),
      transport.request('session', { timeoutMs: 0 }),
      transport.request('session', { timeoutMs: 2_147_483_648 }),
      transport.request('session', {
        body: { sensitive } as unknown as string,
        method: 'POST',
      }),
      transport.request('session', {
        headers: { 'bad\nheader': sensitive },
      }),
      transport.request('session', {
        signal: { aborted: false } as AbortSignal,
      }),
      transport.request('x'.repeat(8193)),
      transport.request('session\nprivate'),
    ];
    for (const failurePromise of requests.map((request) => capture(request))) {
      const failure = await failurePromise;
      expect(failure).toBeInstanceOf(HttpTransportError);
      expect(inspect(failure)).not.toContain(sensitive);
    }
  });
});

describe('HttpSseTransport event streams', () => {
  it('parses fragmented UTF-8, CRLF, comments, multiline data, ids, and retry', async () => {
    const snowman = encoder.encode('☃');
    const transport = createTransport({
      fetch: asFetch(() =>
        response(
          [
            encoder.encode('\uFEFF: connected\r\n'),
            'id: first\r\nevent: message.part\r\ndata: hello\r\ndata: ',
            snowman.subarray(0, 1),
            snowman.subarray(1),
            '\r\nretry: 1500\r\nunknown: ignored\r\n\r\n',
            'data: second\n\n',
          ],
          { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
        ),
      ),
    });
    const stream = transport.subscribe('events');
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        data: 'hello\n☃',
        event: 'message.part',
        id: 'first',
        retry: 1500,
      },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: 'second', id: 'first' },
    });
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'stream_ended',
    });
  });

  it('parses CR lines across chunks and ignores only the initial BOM', async () => {
    const transport = createTransport({
      fetch: asFetch(() =>
        response(
          [
            '\uFEFFdata: first\r',
            '\r\uFEFFdata: hidden\rdata: visible\r',
            '\rdata: split\r',
            '\n\r',
            '\n',
          ],
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      ),
    });
    const iterator = transport.subscribe('events')[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: 'first', id: '' },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: 'visible', id: '' },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: 'split', id: '' },
    });
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'stream_ended',
    });
  });

  it('ignores empty dispatches, invalid ids and retry fields, and unknown fields', async () => {
    const transport = createTransport({
      fetch: asFetch(() =>
        response(
          [
            'event: ignored\n\nid: bad\u0000id\nretry: -1\nfoo: bar\ndata: ok\n\n',
          ],
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
      ),
    });
    const iterator = transport.subscribe('events')[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: 'ok', id: '' },
    });
    await expect(iterator.return?.()).resolves.toMatchObject({ done: true });
  });

  it('rejects non-success responses, wrong content types, missing bodies, and clean EOF', async () => {
    const cases: [Response, string][] = [
      [response(['denied'], { status: 401 }), 'http_status'],
      [
        response(['data: no\n\n'], {
          headers: { 'content-type': 'application/json' },
        }),
        'invalid_sse_response',
      ],
      [new Response(null, { status: 200 }), 'invalid_sse_response'],
      [
        response([], { headers: { 'content-type': 'text/event-stream' } }),
        'stream_ended',
      ],
    ];
    for (const [upstream, code] of cases) {
      const transport = createTransport({
        fetch: asFetch(() => upstream),
      });
      await expect(
        collect(transport.subscribe('events')),
      ).rejects.toMatchObject({ code });
    }
  });

  it('fails closed on invalid UTF-8 and bounded line, event, and chunk input', async () => {
    const cases: [readonly (string | Uint8Array)[], object, string][] = [
      [[Uint8Array.of(0xc3, 0x28)], {}, 'invalid_sse_encoding'],
      [['data: 12345\n\n'], { maxSseLineBytes: 8 }, 'sse_line_too_large'],
      [
        ['data: 12\ndata: 34\n\n'],
        { maxSseEventBytes: 12 },
        'sse_event_too_large',
      ],
      [['data: 123456\n\n'], { maxSseChunkBytes: 8 }, 'sse_chunk_too_large'],
      [['data: 12345'], { maxSseLineBytes: 8 }, 'sse_line_too_large'],
    ];
    for (const [chunks, limits, code] of cases) {
      const transport = createTransport({
        ...limits,
        fetch: asFetch(() =>
          response(chunks, {
            headers: { 'content-type': 'text/event-stream' },
          }),
        ),
      });
      await expect(
        collect(transport.subscribe('events')),
      ).rejects.toMatchObject({ code });
    }
  });

  it('bounds concurrent streams and releases capacity when a consumer returns', async () => {
    const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
    const transport = createTransport({
      fetch: asFetch(
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                streams.push(controller);
                controller.enqueue(encoder.encode('data: ready\n\n'));
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
      maxConcurrentStreams: 1,
    });
    const first = transport.subscribe('events')[Symbol.asyncIterator]();
    await expect(first.next()).resolves.toMatchObject({ done: false });
    await expect(
      collect(transport.subscribe('other-events')),
    ).rejects.toMatchObject({ code: 'capacity_exceeded' });
    await first.return?.();

    const second = transport.subscribe('other-events')[Symbol.asyncIterator]();
    await expect(second.next()).resolves.toMatchObject({ done: false });
    await second.return?.();
    expect(streams).toHaveLength(2);
  });

  it('distinguishes connect timeout, caller abort, transport close, and stream read failure', async () => {
    vi.useFakeTimers();
    const pending = pendingFetch();
    const timeoutTransport = createTransport({
      fetch: pending.fetch,
      sseConnectTimeoutMs: 10,
    });
    const timedOut = capture(collect(timeoutTransport.subscribe('events')));
    await vi.advanceTimersByTimeAsync(10);
    await expect(timedOut).resolves.toMatchObject({ code: 'request_timeout' });

    const controller = new AbortController();
    const aborted = collect(
      createTransport({ fetch: pending.fetch }).subscribe('events', {
        signal: controller.signal,
      }),
    );
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: 'request_aborted' });

    const closeTransport = createTransport({ fetch: pending.fetch });
    const closed = collect(closeTransport.subscribe('events'));
    await closeTransport.close();
    await expect(closed).resolves.toEqual([]);

    const readFailure = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.error(new Error('synthetic stream secret'));
      },
    });
    const failure = await capture(
      collect(
        createTransport({
          fetch: asFetch(
            () =>
              new Response(readFailure, {
                headers: { 'content-type': 'text/event-stream' },
              }),
          ),
        }).subscribe('events'),
      ),
    );
    expect(failure).toMatchObject({ code: 'response_stream_failed' });
    expect(inspect(failure)).not.toContain('synthetic stream secret');
  });

  it('settles stream abort and consumer return without waiting for cancellation', async () => {
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const abortCancel = vi.fn(() => new Promise<void>(() => undefined));
    const abortTransport = createTransport({
      fetch: asFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: abortCancel,
              pull() {
                markReadStarted?.();
                return new Promise<void>(() => undefined);
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    });
    const controller = new AbortController();
    const iterator = abortTransport
      .subscribe('events', { signal: controller.signal })
      [Symbol.asyncIterator]();
    const next = iterator.next();
    await readStarted;

    controller.abort();

    await expect(next).rejects.toMatchObject({ code: 'request_aborted' });
    expect(abortCancel).toHaveBeenCalledOnce();

    const returnCancel = vi.fn(() => new Promise<void>(() => undefined));
    const returnTransport = createTransport({
      fetch: asFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: returnCancel,
              start(streamController) {
                streamController.enqueue(encoder.encode('data: ready\n\n'));
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    });
    const returned = returnTransport
      .subscribe('events')
      [Symbol.asyncIterator]();
    await expect(returned.next()).resolves.toMatchObject({ done: false });
    await expect(returned.return?.()).resolves.toMatchObject({ done: true });
    expect(returnCancel).toHaveBeenCalledOnce();
  });

  it('interrupts a pending next on return and cancels a stream paused at yield on close', async () => {
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const pendingCancel = vi.fn(() => new Promise<void>(() => undefined));
    const pendingTransport = createTransport({
      fetch: asFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: pendingCancel,
              pull() {
                markReadStarted?.();
                return new Promise<void>(() => undefined);
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    });
    const pendingIterator = pendingTransport
      .subscribe('events')
      [Symbol.asyncIterator]();
    const pendingNext = pendingIterator.next();
    await readStarted;

    const returned = pendingIterator.return?.();

    await expect(returned).resolves.toMatchObject({ done: true });
    await expect(pendingNext).resolves.toMatchObject({ done: true });
    expect(pendingCancel).toHaveBeenCalledOnce();

    const closeCancel = vi.fn(() => new Promise<void>(() => undefined));
    const closeTransport = createTransport({
      fetch: asFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: closeCancel,
              start(streamController) {
                streamController.enqueue(encoder.encode('data: ready\n\n'));
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    });
    const closeIterator = closeTransport
      .subscribe('events')
      [Symbol.asyncIterator]();
    await expect(closeIterator.next()).resolves.toMatchObject({ done: false });

    await expect(closeTransport.close()).resolves.toBeUndefined();

    expect(closeCancel).toHaveBeenCalledOnce();
    await expect(closeIterator.return?.()).resolves.toMatchObject({
      done: true,
    });
    expect(closeCancel).toHaveBeenCalledOnce();
  });

  it('preserves an explicit Accept header and empty data dispatch', async () => {
    const accepted: string[] = [];
    const transport = createTransport({
      fetch: asFetch((_input, init) => {
        accepted.push(new Headers(init?.headers).get('accept') ?? '');
        return response(['data\nevent:\nretry: 999999999999999999999\n\n'], {
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    });
    const iterator = transport
      .subscribe('events', { headers: { accept: 'text/event-stream' } })
      [Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: '', id: '' },
    });
    await iterator.return?.();
    expect(accepted).toEqual(['text/event-stream']);
  });
});

describe('HttpSseTransport configuration', () => {
  it('validates base URLs, limits, and default headers with fixed errors', () => {
    const sensitive = 'synthetic-secret';
    const cases: HttpSseTransportOptions[] = [
      { baseUrl: 'file:///private/provider' },
      { baseUrl: `https://user:${sensitive}@provider.invalid/` },
      { baseUrl: 'https://provider.invalid/root?query=private' },
      { baseUrl: 'https://provider.invalid/root#private' },
      { baseUrl: 'https://provider.invalid/', maxResponseBytes: 0 },
      { baseUrl: 'not a URL' },
      { baseUrl: 'https://provider.invalid/', requestTimeoutMs: 2_147_483_648 },
      {
        baseUrl: 'https://provider.invalid/',
        fetch: 'invalid' as unknown as typeof fetch,
      },
      {
        baseUrl: 'https://provider.invalid/',
        cleanup: 'invalid' as unknown as () => void,
      },
      {
        baseUrl: 'https://provider.invalid/',
        defaultHeaders: { 'bad\nheader': sensitive },
      },
      {
        baseUrl: 'https://provider.invalid/',
        defaultHeaders: { authorization: sensitive },
        maxHeaderBytes: 1,
      },
    ];
    for (const options of cases) {
      let failure: unknown;
      try {
        new HttpSseTransport(options);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(HttpTransportError);
      expect(failure).toMatchObject({ code: 'invalid_configuration' });
      expect(inspect(failure)).not.toContain(sensitive);
      expect(inspect(failure)).not.toContain('/private/provider');
    }
  });

  it('serializes only bounded error metadata', () => {
    const failure = new HttpTransportError('http_status', 503);
    expect(failure.toJSON()).toEqual({
      code: 'http_status',
      message: 'The SSE endpoint returned a non-success HTTP status.',
      name: 'HttpTransportError',
      status: 503,
    });
    expect(inspect(failure)).not.toContain(process.cwd());
    expect(failure.stack).not.toContain(process.cwd());
    expect(
      new HttpTransportError('http_status', 999).toJSON(),
    ).not.toHaveProperty('status');
  });

  it('does not expose endpoint or header credentials through inspection', () => {
    const endpoint = 'private-endpoint.invalid';
    const secret = 'synthetic-secret';
    const transport = createTransport({
      baseUrl: `https://${endpoint}/root/`,
      defaultHeaders: { authorization: `Bearer ${secret}` },
    });

    expect(inspect(transport)).not.toContain(endpoint);
    expect(inspect(transport)).not.toContain(secret);
    expect(JSON.stringify(transport)).not.toContain(endpoint);
    expect(JSON.stringify(transport)).not.toContain(secret);
  });
});
