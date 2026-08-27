import type { Readable, Writable } from 'node:stream';
import { setImmediate as scheduleImmediate } from 'node:timers';
import { inspect } from 'node:util';

const defaultMaxMessageBytes = 1024 * 1024;
const defaultMaxBufferedMessages = 128;
const defaultMaxPendingRequests = 128;
const defaultMaxPendingInboundRequests = 128;
const defaultMaxPendingWrites = 128;
const defaultRequestTimeoutMs = 30_000;
const maximumTimerMilliseconds = 2_147_483_647;

/** JSON-RPC identifier supported by the transport. */
export type JsonRpcId = string | number;

/** JSON-RPC error object returned by a remote peer. */
export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** Request initiated by the remote peer. */
export interface JsonRpcInboundRequest {
  readonly kind: 'request';
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

/** Notification emitted by the remote peer. */
export interface JsonRpcInboundNotification {
  readonly kind: 'notification';
  readonly method: string;
  readonly params?: unknown;
}

/** Inbound messages that require Provider-level interpretation. */
export type JsonRpcInboundMessage =
  JsonRpcInboundRequest | JsonRpcInboundNotification;

/** Safe transport diagnostic without message content or remote identifiers. */
export interface JsonRpcDiagnostic {
  readonly code: 'unmatched_response';
}

/** Stable transport failure categories for Provider error mapping. */
export type JsonRpcTransportErrorCode =
  | 'capacity_exceeded'
  | 'cleanup_failed'
  | 'consumer_conflict'
  | 'invalid_configuration'
  | 'invalid_outbound_message'
  | 'malformed_message'
  | 'message_too_large'
  | 'request_aborted'
  | 'request_timeout'
  | 'response_not_pending'
  | 'stream_ended'
  | 'stream_failed'
  | 'transport_closed'
  | 'truncated_message'
  | 'write_failed';

/** Safe transport failure that never includes a frame or stream error body. */
export class JsonRpcTransportError extends Error {
  readonly code: JsonRpcTransportErrorCode;

  constructor(code: JsonRpcTransportErrorCode, message: string) {
    super(message);
    this.name = 'JsonRpcTransportError';
    this.code = code;
  }
}

/** Safe remote failure with raw fields behind an explicit extraction method. */
export class JsonRpcRemoteError extends Error {
  readonly #remoteError: JsonRpcErrorObject;

  constructor(error: JsonRpcErrorObject) {
    super('Remote JSON-RPC request failed.');
    Object.defineProperty(this, 'name', { value: 'JsonRpcRemoteError' });
    this.#remoteError = Object.prototype.hasOwnProperty.call(error, 'data')
      ? { code: error.code, data: error.data, message: error.message }
      : { code: error.code, message: error.message };
  }

  /** Explicitly extract untrusted fields for Provider validation and redaction. */
  getRemoteError(): JsonRpcErrorObject {
    return this.#remoteError;
  }

  /** Keep generic JSON error logging bounded and content-free. */
  toJSON(): Readonly<{ message: string; name: string }> {
    return { message: this.message, name: this.name };
  }

  /** Keep Node inspection bounded and content-free. */
  [inspect.custom](): string {
    return `${this.name}: ${this.message}`;
  }
}

/** Request-local timeout and wait-abort controls. */
export interface JsonRpcRequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Explicit stream, lifecycle, and resource limits for one connection. */
export interface JsonRpcStdioTransportOptions {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly cleanup?: () => Promise<void> | void;
  readonly emitJsonRpcVersion?: boolean;
  readonly maxMessageBytes?: number;
  readonly maxBufferedMessages?: number;
  readonly maxPendingRequests?: number;
  readonly maxPendingInboundRequests?: number;
  readonly maxPendingWrites?: number;
  readonly requestTimeoutMs?: number;
  readonly onDiagnostic?: (diagnostic: JsonRpcDiagnostic) => void;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: JsonRpcTransportError | JsonRpcRemoteError) => void;
  readonly timer: NodeJS.Timeout;
  readonly signal: AbortSignal | undefined;
  readonly abortListener: (() => void) | undefined;
  writeStarted: boolean;
}

