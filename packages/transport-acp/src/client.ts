import {
  JsonRpcStdioTransport,
  JsonRpcTransportError,
  type JsonRpcId,
  type JsonRpcInboundMessage,
} from '@harapter/transport-jsonrpc-stdio';

import { AcpClientError, acpError } from './errors.js';
import {
  extensionMethod,
  parseEmptyResult,
  parseInitializeResult,
  parseListSessionsResult,
  parseNewSessionResult,
  parsePermissionRequest,
  parsePromptResult,
  parseSessionNotification,
  parseSessionStateResult,
  prepareInitializeInput,
  prepareListSessionsInput,
  prepareLoadSessionInput,
  prepareNewSessionInput,
  preparePermissionOutcome,
  preparePromptInput,
  prepareResumeSessionInput,
  redactAcpObservation,
  sessionIdentifier,
} from './validation.js';
import type {
  AcpAgentCapabilities,
  AcpClientOptions,
  AcpEvent,
  AcpInitializeInput,
  AcpInitializeResult,
  AcpListSessionsInput,
  AcpListSessionsResult,
  AcpLoadSessionInput,
  AcpMeta,
  AcpNewSessionInput,
  AcpNewSessionResult,
  AcpPermissionOutcome,
  AcpPermissionRequest,
  AcpPromptInput,
  AcpPromptResult,
  AcpRequestOptions,
  AcpResumeSessionInput,
  AcpSessionState,
} from './types.js';

const defaultMaxBufferedEvents = 128;
const permissionSettled = Symbol('permission-settled');

interface PendingPermission {
  readonly id: JsonRpcId;
  readonly key: string;
  readonly request: AcpPermissionRequest;
  readonly settle: () => void;
  readonly settled: Promise<void>;
}

type PermissionHandlerResult =
  | { readonly kind: 'failure' }
  | { readonly kind: 'outcome'; readonly outcome: AcpPermissionOutcome };

class EventQueue {
  private readonly capacity: number;
  private readonly values: AcpEvent[] = [];
  private waiter:
    | {
        resolve: (value: IteratorResult<AcpEvent>) => void;
        reject: (error: unknown) => void;
      }
    | undefined;
  private closed = false;
  private failure: unknown;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(value: AcpEvent): boolean {
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

  next(): Promise<IteratorResult<AcpEvent>> {
    const value = this.values.shift();
    if (value) return Promise.resolve({ done: false, value });
    if (this.failure !== undefined) {
      return Promise.reject(asError(this.failure));
    }
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    if (this.waiter) {
      return Promise.reject(
        acpError(
          'invalid_configuration',
          'Only one ACP event read may be pending at a time.',
        ),
      );
    }
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }

  close(failure?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = failure;
    this.values.length = 0;
    if (!this.waiter) return;
    const waiter = this.waiter;
    this.waiter = undefined;
    if (failure !== undefined) waiter.reject(failure);
    else waiter.resolve({ done: true, value: undefined });
  }
}

/**
 * Provider-neutral stable ACP v1 client over bounded JSON-RPC stdio streams.
 * It owns ACP negotiation and message semantics, never process lifecycle.
 */
export class AcpClient {
  private readonly transport: JsonRpcStdioTransport;
  private readonly eventQueue: EventQueue;
  private readonly requestPermissionHandler:
    AcpClientOptions['requestPermission'] | undefined;
  private readonly extensionRequestHandler:
    AcpClientOptions['extensionRequest'] | undefined;
  private readonly extensionNotificationHandler:
    AcpClientOptions['extensionNotification'] | undefined;
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly activePromptSessions = new Map<string, symbol>();
  private readonly cancellingSessions = new Set<string>();
  private readonly cancellationOperations = new Map<string, number>();
  private readonly closingSessions = new Set<string>();
  private readonly handlerTasks = new Set<Promise<void>>();
  private readonly dispatchPromise: Promise<void>;
  private initializeAttempted = false;
  private initializePromise: Promise<AcpInitializeResult> | undefined;
  private initializeResult: AcpInitializeResult | undefined;
  private eventsClaimed = false;
  private open = true;

