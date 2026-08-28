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
  type SecretRef,
  type SessionRef,
} from '@harapter/core';
import {
  HttpSseTransport,
  HttpTransportError,
  type HttpHeaderMap,
  type HttpMethod,
  type HttpRequestOptions,
  type HttpTransportResponse,
  type SseEvent,
} from '@harapter/transport-http-sse';
import {
  OPENCODE_PROVIDER_ID,
  OPENCODE_SESSION_COMPATIBILITY_REF,
  createOpenCodeEventState,
  mapOpenCodeEvent,
  parseOpenCodeEvent,
  parseOpenCodeHealth,
  parseOpenCodePromptResponse,
  parseOpenCodeSession,
  parseOpenCodeSessionStatus,
  prepareOpenCodePrompt,
  prepareOpenCodeSession,
  redactOpenCodeEvent,
  sessionStateFromRef,
  type MappedOpenCodeEvent,
  type OpenCodePermissionRequest,
  type OpenCodeRawEvent,
  type OpenCodeSessionState,
} from './protocol.js';

const descriptor: ProviderDescriptor = {
  providerId: OPENCODE_PROVIDER_ID,
  displayName: 'OpenCode Server',
  connectionKinds: ['endpoint'],
  documentationUrl: 'https://opencode.ai/docs/server/',
};

const defaultMaxRunEvents = 128;
const defaultRunRequestTimeoutMs = 30 * 60 * 1000;
const defaultCancelSettlementTimeoutMs = 10_000;
const defaultEventDrainTimeoutMs = 250;
const maximumTimerMilliseconds = 2_147_483_647;
const maximumRunEventCapacity = 4096;
const uncertainRequestProviderCodes = new Set([
  'network_failure',
  'request_aborted',
  'request_timeout',
  'response_stream_failed',
  'transport_closed',
]);

/** Host dependencies used without moving authentication ownership into Harapter. */
export interface OpenCodeProviderFactoryOptions {
  readonly fetch?: typeof fetch;
  readonly resolveAuthHeaders?: (
    reference: SecretRef,
  ) => HttpHeaderMap | Promise<HttpHeaderMap>;
}

/** Connection-level limits accepted in an OpenCode Profile's providerOptions. */
export interface OpenCodeProfileOptions {
  readonly cancelSettlementTimeoutMs?: number;
  readonly eventDrainTimeoutMs?: number;
  readonly maxRunEvents?: number;
  readonly requestTimeoutMs?: number;
  readonly runRequestTimeoutMs?: number;
  readonly sseConnectTimeoutMs?: number;
}

/** Request options for the explicit Provider-native HTTP escape hatch. */
export interface OpenCodeNativeRequestOptions {
  readonly method?: HttpMethod;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Bounded JSON response returned by the Provider-native HTTP escape hatch. */
export interface OpenCodeNativeResponse<T = unknown> {
  readonly status: number;
  readonly body: T;
}

/** Explicit Provider-native client for documented OpenCode HTTP routes. */
export interface OpenCodeNativeClient {
  readonly runtimeIdentity: string;
  request<T = unknown>(
    path: string,
    options?: OpenCodeNativeRequestOptions,
  ): Promise<OpenCodeNativeResponse<T>>;
  onUnknownEvent(listener: (event: OpenCodeRawEvent) => void): () => void;
}

interface ResolvedConnectionOptions {
  readonly cancelSettlementTimeoutMs: number;
  readonly eventDrainTimeoutMs: number;
  readonly maxRunEvents: number;
  readonly requestTimeoutMs: number | undefined;
  readonly runRequestTimeoutMs: number;
  readonly sseConnectTimeoutMs: number | undefined;
}

interface PendingPermission {
  claimed: boolean;
  readonly localId: string;
  readonly permissionId: string;
  readonly run: OpenCodeRun;
}

/** Create a fresh OpenCode HTTP Adapter factory. */
export function createOpenCodeProviderFactory(
  options: OpenCodeProviderFactoryOptions = {},
): ProviderAdapterFactory {
  return {
    descriptor: () => ({
      ...descriptor,
      connectionKinds: [...descriptor.connectionKinds],
    }),
    connect: async (profile) => connectOpenCode(profile, options),
  };
}

async function connectOpenCode(
  profile: HarnessProfile,
  factoryOptions: OpenCodeProviderFactoryOptions,
): Promise<HarnessClient> {
  validateProfile(profile, factoryOptions);
  const options = connectionOptions(profile.providerOptions);
  const headers = await resolveHeaders(profile, factoryOptions);
  let transport: HttpSseTransport;
  try {
    transport = new HttpSseTransport({
      baseUrl: endpointUrl(profile),
      ...(factoryOptions.fetch === undefined
        ? {}
        : { fetch: factoryOptions.fetch }),
      ...(headers === undefined ? {} : { defaultHeaders: headers }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.sseConnectTimeoutMs === undefined
        ? {}
        : { sseConnectTimeoutMs: options.sseConnectTimeoutMs }),
    });
  } catch (error) {
    throw mapError(error, profile, 'configure transport', true);
  }

  try {
    const health = parseOpenCodeHealth(
      await requestProviderJson(
        transport,
        'global/health',
        {},
        profile,
        'health probe',
        'compatibility',
        true,
      ),
    );
    return new OpenCodeClient(
      snapshotProfile(profile),
      transport,
      health.version,
      options,
    );
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw mapError(error, profile, 'connect', true);
  }
}

class OpenCodeClient implements HarnessClient {
  private readonly activeBySession = new Map<string, OpenCodeRun>();
  private readonly extensionRegistry = new ExtensionRegistry(
    OPENCODE_PROVIDER_ID,
  );
  private readonly nativeClient: OpenCodeNativeClient;
  private readonly pendingByLocalId = new Map<string, PendingPermission>();
  private readonly pendingByProviderId = new Map<string, PendingPermission>();
  private readonly quarantinedSessions = new Set<string>();
  private readonly unknownListeners = new Set<
    (event: OpenCodeRawEvent) => void
  >();
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private interactionSerial = 0;
  private runSerial = 0;