type JsonRecord = Record<string, unknown>;

class InboundQueue {
  private readonly capacity: number;
  private readonly values: JsonRpcInboundMessage[] = [];
  private waiter:
    | {
        resolve: (result: IteratorResult<JsonRpcInboundMessage>) => void;
        reject: (error: JsonRpcTransportError) => void;
      }
    | undefined;
  private closed = false;
  private failure: JsonRpcTransportError | undefined;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(value: JsonRpcInboundMessage): boolean {
    if (this.closed) return false;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter.resolve({ done: false, value });
      return true;
    }
    if (this.values.length >= this.capacity) return false;
    this.values.push(value);
    return true;
  }

  next(): Promise<IteratorResult<JsonRpcInboundMessage>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ done: false, value });
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    if (this.waiter) {
      return Promise.reject(
        transportError(
          'consumer_conflict',
          'Only one inbound read may be pending at a time.',
        ),
      );
    }
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  close(failure?: JsonRpcTransportError): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = failure;
    this.values.length = 0;
    if (!this.waiter) return;
    const waiter = this.waiter;
    this.waiter = undefined;
    if (failure) waiter.reject(failure);
    else waiter.resolve({ done: true, value: undefined });
  }
}

/**
 * Bounded bidirectional JSONL RPC transport over caller-owned Node streams.
 * It correlates responses but leaves Provider methods and lifecycle semantics
 * to the consuming Adapter.
 */
export class JsonRpcStdioTransport {
  private readonly readable: Readable;
  private readonly writable: Writable;
  private readonly cleanup: (() => Promise<void> | void) | undefined;
  private readonly emitJsonRpcVersion: boolean;
  private readonly maxMessageBytes: number;
  private readonly maxPendingRequests: number;
  private readonly maxPendingInboundRequests: number;
  private readonly maxPendingWrites: number;
  private readonly requestTimeoutMs: number;
  private readonly onDiagnostic:
    ((diagnostic: JsonRpcDiagnostic) => void) | undefined;
  private readonly inboundQueue: InboundQueue;
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private readonly pendingInboundRequestIds = new Set<string>();
  private readonly respondingInboundRequestIds = new Set<string>();
  private readonly terminalGuardStreams = new Set<Readable | Writable>();
  private readonly activeWriteRejectors = new Set<
    (error: JsonRpcTransportError) => void
  >();
  private lineChunks: Buffer[] = [];
  private lineBytes = 0;
  private nextRequestId = 1;
  private pendingWrites = 0;
  private incomingClaimed = false;
  private open = true;
  private terminalError: JsonRpcTransportError | undefined;
  private cleanupFailure: JsonRpcTransportError | undefined;
  private cleanupPromise: Promise<void> | undefined;
  private writeTail: Promise<void> = Promise.resolve();
  private writableCallbackFailed = false;

  private readonly handleReadableData = (chunk: unknown): void => {
    if (!this.open) return;
    if (
      typeof chunk !== 'string' &&
      !Buffer.isBuffer(chunk) &&
      !(chunk instanceof Uint8Array)
    ) {
      this.fail(
        transportError(
          'stream_failed',
          'The readable stream emitted an unsupported chunk.',
        ),
      );
      return;
    }
    this.consumeChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };

  private readonly handleReadableEnd = (): void => {
    if (!this.open) return;
    this.fail(
      this.lineBytes > 0
        ? transportError(
            'truncated_message',
            'The readable stream ended with an incomplete JSONL frame.',
          )
        : transportError(
            'stream_ended',
            'The readable stream ended before the transport was closed.',
          ),
    );
  };

  private readonly handleStreamError = (_error: unknown): void => {
    this.fail(
      transportError('stream_failed', 'A transport stream reported a failure.'),
    );
  };

  private readonly handleWritableError = (_error: unknown): void => {
    this.fail(
      this.writableCallbackFailed
        ? transportError(
            'write_failed',
            'The transport could not write a JSON-RPC frame.',
          )
        : transportError(
            'stream_failed',
            'A transport stream reported a failure.',
          ),
    );
  };