  constructor(options: AcpClientOptions) {
    const {
      extensionNotification,
      extensionRequest,
      maxBufferedEvents = defaultMaxBufferedEvents,
      requestPermission,
      ...transportOptions
    } = options;
    if (!Number.isSafeInteger(maxBufferedEvents) || maxBufferedEvents <= 0) {
      throw acpError(
        'invalid_configuration',
        'ACP event capacity must be a positive safe integer.',
      );
    }
    this.eventQueue = new EventQueue(maxBufferedEvents);
    this.requestPermissionHandler = requestPermission;
    this.extensionRequestHandler = extensionRequest;
    this.extensionNotificationHandler = extensionNotification;
    this.transport = new JsonRpcStdioTransport({
      ...transportOptions,
      emitJsonRpcVersion: true,
      requireIntegerNumericIds: true,
      requireJsonRpcVersion: true,
    });
    this.dispatchPromise = this.dispatch().catch((error: unknown) => {
      this.fail(error);
    });
  }

  /** Negotiate the stable ACP v1 protocol exactly once. */
  initialize(
    input: AcpInitializeInput = {},
    options: AcpRequestOptions = {},
  ): Promise<AcpInitializeResult> {
    if (this.initializePromise) return this.initializePromise;
    if (this.initializeAttempted || this.initializeResult) {
      return Promise.reject(
        acpError(
          'already_initialized',
          'This ACP client has already attempted initialization.',
        ),
      );
    }
    if (!this.isOpen()) {
      return Promise.reject(
        acpError('client_closed', 'The ACP client is closed.'),
      );
    }
    let params: Readonly<Record<string, unknown>>;
    try {
      params = prepareInitializeInput(input);
    } catch (error) {
      return Promise.reject(asError(error));
    }
    this.initializeAttempted = true;
    const pending = this.transport
      .request('initialize', params, options)
      .then((value) => {
        const result = parseInitializeResult(value);
        this.initializeResult = result;
        return result;
      })
      .catch((error: unknown) => {
        if (error instanceof AcpClientError) this.fail(error);
        throw error;
      })
      .finally(() => {
        this.initializePromise = undefined;
      });
    this.initializePromise = pending;
    return pending;
  }

  /** Return the normalized capabilities established by initialization. */
  capabilities(): AcpAgentCapabilities {
    return this.requireInitialized().capabilities;
  }

  /** Create a new ACP Session. */
  async newSession(
    input: AcpNewSessionInput,
    options: AcpRequestOptions = {},
  ): Promise<AcpNewSessionResult> {
    const capabilities = this.requireReadyCapabilities();
    const params = prepareNewSessionInput(input, capabilities);
    return await this.requestParsed(
      'session/new',
      params,
      options,
      parseNewSessionResult,
    );
  }

  /** Load an existing Session and allow the Agent to replay its history. */
  async loadSession(
    input: AcpLoadSessionInput,
    options: AcpRequestOptions = {},
  ): Promise<AcpSessionState> {
    const capabilities = this.requireReadyCapabilities();
    this.requireCapability(
      capabilities.loadSession,
      'The ACP Agent did not advertise session/load.',
    );
    const params = prepareLoadSessionInput(input, capabilities);
    return await this.requestParsed(
      'session/load',
      params,
      options,
      parseSessionStateResult,
    );
  }

  /** Resume an existing Session without replaying its history. */
  async resumeSession(
    input: AcpResumeSessionInput,
    options: AcpRequestOptions = {},
  ): Promise<AcpSessionState> {
    const capabilities = this.requireReadyCapabilities();
    this.requireCapability(
      capabilities.session.resume,
      'The ACP Agent did not advertise session/resume.',
    );
    const params = prepareResumeSessionInput(input, capabilities);
    return await this.requestParsed(
      'session/resume',
      params,
      options,
      parseSessionStateResult,
    );
  }

  /** List Sessions when advertised by the Agent. */
  async listSessions(
    input: AcpListSessionsInput = {},
    options: AcpRequestOptions = {},
  ): Promise<AcpListSessionsResult> {
    const capabilities = this.requireReadyCapabilities();
    this.requireCapability(
      capabilities.session.list,
      'The ACP Agent did not advertise session/list.',
    );
    return await this.requestParsed(
      'session/list',
      prepareListSessionsInput(input),
      options,
      parseListSessionsResult,
    );
  }

