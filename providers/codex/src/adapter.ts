import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import {
  ExtensionRegistry,
  HarnessError,
  assertSessionCompatibility,
  assertSessionOwnership,
  providerSessionId,
  runId,
  type CancelResult,
  type CapabilityManifest,
  type CapabilityStatus,
  type ClientDescriptor,
  type CreateSessionInput,
  type HarnessClient,
  type HarnessEvent,
  type HarnessInput,
  type HarnessProfile,
  type HarnessRun,
  type HarnessSession,
  type InteractionResponse,
  type ProviderAdapterFactory,
  type ProviderDescriptor,
  type ProviderSessionId,
  type RunOptions,
  type RunRef,
  type RunResult,
  type SessionRef,
  type UsageSummary,
} from '@harapter/core';
import {
  JsonRpcRemoteError,
  JsonRpcStdioTransport,
  JsonRpcTransportError,
  type JsonRpcId,
  type JsonRpcInboundMessage,
  type JsonRpcRequestOptions,
  type JsonRpcStdioTransportOptions,
} from '@harapter/transport-jsonrpc-stdio';
import {
  CODEX_PROVIDER_ID,
  CODEX_SESSION_COMPATIBILITY_REF,
  codexCompatibilityIdentity,
  encodeCodexInteractionResponse,
  mapCodexNotification,
  mapCodexServerRequest,
  parseCodexInitializeResponse,
  parseCodexThreadResponse,
  parseCodexTurnStartResponse,
  prepareCodexInput,
  prepareCodexSessionParams,
  prepareCodexTurnParams,
  redactCodexEvent,
  type CodexRawEvent,
  type MappedCodexEvent,
  type MappedCodexServerRequest,
} from './protocol.js';

const descriptor: ProviderDescriptor = {
  providerId: CODEX_PROVIDER_ID,
  displayName: 'Codex App Server',
  connectionKinds: ['process'],
  documentationUrl: 'https://developers.openai.com/codex/app-server',
};

const defaultMaxRunEvents = 128;
const defaultCancelSettlementTimeoutMs = 10_000;
const childTerminationTimeoutMs = 2_000;
const maximumTimerMilliseconds = 2_147_483_647;

/** Connection-level limits accepted in a Codex Profile's providerOptions. */
export interface CodexProfileOptions {
  readonly cancelSettlementTimeoutMs?: number;
  readonly maxBufferedMessages?: number;
  readonly maxMessageBytes?: number;
  readonly maxPendingInboundRequests?: number;
  readonly maxPendingRequests?: number;
  readonly maxPendingWrites?: number;
  readonly maxRunEvents?: number;
  readonly requestTimeoutMs?: number;
}

/** Request options for explicit Provider-native App Server calls. */
export interface CodexNativeRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Explicit Provider-native escape hatch for initialized App Server traffic. */
export interface CodexNativeClient {
  readonly runtimeIdentity: string;
  request<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: CodexNativeRequestOptions,
  ): Promise<TResult>;
  notify(method: string, params?: unknown): Promise<void>;
  onUnknownEvent(listener: (event: CodexRawEvent) => void): () => void;
}

interface ResolvedConnectionOptions {
  readonly cancelSettlementTimeoutMs: number;
  readonly maxRunEvents: number;
  readonly transport: Omit<
    JsonRpcStdioTransportOptions,
    'cleanup' | 'readable' | 'writable'
  >;
}

interface PendingInteraction {
  readonly wireId: JsonRpcId;
  readonly wireKey: string;
  readonly request: MappedCodexServerRequest;
  readonly run: CodexRun;
}

interface StartingRun {
  readonly promise: Promise<CodexRun | undefined>;
  readonly resolve: (run: CodexRun | undefined) => void;
}

type CodexChildProcess = ChildProcessByStdio<Writable, Readable, null>;

/** Create a fresh Codex App Server Adapter factory. */
export function createCodexProviderFactory(): ProviderAdapterFactory {
  return {
    descriptor: () => ({
      ...descriptor,
      connectionKinds: [...descriptor.connectionKinds],
    }),
    connect: async (profile) => connectCodex(profile),
  };
}