  private readonly handleStreamClose = (): void => {
    if (!this.open) return;
    this.fail(
      transportError(
        'stream_ended',
        'A transport stream closed before the transport was closed.',
      ),
    );
  };

  constructor(options: JsonRpcStdioTransportOptions) {
    this.maxMessageBytes = positiveInteger(
      options.maxMessageBytes ?? defaultMaxMessageBytes,
    );
    const maxBufferedMessages = positiveInteger(
      options.maxBufferedMessages ?? defaultMaxBufferedMessages,
    );
    this.maxPendingRequests = positiveInteger(
      options.maxPendingRequests ?? defaultMaxPendingRequests,
    );
    this.maxPendingInboundRequests = positiveInteger(
      options.maxPendingInboundRequests ?? defaultMaxPendingInboundRequests,
    );
    this.maxPendingWrites = positiveInteger(
      options.maxPendingWrites ?? defaultMaxPendingWrites,
    );
    this.requestTimeoutMs = timerMilliseconds(
      options.requestTimeoutMs ?? defaultRequestTimeoutMs,
    );
    this.readable = options.readable;
    this.writable = options.writable;
    this.cleanup = options.cleanup;
    this.emitJsonRpcVersion = options.emitJsonRpcVersion ?? false;
    this.onDiagnostic = options.onDiagnostic;
    this.inboundQueue = new InboundQueue(maxBufferedMessages);

    this.readable.on('data', this.handleReadableData);
    this.readable.once('end', this.handleReadableEnd);
    this.readable.once('error', this.handleStreamError);
    this.readable.once('close', this.handleStreamClose);
    this.writable.once('error', this.handleWritableError);
    this.writable.once('close', this.handleStreamClose);
  }

  /** Send a request and resolve it exactly once from its correlated response. */
  request<TResult = unknown>(
    method: string,
    params?: unknown,
    options: JsonRpcRequestOptions = {},
  ): Promise<TResult> {
    try {
      this.assertOpen();
      assertMethod(method);
      if (options.signal?.aborted) {
        throw transportError(
          'request_aborted',
          'The local request wait was aborted before the request was sent.',
        );
      }
      if (this.pendingRequests.size >= this.maxPendingRequests) {
        throw transportError(
          'capacity_exceeded',
          'The pending outbound request limit was reached.',
        );
      }

      const timeoutMs = timerMilliseconds(
        options.timeoutMs ?? this.requestTimeoutMs,
      );
      const id = this.allocateRequestId();
      const envelope = this.outboundEnvelope({ id, method, params });
      const frame = this.encode(envelope);
      this.assertOpen();
      const response = new Promise<unknown>((resolve, reject) => {
        const abortListener = options.signal
          ? () => {
              this.settlePending(id, (pending) => {
                pending.reject(
                  transportError(
                    'request_aborted',
                    'The local request wait was aborted.',
                  ),
                );
              });
            }
          : undefined;
        const timer = setTimeout(() => {
          this.settlePending(id, (pending) => {
            pending.reject(
              transportError(
                'request_timeout',
                'The JSON-RPC request timed out.',
              ),
            );
          });
        }, timeoutMs);
        timer.unref();
        this.pendingRequests.set(id, {
          resolve,
          reject,
          timer,
          signal: options.signal,
          abortListener,
          writeStarted: false,
        });
        if (abortListener) {
          options.signal?.addEventListener('abort', abortListener, {
            once: true,
          });
          if (options.signal?.aborted) abortListener();
        }
      });

      void this.enqueueWrite(frame, () => this.startPendingWrite(id)).catch(
        (error: unknown) => {
          this.settlePending(id, (pending) => {
            pending.reject(asTransportError(error));
          });
        },
      );
      return response as Promise<TResult>;
    } catch (error) {
      return Promise.reject(asTransportError(error));
    }
  }

  /** Send a notification and wait until its complete frame is flushed. */
  notify(method: string, params?: unknown): Promise<void> {
    try {
      this.assertOpen();
      assertMethod(method);
      return this.enqueueWrite(
        this.encode(this.outboundEnvelope({ method, params })),
      );
    } catch (error) {
      return Promise.reject(asTransportError(error));
    }
  }