  /** Delete a listed Session when advertised by the Agent. */
  async deleteSession(
    sessionId: string,
    options: AcpRequestOptions = {},
  ): Promise<Readonly<{ _meta?: AcpMeta }>> {
    const capabilities = this.requireReadyCapabilities();
    this.requireCapability(
      capabilities.session.delete,
      'The ACP Agent did not advertise session/delete.',
    );
    return await this.requestParsed(
      'session/delete',
      { sessionId: sessionIdentifier(sessionId) },
      options,
      parseEmptyResult,
    );
  }

  /** Close an active Session when advertised by the Agent. */
  async closeSession(
    sessionIdValue: string,
    options: AcpRequestOptions = {},
  ): Promise<Readonly<{ _meta?: AcpMeta }>> {
    const capabilities = this.requireReadyCapabilities();
    this.requireCapability(
      capabilities.session.close,
      'The ACP Agent did not advertise session/close.',
    );
    const sessionId = sessionIdentifier(sessionIdValue);
    if (this.closingSessions.has(sessionId)) {
      throw acpError('invalid_params', 'This ACP Session is already closing.');
    }
    this.closingSessions.add(sessionId);
    let detachedLocalWait = false;
    try {
      await this.settleSessionPermissions(sessionId);
      const result = await this.requestParsed(
        'session/close',
        { sessionId },
        options,
        parseEmptyResult,
      );
      this.activePromptSessions.delete(sessionId);
      this.maybeClearCancellation(sessionId);
      return result;
    } catch (error) {
      detachedLocalWait = isLocalWaitEnd(error);
      throw error;
    } finally {
      if (!detachedLocalWait) this.closingSessions.delete(sessionId);
    }
  }

  /** Submit one prompt turn and resolve only from its terminal response. */
  async prompt(
    input: AcpPromptInput,
    options: AcpRequestOptions = {},
  ): Promise<AcpPromptResult> {
    const capabilities = this.requireReadyCapabilities();
    const params = preparePromptInput(input, capabilities);
    const sessionId = input.sessionId;
    if (
      this.activePromptSessions.has(sessionId) ||
      this.cancellingSessions.has(sessionId) ||
      this.closingSessions.has(sessionId)
    ) {
      throw acpError(
        'invalid_params',
        'Only one ACP prompt may be active per Session.',
      );
    }
    const promptToken = Symbol(sessionId);
    this.activePromptSessions.set(sessionId, promptToken);
    let detachedLocalWait = false;
    try {
      return await this.requestParsed(
        'session/prompt',
        params,
        options,
        parsePromptResult,
      );
    } catch (error) {
      detachedLocalWait = isLocalWaitEnd(error);
      throw error;
    } finally {
      if (!detachedLocalWait) {
        if (this.activePromptSessions.get(sessionId) === promptToken) {
          this.activePromptSessions.delete(sessionId);
        }
        this.maybeClearCancellation(sessionId);
      }
    }
  }

  /**
   * Send native ACP Session cancellation. Pending permission prompts for the
   * Session are answered as cancelled first, as required by ACP v1.
   */
  async cancelSession(sessionIdValue: string): Promise<void> {
    this.requireReadyCapabilities();
    const sessionId = sessionIdentifier(sessionIdValue);
    this.cancellingSessions.add(sessionId);
    this.beginCancellationOperation(sessionId);
    try {
      await this.settleSessionPermissions(sessionId);
      await this.transport.notify('session/cancel', { sessionId });
    } finally {
      this.endCancellationOperation(sessionId);
    }
  }

  /** Invoke an explicitly namespaced ACP extension request. */
  async requestExtension<TResult = unknown>(
    methodValue: string,
    params?: unknown,
    options: AcpRequestOptions = {},
  ): Promise<TResult> {
    this.requireReadyCapabilities();
    return await this.transport.request<TResult>(
      extensionMethod(methodValue),
      params,
      options,
    );
  }

  /** Send an explicitly namespaced ACP extension notification. */
  async notifyExtension(methodValue: string, params?: unknown): Promise<void> {
    this.requireReadyCapabilities();
    await this.transport.notify(extensionMethod(methodValue), params);
  }

