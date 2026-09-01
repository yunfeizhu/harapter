import type { Readable, Writable } from 'node:stream';
import { setImmediate as scheduleImmediate } from 'node:timers';
import { inspect } from 'node:util';

const defaultMaxMessageBytes = 1024 * 1024;
const defaultMaxBufferedMessages = 128;
const defaultMaxPendingWrites = 128;
const defaultWriteTimeoutMs = 30_000;
const maximumTimerMilliseconds = 2_147_483_647;

/** One provider-owned JSON object carried by the transport. */
export type JsonlMessage = Readonly<Record<string, unknown>>;

/** Stable transport failure categories for Provider error mapping. */
export type JsonlTransportErrorCode =
  | 'capacity_exceeded'
  | 'cleanup_failed'
  | 'consumer_conflict'
  | 'invalid_configuration'
  | 'invalid_outbound_message'
  | 'malformed_message'
  | 'message_too_large'
  | 'stream_ended'
  | 'stream_failed'
  | 'transport_closed'
  | 'truncated_message'
  | 'write_aborted'
  | 'write_failed'
  | 'write_timeout';

/** Safe transport failure that never includes a frame or stream error body. */
export class JsonlTransportError extends Error {
  readonly code: JsonlTransportErrorCode;

  constructor(code: JsonlTransportErrorCode, message: string) {
    super(message);
    this.name = 'JsonlTransportError';
    this.code = code;
  }

  /** Keep generic JSON error logging bounded and content-free. */
  toJSON(): Readonly<{
    code: JsonlTransportErrorCode;
    message: string;
    name: string;
  }> {
    return { code: this.code, message: this.message, name: this.name };
  }

  /** Keep Node inspection bounded and content-free. */
  [inspect.custom](): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

/** Local controls for waiting until one complete frame is written. */
export interface JsonlSendOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Explicit stream, lifecycle, and resource limits for one connection. */
export interface JsonlProcessTransportOptions {
  readonly readable: Readable;
  readonly writable: Writable;
  readonly cleanup?: () => Promise<void> | void;
  readonly maxMessageBytes?: number;
  readonly maxBufferedMessages?: number;
  readonly maxPendingWrites?: number;
  readonly writeTimeoutMs?: number;
}

interface QueueWaiter {
  readonly resolve: (result: IteratorResult<JsonlMessage>) => void;
  readonly reject: (error: JsonlTransportError) => void;
}

class InboundQueue {
  private readonly values: JsonlMessage[] = [];
  private waiter: QueueWaiter | undefined;
  private failure: JsonlTransportError | undefined;
  private closed = false;

  constructor(private readonly capacity: number) {}

  push(value: JsonlMessage): boolean {
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

  next(): Promise<IteratorResult<JsonlMessage>> {
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

  close(failure?: JsonlTransportError): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = failure;
    if (!failure) this.values.length = 0;
    if (!this.waiter) return;
    const waiter = this.waiter;
    this.waiter = undefined;
    if (failure) waiter.reject(failure);
    else waiter.resolve({ done: true, value: undefined });
  }
}

interface PendingWrite {
  readonly resolve: () => void;
  readonly reject: (error: JsonlTransportError) => void;
  readonly signal: AbortSignal | undefined;
  readonly abortListener: (() => void) | undefined;
  readonly timer: NodeJS.Timeout;
  started: boolean;
  settled: boolean;
}

/**
 * Bounded strict-JSONL transport over caller-owned process streams.
 * Provider Adapters own every message envelope and lifecycle interpretation.
 */
export class JsonlProcessTransport {
  private readonly readable: Readable;
  private readonly writable: Writable;
  private readonly cleanup: (() => Promise<void> | void) | undefined;
  private readonly maxMessageBytes: number;
  private readonly maxPendingWrites: number;
  private readonly writeTimeoutMs: number;
  private readonly inboundQueue: InboundQueue;
  private readonly pendingWriteWaits = new Set<PendingWrite>();
  private readonly activeWriteRejectors = new Set<
    (error: JsonlTransportError) => void
  >();
  private readonly terminalGuardStreams = new Set<Readable | Writable>();
  private lineChunks: Buffer[] = [];
  private lineBytes = 0;
  private pendingWrites = 0;
  private incomingClaimed = false;
  private open = true;
  private terminalError: JsonlTransportError | undefined;
  private cleanupFailure: JsonlTransportError | undefined;
  private cleanupPromise: Promise<void> | undefined;
  private cleanupSettled = false;
  private activePhysicalWrites = 0;
  private terminalGuardReleaseScheduled = false;
  private resolveTerminalGuardRelease: (() => void) | undefined;
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
            'The transport could not write a JSONL frame.',
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