  /** Iterate remote requests and notifications in wire order. */
  incoming(): AsyncIterableIterator<JsonRpcInboundMessage> {
    if (this.incomingClaimed) {
      throw transportError(
        'consumer_conflict',
        'The inbound message stream already has a consumer.',
      );
    }
    this.incomingClaimed = true;
    const source = this.iterateIncoming();
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => source.next(),
      return: async () => {
        await this.close();
        return source.return(undefined);
      },
      throw: async (error?: unknown) => {
        await this.close();
        return source.throw(error);
      },
    };
  }

  /** Respond successfully to one outstanding remote request. */
  respond(id: JsonRpcId, result: unknown): Promise<void> {
    if (result === undefined) {
      return Promise.reject(
        transportError(
          'invalid_outbound_message',
          'A JSON-RPC response result cannot be undefined.',
        ),
      );
    }
    return this.respondWithEnvelope(id, { id, result });
  }

  /** Respond with a JSON-RPC error to one outstanding remote request. */
  respondError(id: JsonRpcId, error: JsonRpcErrorObject): Promise<void> {
    return this.respondWithEnvelope(id, { error, id }, 'error');
  }

  /** Close the logical transport and run caller-provided cleanup once. */
  async close(): Promise<void> {
    if (this.open) {
      this.terminate(
        undefined,
        transportError('transport_closed', 'The transport was closed.'),
      );
    }
    await this.cleanupPromise;
    if (this.cleanupFailure) throw this.cleanupFailure;
  }

  private async *iterateIncoming(): AsyncGenerator<JsonRpcInboundMessage> {
    try {
      for (;;) {
        const next = await this.inboundQueue.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      if (this.open) await this.close();
    }
  }

  private respondWithEnvelope(
    id: JsonRpcId,
    envelope: JsonRecord,
    responseKind: 'error' | 'result' = 'result',
  ): Promise<void> {
    let reservedKey: string | undefined;
    try {
      this.assertOpen();
      if (!isJsonRpcId(id)) {
        throw transportError(
          'invalid_outbound_message',
          'A JSON-RPC response identifier is invalid.',
        );
      }
      const key = requestIdKey(id);
      if (
        !this.pendingInboundRequestIds.has(key) ||
        this.respondingInboundRequestIds.has(key)
      ) {
        throw transportError(
          'response_not_pending',
          'No inbound request is awaiting that response.',
        );
      }
      this.respondingInboundRequestIds.add(key);
      reservedKey = key;
      const frame = this.encode(this.outboundEnvelope(envelope));
      assertSerializedResponse(frame, key, responseKind);
      return this.enqueueWrite(frame).then(
        () => {
          this.respondingInboundRequestIds.delete(key);
          this.pendingInboundRequestIds.delete(key);
        },
        (error: unknown) => {
          this.respondingInboundRequestIds.delete(key);
          throw asTransportError(error);
        },
      );
    } catch (error) {
      if (reservedKey) this.respondingInboundRequestIds.delete(reservedKey);
      return Promise.reject(asTransportError(error));
    }
  }

  private outboundEnvelope(envelope: JsonRecord): JsonRecord {
    const output: JsonRecord = this.emitJsonRpcVersion
      ? { jsonrpc: '2.0', ...envelope }
      : { ...envelope };
    if (output['params'] === undefined) delete output['params'];
    return output;
  }

  private encode(envelope: JsonRecord): string {
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(envelope);
    } catch {
      throw transportError(
        'invalid_outbound_message',
        'The outbound JSON-RPC message is not JSON serializable.',
      );
    }
    if (!encoded) {
      throw transportError(
        'invalid_outbound_message',
        'The outbound JSON-RPC message is invalid.',
      );
    }
    if (Buffer.byteLength(encoded) > this.maxMessageBytes) {
      throw transportError(
        'message_too_large',
        'The outbound JSON-RPC message exceeds the configured limit.',
      );
    }
    return `${encoded}\n`;
  }

  private enqueueWrite(
    frame: string,
    shouldWrite?: () => boolean,
  ): Promise<void> {
    if (this.pendingWrites >= this.maxPendingWrites) {
      return Promise.reject(
        transportError(
          'capacity_exceeded',
          'The pending transport write limit was reached.',
        ),
      );
    }
    this.pendingWrites += 1;
    const operation = this.writeTail.then(async () => {
      this.assertOpen();
      if (shouldWrite && !shouldWrite()) return;
      await this.writeFrame(frame);
    });
    const tracked = operation.finally(() => {
      this.pendingWrites -= 1;
    });
    this.writeTail = tracked.catch(() => undefined);
    return tracked;
  }

  private writeFrame(frame: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const rejectWrite = (error: JsonRpcTransportError): void => {
        if (settled) return;
        settled = true;
        this.activeWriteRejectors.delete(rejectWrite);
        reject(error);
      };
      const resolveWrite = (): void => {
        if (settled) return;
        settled = true;
        this.activeWriteRejectors.delete(rejectWrite);
        resolve();
      };
      this.activeWriteRejectors.add(rejectWrite);
      try {
        this.writable.write(frame, (error) => {
          if (error) {
            // Node emits the matching `error` event after this callback. Let
            // that listener terminate the transport so the event cannot become
            // unhandled when termination detaches stream listeners.
            this.writableCallbackFailed = true;
          } else {
            resolveWrite();
          }
        });
      } catch {
        this.fail(
          transportError(
            'write_failed',
            'The transport could not write a JSON-RPC frame.',
          ),
        );
      }
    });
  }

  private consumeChunk(chunk: Buffer): void {
    let segmentStart = 0;
    for (let index = 0; index < chunk.length && this.open; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      if (!this.appendLineSegment(chunk.subarray(segmentStart, index))) return;
      this.consumeLine();
      segmentStart = index + 1;
    }
    if (this.open && segmentStart < chunk.length) {
      this.appendLineSegment(chunk.subarray(segmentStart));
    }
  }

  private appendLineSegment(segment: Buffer): boolean {
    if (segment.length === 0) return true;
    if (this.lineBytes + segment.length > this.maxMessageBytes) {
      this.fail(
        transportError(
          'message_too_large',
          'An inbound JSONL frame exceeds the configured limit.',
        ),
      );
      return false;
    }
    this.lineChunks.push(Buffer.from(segment));
    this.lineBytes += segment.length;
    return true;
  }

  private consumeLine(): void {
    let line = Buffer.concat(this.lineChunks, this.lineBytes);
    this.lineChunks = [];
    this.lineBytes = 0;
    if (line.at(-1) === 0x0d) line = line.subarray(0, -1);

    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(line);
    } catch {
      this.fail(
        transportError('malformed_message', 'An inbound frame is not UTF-8.'),
      );
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(decoded);
    } catch {
      this.fail(
        transportError(
          'malformed_message',
          'An inbound frame is not valid JSON.',
        ),
      );
      return;
    }
    this.consumeEnvelope(value);
  }

  private consumeEnvelope(value: unknown): void {
    if (!isRecord(value) || !validJsonRpcVersion(value)) {
      this.fail(malformedEnvelope());
      return;
    }

    if (hasOwn(value, 'method')) {
      this.consumeMethodEnvelope(value);
      return;
    }
    this.consumeResponseEnvelope(value);
  }

  private consumeMethodEnvelope(envelope: JsonRecord): void {
    if (
      typeof envelope['method'] !== 'string' ||
      envelope['method'].length === 0 ||
      hasOwn(envelope, 'result') ||
      hasOwn(envelope, 'error')
    ) {
      this.fail(malformedEnvelope());
      return;
    }

    const params = hasOwn(envelope, 'params')
      ? { params: envelope['params'] }
      : {};
    if (!hasOwn(envelope, 'id')) {
      this.enqueueInbound({
        kind: 'notification',
        method: envelope['method'],
        ...params,
      });
      return;
    }

    const id = envelope['id'];
    if (!isJsonRpcId(id)) {
      this.fail(malformedEnvelope());
      return;
    }
    const key = requestIdKey(id);
    if (
      this.pendingInboundRequestIds.has(key) ||
      this.pendingInboundRequestIds.size >= this.maxPendingInboundRequests
    ) {
      this.fail(
        this.pendingInboundRequestIds.has(key)
          ? malformedEnvelope()
          : transportError(
              'capacity_exceeded',
              'The pending inbound request limit was reached.',
            ),
      );
      return;
    }
    this.pendingInboundRequestIds.add(key);
    this.enqueueInbound({
      id,
      kind: 'request',
      method: envelope['method'],
      ...params,
    });
  }

  private consumeResponseEnvelope(envelope: JsonRecord): void {
    if (!hasOwn(envelope, 'id')) {
      this.fail(malformedEnvelope());
      return;
    }
    const hasResult = hasOwn(envelope, 'result');
    const hasError = hasOwn(envelope, 'error');
    if (hasResult === hasError) {
      this.fail(malformedEnvelope());
      return;
    }
    if (hasError && !isJsonRpcErrorObject(envelope['error'])) {
      this.fail(malformedEnvelope());
      return;
    }

    const id = envelope['id'];
    if (id === null) {
      this.emitDiagnostic({ code: 'unmatched_response' });
      return;
    }
    if (!isJsonRpcId(id)) {
      this.fail(malformedEnvelope());
      return;
    }

    const pending = this.pendingRequests.get(id);
    if (!pending?.writeStarted) {
      this.emitDiagnostic({ code: 'unmatched_response' });
      return;
    }
    const settled = this.settlePending(id, (pending) => {
      if (hasError) {
        pending.reject(
          new JsonRpcRemoteError(envelope['error'] as JsonRpcErrorObject),
        );
      } else {
        pending.resolve(envelope['result']);
      }
    });
    if (!settled) this.emitDiagnostic({ code: 'unmatched_response' });
  }

  private enqueueInbound(message: JsonRpcInboundMessage): void {
    if (this.inboundQueue.push(message)) return;
    this.fail(
      transportError(
        'capacity_exceeded',
        'The buffered inbound message limit was reached.',
      ),
    );
  }

  private settlePending(
    id: JsonRpcId,
    settle: (pending: PendingRequest) => void,
  ): boolean {
    const pending = this.pendingRequests.get(id);
    if (!pending) return false;
    this.pendingRequests.delete(id);
    clearTimeout(pending.timer);
    if (pending.abortListener) {
      pending.signal?.removeEventListener('abort', pending.abortListener);
    }
    settle(pending);
    return true;
  }

  private startPendingWrite(id: JsonRpcId): boolean {
    const pending = this.pendingRequests.get(id);
    if (!pending) return false;
    pending.writeStarted = true;
    return true;
  }

  private allocateRequestId(): number {
    const start = this.nextRequestId;
    do {
      const candidate = this.nextRequestId;
      this.nextRequestId =
        candidate === Number.MAX_SAFE_INTEGER ? 1 : candidate + 1;
      if (!this.pendingRequests.has(candidate)) return candidate;
    } while (this.nextRequestId !== start);
    throw transportError(
      'capacity_exceeded',
      'No JSON-RPC request identifier is available.',
    );
  }

  private emitDiagnostic(diagnostic: JsonRpcDiagnostic): void {
    try {
      this.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostic callbacks cannot affect transport lifecycle.
    }
  }

  private assertOpen(): void {
    if (!this.open) {
      throw (
        this.terminalError ??
        transportError('transport_closed', 'The transport is closed.')
      );
    }
  }

  private fail(error: JsonRpcTransportError): void {
    if (!this.open) return;
    this.terminate(error, error);
  }

  private terminate(
    inboundFailure: JsonRpcTransportError | undefined,
    operationFailure: JsonRpcTransportError,
  ): void {
    if (!this.open) return;
    this.open = false;
    this.terminalError = operationFailure;
    this.armTerminalErrorGuards();
    this.detachStreams();
    this.lineChunks = [];
    this.lineBytes = 0;
    this.pendingInboundRequestIds.clear();
    this.respondingInboundRequestIds.clear();
    for (const id of [...this.pendingRequests.keys()]) {
      this.settlePending(id, (pending) => {
        pending.reject(operationFailure);
      });
    }
    for (const rejectWrite of [...this.activeWriteRejectors]) {
      rejectWrite(operationFailure);
    }
    this.inboundQueue.close(inboundFailure);
    this.startCleanup();
  }

  private detachStreams(): void {
    this.readable.off('data', this.handleReadableData);
    this.readable.off('end', this.handleReadableEnd);
    this.readable.off('error', this.handleStreamError);
    this.readable.off('close', this.handleStreamClose);
    this.writable.off('error', this.handleWritableError);
    this.writable.off('close', this.handleStreamClose);
  }

  private startCleanup(): void {
    this.cleanupPromise ??= Promise.resolve()
      .then(() => this.cleanup?.())
      .then(() => undefined)
      .catch(() => {
        this.cleanupFailure = transportError(
          'cleanup_failed',
          'Transport cleanup failed.',
        );
      })
      .then(
        () =>
          new Promise<void>((resolve) => {
            scheduleImmediate(resolve);
          }),
      )
      .then(() => {
        this.releaseTerminalErrorGuards();
      });
  }

  private armTerminalErrorGuards(): void {
    this.terminalGuardStreams.add(this.readable);
    this.terminalGuardStreams.add(this.writable);
    for (const stream of this.terminalGuardStreams) {
      stream.on('error', ignoreTerminalStreamError);
    }
  }

  private releaseTerminalErrorGuards(): void {
    for (const stream of this.terminalGuardStreams) {
      stream.off('error', ignoreTerminalStreamError);
    }
    this.terminalGuardStreams.clear();
  }
}