  /** Iterate typed Session updates and redacted unknown observations in order. */
  events(): AsyncIterableIterator<AcpEvent> {
    if (this.eventsClaimed) {
      throw acpError(
        'invalid_configuration',
        'The ACP event stream already has a consumer.',
      );
    }
    this.eventsClaimed = true;
    const source = this.iterateEvents();
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

  /** Whether the logical ACP connection can still accept operations. */
  isOpen(): boolean {
    return this.open && this.transport.isOpen();
  }

  /** Close ACP dispatch and the composed transport without owning its streams. */
  async close(): Promise<void> {
    if (this.open) {
      this.open = false;
      this.eventQueue.close();
      this.releaseAllPendingPermissions();
      this.activePromptSessions.clear();
      this.cancellingSessions.clear();
      this.cancellationOperations.clear();
      this.closingSessions.clear();
    }
    await this.transport.close();
    await this.dispatchPromise;
  }

  private async dispatch(): Promise<void> {
    for await (const message of this.transport.incoming()) {
      if (message.kind === 'request') this.track(this.handleRequest(message));
      else this.handleNotification(message);
    }
    if (this.open) {
      this.fail(
        acpError(
          'client_closed',
          'The ACP transport ended before the client was closed.',
        ),
      );
    }
  }

  private handleNotification(
    message: Extract<JsonRpcInboundMessage, { kind: 'notification' }>,
  ): void {
    if (message.method === 'session/update') {
      const parsed = parseSessionNotification(message.params);
      if (parsed.kind === 'update') {
        this.emit({
          kind: 'session_update',
          sessionId: parsed.sessionId,
          update: parsed.update,
        });
      } else {
        this.emit({ kind: 'unknown', observation: parsed.observation });
      }
      return;
    }
    if (message.method.startsWith('_')) {
      try {
        if (this.extensionNotificationHandler) {
          void Promise.resolve(
            this.extensionNotificationHandler(message.method, message.params),
          ).catch(() => undefined);
        }
      } catch {
        // Extension observers cannot affect ACP lifecycle.
      }
    }
    this.emit({
      kind: 'unknown',
      observation: redactAcpObservation(
        'unknown_notification',
        message.method,
        message.params,
      ),
    });
  }

  private async handleRequest(
    message: Extract<JsonRpcInboundMessage, { kind: 'request' }>,
  ): Promise<void> {
    if (message.method === 'session/request_permission') {
      let request: AcpPermissionRequest;
      try {
        request = parsePermissionRequest(message.params);
      } catch {
        await this.transport.respondError(message.id, {
          code: -32_602,
          message: 'Invalid params',
        });
        return;
      }
      if (
        this.cancellingSessions.has(request.sessionId) ||
        this.closingSessions.has(request.sessionId)
      ) {
        await this.transport.respond(message.id, {
          outcome: { outcome: 'cancelled' },
        });
        return;
      }
      if (!this.requestPermissionHandler) {
        await this.transport.respondError(message.id, {
          code: -32_601,
          message: 'Method not found',
        });
        return;
      }
      const pending: PendingPermission = {
        id: message.id,
        key: requestKey(message.id),
        request,
        ...settlementSignal(),
      };
      this.pendingPermissions.set(pending.key, pending);
      const permissionHandler = this.requestPermissionHandler;
      const handled: Promise<PermissionHandlerResult> = Promise.resolve()
        .then(() => permissionHandler(request))
        .then(
          (outcome) => ({ kind: 'outcome' as const, outcome }),
          () => ({ kind: 'failure' as const }),
        );
      const result = await Promise.race([
        handled,
        pending.settled.then((): typeof permissionSettled => permissionSettled),
      ]);
      if (result === permissionSettled) return;
      if (!this.releasePendingPermission(pending.key)) return;
      if (result.kind === 'failure') {
        await this.transport.respondError(message.id, {
          code: -32_603,
          message: 'Internal error',
        });
        return;
      }
      try {
        await this.transport.respond(
          message.id,
          preparePermissionOutcome(result.outcome, request),
        );
      } catch (error) {
        if (error instanceof AcpClientError) {
          await this.transport.respondError(message.id, {
            code: -32_603,
            message: 'Internal error',
          });
          return;
        }
        throw error;
      }
      return;
    }

    if (message.method.startsWith('_') && this.extensionRequestHandler) {
      try {
        const result = await this.extensionRequestHandler(
          message.method,
          message.params,
        );
        await this.transport.respond(message.id, result);
      } catch {
        await this.transport.respondError(message.id, {
          code: -32_603,
          message: 'Internal error',
        });
      }
      return;
    }

    this.emit({
      kind: 'unknown',
      observation: redactAcpObservation(
        'unknown_request',
        message.method,
        message.params,
      ),
    });
    await this.transport.respondError(message.id, {
      code: -32_601,
      message: 'Method not found',
    });
  }

  private emit(event: AcpEvent): void {
    if (this.eventQueue.push(event)) return;
    this.fail(
      acpError(
        'event_capacity_exceeded',
        'The bounded ACP event queue is full.',
      ),
    );
  }

  private track(promise: Promise<void>): void {
    const tracked = promise
      .catch((error: unknown) => {
        this.fail(error);
      })
      .finally(() => {
        this.handlerTasks.delete(tracked);
      });
    this.handlerTasks.add(tracked);
  }

  private fail(error: unknown): void {
    if (!this.open) return;
    this.open = false;
    this.releaseAllPendingPermissions();
    this.eventQueue.close(error);
    void this.transport.close().catch(() => undefined);
  }

  private async *iterateEvents(): AsyncGenerator<AcpEvent> {
    for (;;) {
      const next = await this.eventQueue.next();
      if (next.done) return;
      yield next.value;
    }
  }

  private requireInitialized(): AcpInitializeResult {
    if (!this.initializeResult) {
      throw acpError(
        'not_initialized',
        'The ACP client has not completed initialization.',
      );
    }
    return this.initializeResult;
  }

  private requireReadyCapabilities(): AcpAgentCapabilities {
    const result = this.requireInitialized();
    if (!this.isOpen()) {
      throw acpError('client_closed', 'The ACP client is closed.');
    }
    return result.capabilities;
  }

  private requireCapability(advertised: boolean, message: string): void {
    if (!advertised) {
      throw acpError('capability_not_advertised', message);
    }
  }

  private requestParsed<TResult>(
    method: string,
    params: Readonly<Record<string, unknown>>,
    options: AcpRequestOptions,
    parse: (value: unknown) => TResult,
  ): Promise<TResult> {
    return this.transport.request(method, params, options).then((value) => {
      try {
        return parse(value);
      } catch (error) {
        if (error instanceof AcpClientError) this.fail(error);
        throw error;
      }
    });
  }

  private async settleSessionPermissions(sessionId: string): Promise<void> {
    const responses: Promise<void>[] = [];
    for (const pending of [...this.pendingPermissions.values()]) {
      if (pending.request.sessionId !== sessionId) continue;
      this.releasePendingPermission(pending.key);
      responses.push(
        this.transport.respond(pending.id, {
          outcome: { outcome: 'cancelled' },
        }),
      );
    }
    await Promise.all(responses);
  }

  private releasePendingPermission(key: string): boolean {
    const pending = this.pendingPermissions.get(key);
    if (!pending) return false;
    this.pendingPermissions.delete(key);
    pending.settle();
    return true;
  }

  private releaseAllPendingPermissions(): void {
    for (const pending of [...this.pendingPermissions.values()]) {
      this.releasePendingPermission(pending.key);
    }
  }

  private beginCancellationOperation(sessionId: string): void {
    this.cancellationOperations.set(
      sessionId,
      (this.cancellationOperations.get(sessionId) ?? 0) + 1,
    );
  }

  private endCancellationOperation(sessionId: string): void {
    const remaining = (this.cancellationOperations.get(sessionId) ?? 1) - 1;
    if (remaining > 0) this.cancellationOperations.set(sessionId, remaining);
    else this.cancellationOperations.delete(sessionId);
    this.maybeClearCancellation(sessionId);
  }

  private maybeClearCancellation(sessionId: string): void {
    if (
      !this.activePromptSessions.has(sessionId) &&
      !this.cancellationOperations.has(sessionId)
    ) {
      this.cancellingSessions.delete(sessionId);
    }
  }
}

function requestKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function settlementSignal(): {
  readonly settle: () => void;
  readonly settled: Promise<void>;
} {
  let settle: (() => void) | undefined;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    settle: () => {
      settle?.();
      settle = undefined;
    },
    settled,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : acpError('invalid_message', 'The ACP operation failed safely.');
}

function isLocalWaitEnd(error: unknown): boolean {
  return (
    error instanceof JsonRpcTransportError &&
    (error.code === 'request_aborted' || error.code === 'request_timeout')
  );
}
