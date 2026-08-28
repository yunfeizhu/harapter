import { inspect } from 'node:util';

/** Stable failure categories emitted by the HTTP/SSE transport. */
export type HttpTransportErrorCode =
  | 'capacity_exceeded'
  | 'cleanup_failed'
  | 'headers_too_large'
  | 'http_status'
  | 'invalid_configuration'
  | 'invalid_request'
  | 'invalid_sse_encoding'
  | 'invalid_sse_response'
  | 'network_failure'
  | 'request_aborted'
  | 'request_timeout'
  | 'request_too_large'
  | 'response_stream_failed'
  | 'response_too_large'
  | 'sse_chunk_too_large'
  | 'sse_event_too_large'
  | 'sse_line_too_large'
  | 'stream_ended'
  | 'transport_closed';

/** HTTP methods accepted by the bounded request API. */
export type HttpMethod =
  'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT';

/** Caller-provided HTTP headers. Values may contain credentials. */
export type HttpHeaderMap = Readonly<Record<string, string>>;

/** Constructor controls for one endpoint-bound transport. */
export interface HttpSseTransportOptions {
  readonly baseUrl: string | URL;
  readonly fetch?: typeof fetch;
  readonly defaultHeaders?: HttpHeaderMap;
  readonly cleanup?: () => Promise<void> | void;
  readonly maxConcurrentRequests?: number;
  readonly maxConcurrentStreams?: number;
  readonly maxHeaderBytes?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxSseChunkBytes?: number;
  readonly maxSseEventBytes?: number;
  readonly maxSseLineBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly sseConnectTimeoutMs?: number;
}

/** Options for one ordinary HTTP request. */
export interface HttpRequestOptions {
  readonly method?: HttpMethod;
  readonly headers?: HttpHeaderMap;
  readonly body?: string | Uint8Array;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Bounded HTTP response data returned to a Provider Adapter. */
export interface HttpTransportResponse {
  readonly status: number;
  readonly body: Uint8Array;
  readonly contentType?: string;
}

/** Options for one Server-Sent Events subscription. */
export interface SseSubscribeOptions {
  readonly headers?: HttpHeaderMap;
  readonly signal?: AbortSignal;
  readonly connectTimeoutMs?: number;
}

/** One parsed SSE dispatch without Provider-level interpretation. */
export interface SseEvent {
  readonly data: string;
  readonly id: string;
  readonly event?: string;
  readonly retry?: number;
}

const errorMessages: Readonly<Record<HttpTransportErrorCode, string>> = {
  capacity_exceeded: 'The HTTP transport capacity limit was reached.',
  cleanup_failed: 'HTTP transport cleanup failed.',
  headers_too_large: 'The HTTP request headers exceed the configured limit.',
  http_status: 'The SSE endpoint returned a non-success HTTP status.',
  invalid_configuration: 'The HTTP transport configuration is invalid.',
  invalid_request: 'The HTTP transport request is invalid.',
  invalid_sse_encoding: 'The SSE stream contains invalid UTF-8.',
  invalid_sse_response: 'The HTTP response is not a valid SSE stream.',
  network_failure: 'The HTTP request failed before a response was available.',
  request_aborted: 'The local HTTP operation was aborted.',
  request_timeout: 'The local HTTP operation timed out.',
  request_too_large: 'The HTTP request body exceeds the configured limit.',
  response_stream_failed: 'The HTTP response stream failed.',
  response_too_large: 'The HTTP response body exceeds the configured limit.',
  sse_chunk_too_large: 'An SSE stream chunk exceeds the configured limit.',
  sse_event_too_large: 'An SSE event exceeds the configured limit.',
  sse_line_too_large: 'An SSE line exceeds the configured limit.',
  stream_ended: 'The SSE stream ended unexpectedly.',
  transport_closed: 'The HTTP transport is closed.',
};

/** Content-free transport failure safe for ordinary JSON and Node inspection. */
export class HttpTransportError extends Error {
  readonly code: HttpTransportErrorCode;
  readonly status: number | undefined;