  constructor(
    private readonly profile: HarnessProfile,
    private readonly transport: HttpSseTransport,
    private readonly runtimeVersion: string,
    private readonly options: ResolvedConnectionOptions,
  ) {
    this.nativeClient = Object.freeze({
      runtimeIdentity: this.runtimeIdentity(),
      request: <T>(
        path: string,
        requestOptions?: OpenCodeNativeRequestOptions,
      ) => this.nativeRequest<T>(path, requestOptions),
      onUnknownEvent: (listener: (event: OpenCodeRawEvent) => void) => {
        this.unknownListeners.add(listener);
        return () => this.unknownListeners.delete(listener);
      },
    });
  }

  descriptor(): Promise<ClientDescriptor> {
    return Promise.resolve({
      providerId: OPENCODE_PROVIDER_ID,
      profileId: this.profile.profileId,
      displayName: this.profile.displayName,
      connectionKind: 'endpoint',
      runtime: {
        name: 'OpenCode Server',
        version: this.runtimeVersion,
        protocol: 'HTTP/OpenAPI + SSE',
        protocolVersion: 'stable',
      },
      compatibility: 'supported',
    });
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.capabilityManifest());
  }

  async createSession(input: CreateSessionInput = {}): Promise<HarnessSession> {
    this.assertOpen();
    const prepared = prepareOpenCodeSession(input);
    try {
      const response = await requestProviderJson(
        this.transport,
        withDirectory('session', prepared.directory),
        {
          method: 'POST',
          body: jsonBody(prepared.body),
          headers: jsonHeaders,
        },
        this.profile,
        'create Session',
        'session',
      );
      const session = parseOpenCodeSession(response);
      const sessionId = providerSessionId(session.id);
      this.assertSessionReusable(sessionId);
      return new OpenCodeSession(this, sessionId, {
        directory: session.directory,
        ...prepared.defaults,
      });
    } catch (error) {
      throw mapError(error, this.profile, 'create Session');
    }
  }

