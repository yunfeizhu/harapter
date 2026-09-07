import { randomUUID } from 'node:crypto';
import { HarnessError, type HarnessErrorCode } from '@harapter/core';
import WebSocket, { type RawData } from 'ws';
import { DSH_PROVIDER_ID } from './protocol.js';
import { GatewayQueue } from './gateway-queue.js';

interface GatewayTransportOptions {
  readonly url: string;
  readonly cookie: string;
  readonly requestTimeoutMs: number;
  readonly maxMessageBytes: number;
  readonly maxBufferedEvents: number;
  readonly maxSessions: number;
}

/** One bounded observation; closing it never cancels native execution. */
export interface GatewayStream {
  readonly events: AsyncIterable<unknown>;
  close(): void;
}

/** An authoritative business rejection, distinct from uncertain transport loss. */
export class GatewayRemoteError extends HarnessError {}

/** Only these official precondition failures prove a write was not admitted. */
export function isGatewayPreconditionError(
  error: unknown,
): error is GatewayRemoteError {
  return (
    error instanceof GatewayRemoteError &&
    [
      'session_not_found',
      'run_conflict',
      'unsupported_capability',
      'invalid_request',
    ].includes(error.code)
  );
}

/** Construct a stable failure without retaining provider content or causes. */
export function gatewayError(
  code: HarnessErrorCode,
  providerCode = 'gateway_failure',
): HarnessError {
  return new HarnessError(
    code,
    'DSH Gateway operation could not be completed.',
    {
      retryable: false,
      providerId: DSH_PROVIDER_ID,
      providerCode,
    },
  );
}

/** Parse a configured authority without accepting credential-bearing URLs. */
export function gatewayUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw gatewayError('profile_invalid', 'endpoint_invalid');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.pathname !== '/'
  ) {
    throw gatewayError('profile_invalid', 'endpoint_invalid');
  }
  return url;
}

const methods = new Set([
  'session/create',
  'session/prompt',
  'session/fork',
  'session/cancel',
  'session/modelCatalog',
  'session/list',
  'session/page',
]);
const remoteCodes: Readonly<Record<string, HarnessErrorCode>> = {
  'session/not-found': 'session_not_found',
  'session/agent-busy': 'run_conflict',
  'session/conflict': 'session_provider_mismatch',
  'session/fork-unavailable': 'unsupported_capability',
  'gateway/bad-request': 'invalid_request',
  'gateway/cancelled': 'provider_error',
  'gateway/internal': 'provider_error',
  'session/workspace-attach-failed': 'provider_error',
  'session/model-unavailable': 'provider_error',
  'gateway/method-not-found': 'provider_api_incompatible',
};

/** Decode plain JSON records only at the external protocol boundary. */
export function gatewayRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function remoteError(value: unknown): GatewayRemoteError {
  const record = gatewayRecord(value);
  if (
    typeof record?.['code'] !== 'string' ||
    typeof record['message'] !== 'string' ||
    gatewayRecord(record['details']) === undefined
  )
    throw gatewayError('provider_api_incompatible');
  const code = Object.hasOwn(remoteCodes, record['code'])
    ? record['code']
    : 'upstream_error';
  return new GatewayRemoteError(
    remoteCodes[code] ?? 'provider_error',
    'DSH Gateway rejected the operation.',
    {
      retryable: false,
      providerId: DSH_PROVIDER_ID,
      providerCode: code,
    },
  );
}

/** DSH-local HTTP and WebSocket carrier; never installs or stops a Runtime. */
export class DshGatewayTransport {
  private readonly socket: WebSocket;
  private readonly streams = new Map<string, GatewayQueue<unknown>>();
  private readonly requests = new Set<AbortController>();
  private readonly closeListeners = new Set<(error: HarnessError) => void>();
  private closed = false;
  private cookie: string;
  private readonly url: URL;
  private readonly options: Omit<GatewayTransportOptions, 'cookie' | 'url'>;