  constructor(code: HttpTransportErrorCode, status?: number) {
    super(errorMessages[code]);
    this.name = 'HttpTransportError';
    this.code = code;
    this.status = isHttpStatus(status) ? status : undefined;
    Object.defineProperty(this, 'stack', {
      configurable: false,
      enumerable: false,
      value: `${this.name}: ${this.message}`,
      writable: false,
    });
  }

  toJSON(): Readonly<Record<string, number | string>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
    };
  }

  /** Keep Node inspection bounded and free of captured local stack paths. */
  [inspect.custom](): Readonly<Record<string, number | string>> {
    return this.toJSON();
  }
}

const defaultMaxConcurrentRequests = 64;
const defaultMaxConcurrentStreams = 8;
const defaultMaxHeaderBytes = 64 * 1024;
const defaultMaxRequestBytes = 1024 * 1024;
const defaultMaxResponseBytes = 1024 * 1024;
const defaultMaxSseChunkBytes = 1024 * 1024;
const defaultMaxSseEventBytes = 1024 * 1024;
const defaultMaxSseLineBytes = 64 * 1024;
const defaultRequestTimeoutMs = 30_000;
const defaultSseConnectTimeoutMs = 30_000;
const maximumTimerMs = 2_147_483_647;
const maximumPathLength = 8192;
const maximumContentTypeLength = 256;
const validMethods = new Set<HttpMethod>([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
]);

type OperationKind = 'request' | 'stream';
type LocalAbortReason =
  | 'request_aborted'
  | 'request_timeout'
  | 'stream_disposed'
  | 'transport_closed';

interface ActiveOperation {
  readonly controller: AbortController;
  readonly kind: OperationKind;
  readonly abort: (reason: LocalAbortReason) => void;
  readonly finish: () => void;
  readonly clearTimer: () => void;
  readonly reason: () => LocalAbortReason | undefined;
  readonly setDisposer: (disposer: () => void) => void;
}

interface SseLimits {
  readonly maxChunkBytes: number;
  readonly maxEventBytes: number;
  readonly maxLineBytes: number;
}

/**
 * Endpoint-bound, Provider-neutral HTTP request and SSE transport.
 * Provider routes, payload validation, authentication policy, and lifecycle
 * meaning remain the responsibility of the consuming Adapter.
 */
export class HttpSseTransport {
  readonly #activeOperations = new Set<ActiveOperation>();
  readonly #baseUrl: URL;
  readonly #cleanup: (() => Promise<void> | void) | undefined;
  readonly #defaultHeaders: Headers;
  readonly #fetchImplementation: typeof fetch;
  readonly #maxConcurrentRequests: number;
  readonly #maxConcurrentStreams: number;
  readonly #maxHeaderBytes: number;
  readonly #maxRequestBytes: number;
  readonly #maxResponseBytes: number;
  readonly #sseLimits: SseLimits;
  readonly #requestTimeoutMs: number;
  readonly #sseConnectTimeoutMs: number;
  #cleanupFailure: HttpTransportError | undefined;
  #cleanupPromise: Promise<void> | undefined;
  #open = true;