  async resumeSession(ref: SessionRef): Promise<HarnessSession> {
    this.assertOpen();
    assertSessionOwnership(ref, OPENCODE_PROVIDER_ID, this.profile.profileId);
    assertSessionCompatibility(ref, OPENCODE_SESSION_COMPATIBILITY_REF);
    this.assertSessionReusable(ref.providerSessionId);
    const state = sessionStateFromRef(ref);
    try {
      const status = parseOpenCodeSessionStatus(
        await requestProviderJson(
          this.transport,
          withDirectory('session/status', state.directory),
          {},
          this.profile,
          'resume Session status probe',
          'session',
        ),
        ref.providerSessionId,
      );
      if (status !== 'idle') throw sessionUnsafe(this.profile);
      const response = await requestProviderJson(
        this.transport,
        withDirectory(sessionPath(ref.providerSessionId), state.directory),
        {},
        this.profile,
        'resume Session',
        'session',
      );
      const session = parseOpenCodeSession(response);
      if (
        session.id !== ref.providerSessionId ||
        session.directory !== state.directory
      ) {
        throw sessionMismatch(this.profile);
      }
      return new OpenCodeSession(this, providerSessionId(session.id), state);
    } catch (error) {
      throw mapError(error, this.profile, 'resume Session');
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

  sessionRef(
    sessionId: ProviderSessionId,
    state: OpenCodeSessionState,
  ): SessionRef {
    return {
      providerId: OPENCODE_PROVIDER_ID,
      profileId: this.profile.profileId,
      providerSessionId: sessionId,
      compatibilityRef: OPENCODE_SESSION_COMPATIBILITY_REF,
      providerState: snapshotSessionState(state),
    };
  }

  capabilityManifest(): CapabilityManifest {
    return openCodeCapabilities(this.profile, this.runtimeIdentity());
  }

  async startRun(
    owner: OpenCodeSession,
    sessionId: ProviderSessionId,
    state: OpenCodeSessionState,
    input: HarnessInput,
    options: RunOptions = {},
  ): Promise<HarnessRun> {
    this.assertOpen();
    this.assertSessionReusable(sessionId);
    if (this.activeBySession.has(sessionId)) {
      throw new HarnessError(
        'run_conflict',
        'OpenCode Session already has an active Run.',
        {
          retryable: false,
          providerId: OPENCODE_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    const prompt = prepareOpenCodePrompt(input, options, state);
    const run = new OpenCodeRun(
      {
        providerId: OPENCODE_PROVIDER_ID,
        profileId: this.profile.profileId,
        sessionId,
        runId: runId(`opencode-run-${String(++this.runSerial)}`),
      },
      owner,
      state.directory,
      prompt,
      options.timeoutMs,
      this.transport,
      this.profile,
      this.options,
      (activeRun, permission) => {
        this.registerPermission(activeRun, permission);
      },
      (activeRun, permissionId) => {
        this.resolvePermission(activeRun, permissionId, 'provider');
      },
      (event) => {
        this.emitUnknown(event);
      },
      (activeRun) => this.abortRun(activeRun),
      (activeRun) => {
        this.markSessionUnsafe(activeRun);
      },
      (activeRun) => {
        this.onRunSettling(activeRun);
      },
    );
    this.activeBySession.set(sessionId, run);
    try {
      await run.open();
      return run;
    } catch (error) {
      if (this.activeBySession.get(sessionId) === run) {
        this.activeBySession.delete(sessionId);
      }
      throw mapError(error, this.profile, 'start Run');
    }
  }

  async respond(
    owner: OpenCodeSession,
    sessionId: ProviderSessionId,
    requestId: string,
    response: InteractionResponse,
  ): Promise<void> {
    this.assertOpen();
    const pending = this.pendingByLocalId.get(requestId);
    if (
      pending?.run.owner !== owner ||
      pending.run.ref().sessionId !== sessionId ||
      pending.run.isTerminal() ||
      pending.claimed
    ) {
      throw invalidInteraction(this.profile);
    }
    const decision = permissionDecision(response);
    pending.claimed = true;
    try {
      const accepted = await requestProviderJson(
        this.transport,
        withDirectory(
          `${sessionPath(sessionId)}/permissions/${encodeURIComponent(pending.permissionId)}`,
          pending.run.directory,
        ),
        {
          method: 'POST',
          headers: jsonHeaders,
          body: jsonBody({ response: decision }),
        },
        this.profile,
        'respond to permission',
        'session',
      );
      if (accepted !== true) {
        throw providerRejected(this.profile, 'permission response');
      }
      this.resolvePermission(pending.run, pending.permissionId, 'host');
    } catch (error) {
      if (
        this.pendingByLocalId.get(requestId) === pending &&
        !pending.run.isTerminal()
      ) {
        pending.claimed = false;
      }
      throw mapError(error, this.profile, 'respond to permission');
    }
  }

  closeSession(owner: OpenCodeSession, sessionId: ProviderSessionId): void {
    const active = this.activeBySession.get(sessionId);
    if (active?.owner === owner) active.abortConnection();
  }

  private async nativeRequest<T>(
    path: string,
    options: OpenCodeNativeRequestOptions = {},
  ): Promise<OpenCodeNativeResponse<T>> {
    this.assertOpen();
    const requestOptions: HttpRequestOptions = {
      ...(options.method === undefined ? {} : { method: options.method }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.body === undefined
        ? {}
        : { body: jsonBody(options.body), headers: jsonHeaders }),
    };
    try {
      const response = await this.transport.request(path, requestOptions);
      return {
        status: response.status,
        body: parseJsonResponse(response, 'native response') as T,
      };
    } catch (error) {
      throw mapError(error, this.profile, 'native request');
    }
  }

  private async abortRun(run: OpenCodeRun): Promise<boolean> {
    this.assertOpen();
    try {
      const response = await requestProviderJson(
        this.transport,
        withDirectory(
          `${sessionPath(run.ref().sessionId)}/abort`,
          run.directory,
        ),
        { method: 'POST' },
        this.profile,
        'abort Run',
        'session',
      );
      return response === true;
    } catch (error) {
      throw mapError(error, this.profile, 'abort Run');
    }
  }

  private registerPermission(
    run: OpenCodeRun,
    permission: OpenCodePermissionRequest,
  ): void {
    const providerKey = permissionKey(
      run.ref().sessionId,
      permission.permissionId,
    );
    if (this.pendingByProviderId.has(providerKey)) return;
    const localId = `opencode-interaction-${String(++this.interactionSerial)}`;
    const pending: PendingPermission = {
      claimed: false,
      localId,
      permissionId: permission.permissionId,
      run,
    };
    this.pendingByLocalId.set(localId, pending);
    this.pendingByProviderId.set(providerKey, pending);
    run.emit({
      type: 'interaction.requested',
      data: {
        requestId: localId,
        kind: 'approval',
        title: permission.title,
        prompt: permissionPrompt(permission),
      },
    });
  }

  private resolvePermission(
    run: OpenCodeRun,
    permissionId: string,
    resolution: 'host' | 'provider',
  ): void {
    const key = permissionKey(run.ref().sessionId, permissionId);
    const pending = this.pendingByProviderId.get(key);
    if (pending?.run !== run) return;
    this.pendingByProviderId.delete(key);
    this.pendingByLocalId.delete(pending.localId);
    run.emit({
      type: 'interaction.resolved',
      data: { requestId: pending.localId, resolution },
    });
  }

  private onRunSettling(run: OpenCodeRun): void {
    const sessionId = run.ref().sessionId;
    if (this.activeBySession.get(sessionId) === run) {
      this.activeBySession.delete(sessionId);
    }
    for (const pending of [...this.pendingByLocalId.values()]) {
      if (pending.run !== run) continue;
      this.pendingByLocalId.delete(pending.localId);
      this.pendingByProviderId.delete(
        permissionKey(sessionId, pending.permissionId),
      );
      run.emitSettlement({
        type: 'interaction.resolved',
        data: { requestId: pending.localId, resolution: 'terminal' },
      });
    }
  }

  private emitUnknown(event: OpenCodeRawEvent): void {
    for (const listener of this.unknownListeners) {
      try {
        listener(structuredClone(event));
      } catch {
        // Host observers cannot alter Provider lifecycle settlement.
      }
    }
  }

  private markSessionUnsafe(run: OpenCodeRun): void {
    const sessionId = run.ref().sessionId;
    this.quarantinedSessions.add(sessionId);
    run.owner.markUnsafe();
  }

  private assertSessionReusable(sessionId: ProviderSessionId): void {
    if (!this.quarantinedSessions.has(sessionId)) return;
    throw sessionUnsafe(this.profile);
  }

  private runtimeIdentity(): string {
    return `${OPENCODE_SESSION_COMPATIBILITY_REF};runtime=${this.runtimeVersion}`;
  }

  private assertOpen(): void {
    if (!this.closed && this.transport.isOpen()) return;
    throw new HarnessError(
      'connection_aborted',
      'The OpenCode Client connection is closed.',
      {
        retryable: false,
        providerId: OPENCODE_PROVIDER_ID,
        profileId: this.profile.profileId,
      },
    );
  }

  private async closeOnce(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const run of [...this.activeBySession.values()]) run.abortConnection();
    this.pendingByLocalId.clear();
    this.pendingByProviderId.clear();
    try {
      await this.transport.close();
    } catch (error) {
      throw mapError(error, this.profile, 'close connection');
    }
  }
}

class OpenCodeSession implements HarnessSession {
  private closed = false;
  private unsafe = false;

  constructor(
    private readonly client: OpenCodeClient,
    private readonly sessionId: ProviderSessionId,
    private readonly state: OpenCodeSessionState,
  ) {}

  ref(): SessionRef {
    return this.client.sessionRef(this.sessionId, this.state);
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.client.capabilityManifest());
  }

  start(input: HarnessInput, options: RunOptions = {}): Promise<HarnessRun> {
    this.assertOpen();
    return this.client.startRun(
      this,
      this.sessionId,
      this.state,
      input,
      options,
    );
  }

  respond(requestId: string, response: InteractionResponse): Promise<void> {
    this.assertOpen();
    return this.client.respond(this, this.sessionId, requestId, response);
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.client.closeSession(this, this.sessionId);
    }
    return Promise.resolve();
  }

  markUnsafe(): void {
    this.unsafe = true;
  }

  private assertOpen(): void {
    if (!this.closed && !this.unsafe) return;
    throw new HarnessError(
      'connection_aborted',
      'The OpenCode Session is closed.',
      {
        retryable: false,
        providerId: OPENCODE_PROVIDER_ID,
      },
    );
  }
}

class OpenCodeRun implements HarnessRun {
  private readonly controller = new AbortController();
  private readonly eventQueue: EventQueue;
  private readonly eventState = createOpenCodeEventState();
  private readonly idleSeen: Promise<void>;
  private readonly providerRunStarted: Promise<void>;
  private readonly settlement: Promise<RunResult>;
  private cancelPromise: Promise<CancelResult> | undefined;
  private finalResult: RunResult | undefined;
  private idleResolve!: () => void;
  private providerRunStartedResolve!: () => void;
  private resolveSettlement!: (result: RunResult) => void;
  private sequence = 0;
  private timeout: NodeJS.Timeout | undefined;
  private timeoutTriggered = false;

  constructor(
    private readonly reference: RunRef,
    readonly owner: OpenCodeSession,
    readonly directory: string,
    private readonly prompt: Readonly<Record<string, unknown>>,
    private readonly timeoutMs: number | undefined,
    private readonly transport: HttpSseTransport,
    private readonly profile: HarnessProfile,
    private readonly options: ResolvedConnectionOptions,
    private readonly onPermission: (
      run: OpenCodeRun,
      permission: OpenCodePermissionRequest,
    ) => void,
    private readonly onPermissionResolved: (
      run: OpenCodeRun,
      permissionId: string,
    ) => void,
    private readonly onUnknown: (event: OpenCodeRawEvent) => void,
    private readonly nativeAbort: (run: OpenCodeRun) => Promise<boolean>,
    private readonly onUnsafe: (run: OpenCodeRun) => void,
    private readonly onSettling: (run: OpenCodeRun) => void,
  ) {
    this.eventQueue = new EventQueue(options.maxRunEvents);
    this.settlement = new Promise((resolve) => {
      this.resolveSettlement = resolve;
    });
    this.idleSeen = new Promise((resolve) => {
      this.idleResolve = resolve;
    });
    this.providerRunStarted = new Promise((resolve) => {
      this.providerRunStartedResolve = resolve;
    });
  }

  async open(): Promise<void> {
    const iterable = this.transport.subscribe(
      withDirectory('event', this.directory),
      { signal: this.controller.signal },
    );
    const iterator = iterable[Symbol.asyncIterator]();
    let first: IteratorResult<SseEvent>;
    try {
      first = await iterator.next();
      if (first.done) {
        throw providerIncompatible(this.profile, 'SSE connection event');
      }
      validateSseDispatch(first.value.event);
      const connected = parseOpenCodeEvent(first.value.data);
      if (connected.type !== 'server.connected') {
        throw providerIncompatible(this.profile, 'SSE connection event');
      }
    } catch (error) {
      await iterator.return?.().catch(() => undefined);
      if (
        error instanceof HttpTransportError &&
        error.code === 'stream_ended'
      ) {
        throw providerIncompatible(this.profile, 'SSE connection event');
      }
      throw error;
    }

    this.emit({ type: 'run.started', data: {} });
    void this.pump(iterator).catch(() => undefined);
    void this.executePrompt();
    if (this.timeoutMs !== undefined) {
      this.timeout = setTimeout(() => {
        this.timeoutTriggered = true;
        void this.cancel().catch(() => {
          this.abortConnection();
        });
      }, this.timeoutMs);
      this.timeout.unref();
    }
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

  emit(mapped: MappedOpenCodeEvent): void {
    if (this.isTerminal()) return;
    if (!this.eventQueue.push(this.portableEvent(mapped)))
      this.abortConnection();
  }

  emitSettlement(mapped: MappedOpenCodeEvent): void {
    if (this.isTerminal()) return;
    this.eventQueue.pushTerminal(this.portableEvent(mapped));
  }

  abortConnection(): void {
    if (this.isTerminal()) return;
    this.onUnsafe(this);
    this.finish({ status: 'connection_aborted' }, 'connection.aborted');
  }

  private async pump(iterator: AsyncIterator<SseEvent>): Promise<void> {
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        validateSseDispatch(next.value.event);
        const event = parseOpenCodeEvent(next.value.data);
        if (
          event.type === 'message.updated' &&
          (event.properties['sessionID'] === this.reference.sessionId ||
            runtimeRecord(event.properties['info'])?.['sessionID'] ===
              this.reference.sessionId)
        ) {
          this.providerRunStartedResolve();
        }
        const mapping = mapOpenCodeEvent(
          event,
          this.reference.sessionId,
          this.eventState,
        );
        if (
          event.type === 'session.idle' &&
          event.properties['sessionID'] === this.reference.sessionId
        ) {
          this.idleResolve();
        }
        if (mapping.permission !== undefined) {
          this.onPermission(this, mapping.permission);
        }
        if (mapping.resolvedPermissionId !== undefined) {
          this.onPermissionResolved(this, mapping.resolvedPermissionId);
        }
        for (const mapped of mapping.events) this.emit(mapped);
        if (!mapping.routed) this.onUnknown(redactOpenCodeEvent(event));
      }
      if (!this.isTerminal()) this.abortConnection();
    } catch (error) {
      if (this.isTerminal()) return;
      if (error instanceof HarnessError) {
        this.onUnsafe(this);
        this.fail(error);
      } else {
        const mapped = mapError(error, this.profile, 'consume event stream');
        if (mapped.code === 'provider_api_incompatible') {
          this.onUnsafe(this);
          this.fail(mapped);
        } else this.abortConnection();
      }
    }
  }

  private async executePrompt(): Promise<void> {
    try {
      const response = await requestProviderJson(
        this.transport,
        withDirectory(
          `${sessionPath(this.reference.sessionId)}/message`,
          this.directory,
        ),
        {
          method: 'POST',
          headers: jsonHeaders,
          body: jsonBody(this.prompt),
          signal: this.controller.signal,
          timeoutMs: this.options.runRequestTimeoutMs,
        },
        this.profile,
        'execute Run',
        'session',
      );
      const terminal = parseOpenCodePromptResponse(
        response,
        this.reference.sessionId,
      );
      await Promise.race([
        this.idleSeen,
        boundedDelay(this.options.eventDrainTimeoutMs),
      ]);
      if (this.isTerminal()) return;
      if (terminal.result.status === 'completed') {
        if (terminal.finalMessage !== undefined) {
          this.emit({
            type: 'message.completed',
            data: { message: terminal.finalMessage },
          });
        }
        this.emit({
          type: 'usage.updated',
          data: terminal.usage,
          usage: terminal.usage,
        });
      }
      const result =
        this.timeoutTriggered && terminal.result.status === 'cancelled'
          ? {
              ...terminal.result,
              providerResult: {
                ...terminal.providerResult,
                reason: 'timeout',
              },
            }
          : terminal.result;
      this.finish(result, terminalEventType(result.status));
    } catch (error) {
      if (this.isTerminal()) return;
      const mapped = mapError(error, this.profile, 'execute Run');
      if (mapped.code === 'connection_aborted') this.abortConnection();
      else {
        if (uncertainRequestFailure(mapped)) this.onUnsafe(this);
        this.fail(mapped);
      }
    }
  }

  private async cancelOnce(): Promise<CancelResult> {
    await Promise.race([
      this.providerRunStarted,
      this.settlement.then(() => undefined),
      boundedDelay(this.options.eventDrainTimeoutMs),
    ]);
    if (this.isTerminal()) return { mode: 'already_terminal' };
    const acknowledged = await this.nativeAbort(this);
    if (!acknowledged) {
      if (this.isTerminal()) return { mode: 'already_terminal' };
      throw providerRejected(this.profile, 'Run abort');
    }
    const outcome = await Promise.race([
      this.settlement,
      boundedDelay(this.options.cancelSettlementTimeoutMs).then(
        () => undefined,
      ),
    ]);
    if (outcome === undefined) {
      this.abortConnection();
      return { mode: 'connection_aborted' };
    }
    if (outcome.status === 'cancelled') return { mode: 'native' };
    return outcome.status === 'connection_aborted'
      ? { mode: 'connection_aborted' }
      : { mode: 'already_terminal' };
  }

  private fail(error: HarnessError): void {
    const result: RunResult = {
      status: 'failed',
      providerResult: {
        error: error.code,
        ...(error.providerCode === undefined
          ? {}
          : { providerCode: error.providerCode }),
      },
    };
    this.finish(result, 'run.failed');
  }

  private finish(result: RunResult, type: HarnessEvent['type']): void {
    if (this.isTerminal()) return;
    this.onSettling(this);
    this.finalResult = result;
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.controller.abort();
    this.eventQueue.pushTerminal(this.portableEvent({ type, data: result }));
    this.eventQueue.close();
    this.resolveSettlement(result);
  }

  private portableEvent(mapped: MappedOpenCodeEvent): HarnessEvent {
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
                'OpenCode Run events already have a consumer.',
                { retryable: false, providerId: OPENCODE_PROVIDER_ID },
              ),
            ),
        }),
      };
    }
    this.consumed = true;
    return {
      [Symbol.asyncIterator]: () => ({ next: () => this.next() }),
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
          'An OpenCode event read is already pending.',
          { retryable: false, providerId: OPENCODE_PROVIDER_ID },
        ),
      );
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