  private constructor(options: GatewayTransportOptions) {
    const { cookie: _cookie, url: _url, ...limits } = options;
    this.options = limits;
    this.url = gatewayUrl(options.url);
    this.cookie = options.cookie;
    if (
      this.cookie.length === 0 ||
      this.cookie.length > 8192 ||
      /[^\x20-\x7e]/u.test(this.cookie)
    ) {
      throw gatewayError('profile_invalid', 'cookie_invalid');
    }
    const socketUrl = new URL('/api/remote.mux', this.url);
    socketUrl.protocol = this.url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(socketUrl, {
      headers: { cookie: this.cookie, origin: this.url.origin },
      followRedirects: false,
      perMessageDeflate: false,
      maxPayload: options.maxMessageBytes,
      handshakeTimeout: options.requestTimeoutMs,
    });
    this.socket.on('error', () => {
      this.fail(gatewayError('connection_aborted'));
    });
    this.socket.on('close', () => {
      this.fail(gatewayError('connection_aborted'));
    });
    this.socket.on('message', (data, binary) => {
      this.receive(data, binary);
    });
  }

  static async connect(
    options: GatewayTransportOptions,
  ): Promise<DshGatewayTransport> {
    const transport = new DshGatewayTransport(options);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          finish(gatewayError('timeout'));
        }, options.requestTimeoutMs);
        const onOpen = (): void => {
          finish();
        };
        const onError = (): void => {
          finish(gatewayError('connection_failed'));
        };
        const onResponse = (
          _request: unknown,
          response: { statusCode?: number; destroy(): void },
        ): void => {
          const code =
            response.statusCode === 401 || response.statusCode === 403
              ? 'authentication_failed'
              : 'connection_failed';
          response.destroy();
          finish(gatewayError(code));
        };
        const finish = (error?: HarnessError): void => {
          clearTimeout(timer);
          transport.socket.off('open', onOpen);
          transport.socket.off('error', onError);
          transport.socket.off('unexpected-response', onResponse);
          if (error === undefined) resolve();
          else reject(error);
        };
        transport.socket.once('open', onOpen);
        transport.socket.once('error', onError);
        transport.socket.once('unexpected-response', onResponse);
      });
      transport.assertOpen();
      return transport;
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  onClose(listener: (error: HarnessError) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async request(
    endpoint: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    this.assertOpen();
    if (!methods.has(endpoint))
      throw gatewayError('invalid_request', 'method_invalid');
    if (this.requests.size >= 32)
      throw gatewayError('run_conflict', 'request_capacity');
    const rpcId = randomUUID();
    const body = this.requestBody(endpoint, args, rpcId);
    const controller = new AbortController();
    this.requests.add(controller);
    const timeout = { expired: false };
    const timer = setTimeout(() => {
      timeout.expired = true;
      controller.abort();
    }, this.options.requestTimeoutMs);
    try {
      const response = await fetch(new URL(`/api/${endpoint}`, this.url), {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          cookie: this.cookie,
          origin: this.url.origin,
        },
        body,
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw gatewayError(
          response.status === 401 || response.status === 403
            ? 'authentication_failed'
            : 'connection_failed',
        );
      }
      const decoded = gatewayRecord(await this.readJson(response));
      const result = gatewayRecord(decoded?.['result']);
      if (
        decoded?.['type'] !== 'server-response' ||
        decoded['rpcId'] !== rpcId ||
        result === undefined
      ) {
        throw gatewayError('provider_api_incompatible');
      }
      if (result['ok'] === false) throw remoteError(result['error']);
      if (result['ok'] !== true)
        throw gatewayError('provider_api_incompatible');
      this.assertOpen();
      return result['value'];
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw gatewayError(
        timeout.expired
          ? 'timeout'
          : this.closed
            ? 'connection_aborted'
            : 'connection_failed',
      );
    } finally {
      clearTimeout(timer);
      this.requests.delete(controller);
    }
  }

  /** Validate the exact serialized size before a Client takes ownership of a Run. */
  validateRequest(
    endpoint: string,
    args: Readonly<Record<string, unknown>>,
  ): void {
    this.assertOpen();
    this.requestBody(endpoint, args, '00000000-0000-0000-0000-000000000000');
  }

  private requestBody(
    endpoint: string,
    args: Readonly<Record<string, unknown>>,
    rpcId: string,
  ): string {
    const body = JSON.stringify({
      type: 'client-request',
      rpcId,
      method: endpoint,
      payload: { args },
    });
    if (Buffer.byteLength(body) > this.options.maxMessageBytes)
      throw gatewayError('invalid_request', 'request_capacity');
    return body;
  }

  open(
    endpoint: 'session/follow',
    args: Readonly<Record<string, unknown>>,
  ): GatewayStream {
    this.assertOpen();
    if (this.streams.size >= this.options.maxSessions)
      throw gatewayError('run_conflict', 'stream_capacity');
    const streamId = randomUUID();
    const queue = new GatewayQueue<unknown>(this.options.maxBufferedEvents);
    this.streams.set(streamId, queue);
    this.send({ type: 'open', streamId, endpoint, payload: { args } });
    return {
      events: queue.iterate(),
      close: () => {
        if (!this.streams.delete(streamId)) return;
        queue.end();
        if (!this.closed) this.send({ type: 'cancel', streamId });
      },
    };
  }

  close(): void {
    this.fail(gatewayError('connection_aborted', 'client_closed'));
  }

  private send(message: unknown): void {
    const encoded = JSON.stringify(message);
    if (
      Buffer.byteLength(encoded) + this.socket.bufferedAmount >
      this.options.maxMessageBytes
    ) {
      this.fail(gatewayError('connection_aborted', 'write_capacity'));
      return;
    }
    this.socket.send(encoded, (error) => {
      if (error) this.fail(gatewayError('connection_aborted'));
    });
  }

  private receive(data: RawData, binary: boolean): void {
    if (this.closed) return;
    try {
      if (binary || !Buffer.isBuffer(data))
        throw gatewayError('provider_api_incompatible');
      const frame = gatewayRecord(JSON.parse(data.toString()) as unknown);
      if (
        typeof frame?.['streamId'] !== 'string' ||
        !['item', 'error', 'end'].includes(String(frame['type']))
      )
        throw gatewayError('provider_api_incompatible');
      const queue = this.streams.get(frame['streamId']);
      if (queue === undefined) return; // A cancelled logical stream may have already-written frames in flight.
      if (frame['type'] === 'item') {
        if (frame['value'] === undefined || !queue.push(frame['value']))
          throw gatewayError('provider_api_incompatible', 'stream_capacity');
      } else {
        const failure =
          frame['type'] === 'error'
            ? remoteError(frame['error'])
            : gatewayError('connection_aborted', 'stream_ended');
        this.streams.delete(frame['streamId']);
        queue.end(failure);
      }
    } catch (error) {
      this.fail(
        error instanceof HarnessError
          ? error
          : gatewayError('provider_api_incompatible'),
      );
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (reader === undefined) throw gatewayError('provider_api_incompatible');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        const chunk: unknown = item.value;
        if (!(chunk instanceof Uint8Array))
          throw gatewayError('provider_api_incompatible');
        size += chunk.length;
        if (size > this.options.maxMessageBytes)
          throw gatewayError('provider_api_incompatible', 'response_capacity');
        chunks.push(chunk);
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
      } catch {
        throw gatewayError('provider_api_incompatible');
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  private fail(error: HarnessError): void {
    if (this.closed) return;
    this.closed = true;
    this.cookie = '';
    for (const request of this.requests) request.abort();
    for (const queue of this.streams.values()) queue.end(error);
    this.streams.clear();
    this.socket.terminate();
    for (const listener of this.closeListeners) listener(error);
    this.closeListeners.clear();
  }

  private assertOpen(): void {
    if (this.closed) throw gatewayError('connection_aborted');
  }
}