  constructor(options: HttpSseTransportOptions) {
    if (!isRuntimeRecord(options)) {
      throw transportError('invalid_configuration');
    }
    this.#baseUrl = validatedBaseUrl(options.baseUrl);
    this.#fetchImplementation =
      options.fetch === undefined
        ? fetch
        : typeof options.fetch === 'function'
          ? options.fetch
          : invalidConfiguration();
    this.#cleanup =
      options.cleanup === undefined
        ? undefined
        : typeof options.cleanup === 'function'
          ? options.cleanup
          : invalidConfiguration();
    this.#maxConcurrentRequests = positiveConfigurationInteger(
      options.maxConcurrentRequests,
      defaultMaxConcurrentRequests,
    );
    this.#maxConcurrentStreams = positiveConfigurationInteger(
      options.maxConcurrentStreams,
      defaultMaxConcurrentStreams,
    );
    this.#maxHeaderBytes = positiveConfigurationInteger(
      options.maxHeaderBytes,
      defaultMaxHeaderBytes,
    );
    this.#maxRequestBytes = positiveConfigurationInteger(
      options.maxRequestBytes,
      defaultMaxRequestBytes,
    );
    this.#maxResponseBytes = positiveConfigurationInteger(
      options.maxResponseBytes,
      defaultMaxResponseBytes,
    );
    this.#sseLimits = {
      maxChunkBytes: positiveConfigurationInteger(
        options.maxSseChunkBytes,
        defaultMaxSseChunkBytes,
      ),
      maxEventBytes: positiveConfigurationInteger(
        options.maxSseEventBytes,
        defaultMaxSseEventBytes,
      ),
      maxLineBytes: positiveConfigurationInteger(
        options.maxSseLineBytes,
        defaultMaxSseLineBytes,
      ),
    };
    this.#requestTimeoutMs = configurationTimer(
      options.requestTimeoutMs,
      defaultRequestTimeoutMs,
    );
    this.#sseConnectTimeoutMs = configurationTimer(
      options.sseConnectTimeoutMs,
      defaultSseConnectTimeoutMs,
    );
    this.#defaultHeaders = configurationHeaders(
      options.defaultHeaders,
      this.#maxHeaderBytes,
    );
  }

  /** Send one bounded HTTP request. HTTP statuses remain Adapter-owned data. */
  async request(
    path: string,
    options: HttpRequestOptions = {},
  ): Promise<HttpTransportResponse> {
    let operation: ActiveOperation | undefined;
    let phase: 'body' | 'fetch' = 'fetch';
    try {
      const request = this.prepareRequest(path, options);
      operation = this.beginOperation(
        'request',
        options.signal,
        request.timeoutMs,
      );
      const upstream = await waitForResponse(
        this.#fetchImplementation(request.url, {
          ...(request.body === undefined ? {} : { body: request.body }),
          credentials: 'omit',
          headers: request.headers,
          method: request.method,
          redirect: 'manual',
          signal: operation.controller.signal,
        }),
        operation,
      );
      throwForResponseAbort(upstream, operation);
      phase = 'body';
      const body = await readBoundedBody(
        upstream.body,
        this.#maxResponseBytes,
        operation,
      );
      throwForLocalAbort(operation);
      const contentType = boundedContentType(upstream.headers);
      return {
        body,
        status: upstream.status,
        ...(contentType === undefined ? {} : { contentType }),
      };
    } catch (error) {
      throw mapOperationError(error, operation, phase);
    } finally {
      operation?.finish();
    }
  }

  /** Open one pull-driven, bounded SSE subscription. */
  subscribe(
    path: string,
    options: SseSubscribeOptions = {},
  ): AsyncIterable<SseEvent> {
    const disposeController = new AbortController();
    const iterator = this.iterateSse(path, options, disposeController.signal);
    const cancellable: AsyncIterableIterator<SseEvent> = {
      next: () => iterator.next(),
      return: async () => {
        disposeController.abort();
        return iterator.return(undefined);
      },
      throw: async (error?: unknown) => {
        disposeController.abort();
        return iterator.throw(error);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    return cancellable;
  }

  /** Whether new operations can be accepted. */
  isOpen(): boolean {
    return this.#open;
  }

  /** Abort active operations and run caller cleanup at most once. */
  async close(): Promise<void> {
    if (this.#open) {
      this.#open = false;
      for (const operation of [...this.#activeOperations]) {
        operation.abort('transport_closed');
      }
    }
    this.#cleanupPromise ??= Promise.resolve()
      .then(() => this.#cleanup?.())
      .catch(() => {
        this.#cleanupFailure ??= transportError('cleanup_failed');
      });
    await this.#cleanupPromise;
    if (this.#cleanupFailure !== undefined) throw this.#cleanupFailure;
  }

  private async *iterateSse(
    path: string,
    options: SseSubscribeOptions,
    disposeSignal: AbortSignal,
  ): AsyncGenerator<SseEvent> {
    let operation: ActiveOperation | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let phase: 'body' | 'fetch' = 'fetch';
    const onDispose = (): void => {
      operation?.abort('stream_disposed');
    };
    try {
      if (disposeSignal.aborted) return;
      const url = this.resolvePath(path);
      const headers = this.requestHeaders(options.headers, true);
      const timeoutMs = requestTimer(
        options.connectTimeoutMs,
        this.#sseConnectTimeoutMs,
      );
      operation = this.beginOperation('stream', options.signal, timeoutMs);
      disposeSignal.addEventListener('abort', onDispose, { once: true });
      const upstream = await waitForResponse(
        this.#fetchImplementation(url, {
          credentials: 'omit',
          headers,
          method: 'GET',
          redirect: 'manual',
          signal: operation.controller.signal,
        }),
        operation,
      );
      throwForResponseAbort(upstream, operation);
      operation.clearTimer();
      if (upstream.status < 200 || upstream.status >= 300) {
        cancelStream(upstream.body);
        throw new HttpTransportError('http_status', upstream.status);
      }
      if (!isEventStream(upstream.headers) || upstream.body === null) {
        cancelStream(upstream.body);
        throw transportError('invalid_sse_response');
      }
      phase = 'body';
      reader = upstream.body.getReader();
      operation.setDisposer(() => {
        if (reader !== undefined) cancelReader(reader);
      });
      for await (const event of parseSse(reader, this.#sseLimits, operation)) {
        throwForLocalAbort(operation);
        yield event;
      }
      throw transportError('stream_ended');
    } catch (error) {
      if (operation?.reason() === 'stream_disposed') return;
      const mapped = mapOperationError(error, operation, phase);
      if (mapped.code === 'transport_closed') return;
      throw mapped;
    } finally {
      disposeSignal.removeEventListener('abort', onDispose);
      operation?.finish();
    }
  }

  private prepareRequest(
    path: string,
    options: HttpRequestOptions,
  ): {
    readonly body?: Uint8Array;
    readonly headers: Headers;
    readonly method: HttpMethod;
    readonly timeoutMs: number;
    readonly url: URL;
  } {
    if (!isRuntimeRecord(options)) throw transportError('invalid_request');
    const method = options.method ?? 'GET';
    if (!validMethods.has(method)) throw transportError('invalid_request');
    const body = requestBody(options.body, this.#maxRequestBytes);
    if (body !== undefined && (method === 'GET' || method === 'HEAD')) {
      throw transportError('invalid_request');
    }
    return {
      ...(body === undefined ? {} : { body }),
      headers: this.requestHeaders(options.headers, false),
      method,
      timeoutMs: requestTimer(options.timeoutMs, this.#requestTimeoutMs),
      url: this.resolvePath(path),
    };
  }

  private resolvePath(path: string): URL {
    if (
      typeof path !== 'string' ||
      path.length === 0 ||
      path.length > maximumPathLength ||
      hasControlCharacter(path) ||
      /^[A-Za-z][A-Za-z\d+.-]*:/u.test(path) ||
      path.startsWith('//')
    ) {
      throw transportError('invalid_request');
    }
    let resolved: URL;
    try {
      resolved = new URL(path, this.#baseUrl);
    } catch {
      throw transportError('invalid_request');
    }
    if (
      resolved.origin !== this.#baseUrl.origin ||
      resolved.hash.length > 0 ||
      !resolved.pathname.startsWith(this.#baseUrl.pathname)
    ) {
      throw transportError('invalid_request');
    }
    return resolved;
  }

  private requestHeaders(
    value: HttpHeaderMap | undefined,
    eventStream: boolean,
  ): Headers {
    let headers: Headers;
    try {
      headers = new Headers(this.#defaultHeaders);
      appendHeaders(headers, value);
      if (eventStream && !headers.has('accept')) {
        headers.set('accept', 'text/event-stream');
      }
    } catch {
      throw transportError('invalid_request');
    }
    if (headerBytes(headers) > this.#maxHeaderBytes) {
      throw transportError('headers_too_large');
    }
    return headers;
  }

  private beginOperation(
    kind: OperationKind,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): ActiveOperation {
    if (!this.#open) throw transportError('transport_closed');
    if (signal !== undefined && !isAbortSignal(signal)) {
      throw transportError('invalid_request');
    }
    if (signal?.aborted === true) throw transportError('request_aborted');
    const activeOfKind = [...this.#activeOperations].filter(
      (operation) => operation.kind === kind,
    ).length;
    const limit =
      kind === 'request'
        ? this.#maxConcurrentRequests
        : this.#maxConcurrentStreams;
    if (activeOfKind >= limit) throw transportError('capacity_exceeded');

    const controller = new AbortController();
    let disposer: (() => void) | undefined;
    let reason: LocalAbortReason | undefined;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation: ActiveOperation = {
      controller,
      kind,
      abort: (next) => {
        if (reason !== undefined || finished) return;
        reason = next;
        controller.abort();
        operation.finish();
      },
      reason: () => reason,
      clearTimer: () => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
      },
      finish: () => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onCallerAbort);
        const currentDisposer = disposer;
        disposer = undefined;
        currentDisposer?.();
        this.#activeOperations.delete(operation);
      },
      setDisposer: (nextDisposer) => {
        if (finished || reason !== undefined) {
          nextDisposer();
          return;
        }
        disposer = nextDisposer;
      },
    };
    const onCallerAbort = (): void => {
      operation.abort('request_aborted');
    };
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    timer = setTimeout(() => {
      operation.abort('request_timeout');
    }, timeoutMs);
    this.#activeOperations.add(operation);
    return operation;
  }
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  operation: ActiveOperation,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let completed = false;
  let total = 0;
  try {
    for (;;) {
      const next = await waitForOperation(reader.read(), operation);
      if (next.done) {
        completed = true;
        break;
      }
      if (!(next.value instanceof Uint8Array)) {
        throw transportError('response_stream_failed');
      }
      total += next.value.byteLength;
      if (total > maximumBytes) {
        throw transportError('response_too_large');
      }
      chunks.push(new Uint8Array(next.value));
    }
  } catch (error) {
    if (error instanceof HttpTransportError) throw error;
    throw transportError('response_stream_failed');
  } finally {
    if (completed) releaseReader(reader);
    else cancelReader(reader);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function* parseSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limits: SseLimits,
  operation: ActiveOperation,
): AsyncGenerator<SseEvent> {
  let lineChunks: Uint8Array[] = [];
  let lineBytes = 0;
  let eventBytes = 0;
  let firstLine = true;
  let skipLineFeed = false;
  let dataLines: string[] = [];
  let eventName: string | undefined;
  let retry: number | undefined;
  let lastEventId = '';

  const consumeLine = (rawLine: Uint8Array): SseEvent | undefined => {
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(rawLine);
    } catch {
      throw transportError('invalid_sse_encoding');
    }
    if (firstLine) {
      firstLine = false;
      if (decoded.startsWith('\uFEFF')) decoded = decoded.slice(1);
    }
    if (decoded.length === 0) {
      const dispatched =
        dataLines.length === 0
          ? undefined
          : {
              data: dataLines.join('\n'),
              id: lastEventId,
              ...(eventName === undefined || eventName.length === 0
                ? {}
                : { event: eventName }),
              ...(retry === undefined ? {} : { retry }),
            };
      dataLines = [];
      eventName = undefined;
      retry = undefined;
      eventBytes = 0;
      return dispatched;
    }

    eventBytes += rawLine.byteLength + 1;
    if (eventBytes > limits.maxEventBytes) {
      throw transportError('sse_event_too_large');
    }
    if (decoded.startsWith(':')) return undefined;
    const colon = decoded.indexOf(':');
    const field = colon < 0 ? decoded : decoded.slice(0, colon);
    let value = colon < 0 ? '' : decoded.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'data':
        dataLines.push(value);
        break;
      case 'event':
        eventName = value;
        break;
      case 'id':
        if (!value.includes('\u0000')) lastEventId = value;
        break;
      case 'retry':
        if (/^[0-9]+$/u.test(value)) {
          const parsed = Number(value);
          if (Number.isSafeInteger(parsed)) retry = parsed;
        }
        break;
      default:
        break;
    }
    return undefined;
  };

  for (;;) {
    let next: Awaited<
      ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>
    >;
    try {
      next = await waitForOperation(reader.read(), operation);
    } catch {
      throw transportError('response_stream_failed');
    }
    if (next.done) {
      if (lineBytes > 0) {
        consumeLine(concatenate(lineChunks, lineBytes));
      }
      return;
    }
    if (!(next.value instanceof Uint8Array)) {
      throw transportError('response_stream_failed');
    }
    if (next.value.byteLength > limits.maxChunkBytes) {
      throw transportError('sse_chunk_too_large');
    }
    let segmentStart = 0;
    for (let index = 0; index < next.value.byteLength; index += 1) {
      const byte = next.value[index];
      if (skipLineFeed) {
        skipLineFeed = false;
        if (byte === 0x0a) {
          segmentStart = index + 1;
          continue;
        }
      }
      if (byte !== 0x0a && byte !== 0x0d) continue;
      const segment = next.value.subarray(segmentStart, index);
      lineBytes += segment.byteLength;
      if (lineBytes > limits.maxLineBytes) {
        throw transportError('sse_line_too_large');
      }
      if (segment.byteLength > 0) lineChunks.push(new Uint8Array(segment));
      const event = consumeLine(concatenate(lineChunks, lineBytes));
      lineChunks = [];
      lineBytes = 0;
      segmentStart = index + 1;
      skipLineFeed = byte === 0x0d;
      if (event !== undefined) yield event;
    }
    if (segmentStart < next.value.byteLength) {
      const segment = next.value.subarray(segmentStart);
      lineBytes += segment.byteLength;
      if (lineBytes > limits.maxLineBytes) {
        throw transportError('sse_line_too_large');
      }
      lineChunks.push(new Uint8Array(segment));
    }
  }
}

function validatedBaseUrl(value: string | URL): URL {
  let baseUrl: URL;
  try {
    baseUrl = new URL(String(value));
  } catch {
    throw transportError('invalid_configuration');
  }
  if (
    (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0
  ) {
    throw transportError('invalid_configuration');
  }
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
  return baseUrl;
}

function configurationHeaders(
  value: HttpHeaderMap | undefined,
  maximumBytes: number,
): Headers {
  try {
    const headers = new Headers();
    appendHeaders(headers, value);
    if (headerBytes(headers) > maximumBytes) invalidConfiguration();
    return headers;
  } catch (error) {
    if (
      error instanceof HttpTransportError &&
      error.code === 'invalid_configuration'
    ) {
      throw error;
    }
    throw transportError('invalid_configuration');
  }
}

function appendHeaders(
  headers: Headers,
  value: HttpHeaderMap | undefined,
): void {
  if (value === undefined) return;
  if (!isRuntimeRecord(value)) throw new TypeError('Invalid headers.');
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== 'string') throw new TypeError('Invalid header.');
    headers.set(name, headerValue);
  }
}

function headerBytes(headers: Headers): number {
  let total = 0;
  for (const [name, value] of headers) {
    total += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8');
  }
  return total;
}

function requestBody(
  value: string | Uint8Array | undefined,
  maximumBytes: number,
): Uint8Array | undefined {
  if (value === undefined) return undefined;
  const body =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? new Uint8Array(value)
        : undefined;
  if (body === undefined) throw transportError('invalid_request');
  if (body.byteLength > maximumBytes) throw transportError('request_too_large');
  return body;
}

function positiveConfigurationInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) invalidConfiguration();
  return value;
}

function configurationTimer(
  value: number | undefined,
  fallback: number,
): number {
  const timer = positiveConfigurationInteger(value, fallback);
  if (timer > maximumTimerMs) invalidConfiguration();
  return timer;
}

function requestTimer(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximumTimerMs) {
    throw transportError('invalid_request');
  }
  return value;
}

function boundedContentType(headers: Headers): string | undefined {
  let value: string | null;
  try {
    value = headers.get('content-type');
  } catch {
    return undefined;
  }
  if (value === null || value.length > maximumContentTypeLength)
    return undefined;
  return value;
}

function isEventStream(headers: Headers): boolean {
  const contentType = boundedContentType(headers);
  if (contentType === undefined) return false;
  return (
    contentType.split(';', 1)[0]?.trim().toLowerCase() === 'text/event-stream'
  );
}

function mapOperationError(
  error: unknown,
  operation: ActiveOperation | undefined,
  phase: 'body' | 'fetch',
): HttpTransportError {
  const reason = operation?.reason();
  if (reason !== undefined) return transportError(abortErrorCode(reason));
  if (error instanceof HttpTransportError) return error;
  return transportError(
    phase === 'fetch' ? 'network_failure' : 'response_stream_failed',
  );
}

function throwForLocalAbort(operation: ActiveOperation): void {
  const reason = operation.reason();
  if (reason !== undefined) throw transportError(abortErrorCode(reason));
}

function throwForResponseAbort(
  response: Response,
  operation: ActiveOperation,
): void {
  const reason = operation.reason();
  if (reason === undefined) return;
  cancelStream(response.body);
  throw transportError(abortErrorCode(reason));
}

function abortErrorCode(reason: LocalAbortReason): HttpTransportErrorCode {
  return reason === 'stream_disposed' ? 'request_aborted' : reason;
}

function waitForOperation<T>(
  pending: Promise<T>,
  operation: ActiveOperation,
): Promise<T> {
  const signal = operation.controller.signal;
  if (signal.aborted) {
    return Promise.reject(
      transportError(abortErrorCode(operation.reason() ?? 'request_aborted')),
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = (): void => {
      finish(() => {
        reject(
          transportError(
            abortErrorCode(operation.reason() ?? 'request_aborted'),
          ),
        );
      });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void pending.then(
      (value) => {
        finish(() => {
          resolve(value);
        });
      },
      (error: unknown) => {
        finish(() => {
          reject(error instanceof Error ? error : new Error());
        });
      },
    );
  });
}

async function waitForResponse(
  pending: Promise<Response>,
  operation: ActiveOperation,
): Promise<Response> {
  try {
    const response = await waitForOperation(pending, operation);
    throwForLocalAbort(operation);
    return response;
  } catch (error) {
    if (operation.reason() !== undefined) {
      void pending.then(
        (response) => {
          cancelStream(response.body);
        },
        () => undefined,
      );
    }
    throw error;
  }
}

function cancelStream(stream: ReadableStream<Uint8Array> | null): void {
  if (stream === null) return;
  try {
    void stream.cancel().catch(() => undefined);
  } catch {
    // A locked or non-standard injected stream remains owned by its reader.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Reader disposal is best effort and must not delay local settlement.
  }
  releaseReader(reader);
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // A pending non-standard read must not delay local settlement.
  }
}

function concatenate(chunks: readonly Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0] ?? new Uint8Array();
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof (value as { addEventListener?: unknown }).addEventListener ===
      'function' &&
    typeof (value as { removeEventListener?: unknown }).removeEventListener ===
      'function'
  );
}

function isHttpStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) return true;
  }
  return false;
}

function isRuntimeRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function transportError(code: HttpTransportErrorCode): HttpTransportError {
  return new HttpTransportError(code);
}

function invalidConfiguration(): never {
  throw transportError('invalid_configuration');
}