async function connectCodex(profile: HarnessProfile): Promise<HarnessClient> {
  validateProfile(profile);
  const options = connectionOptions(profile.providerOptions);
  let transport: JsonRpcStdioTransport;
  try {
    transport = await spawnTransport(profile, options.transport);
  } catch (error) {
    throw mapError(error, profile, 'spawn', true);
  }

  try {
    const initialize = await transport.request('initialize', {
      clientInfo: {
        name: 'harapter',
        title: 'Harapter',
        version: '0.0.0',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
      },
    });
    const runtime = parseCodexInitializeResponse(initialize);
    await transport.notify('initialized');
    return new CodexClient(
      snapshotProfile(profile),
      transport,
      runtime,
      options.cancelSettlementTimeoutMs,
      options.maxRunEvents,
    );
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw mapError(error, profile, 'initialize', true);
  }
}

class CodexClient implements HarnessClient {
  private readonly activeByThread = new Map<string, CodexRun>();
  private readonly activeByTurn = new Map<string, CodexRun>();
  private readonly ephemeralThreads = new Set<string>();
  private readonly extensionRegistry = new ExtensionRegistry(CODEX_PROVIDER_ID);
  private readonly nativeClient: CodexNativeClient;
  private readonly pendingByLocalId = new Map<string, PendingInteraction>();
  private readonly pendingByWireKey = new Map<string, PendingInteraction>();
  private readonly seenTurnIds = new Set<string>();
  private readonly startingByThread = new Map<string, StartingRun>();
  private readonly unknownListeners = new Set<(event: CodexRawEvent) => void>();
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private interactionSerial = 0;
  private runSerial = 0;

  constructor(
    private readonly profile: HarnessProfile,
    private readonly transport: JsonRpcStdioTransport,
    private readonly runtime: ReturnType<typeof parseCodexInitializeResponse>,
    private readonly cancelSettlementTimeoutMs: number,
    private readonly maxRunEvents: number,
  ) {
    this.nativeClient = Object.freeze({
      runtimeIdentity: this.runtimeIdentity(),
      request: <TResult>(
        method: string,
        params?: unknown,
        options?: CodexNativeRequestOptions,
      ) => this.nativeRequest<TResult>(method, params, options),
      notify: (method: string, params?: unknown) =>
        this.nativeNotify(method, params),
      onUnknownEvent: (listener: (event: CodexRawEvent) => void) => {
        this.unknownListeners.add(listener);
        return () => {
          this.unknownListeners.delete(listener);
        };
      },
    });
    void this.pump().catch(() => undefined);
  }

  descriptor(): Promise<ClientDescriptor> {
    return Promise.resolve({
      providerId: CODEX_PROVIDER_ID,
      profileId: this.profile.profileId,
      displayName: this.profile.displayName,
      connectionKind: 'process',
      runtime: {
        name: 'Codex App Server',
        version: this.runtime.runtimeVersion,
        protocol: 'JSONL RPC',
        protocolVersion: 'stable',
      },
      compatibility: 'supported',
    });
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(
      codexCapabilities(this.profile, this.runtimeIdentity()),
    );
  }

  async createSession(input: CreateSessionInput = {}): Promise<HarnessSession> {
    this.assertOpen();
    const params = prepareCodexSessionParams(input);
    try {
      const response = await this.transport.request('thread/start', params);
      const threadId = parseCodexThreadResponse(response);
      if (params['ephemeral'] === true) this.ephemeralThreads.add(threadId);
      return new CodexSession(
        this,
        providerSessionId(threadId),
        params['ephemeral'] !== true,
      );
    } catch (error) {
      throw mapError(
        error,
        this.profile,
        'thread/start',
        false,
        this.transport,
      );
    }
  }

  async resumeSession(ref: SessionRef): Promise<HarnessSession> {
    this.assertOpen();
    assertSessionOwnership(ref, CODEX_PROVIDER_ID, this.profile.profileId);
    if (
      this.ephemeralThreads.has(ref.providerSessionId) ||
      isEphemeralSessionRef(ref)
    ) {
      throw new HarnessError(
        'unsupported_capability',
        'An ephemeral Codex Thread cannot be resumed.',
        {
          retryable: false,
          providerId: CODEX_PROVIDER_ID,
          profileId: this.profile.profileId,
          details: { capability: 'session.resume' },
        },
      );
    }
    assertSessionCompatibility(ref, CODEX_SESSION_COMPATIBILITY_REF);
    try {
      const response = await this.transport.request('thread/resume', {
        threadId: ref.providerSessionId,
      });
      const threadId = parseCodexThreadResponse(response);
      if (threadId !== ref.providerSessionId) {
        throw new HarnessError(
          'session_provider_mismatch',
          'Codex resumed a different Thread than requested.',
          {
            retryable: false,
            providerId: CODEX_PROVIDER_ID,
            profileId: this.profile.profileId,
          },
        );
      }
      return new CodexSession(this, providerSessionId(threadId), true);
    } catch (error) {
      throw mapError(
        error,
        this.profile,
        'thread/resume',
        false,
        this.transport,
      );
    }
  }