const jsonHeaders = { 'content-type': 'application/json' } as const;

function openCodeCapabilities(
  profile: HarnessProfile,
  runtimeIdentity: string,
): CapabilityManifest {
  const native: CapabilityStatus = { mode: 'native', source: 'schema' };
  return {
    providerId: OPENCODE_PROVIDER_ID,
    profileId: profile.profileId,
    observedAt: new Date().toISOString(),
    runtimeIdentity,
    capabilities: {
      'session.create': native,
      'session.resume': native,
      'session.close': {
        mode: 'adapter_controlled',
        source: 'configuration',
        reason: 'Portable close releases only the local Session handle.',
      },
      'session.workspace': native,
      'run.stream': native,
      'run.cancel': native,
      'run.timeout': {
        mode: 'emulated',
        source: 'configuration',
        reason: 'A local timer invokes the documented native abort route.',
      },
      'run.concurrent': {
        mode: 'unsupported',
        source: 'configuration',
        limits: { perSession: 1 },
      },
      'interaction.approval': native,
      'input.text': native,
      'input.file': native,
      'input.image': native,
      'unknown_event.raw': {
        mode: 'adapter_controlled',
        source: 'configuration',
      },
      'native.client': native,
    },
  };
}

function connectionOptions(
  value: Readonly<Record<string, unknown>> | undefined,
): ResolvedConnectionOptions {
  const options = value === undefined ? {} : runtimeRecord(value);
  if (options === undefined) {
    throw profileInvalid('OpenCode providerOptions must be an object.');
  }
  const allowed = new Set([
    'cancelSettlementTimeoutMs',
    'eventDrainTimeoutMs',
    'maxRunEvents',
    'requestTimeoutMs',
    'runRequestTimeoutMs',
    'sseConnectTimeoutMs',
  ]);
  const unknown = Object.keys(options).find((name) => !allowed.has(name));
  if (unknown !== undefined) {
    throw profileInvalid(`OpenCode Profile option ${unknown} is unknown.`);
  }
  const maxRunEvents = profileInteger(
    options['maxRunEvents'],
    defaultMaxRunEvents,
    'maxRunEvents',
  );
  if (maxRunEvents < 2 || maxRunEvents > maximumRunEventCapacity) {
    throw profileInvalid(
      'OpenCode maxRunEvents must be between 2 and the supported upper bound.',
    );
  }
  return {
    maxRunEvents,
    cancelSettlementTimeoutMs: profileTimer(
      options['cancelSettlementTimeoutMs'],
      defaultCancelSettlementTimeoutMs,
      'cancelSettlementTimeoutMs',
    ),
    eventDrainTimeoutMs: profileTimer(
      options['eventDrainTimeoutMs'],
      defaultEventDrainTimeoutMs,
      'eventDrainTimeoutMs',
    ),
    runRequestTimeoutMs: profileTimer(
      options['runRequestTimeoutMs'],
      defaultRunRequestTimeoutMs,
      'runRequestTimeoutMs',
    ),
    requestTimeoutMs:
      options['requestTimeoutMs'] === undefined
        ? undefined
        : profileTimer(options['requestTimeoutMs'], 0, 'requestTimeoutMs'),
    sseConnectTimeoutMs:
      options['sseConnectTimeoutMs'] === undefined
        ? undefined
        : profileTimer(
            options['sseConnectTimeoutMs'],
            0,
            'sseConnectTimeoutMs',
          ),
  };
}