  constructor(options: JsonlProcessTransportOptions) {
    this.maxMessageBytes = positiveInteger(
      options.maxMessageBytes ?? defaultMaxMessageBytes,
    );
    const maxBufferedMessages = positiveInteger(
      options.maxBufferedMessages ?? defaultMaxBufferedMessages,
    );
    this.maxPendingWrites = positiveInteger(
      options.maxPendingWrites ?? defaultMaxPendingWrites,
    );
    this.writeTimeoutMs = timerMilliseconds(
      options.writeTimeoutMs ?? defaultWriteTimeoutMs,
    );
    this.readable = options.readable;
    this.writable = options.writable;
    this.cleanup = options.cleanup;
    this.inboundQueue = new InboundQueue(maxBufferedMessages);

    this.readable.on('data', this.handleReadableData);
    this.readable.once('end', this.handleReadableEnd);
    this.readable.once('error', this.handleStreamError);
    this.readable.once('close', this.handleStreamClose);
    this.writable.once('error', this.handleWritableError);
    this.writable.once('close', this.handleStreamClose);

    if (this.readable.readableEnded) this.handleReadableEnd();
    else if (
      this.readable.destroyed ||
      this.readable.closed ||
      this.writable.destroyed ||
      this.writable.closed
    ) {
      this.handleStreamClose();
    }
  }

  /** Send one JSON object and wait until its complete frame is flushed. */
  send(message: JsonlMessage, options: JsonlSendOptions = {}): Promise<void> {
    try {
      this.assertOpen();
      if (options.signal?.aborted) {
        throw transportError(
          'write_aborted',
          'The local write wait was aborted before the frame was sent.',
        );
      }
      if (this.pendingWrites >= this.maxPendingWrites) {
        throw transportError(
          'capacity_exceeded',
          'The pending transport write limit was reached.',
        );
      }
      const timeoutMs = timerMilliseconds(
        options.timeoutMs ?? this.writeTimeoutMs,
      );
      const frame = this.encode(message);
      this.assertOpen();
      return this.enqueueWrite(frame, options.signal, timeoutMs);
    } catch (error) {
      return Promise.reject(asTransportError(error));
    }
  }