  extensions(): ExtensionRegistry {
    return this.extensionRegistry;
  }

  native<T = unknown>(guard?: (value: unknown) => value is T): T | undefined {
    const value: unknown = this.nativeClient;
    return guard !== undefined && !guard(value) ? undefined : (value as T);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  sessionRef(sessionId: ProviderSessionId, resumable: boolean): SessionRef {
    return {
      providerId: CODEX_PROVIDER_ID,
      profileId: this.profile.profileId,
      providerSessionId: sessionId,
      compatibilityRef: CODEX_SESSION_COMPATIBILITY_REF,
      providerState: {
        createdRuntimeVersion: this.runtime.runtimeVersion,
        ...(resumable ? {} : { ephemeral: true }),
      },
    };
  }

  capabilityManifest(resumable = true): CapabilityManifest {
    return codexCapabilities(this.profile, this.runtimeIdentity(), resumable);
  }

  hasActiveRun(threadId: string): boolean {
    return (
      this.activeByThread.has(threadId) || this.startingByThread.has(threadId)
    );
  }

  async startRun(
    sessionId: ProviderSessionId,
    input: HarnessInput,
    options: RunOptions = {},
  ): Promise<HarnessRun> {
    this.assertOpen();
    if (this.hasActiveRun(sessionId)) {
      throw new HarnessError(
        'run_conflict',
        'Codex Thread already has an active Turn.',
        {
          retryable: false,
          providerId: CODEX_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    const nativeInput = prepareCodexInput(input);
    const overrides = prepareCodexTurnParams(options);
    const starting = createStartingRun();
    this.startingByThread.set(sessionId, starting);
    try {
      const response = await this.transport.request('turn/start', {
        threadId: sessionId,
        input: nativeInput,
        ...overrides,
      });
      const turnId = parseCodexTurnStartResponse(response);
      if (this.seenTurnIds.has(turnId)) {
        this.abortConnection();
        throw new HarnessError(
          'provider_api_incompatible',
          'Codex reused a Turn identifier on one connection.',
          {
            retryable: false,
            providerId: CODEX_PROVIDER_ID,
            profileId: this.profile.profileId,
          },
        );
      }
      this.seenTurnIds.add(turnId);
      const run = new CodexRun(
        {
          providerId: CODEX_PROVIDER_ID,
          profileId: this.profile.profileId,
          sessionId,
          runId: runId(`codex-run-${String(++this.runSerial)}`),
          providerRunId: turnId,
        },
        turnId,
        this.maxRunEvents,
        this.cancelSettlementTimeoutMs,
        options.timeoutMs,
        (activeRun) => this.interrupt(activeRun),
        () => {
          this.abortConnection();
        },
        (activeRun) => {
          this.onRunTerminal(activeRun);
        },
      );
      this.activeByThread.set(sessionId, run);
      this.activeByTurn.set(turnId, run);
      starting.resolve(run);
      return run;
    } catch (error) {
      starting.resolve(undefined);
      throw mapError(error, this.profile, 'turn/start', false, this.transport);
    } finally {
      if (this.startingByThread.get(sessionId) === starting) {
        this.startingByThread.delete(sessionId);
      }
    }
  }

  async respond(
    sessionId: ProviderSessionId,
    requestId: string,
    response: InteractionResponse,
  ): Promise<void> {
    this.assertOpen();
    const pending = this.pendingByLocalId.get(requestId);
    if (
      pending?.run.ref().sessionId !== sessionId ||
      pending.run.isTerminal()
    ) {
      throw new HarnessError(
        'invalid_request',
        'The Codex interaction is no longer pending for this Session.',
        {
          retryable: false,
          providerId: CODEX_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    const result = encodeCodexInteractionResponse(pending.request, response);
    try {
      await this.transport.respond(pending.wireId, result);
      this.settlePending(pending, 'host');
    } catch (error) {
      throw mapError(
        error,
        this.profile,
        'interaction/respond',
        false,
        this.transport,
      );
    }
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.transport.incoming()) {
        if (message.kind === 'request') await this.handleRequest(message);
        else await this.handleNotification(message.method, message.params);
      }
    } catch {
      if (!this.closed) this.abortConnection();
    }
  }

  private async handleRequest(
    message: Extract<JsonRpcInboundMessage, { kind: 'request' }>,
  ): Promise<void> {
    const requestId = `codex-interaction-${String(++this.interactionSerial)}`;
    const mapped = mapCodexServerRequest(
      message.method,
      message.params,
      requestId,
    );
    const run = await this.routeWhenStarted(mapped.threadId, mapped.turnId);
    if (run === undefined) {
      this.emitUnknown(redactCodexEvent(message.method, message.params));
      await this.transport.respondError(message.id, {
        code: -32_601,
        message: 'Harapter has no active Run for this request.',
      });
      return;
    }
    const pending: PendingInteraction = {
      wireId: message.id,
      wireKey: wireKey(message.id),
      request: mapped,
      run,
    };
    this.pendingByLocalId.set(mapped.interaction.requestId, pending);
    this.pendingByWireKey.set(pending.wireKey, pending);
    run.emit({ type: 'interaction.requested', data: mapped.interaction });
  }

  private async handleNotification(
    method: string,
    params: unknown,
  ): Promise<void> {
    if (method === 'serverRequest/resolved') {
      const requestId = requestIdFromResolved(params);
      const pending =
        requestId === undefined
          ? undefined
          : this.pendingByWireKey.get(wireKey(requestId));
      if (pending !== undefined) {
        this.settlePending(pending, 'provider', true);
      } else {
        this.emitUnknown(redactCodexEvent(method, params));
      }
      return;
    }

    const mapping = mapCodexNotification(method, params);
    const run = await this.routeWhenStarted(mapping.threadId, mapping.turnId);
    if (run === undefined) {
      let observed = false;
      for (const event of mapping.events) {
        if (event.raw === undefined) continue;
        observed = true;
        this.emitUnknown(event.raw);
      }
      if (!observed && mapping.turnId !== undefined) {
        this.emitUnknown(redactCodexEvent(method, params));
      }
      return;
    }
    for (const event of mapping.events) {
      if (event.raw !== undefined) this.emitUnknown(event.raw);
    }
    if (
      mapping.events.some(({ terminalResult }) => terminalResult !== undefined)
    ) {
      this.resolvePendingForRun(run, 'turn_terminal');
    }
    for (const event of mapping.events) run.emit(event);
  }

  private route(
    threadId: string | undefined,
    turnId: string | undefined,
  ): CodexRun | undefined {
    if (turnId === undefined) return undefined;
    const byTurn = this.activeByTurn.get(turnId);
    if (
      byTurn !== undefined &&
      (threadId === undefined || byTurn.ref().sessionId === threadId)
    ) {
      return byTurn;
    }
    return undefined;
  }

  private async routeWhenStarted(
    threadId: string | undefined,
    turnId: string | undefined,
  ): Promise<CodexRun | undefined> {
    const active = this.route(threadId, turnId);
    if (active !== undefined || threadId === undefined) return active;
    const starting = this.startingByThread.get(threadId);
    if (starting === undefined) return undefined;
    await starting.promise;
    return this.route(threadId, turnId);
  }

  private async interrupt(run: CodexRun): Promise<void> {
    this.assertOpen();
    try {
      await this.transport.request('turn/interrupt', {
        threadId: run.ref().sessionId,
        turnId: run.turnId,
      });
    } catch (error) {
      throw mapError(
        error,
        this.profile,
        'turn/interrupt',
        false,
        this.transport,
      );
    }
  }

  private onRunTerminal(run: CodexRun): void {
    const reference = run.ref();
    if (this.activeByThread.get(reference.sessionId) === run) {
      this.activeByThread.delete(reference.sessionId);
    }
    if (this.activeByTurn.get(run.turnId) === run) {
      this.activeByTurn.delete(run.turnId);
    }
    this.resolvePendingForRun(run, 'turn_terminal');
  }

  private resolvePendingForRun(run: CodexRun, resolution: string): void {
    for (const pending of [...this.pendingByLocalId.values()]) {
      if (pending.run !== run) continue;
      this.settlePending(pending, resolution, true);
    }
  }

  private settlePending(
    pending: PendingInteraction,
    resolution: string,
    abandonWire = false,
  ): void {
    if (
      this.pendingByLocalId.get(pending.request.interaction.requestId) !==
      pending
    ) {
      return;
    }
    if (abandonWire) this.transport.abandonInboundRequest(pending.wireId);
    this.removePending(pending);
    pending.run.emit({
      type: 'interaction.resolved',
      data: {
        requestId: pending.request.interaction.requestId,
        resolution,
      },
    });
  }

  private removePending(pending: PendingInteraction): void {
    this.pendingByLocalId.delete(pending.request.interaction.requestId);
    this.pendingByWireKey.delete(pending.wireKey);
  }

  private emitUnknown(event: CodexRawEvent): void {
    for (const listener of [...this.unknownListeners]) {
      try {
        listener(structuredClone(event));
      } catch {
        // Native observers cannot break Provider lifecycle processing.
      }
    }
  }

  private nativeRequest<TResult>(
    method: string,
    params: unknown,
    options: JsonRpcRequestOptions = {},
  ): Promise<TResult> {
    this.assertOpen();
    return this.transport.request<TResult>(method, params, options);
  }

  private nativeNotify(method: string, params: unknown): Promise<void> {
    this.assertOpen();
    return this.transport.notify(method, params);
  }

  private abortConnection(): void {
    if (this.closed) return;
    this.closed = true;
    for (const run of [...this.activeByTurn.values()]) {
      this.resolvePendingForRun(run, 'connection_aborted');
      run.abortConnection();
    }
    this.pendingByLocalId.clear();
    this.pendingByWireKey.clear();
    void this.transport.close().catch(() => undefined);
  }

  private async closeOnce(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      for (const run of [...this.activeByTurn.values()]) {
        this.resolvePendingForRun(run, 'connection_aborted');
        run.abortConnection();
      }
      this.pendingByLocalId.clear();
      this.pendingByWireKey.clear();
    }
    try {
      await this.transport.close();
    } catch (error) {
      throw mapError(error, this.profile, 'close', false, this.transport);
    }
  }

  private runtimeIdentity(): string {
    return codexCompatibilityIdentity(this.runtime.runtimeVersion);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new HarnessError(
        'connection_aborted',
        'Codex App Server is closed.',
        {
          retryable: false,
          providerId: CODEX_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
  }
}

class CodexSession implements HarnessSession {
  private closed = false;

  constructor(
    private readonly client: CodexClient,
    private readonly sessionId: ProviderSessionId,
    private readonly resumable: boolean,
  ) {}

  ref(): SessionRef {
    return this.client.sessionRef(this.sessionId, this.resumable);
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.client.capabilityManifest(this.resumable));
  }

  start(input: HarnessInput, options?: RunOptions): Promise<HarnessRun> {
    this.assertOpen();
    return this.client.startRun(this.sessionId, input, options);
  }

  respond(requestId: string, response: InteractionResponse): Promise<void> {
    this.assertOpen();
    return this.client.respond(this.sessionId, requestId, response);
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.client.hasActiveRun(this.sessionId)) {
      return Promise.reject(
        new HarnessError(
          'run_conflict',
          'Cannot close a Codex Session with an active Run.',
          {
            retryable: false,
            providerId: CODEX_PROVIDER_ID,
            profileId: this.ref().profileId,
          },
        ),
      );
    }
    this.closed = true;
    return Promise.resolve();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new HarnessError('session_not_found', 'Codex Session is closed.', {
        retryable: false,
        providerId: CODEX_PROVIDER_ID,
        profileId: this.ref().profileId,
      });
    }
  }
}

class CodexRun implements HarnessRun {
  private readonly eventQueue: EventQueue;
  private readonly settlement: Promise<RunResult>;
  private readonly timeout: NodeJS.Timeout | undefined;
  private cancelPromise: Promise<CancelResult> | undefined;
  private finalMessage: string | undefined;
  private finalResult: RunResult | undefined;
  private resolveSettlement!: (result: RunResult) => void;
  private sequence = 0;
  private timeoutTriggered = false;
  private usage: UsageSummary | undefined;

  constructor(
    private readonly reference: RunRef,
    readonly turnId: string,
    maxRunEvents: number,
    private readonly cancelSettlementTimeoutMs: number,
    timeoutMs: number | undefined,
    private readonly interrupt: (run: CodexRun) => Promise<void>,
    private readonly abortOwnerConnection: () => void,
    private readonly onTerminal: (run: CodexRun) => void,
  ) {
    this.eventQueue = new EventQueue(maxRunEvents);
    this.settlement = new Promise((resolve) => {
      this.resolveSettlement = resolve;
    });
    this.timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.timeoutTriggered = true;
            void this.cancel().catch(() => {
              this.abortOwnerConnection();
            });
          }, timeoutMs);
    this.timeout?.unref();
    this.emit({ type: 'run.started', data: {} });
  }

  ref(): RunRef {
    return { ...this.reference };
  }

  events(): AsyncIterable<HarnessEvent> {
    return this.eventQueue.iterable();
  }

  cancel(): Promise<CancelResult> {
    if (this.isTerminal()) return Promise.resolve({ mode: 'already_terminal' });
    this.cancelPromise ??= this.cancelOnce();
    return this.cancelPromise;
  }

  result(): Promise<RunResult> {
    return this.settlement;
  }

  isTerminal(): boolean {
    return this.finalResult !== undefined;
  }

  emit(mapped: MappedCodexEvent): void {
    if (this.isTerminal()) return;
    if (mapped.finalMessage !== undefined)
      this.finalMessage = mapped.finalMessage;
    if (mapped.usage !== undefined) this.usage = mapped.usage;

    if (mapped.terminalResult !== undefined) {
      const result: RunResult = {
        ...mapped.terminalResult,
        ...(mapped.terminalResult.status === 'completed' &&
        this.finalMessage !== undefined
          ? { finalMessage: this.finalMessage }
          : {}),
        ...(this.usage === undefined ? {} : { usage: this.usage }),
        ...(this.timeoutTriggered &&
        mapped.terminalResult.status === 'cancelled'
          ? { providerResult: { reason: 'timeout' } }
          : {}),
      };
      this.finish(result, mapped.type, {
        ...mapped,
        data: result,
      });
      return;
    }
    const event = this.portableEvent(mapped);
    if (!this.eventQueue.push(event)) this.abortOwnerConnection();
  }

  abortConnection(): void {
    if (this.isTerminal()) return;
    const result: RunResult = { status: 'connection_aborted' };
    this.finish(result, 'connection.aborted', {
      type: 'connection.aborted',
      data: result,
    });
  }

  private async cancelOnce(): Promise<CancelResult> {
    await this.interrupt(this);
    const watchdog = setTimeout(() => {
      this.abortOwnerConnection();
    }, this.cancelSettlementTimeoutMs);
    watchdog.unref();
    try {
      const result = await this.settlement;
      if (result.status === 'cancelled') return { mode: 'native' };
      return result.status === 'connection_aborted'
        ? { mode: 'connection_aborted' }
        : { mode: 'already_terminal' };
    } finally {
      clearTimeout(watchdog);
    }
  }

  private finish(
    result: RunResult,
    terminalType: HarnessEvent['type'],
    mapped: MappedCodexEvent,
  ): void {
    if (this.isTerminal()) return;
    this.finalResult = result;
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.eventQueue.pushTerminal(
      this.portableEvent({ ...mapped, type: terminalType, data: result }),
    );
    this.eventQueue.close();
    this.onTerminal(this);
    this.resolveSettlement(result);
  }

  private portableEvent(mapped: MappedCodexEvent): HarnessEvent {
    const sequence = this.sequence++;
    return {
      id: `${this.reference.runId}:event:${String(sequence)}`,
      type: mapped.type,
      providerId: this.reference.providerId,
      profileId: this.reference.profileId,
      sessionId: this.reference.sessionId,
      runId: this.reference.runId,
      sequence,
      timestamp: new Date().toISOString(),
      data: mapped.data,
      ...(mapped.providerEventType === undefined
        ? {}
        : { providerEventType: mapped.providerEventType }),
      ...(mapped.raw === undefined ? {} : { raw: mapped.raw }),
    };
  }
}

class EventQueue {
  private readonly values: HarnessEvent[] = [];
  private closed = false;
  private consumed = false;
  private waiter: ((result: IteratorResult<HarnessEvent>) => void) | undefined;