function validateProfile(
  profile: HarnessProfile,
  factoryOptions: OpenCodeProviderFactoryOptions,
): void {
  if (
    profile.providerId !== OPENCODE_PROVIDER_ID ||
    profile.connection.kind !== 'endpoint' ||
    (profile.connection.transport !== undefined &&
      profile.connection.transport !== 'http') ||
    profile.connection.url.length === 0
  ) {
    throw profileInvalid(
      'OpenCode requires an HTTP endpoint Profile owned by the host or an external service.',
      profile,
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(profile.connection.url);
  } catch {
    throw profileInvalid('OpenCode endpoint URL must be absolute.', profile);
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw profileInvalid(
      'OpenCode endpoint URL must use HTTP or HTTPS.',
      profile,
    );
  }
  if (
    profile.connection.authRef !== undefined &&
    factoryOptions.resolveAuthHeaders === undefined
  ) {
    throw profileInvalid(
      'OpenCode authRef requires a host-provided authentication-header resolver.',
      profile,
    );
  }
}

async function resolveHeaders(
  profile: HarnessProfile,
  factoryOptions: OpenCodeProviderFactoryOptions,
): Promise<HttpHeaderMap | undefined> {
  if (profile.connection.kind !== 'endpoint')
    throw profileInvalid(undefined, profile);
  const reference = profile.connection.authRef;
  if (reference === undefined) return undefined;
  try {
    const headers = await factoryOptions.resolveAuthHeaders?.(reference);
    if (
      headers === undefined ||
      runtimeRecord(headers) === undefined ||
      Object.values(headers).some((value) => typeof value !== 'string')
    ) {
      throw new TypeError('invalid authentication headers');
    }
    return headers;
  } catch {
    throw new HarnessError(
      'authentication_failed',
      'The host could not resolve OpenCode authentication headers.',
      {
        retryable: false,
        providerId: OPENCODE_PROVIDER_ID,
        profileId: profile.profileId,
      },
    );
  }
}

async function requestProviderJson(
  transport: HttpSseTransport,
  path: string,
  options: HttpRequestOptions,
  profile: HarnessProfile,
  phase: string,
  notFound: 'compatibility' | 'session',
  connecting = false,
): Promise<unknown> {
  let response: HttpTransportResponse;
  try {
    response = await transport.request(path, options);
  } catch (error) {
    throw mapError(error, profile, phase, connecting);
  }
  if (response.status < 200 || response.status >= 300) {
    throw responseError(response.status, profile, phase, notFound);
  }
  return parseJsonResponse(response, phase);
}

function parseJsonResponse(
  response: HttpTransportResponse,
  phase: string,
): unknown {
  if (!response.contentType?.toLowerCase().startsWith('application/json')) {
    throw providerIncompatible(undefined, `${phase} Content-Type`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(response.body);
  } catch {
    throw providerIncompatible(undefined, `${phase} encoding`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw providerIncompatible(undefined, `${phase} JSON`);
  }
}

function responseError(
  status: number,
  profile: HarnessProfile,
  phase: string,
  notFound: 'compatibility' | 'session',
): HarnessError {
  if (status === 401 || status === 403) {
    return new HarnessError(
      'authentication_failed',
      `OpenCode rejected ${phase} authentication.`,
      {
        retryable: false,
        providerId: OPENCODE_PROVIDER_ID,
        profileId: profile.profileId,
        providerCode: String(status),
      },
    );
  }
  if (status === 404) {
    return new HarnessError(
      notFound === 'session'
        ? 'session_not_found'
        : 'provider_api_incompatible',
      notFound === 'session'
        ? `OpenCode could not find the Session for ${phase}.`
        : 'The OpenCode endpoint does not expose the required stable interface.',
      {
        retryable: false,
        providerId: OPENCODE_PROVIDER_ID,
        profileId: profile.profileId,
        providerCode: String(status),
      },
    );
  }
  const code =
    status === 400
      ? 'invalid_request'
      : status === 409
        ? 'run_conflict'
        : 'provider_error';
  return new HarnessError(code, `OpenCode rejected ${phase}.`, {
    retryable: status >= 500,
    providerId: OPENCODE_PROVIDER_ID,
    profileId: profile.profileId,
    providerCode: String(status),
  });
}

function mapError(
  error: unknown,
  profile: HarnessProfile,
  phase: string,
  connecting = false,
): HarnessError {
  if (error instanceof HarnessError) return error;
  if (error instanceof HttpTransportError) {
    if (error.code === 'http_status' && error.status !== undefined) {
      return responseError(error.status, profile, phase, 'compatibility');
    }
    const code =
      error.code === 'request_timeout'
        ? 'timeout'
        : error.code === 'transport_closed'
          ? 'connection_aborted'
          : connecting && error.code === 'network_failure'
            ? 'connection_failed'
            : 'provider_error';
    return new HarnessError(code, `OpenCode ${phase} did not complete.`, {
      retryable:
        error.code === 'request_timeout' ||
        error.code === 'capacity_exceeded' ||
        error.code === 'network_failure',
      providerId: OPENCODE_PROVIDER_ID,
      profileId: profile.profileId,
      providerCode: error.code,
    });
  }
  return new HarnessError(
    connecting ? 'connection_failed' : 'provider_error',
    `OpenCode ${phase} failed.`,
    {
      retryable: false,
      providerId: OPENCODE_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function uncertainRequestFailure(error: HarnessError): boolean {
  return (
    error.code === 'timeout' ||
    (error.providerCode !== undefined &&
      uncertainRequestProviderCodes.has(error.providerCode))
  );
}

function jsonBody(value: unknown): string {
  try {
    const body: unknown = JSON.stringify(value);
    if (typeof body !== 'string') throw new TypeError('undefined JSON');
    return body;
  } catch {
    throw new HarnessError(
      'invalid_request',
      'OpenCode request data must be JSON serializable.',
      { retryable: false, providerId: OPENCODE_PROVIDER_ID },
    );
  }
}

function permissionDecision(
  response: InteractionResponse,
): 'always' | 'once' | 'reject' {
  if (response.kind === 'provider') {
    const value = runtimeRecord(response.value);
    const decision = value?.['response'];
    if (decision === 'always' || decision === 'once' || decision === 'reject') {
      return decision;
    }
    throw invalidInteraction();
  }
  if (response.kind !== 'approval') throw invalidInteraction();
  if (response.decision === 'deny') return 'reject';
  if (response.providerOptions === undefined) return 'once';
  const options = runtimeRecord(response.providerOptions);
  if (
    options !== undefined &&
    Object.keys(options).length === 1 &&
    options['scope'] === 'always'
  ) {
    return 'always';
  }
  throw invalidInteraction();
}

function validateSseDispatch(event: string | undefined): void {
  if (event !== undefined && event !== 'message') {
    throw providerIncompatible(undefined, 'SSE event name');
  }
}

function terminalEventType(status: RunResult['status']): HarnessEvent['type'] {
  const mapping: Record<RunResult['status'], HarnessEvent['type']> = {
    completed: 'run.completed',
    cancelled: 'run.cancelled',
    failed: 'run.failed',
    connection_aborted: 'connection.aborted',
  };
  return mapping[status];
}

function withDirectory(path: string, directory: string | undefined): string {
  return directory === undefined
    ? path
    : `${path}?directory=${encodeURIComponent(directory)}`;
}

function sessionPath(sessionId: string): string {
  return `session/${encodeURIComponent(sessionId)}`;
}

function permissionKey(sessionId: string, permissionId: string): string {
  return `${sessionId}\u0000${permissionId}`;
}

function permissionPrompt(permission: OpenCodePermissionRequest): string {
  if (typeof permission.pattern === 'string') return permission.pattern;
  if (permission.pattern !== undefined) return permission.pattern.join('\n');
  return `OpenCode requests ${permission.type} permission.`;
}

function snapshotSessionState(
  state: OpenCodeSessionState,
): OpenCodeSessionState {
  return {
    directory: state.directory,
    ...(state.system === undefined ? {} : { system: state.system }),
    ...(state.model === undefined
      ? {}
      : {
          model: {
            providerId: state.model.providerId,
            modelId: state.model.modelId,
          },
        }),
  };
}

function snapshotProfile(profile: HarnessProfile): HarnessProfile {
  return {
    ...profile,
    connection: {
      ...profile.connection,
      ...(profile.connection.kind === 'endpoint' &&
      profile.connection.authRef !== undefined
        ? { authRef: { ...profile.connection.authRef } }
        : {}),
    },
    ...(profile.providerOptions === undefined
      ? {}
      : { providerOptions: { ...profile.providerOptions } }),
  };
}

function endpointUrl(profile: HarnessProfile): string {
  if (profile.connection.kind !== 'endpoint')
    throw profileInvalid(undefined, profile);
  return profile.connection.url;
}

function profileInteger(
  value: unknown,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw profileInvalid(`OpenCode ${label} must be a positive integer.`);
  }
  return value;
}

function profileTimer(value: unknown, fallback: number, label: string): number {
  const timer = profileInteger(value, fallback, label);
  if (timer > maximumTimerMilliseconds) {
    throw profileInvalid(
      `OpenCode ${label} exceeds the supported timer range.`,
    );
  }
  return timer;
}

function boundedDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

function runtimeRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function profileInvalid(
  message = 'The OpenCode Profile is invalid.',
  profile?: HarnessProfile,
): HarnessError {
  return new HarnessError('profile_invalid', message, {
    retryable: false,
    providerId: OPENCODE_PROVIDER_ID,
    ...(profile === undefined ? {} : { profileId: profile.profileId }),
  });
}

function providerIncompatible(
  profile: HarnessProfile | undefined,
  surface: string,
): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    `OpenCode returned an incompatible ${surface}.`,
    {
      retryable: false,
      providerId: OPENCODE_PROVIDER_ID,
      ...(profile === undefined ? {} : { profileId: profile.profileId }),
    },
  );
}

function providerRejected(
  profile: HarnessProfile,
  operation: string,
): HarnessError {
  return new HarnessError(
    'provider_error',
    `OpenCode did not acknowledge ${operation}.`,
    {
      retryable: false,
      providerId: OPENCODE_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function invalidInteraction(profile?: HarnessProfile): HarnessError {
  return new HarnessError(
    'invalid_request',
    'The OpenCode interaction response is invalid or no longer pending.',
    {
      retryable: false,
      providerId: OPENCODE_PROVIDER_ID,
      ...(profile === undefined ? {} : { profileId: profile.profileId }),
    },
  );
}

function sessionMismatch(profile: HarnessProfile): HarnessError {
  return new HarnessError(
    'session_provider_mismatch',
    'OpenCode returned a different Session or workspace instance.',
    {
      retryable: false,
      providerId: OPENCODE_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function sessionUnsafe(profile: HarnessProfile): HarnessError {
  return new HarnessError(
    'connection_aborted',
    'The OpenCode Session cannot be reused after uncertain remote settlement.',
    {
      retryable: false,
      providerId: OPENCODE_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}