function transportError(
  code: JsonRpcTransportErrorCode,
  message: string,
): JsonRpcTransportError {
  return new JsonRpcTransportError(code, message);
}

function asTransportError(error: unknown): JsonRpcTransportError {
  return error instanceof JsonRpcTransportError
    ? error
    : transportError(
        'invalid_outbound_message',
        'The outbound JSON-RPC operation is invalid.',
      );
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw transportError(
      'invalid_configuration',
      'Transport limits and timeouts must be positive safe integers.',
    );
  }
  return value;
}

function timerMilliseconds(value: number): number {
  const timeout = positiveInteger(value);
  if (timeout > maximumTimerMilliseconds) {
    throw transportError(
      'invalid_configuration',
      `Transport timeouts cannot exceed ${String(maximumTimerMilliseconds)} milliseconds.`,
    );
  }
  return timeout;
}

function assertMethod(method: string): void {
  if (typeof method !== 'string' || method.length === 0) {
    throw transportError(
      'invalid_outbound_message',
      'A JSON-RPC method must be a non-empty string.',
    );
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validJsonRpcVersion(value: JsonRecord): boolean {
  return !hasOwn(value, 'jsonrpc') || value['jsonrpc'] === '2.0';
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function requestIdKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function isJsonRpcErrorObject(value: unknown): value is JsonRpcErrorObject {
  return (
    isRecord(value) &&
    typeof value['code'] === 'number' &&
    Number.isSafeInteger(value['code']) &&
    typeof value['message'] === 'string'
  );
}

function malformedEnvelope(): JsonRpcTransportError {
  return transportError(
    'malformed_message',
    'An inbound JSON-RPC envelope is malformed.',
  );
}

function assertSerializedResponse(
  frame: string,
  expectedIdKey: string,
  responseKind: 'error' | 'result',
): void {
  const value: unknown = JSON.parse(frame);
  if (!isRecord(value) || !isJsonRpcId(value['id'])) {
    throw invalidSerializedResponse();
  }
  const hasError = hasOwn(value, 'error');
  const hasResult = hasOwn(value, 'result');
  if (
    requestIdKey(value['id']) !== expectedIdKey ||
    hasOwn(value, 'method') ||
    (responseKind === 'result'
      ? !hasResult || hasError
      : hasResult || !hasError || !isJsonRpcErrorObject(value['error']))
  ) {
    throw invalidSerializedResponse();
  }
}

function invalidSerializedResponse(): JsonRpcTransportError {
  return transportError(
    'invalid_outbound_message',
    'The serialized JSON-RPC response is invalid.',
  );
}

function ignoreTerminalStreamError(_error: unknown): void {
  // The first terminal error is already recorded; suppress only errors that
  // race with that terminal path or its awaited cleanup operation.
}