  constructor(private readonly capacity: number) {}

  push(event: HarnessEvent): boolean {
    if (this.closed) return false;
    if (this.waiter !== undefined) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter({ done: false, value: event });
      return true;
    }
    if (this.values.length >= this.capacity - 1) return false;
    this.values.push(event);
    return true;
  }

  pushTerminal(event: HarnessEvent): void {
    if (this.waiter !== undefined) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter({ done: false, value: event });
      return;
    }
    this.values.push(event);
  }

  close(): void {
    this.closed = true;
  }

  iterable(): AsyncIterable<HarnessEvent> {
    if (this.consumed) {
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            Promise.reject(
              new HarnessError(
                'run_conflict',
                'Codex Run events already have a consumer.',
                { retryable: false, providerId: CODEX_PROVIDER_ID },
              ),
            ),
        }),
      };
    }
    this.consumed = true;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => this.next(),
      }),
    };
  }

  private next(): Promise<IteratorResult<HarnessEvent>> {
    const event = this.values.shift();
    if (event !== undefined)
      return Promise.resolve({ done: false, value: event });
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    if (this.waiter !== undefined) {
      return Promise.reject(
        new HarnessError(
          'run_conflict',
          'A Codex event read is already pending.',
          {
            retryable: false,
            providerId: CODEX_PROVIDER_ID,
          },
        ),
      );
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

async function spawnTransport(
  profile: HarnessProfile,
  options: ResolvedConnectionOptions['transport'],
): Promise<JsonRpcStdioTransport> {
  if (profile.connection.kind !== 'process') throw profileInvalid(profile);
  const child = spawn(
    profile.connection.command,
    [...(profile.connection.args ?? [])],
    {
      cwd: profile.connection.cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );
  await processStarted(child);
  try {
    return new JsonRpcStdioTransport({
      ...options,
      readable: child.stdout,
      writable: child.stdin,
      cleanup: () => terminateChild(child),
    });
  } catch (error) {
    await terminateChild(child);
    throw error;
  }
}

function processStarted(child: CodexChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = (): void => {
      child.off('error', onError);
      child.on('error', () => undefined);
      resolve();
    };
    const onError = (error: Error): void => {
      child.off('spawn', onSpawn);
      reject(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

async function terminateChild(child: CodexChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (await waitForChildExit(child, childTerminationTimeoutMs)) return;
  child.kill('SIGKILL');
  if (await waitForChildExit(child, childTerminationTimeoutMs)) return;
  throw new Error('Codex child process did not exit after forced termination.');
}

function waitForChildExit(
  child: CodexChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const onExit = (): void => {
      finish(true);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    timer.unref();
    function finish(exited: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    }
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
}

function codexCapabilities(
  profile: HarnessProfile,
  runtimeIdentity: string,
  resumable = true,
): CapabilityManifest {
  const native: CapabilityStatus = { mode: 'native', source: 'schema' };
  const unsupported: CapabilityStatus = {
    mode: 'unsupported',
    source: 'schema',
  };
  const sessionResume: CapabilityStatus = resumable
    ? native
    : {
        mode: 'unsupported',
        reason: 'Ephemeral Codex Threads are not persisted for resume.',
        source: 'configuration',
      };
  return {
    providerId: CODEX_PROVIDER_ID,
    profileId: profile.profileId,
    capabilities: {
      'session.create': native,
      'session.resume': sessionResume,
      'session.fork': unsupported,
      'session.close': { mode: 'adapter_controlled', source: 'configuration' },
      'run.stream': native,
      'run.cancel': native,
      'connection.abort': {
        mode: 'adapter_controlled',
        source: 'configuration',
      },
      'input.text': native,
      'input.image': native,
      'input.file': unsupported,
      'interaction.approval': native,
      'interaction.user_input': {
        mode: 'unsupported',
        reason: 'Codex user-input requests require the experimental API.',
        source: 'schema',
      },
      'interaction.provider': native,
      'event.raw': { mode: 'adapter_controlled', source: 'configuration' },
      'native.client': native,
    },
    observedAt: new Date().toISOString(),
    runtimeIdentity,
  };
}

function connectionOptions(
  value: Readonly<Record<string, unknown>> | undefined,
): ResolvedConnectionOptions {
  const options = value ?? {};
  const allowed = new Set([
    'cancelSettlementTimeoutMs',
    'maxBufferedMessages',
    'maxMessageBytes',
    'maxPendingInboundRequests',
    'maxPendingRequests',
    'maxPendingWrites',
    'maxRunEvents',
    'requestTimeoutMs',
  ]);
  const unknown = Object.keys(options).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw new HarnessError(
      'profile_invalid',
      `Unsupported Codex Profile option: ${unknown}.`,
      { retryable: false, providerId: CODEX_PROVIDER_ID },
    );
  }
  const transport: Record<string, number> = {};
  for (const name of [
    'maxBufferedMessages',
    'maxMessageBytes',
    'maxPendingInboundRequests',
    'maxPendingRequests',
    'maxPendingWrites',
  ] as const) {
    if (options[name] !== undefined) {
      transport[name] = positiveProfileInteger(options[name], name);
    }
  }
  if (options['requestTimeoutMs'] !== undefined) {
    transport['requestTimeoutMs'] = positiveProfileTimer(
      options['requestTimeoutMs'],
      'requestTimeoutMs',
    );
  }
  return {
    cancelSettlementTimeoutMs:
      options['cancelSettlementTimeoutMs'] === undefined
        ? defaultCancelSettlementTimeoutMs
        : positiveProfileTimer(
            options['cancelSettlementTimeoutMs'],
            'cancelSettlementTimeoutMs',
          ),
    maxRunEvents: runEventCapacity(options['maxRunEvents']),
    transport,
  };
}

function runEventCapacity(value: unknown): number {
  if (value === undefined) return defaultMaxRunEvents;
  const capacity = positiveProfileInteger(value, 'maxRunEvents');
  if (capacity < 2) {
    throw new HarnessError(
      'profile_invalid',
      'Codex maxRunEvents must reserve space for a terminal event.',
      { retryable: false, providerId: CODEX_PROVIDER_ID },
    );
  }
  return capacity;
}

function validateProfile(profile: HarnessProfile): void {
  if (
    profile.providerId !== CODEX_PROVIDER_ID ||
    profile.connection.kind !== 'process' ||
    profile.connection.ownership !== 'adapter' ||
    profile.connection.command.length === 0 ||
    profile.connection.envRefs !== undefined
  ) {
    throw profileInvalid(profile);
  }
}

function profileInvalid(profile: HarnessProfile): HarnessError {
  return new HarnessError(
    'profile_invalid',
    'Codex requires an adapter-owned process Profile without unresolved Secret references.',
    {
      retryable: false,
      providerId: CODEX_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function positiveProfileInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HarnessError(
      'profile_invalid',
      `Codex ${label} must be a positive integer.`,
      {
        retryable: false,
        providerId: CODEX_PROVIDER_ID,
      },
    );
  }
  return value;
}

function positiveProfileTimer(value: unknown, label: string): number {
  const timeout = positiveProfileInteger(value, label);
  if (timeout > maximumTimerMilliseconds) {
    throw new HarnessError(
      'profile_invalid',
      `Codex ${label} exceeds the supported timer range.`,
      {
        retryable: false,
        providerId: CODEX_PROVIDER_ID,
      },
    );
  }
  return timeout;
}

function snapshotProfile(profile: HarnessProfile): HarnessProfile {
  return {
    ...profile,
    connection: {
      ...profile.connection,
      ...(profile.connection.kind === 'process' && profile.connection.args
        ? { args: [...profile.connection.args] }
        : {}),
    },
    ...(profile.providerOptions === undefined
      ? {}
      : { providerOptions: { ...profile.providerOptions } }),
  };
}

function requestIdFromResolved(params: unknown): JsonRpcId | undefined {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return undefined;
  }
  const value = (params as Record<string, unknown>)['requestId'];
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : undefined;
}

function isEphemeralSessionRef(ref: SessionRef): boolean {
  return (
    typeof ref.providerState === 'object' &&
    ref.providerState !== null &&
    !Array.isArray(ref.providerState) &&
    (ref.providerState as Record<string, unknown>)['ephemeral'] === true
  );
}

function wireKey(id: JsonRpcId): string {
  return `${typeof id}:${String(id)}`;
}

function createStartingRun(): StartingRun {
  let resolve!: (run: CodexRun | undefined) => void;
  const promise = new Promise<CodexRun | undefined>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function mapError(
  error: unknown,
  profile: HarnessProfile,
  phase: string,
  connecting = false,
  transport?: JsonRpcStdioTransport,
): HarnessError {
  if (error instanceof HarnessError) return error;
  if (error instanceof JsonRpcRemoteError) {
    const remote = error.getRemoteError();
    const code =
      remote.code === -32_601 ? 'provider_api_incompatible' : 'provider_error';
    return new HarnessError(code, `Codex App Server rejected ${phase}.`, {
      retryable: false,
      providerId: CODEX_PROVIDER_ID,
      profileId: profile.profileId,
      providerCode: String(remote.code),
    });
  }
  if (error instanceof JsonRpcTransportError) {
    const code =
      error.code === 'request_timeout'
        ? 'timeout'
        : connecting
          ? 'connection_failed'
          : transport?.isOpen() === false
            ? 'connection_aborted'
            : 'provider_error';
    return new HarnessError(
      code,
      `Codex App Server ${phase} did not complete.`,
      {
        retryable:
          error.code === 'request_timeout' ||
          error.code === 'capacity_exceeded',
        providerId: CODEX_PROVIDER_ID,
        profileId: profile.profileId,
        providerCode: error.code,
      },
    );
  }
  const systemCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (connecting && systemCode === 'ENOENT') {
    return new HarnessError(
      'runtime_not_found',
      'The configured Codex runtime was not found.',
      {
        retryable: false,
        providerId: CODEX_PROVIDER_ID,
        profileId: profile.profileId,
      },
    );
  }
  return new HarnessError(
    connecting ? 'connection_failed' : 'provider_error',
    `Codex App Server ${phase} failed.`,
    {
      retryable: false,
      providerId: CODEX_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}