  /** Iterate provider-owned JSON objects in wire order. */
  incoming(): AsyncIterableIterator<JsonlMessage> {
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

  /** Whether the logical transport can still accept operations. */
  isOpen(): boolean {
    return this.open;
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

  private async *iterateIncoming(): AsyncGenerator<JsonlMessage> {
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

  private encode(message: JsonlMessage): string {
    if (!isRecord(message)) {
      throw transportError(
        'invalid_outbound_message',
        'The outbound JSONL message must be a JSON object.',
      );
    }
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(message);
    } catch {
      throw transportError(
        'invalid_outbound_message',
        'The outbound JSONL message is not JSON serializable.',
      );
    }
    if (!encoded || !isSerializedRecord(encoded)) {
      throw transportError(
        'invalid_outbound_message',
        'The outbound JSONL message must serialize to a JSON object.',
      );
    }
    if (Buffer.byteLength(encoded) > this.maxMessageBytes) {
      throw transportError(
        'message_too_large',
        'The outbound JSONL message exceeds the configured limit.',
      );
    }
    return `${encoded}\n`;
  }

  private enqueueWrite(
    frame: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<void> {
    this.pendingWrites += 1;
    let state: PendingWrite;
    const wait = new Promise<void>((resolve, reject) => {
      const abortListener = signal
        ? () => {
            this.rejectWriteWait(
              state,
              transportError(
                'write_aborted',
                'The local write wait was aborted.',
              ),
            );
          }
        : undefined;
      const timer = setTimeout(() => {
        this.rejectWriteWait(
          state,
          transportError('write_timeout', 'The JSONL write wait timed out.'),
        );
      }, timeoutMs);
      timer.unref();
      state = {
        abortListener,
        reject,
        resolve,
        signal,
        started: false,
        settled: false,
        timer,
      };
      this.pendingWriteWaits.add(state);
      if (abortListener) {
        signal?.addEventListener('abort', abortListener, { once: true });
        if (signal?.aborted) abortListener();
      }
    });

    const operation = this.writeTail.then(async () => {
      this.assertOpen();
      if (state.settled) return;
      state.started = true;
      await this.writeFrame(frame);
    });
    const tracked = operation
      .then(
        () => {
          this.resolveWriteWait(state);
        },
        (error: unknown) => {
          this.rejectWriteWait(state, asTransportError(error));
        },
      )
      .finally(() => {
        this.pendingWrites -= 1;
      });
    this.writeTail = tracked.catch(() => undefined);
    return wait;
  }

  private writeFrame(frame: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const rejectWrite = (error: JsonlTransportError): void => {
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
      this.activePhysicalWrites += 1;
      let physicalWriteSettled = false;
      const settlePhysicalWrite = (): void => {
        if (physicalWriteSettled) return;
        physicalWriteSettled = true;
        this.activePhysicalWrites -= 1;
        this.maybeReleaseTerminalErrorGuards();
      };
      try {
        this.writable.write(frame, (error) => {
          if (error) {
            this.writableCallbackFailed = true;
          } else {
            resolveWrite();
          }
          settlePhysicalWrite();
        });
      } catch {
        settlePhysicalWrite();
        this.fail(
          transportError(
            'write_failed',
            'The transport could not write a JSONL frame.',
          ),
        );
      }
    });
  }

  private resolveWriteWait(state: PendingWrite): void {
    if (state.settled) return;
    this.finishWriteWait(state);
    state.resolve();
  }

  private rejectWriteWait(
    state: PendingWrite,
    error: JsonlTransportError,
  ): void {
    if (state.settled) return;
    this.finishWriteWait(state);
    state.reject(error);
  }

  private finishWriteWait(state: PendingWrite): void {
    state.settled = true;
    clearTimeout(state.timer);
    if (state.abortListener) {
      state.signal?.removeEventListener('abort', state.abortListener);
    }
    this.pendingWriteWaits.delete(state);
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
    const nextLineBytes = this.lineBytes + segment.length;
    const hasOptionalDelimiterCr =
      nextLineBytes === this.maxMessageBytes + 1 && segment.at(-1) === 0x0d;
    if (nextLineBytes > this.maxMessageBytes && !hasOptionalDelimiterCr) {
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
    if (!isRecord(value)) {
      this.fail(
        transportError(
          'malformed_message',
          'An inbound JSONL message must be a JSON object.',
        ),
      );
      return;
    }
    if (this.inboundQueue.push(value)) return;
    this.fail(
      transportError(
        'capacity_exceeded',
        'The buffered inbound message limit was reached.',
      ),
    );
  }

  private assertOpen(): void {
    if (!this.open) {
      throw (
        this.terminalError ??
        transportError('transport_closed', 'The transport is closed.')
      );
    }
  }

  private fail(error: JsonlTransportError): void {
    if (!this.open) return;
    this.terminate(error, error);
  }

  private terminate(
    inboundFailure: JsonlTransportError | undefined,
    operationFailure: JsonlTransportError,
  ): void {
    if (!this.open) return;
    this.open = false;
    this.terminalError = operationFailure;
    this.armTerminalErrorGuards();
    this.detachStreams();
    this.lineChunks = [];
    this.lineBytes = 0;
    for (const state of [...this.pendingWriteWaits]) {
      this.rejectWriteWait(state, operationFailure);
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
    if (this.cleanupPromise) return;
    const terminalGuardRelease = new Promise<void>((resolve) => {
      this.resolveTerminalGuardRelease = resolve;
    });
    this.cleanupPromise = Promise.resolve()
      .then(() => this.cleanup?.())
      .then(() => undefined)
      .catch(() => {
        this.cleanupFailure = transportError(
          'cleanup_failed',
          'Transport cleanup failed.',
        );
      })
      .then(() => {
        this.cleanupSettled = true;
        this.maybeReleaseTerminalErrorGuards();
        return terminalGuardRelease;
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

  private maybeReleaseTerminalErrorGuards(): void {
    if (
      !this.cleanupSettled ||
      this.activePhysicalWrites > 0 ||
      this.terminalGuardReleaseScheduled
    ) {
      return;
    }
    this.terminalGuardReleaseScheduled = true;
    scheduleImmediate(() => {
      this.releaseTerminalErrorGuards();
      this.resolveTerminalGuardRelease?.();
      this.resolveTerminalGuardRelease = undefined;
    });
  }
}

function transportError(
  code: JsonlTransportErrorCode,
  message: string,
): JsonlTransportError {
  return new JsonlTransportError(code, message);
}

function asTransportError(error: unknown): JsonlTransportError {
  return error instanceof JsonlTransportError
    ? error
    : transportError(
        'invalid_outbound_message',
        'The outbound JSONL operation is invalid.',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSerializedRecord(encoded: string): boolean {
  try {
    const value: unknown = JSON.parse(encoded);
    return isRecord(value);
  } catch {
    return false;
  }
}

function ignoreTerminalStreamError(): void {
  // A short-lived guard contains errors racing with terminal cleanup.
}
