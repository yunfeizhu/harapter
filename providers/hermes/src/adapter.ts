import {
  assertSessionCompatibility,
  assertSessionOwnership,
  ExtensionRegistry,
  HarnessError,
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
  HERMES_PROVIDER_ID,
  HERMES_SESSION_COMPATIBILITY_REF,
  HERMES_SUBAGENT_EXTENSION,
  compatibilityFingerprint,
  mapHermesEvent,
  parseHermesApprovalResponse,
  parseHermesCapabilities,
  parseHermesRunReceipt,
  parseHermesRunStatus,
  parseHermesSession,
  parseHermesStopResponse,
  prepareHermesRun,
  prepareHermesSession,
  sessionStateFromRef,
  snapshotHermesSessionState,
  type HermesCapabilities,
  type HermesEventMapping,
  type HermesRawEvent,
  type HermesSessionState,
  type HermesSubagentEvent,
  type HermesSubagentExtension,
} from './protocol.js';

const descriptor: ProviderDescriptor = {
  providerId: HERMES_PROVIDER_ID,
  displayName: 'Hermes Agent',
  connectionKinds: ['endpoint'],
  documentationUrl:
    'https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server',
};

const defaultMaxRunEvents = 128;
const defaultCancelSettlementTimeoutMs = 10_000;
const defaultLateEventDrainTimeoutMs = 500;
const defaultReconcilePollIntervalMs = 100;
const defaultReconcileTimeoutMs = 30_000;
const maximumRunEventCapacity = 4096;
const maximumTimerMilliseconds = 2_147_483_647;
const uncertainTransportCodes = new Set([
  'capacity_exceeded',
  'network_failure',
  'request_aborted',
  'request_timeout',
  'response_stream_failed',
  'stream_ended',
  'transport_closed',
]);

/** Host integrations available while creating a Hermes Adapter. */
export interface HermesProviderFactoryOptions {
  readonly fetch?: typeof fetch;
  readonly resolveAuthHeaders?: (
    reference: SecretRef,
  ) => Promise<HttpHeaderMap> | HttpHeaderMap;
}

/** Supported bounded controls in a Hermes Profile providerOptions object. */
export interface HermesProfileOptions {
  readonly cancelSettlementTimeoutMs?: number;
  readonly lateEventDrainTimeoutMs?: number;
  readonly maxRunEvents?: number;
  readonly reconcilePollIntervalMs?: number;
  readonly reconcileTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly sseConnectTimeoutMs?: number;
}

/** Options for an explicit Provider-native bounded request. */
export interface HermesNativeRequestOptions {
  readonly body?: unknown;
  readonly method?: HttpMethod;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Bounded JSON response returned by the native HTTP escape hatch. */
export interface HermesNativeResponse<T = unknown> {
  readonly body: T;
  readonly status: number;
}

/** Provider-bound access to the official API Server HTTP surface. */
export interface HermesNativeClient {
  readonly runtimeIdentity: string;
  request<T = unknown>(
    path: string,
    options?: HermesNativeRequestOptions,
  ): Promise<HermesNativeResponse<T>>;
  onUnknownEvent(listener: (event: HermesRawEvent) => void): () => void;
}

interface ResolvedConnectionOptions {
  readonly cancelSettlementTimeoutMs: number;
  readonly lateEventDrainTimeoutMs: number;
  readonly maxRunEvents: number;
  readonly reconcilePollIntervalMs: number;
  readonly reconcileTimeoutMs: number;
  readonly requestTimeoutMs?: number;
  readonly sseConnectTimeoutMs?: number;
}

interface PendingApproval {
  claimed: boolean;
  readonly choices: ReadonlySet<string>;
  readonly localId: string;
  providerResolvedChoice?: string;
  readonly run: HermesRun;
}

interface StartingRun {
  closed: boolean;
  readonly controller: AbortController;
  readonly owner: HermesSession;
}

/** Create a fresh Hermes Agent API Server Adapter factory. */
export function createHermesProviderFactory(
  options: HermesProviderFactoryOptions = {},
): ProviderAdapterFactory {
  return {
    descriptor: () => ({
      ...descriptor,
      connectionKinds: [...descriptor.connectionKinds],
    }),
    connect: async (profile) => connectHermes(profile, options),
  };
}

async function connectHermes(
  profile: HarnessProfile,
  factoryOptions: HermesProviderFactoryOptions,
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
    const capabilities = parseHermesCapabilities(
      await requestProviderJson(
        transport,
        'v1/capabilities',
        {},
        profile,
        'capability probe',
        'compatibility',
        true,
      ),
    );
    return new HermesClient(
      snapshotProfile(profile),
      transport,
      capabilities,
      options,
    );
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw mapError(error, profile, 'connect', true);
  }
}

class HermesClient implements HarnessClient {
  private readonly activeBySession = new Map<string, HermesRun>();
  private readonly startingBySession = new Map<string, StartingRun>();
  private readonly extensionRegistry = new ExtensionRegistry(
    HERMES_PROVIDER_ID,
  );
  private readonly fingerprint: string;
  private readonly nativeClient: HermesNativeClient;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly quarantinedSessions = new Set<string>();
  private readonly subagentListeners = new Set<
    (event: HermesSubagentEvent) => void
  >();
  private readonly unknownListeners = new Set<
    (event: HermesRawEvent) => void
  >();
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private interactionSerial = 0;
  private runSerial = 0;

  constructor(
    private readonly profile: HarnessProfile,
    private readonly transport: HttpSseTransport,
    private readonly observedCapabilities: HermesCapabilities,
    private readonly options: ResolvedConnectionOptions,
  ) {
    this.fingerprint = compatibilityFingerprint(observedCapabilities);
    this.nativeClient = Object.freeze({
      runtimeIdentity: this.runtimeIdentity(),
      request: <T>(path: string, requestOptions?: HermesNativeRequestOptions) =>
        this.nativeRequest<T>(path, requestOptions),
      onUnknownEvent: (listener: (event: HermesRawEvent) => void) => {
        this.unknownListeners.add(listener);
        return () => this.unknownListeners.delete(listener);
      },
    });
    const subagents: HermesSubagentExtension = Object.freeze({
      onEvent: (listener: (event: HermesSubagentEvent) => void) => {
        this.subagentListeners.add(listener);
        return () => this.subagentListeners.delete(listener);
      },
    });
    this.extensionRegistry.register(
      {
        name: HERMES_SUBAGENT_EXTENSION,
        providerId: HERMES_PROVIDER_ID,
        displayName: 'Hermes child-session observer',
        description:
          'Observes bounded child-session lifecycle events without extending a parent Run trace.',
        stability: 'experimental',
      },
      subagents,
    );
  }

  descriptor(): Promise<ClientDescriptor> {
    return Promise.resolve({
      providerId: HERMES_PROVIDER_ID,
      profileId: this.profile.profileId,
      displayName: this.profile.displayName,
      connectionKind: 'endpoint',
      runtime: {
        name: 'Hermes Agent API Server',
        protocol: 'HTTP + SSE',
        protocolVersion: this.fingerprint,
      },
      compatibility: 'experimental',
      warnings: [
        {
          code: 'live_runtime_evidence_pending',
          message:
            'The current API Server mapping has fixture and conformance evidence but no recorded live-runtime result.',
        },
      ],
    });
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.capabilityManifest());
  }

  async createSession(input: CreateSessionInput = {}): Promise<HarnessSession> {
    this.assertOpen();
    const prepared = prepareHermesSession(input);
    try {
      const response = await requestProviderJson(
        this.transport,
        'api/sessions',
        {
          method: 'POST',
          headers: jsonHeaders,
          body: jsonBody(prepared.body),
        },
        this.profile,
        'create Session',
        'session',
      );
      const session = parseHermesSession(response);
      const sessionId = providerSessionId(session.id);
      this.assertSessionReusable(sessionId);
      if (
        prepared.state.model !== undefined &&
        session.model !== undefined &&
        prepared.state.model !== session.model
      ) {
        throw sessionMismatch(this.profile);
      }
      return new HermesSession(this, sessionId, prepared.state);
    } catch (error) {
      throw mapError(error, this.profile, 'create Session');
    }
  }

  async resumeSession(ref: SessionRef): Promise<HarnessSession> {
    this.assertOpen();
    assertSessionOwnership(ref, HERMES_PROVIDER_ID, this.profile.profileId);
    assertSessionCompatibility(ref, HERMES_SESSION_COMPATIBILITY_REF);
    this.assertSessionReusable(ref.providerSessionId);
    const state = sessionStateFromRef(ref);
    try {
      const session = parseHermesSession(
        await requestProviderJson(
          this.transport,
          sessionPath(ref.providerSessionId),
          {},
          this.profile,
          'resume Session',
          'session',
        ),
      );
      if (
        session.id !== ref.providerSessionId ||
        (state.model !== undefined &&
          session.model !== undefined &&
          state.model !== session.model)
      ) {
        throw sessionMismatch(this.profile);
      }
      return new HermesSession(this, providerSessionId(session.id), state);
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
    state: HermesSessionState,
  ): SessionRef {
    return {
      providerId: HERMES_PROVIDER_ID,
      profileId: this.profile.profileId,
      providerSessionId: sessionId,
      compatibilityRef: HERMES_SESSION_COMPATIBILITY_REF,
      providerState: snapshotHermesSessionState(state),
    };
  }

  capabilityManifest(): CapabilityManifest {
    return hermesCapabilityManifest(
      this.profile,
      this.runtimeIdentity(),
      this.observedCapabilities,
    );
  }

  async startRun(
    owner: HermesSession,
    sessionId: ProviderSessionId,
    state: HermesSessionState,
    input: HarnessInput,
    runOptions: RunOptions = {},
  ): Promise<HarnessRun> {
    this.assertOpen();
    this.assertSessionReusable(sessionId);
    if (runOptions.timeoutMs !== undefined) {
      validateRunTimeout(runOptions.timeoutMs);
    }
    if (
      this.activeBySession.has(sessionId) ||
      this.startingBySession.has(sessionId)
    ) {
      throw new HarnessError(
        'run_conflict',
        'Hermes Agent Session already has an active Run.',
        {
          retryable: false,
          providerId: HERMES_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    const request = prepareHermesRun(input, sessionId, state, runOptions);
    const starting: StartingRun = {
      closed: false,
      controller: new AbortController(),
      owner,
    };
    this.startingBySession.set(sessionId, starting);
    let receipt;
    let submissionAccepted = false;
    try {
      const response = await requestProviderJson(
        this.transport,
        'v1/runs',
        {
          method: 'POST',
          headers: jsonHeaders,
          body: jsonBody(request),
          signal: starting.controller.signal,
        },
        this.profile,
        'start Run',
        'run',
      );
      submissionAccepted = true;
      receipt = parseHermesRunReceipt(response);
      parseHermesRunStatus(
        await requestProviderJson(
          this.transport,
          runPath(receipt.runId),
          {},
          this.profile,
          'validate Run ownership',
          'run',
        ),
        receipt.runId,
        sessionId,
      );
    } catch (error) {
      if (this.startingBySession.get(sessionId) === starting) {
        this.startingBySession.delete(sessionId);
      }
      const mapped = mapError(error, this.profile, 'start Run');
      if (
        starting.closed ||
        submissionAccepted ||
        uncertainMutationFailure(mapped)
      ) {
        this.quarantinedSessions.add(sessionId);
        owner.markUnsafe();
      }
      if (starting.closed) throw sessionUnsafe(this.profile);
      throw mapped;
    }
    if (starting.closed || this.startingBySession.get(sessionId) !== starting) {
      if (this.startingBySession.get(sessionId) === starting) {
        this.startingBySession.delete(sessionId);
      }
      this.quarantinedSessions.add(sessionId);
      owner.markUnsafe();
      throw sessionUnsafe(this.profile);
    }
    const run = new HermesRun(
      {
        providerId: HERMES_PROVIDER_ID,
        profileId: this.profile.profileId,
        sessionId,
        runId: runId(`hermes-run-${String(++this.runSerial)}`),
        providerRunId: receipt.runId,
      },
      owner,
      receipt.runId,
      runOptions.timeoutMs,
      this.transport,
      this.profile,
      this.options,
      this.observedCapabilities.features.cancel,
      (activeRun, mapping) => {
        this.onRunMapping(activeRun, mapping);
      },
      (activeRun) => {
        this.onRunSettling(activeRun);
      },
      (activeRun) => {
        this.markSessionUnsafe(activeRun);
      },
    );
    this.startingBySession.delete(sessionId);
    this.activeBySession.set(sessionId, run);
    run.open();
    return run;
  }

  async respond(
    owner: HermesSession,
    sessionId: ProviderSessionId,
    requestId: string,
    response: InteractionResponse,
  ): Promise<void> {
    this.assertOpen();
    const pending = this.pendingApprovals.get(requestId);
    if (
      pending?.run.owner !== owner ||
      pending.run.ref().sessionId !== sessionId ||
      pending.run.isTerminal() ||
      pending.claimed
    ) {
      throw invalidInteraction(this.profile);
    }
    const choice = approvalChoice(response);
    if (!pending.choices.has(choice)) {
      throw invalidInteraction(this.profile);
    }
    pending.claimed = true;
    const settleApprovalResponse = pending.run.beginApprovalResponse();
    try {
      parseHermesApprovalResponse(
        await requestProviderJson(
          this.transport,
          `${runPath(pending.run.providerRunId)}/approval`,
          {
            method: 'POST',
            headers: jsonHeaders,
            body: jsonBody({ choice }),
          },
          this.profile,
          'respond to approval',
          'interaction',
        ),
        pending.run.providerRunId,
        choice,
      );
      if (pending.providerResolvedChoice !== undefined) {
        if (pending.providerResolvedChoice !== choice) {
          pending.run.failIncompatible('contradictory approval resolution');
          throw providerIncompatible(
            this.profile,
            'contradictory approval resolution',
          );
        }
      } else {
        if (!pending.run.confirmApproval(choice)) {
          pending.run.failIncompatible('overlapping approval acknowledgement');
          throw providerIncompatible(
            this.profile,
            'overlapping approval acknowledgement',
          );
        }
        this.resolveApproval(pending.run, 'host');
      }
    } catch (error) {
      const mapped = mapError(error, this.profile, 'respond to approval');
      if (uncertainMutationFailure(mapped)) {
        this.markSessionUnsafe(pending.run);
        pending.run.abortConnection();
        throw mapped;
      }
      if (
        this.pendingApprovals.get(requestId) === pending &&
        !pending.run.isTerminal()
      ) {
        pending.claimed = false;
      }
      throw mapped;
    } finally {
      settleApprovalResponse();
    }
  }

  closeSession(owner: HermesSession, sessionId: ProviderSessionId): void {
    const starting = this.startingBySession.get(sessionId);
    if (starting?.owner === owner) {
      starting.closed = true;
      starting.controller.abort();
    }
    const active = this.activeBySession.get(sessionId);
    if (active?.owner === owner) active.abortConnection();
  }

  private onRunMapping(run: HermesRun, mapping: HermesEventMapping): void {
    if (mapping.kind === 'interaction') {
      if (!this.observedCapabilities.features.approval) {
        run.failIncompatible('approval event without advertised support');
        return;
      }
      if (
        [...this.pendingApprovals.values()].some(
          (pending) => pending.run === run,
        )
      ) {
        run.failIncompatible('overlapping approval requests');
        return;
      }
      const localId = `hermes-interaction-${String(++this.interactionSerial)}`;
      this.pendingApprovals.set(localId, {
        claimed: false,
        choices: new Set(mapping.choices),
        localId,
        run,
      });
      run.emit({
        type: 'interaction.requested',
        data: { ...mapping.request, requestId: localId },
      });
      return;
    }
    if (mapping.kind === 'interaction.resolved') {
      const pending = this.pendingApproval(run);
      if (pending !== undefined) {
        if (!pending.choices.has(mapping.choice)) {
          run.failIncompatible('approval resolution outside requested choices');
          return;
        }
        if (pending.claimed) {
          pending.providerResolvedChoice = mapping.choice;
        }
        this.resolveApproval(run, 'provider');
        return;
      }
      if (!run.acceptConfirmedApproval(mapping.choice)) {
        run.failIncompatible('approval resolution without matching request');
        return;
      }
      return;
    }
    if (mapping.kind === 'subagent') {
      this.emitSubagent(mapping.event);
      if (!run.hasTerminalBoundary()) {
        run.emit({
          type: 'provider',
          data: { childSessionId: mapping.event.childSessionId },
          providerEventType: mapping.event.eventType,
          raw: mapping.event.raw,
        });
      }
      return;
    }
    if (mapping.kind === 'provider') {
      this.emitUnknown(mapping.event);
      if (!run.hasTerminalBoundary()) {
        run.emit({
          type: 'provider',
          data: {},
          providerEventType: mapping.event.providerEventType,
          raw: mapping.event.raw,
        });
      }
    }
  }

  private resolveApproval(
    run: HermesRun,
    resolution: 'host' | 'provider' | 'terminal',
  ): void {
    const pending = this.pendingApproval(run);
    if (pending === undefined) return;
    this.pendingApprovals.delete(pending.localId);
    run.emitSettlement({
      type: 'interaction.resolved',
      data: { requestId: pending.localId, resolution },
    });
  }

  private pendingApproval(run: HermesRun): PendingApproval | undefined {
    return [...this.pendingApprovals.values()].find(
      (candidate) => candidate.run === run,
    );
  }

  private onRunSettling(run: HermesRun): void {
    const sessionId = run.ref().sessionId;
    if (this.activeBySession.get(sessionId) === run) {
      this.activeBySession.delete(sessionId);
    }
    this.resolveApproval(run, 'terminal');
  }

  private emitSubagent(event: HermesSubagentEvent): void {
    for (const listener of this.subagentListeners) {
      try {
        listener(structuredClone(event));
      } catch {
        // Host observers cannot alter parent Run settlement.
      }
    }
  }

  private emitUnknown(event: HermesRawEvent): void {
    for (const listener of this.unknownListeners) {
      try {
        listener(structuredClone(event));
      } catch {
        // Host observers cannot alter Provider lifecycle settlement.
      }
    }
  }

  private markSessionUnsafe(run: HermesRun): void {
    const sessionId = run.ref().sessionId;
    this.quarantinedSessions.add(sessionId);
    run.owner.markUnsafe();
  }

  private assertSessionReusable(sessionId: ProviderSessionId): void {
    if (!this.quarantinedSessions.has(sessionId)) return;
    throw sessionUnsafe(this.profile);
  }

  private async nativeRequest<T>(
    path: string,
    options: HermesNativeRequestOptions = {},
  ): Promise<HermesNativeResponse<T>> {
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

  private runtimeIdentity(): string {
    return `${HERMES_SESSION_COMPATIBILITY_REF};${this.fingerprint}`;
  }

  private assertOpen(): void {
    if (!this.closed && this.transport.isOpen()) return;
    throw new HarnessError(
      'connection_aborted',
      'The Hermes Agent Client connection is closed.',
      {
        retryable: false,
        providerId: HERMES_PROVIDER_ID,
        profileId: this.profile.profileId,
      },
    );
  }

  private async closeOnce(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const starting of this.startingBySession.values()) {
      starting.closed = true;
      starting.controller.abort();
    }
    for (const run of [...this.activeBySession.values()]) run.abortConnection();
    this.pendingApprovals.clear();
    try {
      await this.transport.close();
    } catch (error) {
      throw mapError(error, this.profile, 'close connection');
    }
  }
}

class HermesSession implements HarnessSession {
  private closed = false;
  private unsafe = false;

  constructor(
    private readonly client: HermesClient,
    private readonly sessionId: ProviderSessionId,
    private readonly state: HermesSessionState,
  ) {}

  ref(): SessionRef {
    return this.client.sessionRef(this.sessionId, this.state);
  }

  capabilities(): Promise<CapabilityManifest> {
    this.assertOpen();
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
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.client.closeSession(this, this.sessionId);
    return Promise.resolve();
  }

  markUnsafe(): void {
    this.unsafe = true;
  }

  private assertOpen(): void {
    if (!this.closed && !this.unsafe) return;
    throw this.unsafe ? sessionUnsafe(undefined) : sessionClosed();
  }
}

class HermesRun implements HarnessRun {
  private readonly approvalResponseGates = new Set<Promise<void>>();
  private readonly controller = new AbortController();
  private readonly eventQueue: EventQueue;
  private readonly settlement: Promise<RunResult>;
  private readonly streamClosed: Promise<void>;
  private cancelPromise: Promise<CancelResult> | undefined;
  private confirmedApprovalChoice: string | undefined;
  private finalResult: RunResult | undefined;
  private reconcilePromise: Promise<void> | undefined;
  private resolveSettlement!: (result: RunResult) => void;
  private resolveStreamClosed!: () => void;
  private sequence = 0;
  private terminalSignal: string | undefined;
  private timeout: NodeJS.Timeout | undefined;

  constructor(
    private readonly reference: RunRef,
    readonly owner: HermesSession,
    readonly providerRunId: string,
    timeoutMs: number | undefined,
    private readonly transport: HttpSseTransport,
    private readonly profile: HarnessProfile,
    private readonly options: ResolvedConnectionOptions,
    private readonly supportsCancel: boolean,
    private readonly onMapping: (
      run: HermesRun,
      mapping: HermesEventMapping,
    ) => void,
    private readonly onSettling: (run: HermesRun) => void,
    private readonly onUnsafe: (run: HermesRun) => void,
  ) {
    this.eventQueue = new EventQueue(options.maxRunEvents);
    this.settlement = new Promise((resolve) => {
      this.resolveSettlement = resolve;
    });
    this.streamClosed = new Promise((resolve) => {
      this.resolveStreamClosed = resolve;
    });
    if (timeoutMs !== undefined) {
      this.timeout = setTimeout(() => {
        if (this.supportsCancel) {
          void this.cancel().catch(() => {
            this.abortConnection();
          });
        } else {
          this.abortConnection();
        }
      }, timeoutMs);
      this.timeout.unref();
    }
  }

  open(): void {
    this.emit({ type: 'run.started', data: {} });
    const iterable = this.transport.subscribe(
      `${runPath(this.providerRunId)}/events`,
      { signal: this.controller.signal },
    );
    void this.pump(iterable[Symbol.asyncIterator]()).catch(() => {
      if (!this.isTerminal()) this.abortConnection();
    });
  }

  ref(): RunRef {
    return { ...this.reference };
  }

  events(): AsyncIterable<HarnessEvent> {
    return this.eventQueue.iterable();
  }

  cancel(): Promise<CancelResult> {
    if (this.isTerminal()) return Promise.resolve({ mode: 'already_terminal' });
    if (!this.supportsCancel) {
      return Promise.reject(
        new HarnessError(
          'unsupported_capability',
          'The connected Hermes Agent API Server does not advertise Run stop.',
          {
            retryable: false,
            providerId: HERMES_PROVIDER_ID,
            profileId: this.profile.profileId,
            details: { capability: 'run.cancel' },
          },
        ),
      );
    }
    this.cancelPromise ??= this.cancelOnce();
    return this.cancelPromise;
  }

  result(): Promise<RunResult> {
    return this.settlement;
  }

  isTerminal(): boolean {
    return this.finalResult !== undefined;
  }

  hasTerminalBoundary(): boolean {
    return this.isTerminal() || this.terminalSignal !== undefined;
  }

  emit(mapped: {
    readonly type: HarnessEvent['type'];
    readonly data: unknown;
    readonly providerEventType?: string;
    readonly raw?: unknown;
  }): void {
    if (this.isTerminal()) return;
    if (!this.eventQueue.push(this.portableEvent(mapped)))
      this.abortConnection();
  }

  emitSettlement(mapped: {
    readonly type: HarnessEvent['type'];
    readonly data: unknown;
  }): void {
    if (this.isTerminal()) return;
    this.eventQueue.pushTerminal(this.portableEvent(mapped));
  }

  abortConnection(): void {
    if (this.isTerminal()) return;
    this.onUnsafe(this);
    this.controller.abort();
    this.finish({ status: 'connection_aborted' }, 'connection.aborted');
  }

  failIncompatible(surface: string): void {
    if (this.isTerminal()) return;
    this.onUnsafe(this);
    this.controller.abort();
    this.fail(providerIncompatible(this.profile, surface));
  }

  beginApprovalResponse(): () => void {
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    this.approvalResponseGates.add(gate);
    return () => {
      this.approvalResponseGates.delete(gate);
      resolveGate();
    };
  }

  confirmApproval(choice: string): boolean {
    if (this.confirmedApprovalChoice !== undefined) return false;
    this.confirmedApprovalChoice = choice;
    return true;
  }

  acceptConfirmedApproval(choice: string): boolean {
    if (this.confirmedApprovalChoice !== choice) return false;
    this.confirmedApprovalChoice = undefined;
    return true;
  }

  private async pump(iterator: AsyncIterator<SseEvent>): Promise<void> {
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        validateSseDispatch(next.value);
        const value = parseSseJson(next.value.data);
        const mapping = mapHermesEvent(value, this.providerRunId);
        if (mapping.kind === 'terminal') {
          this.handleTerminalSignal(mapping.eventType);
        } else if (
          this.terminalSignal !== undefined &&
          mapping.kind !== 'subagent' &&
          mapping.kind !== 'provider'
        ) {
          this.failIncompatible('Run event after terminal evidence');
        } else if (mapping.kind === 'portable') {
          this.emit(mapping.event);
        } else {
          this.onMapping(this, mapping);
        }
        if (
          this.finalResult !== undefined &&
          this.finalResult.status !== 'completed'
        ) {
          return;
        }
      }
      if (!this.isTerminal() && this.terminalSignal === undefined) {
        await this.reconcileAfterStreamLoss();
      }
    } catch (error) {
      if (this.isTerminal()) return;
      if (this.terminalSignal !== undefined) return;
      const mapped = mapError(error, this.profile, 'consume Run events');
      if (
        error instanceof HttpTransportError &&
        uncertainTransportCodes.has(error.code)
      ) {
        await this.reconcileAfterStreamLoss();
      } else if (mapped.code === 'provider_api_incompatible') {
        this.onUnsafe(this);
        this.fail(mapped);
      } else {
        this.abortConnection();
      }
    } finally {
      await iterator.return?.().catch(() => undefined);
      this.resolveStreamClosed();
    }
  }

  private handleTerminalSignal(eventType: string): void {
    if (this.terminalSignal !== undefined) {
      this.failIncompatible('duplicate Run terminal event');
      return;
    }
    if (this.isTerminal()) return;
    this.terminalSignal = eventType;
    this.reconcilePromise ??= this.reconcileTerminal(eventType);
    void this.reconcilePromise.catch(() => undefined);
  }

  private async reconcileAfterStreamLoss(): Promise<void> {
    this.reconcilePromise ??= this.reconcileTerminal(this.terminalSignal);
    await this.reconcilePromise;
  }

  private async reconcileTerminal(
    expectedEvent: string | undefined,
  ): Promise<void> {
    const deadline = Date.now() + this.options.reconcileTimeoutMs;
    for (;;) {
      if (this.isTerminal()) return;
      let status;
      try {
        status = parseHermesRunStatus(
          await requestProviderJson(
            this.transport,
            runPath(this.providerRunId),
            {},
            this.profile,
            'reconcile Run status',
            'run',
          ),
          this.providerRunId,
          this.reference.sessionId,
        );
      } catch (error) {
        const mapped = mapError(error, this.profile, 'reconcile Run status');
        if (mapped.code === 'provider_api_incompatible') {
          this.onUnsafe(this);
          this.controller.abort();
          this.fail(mapped);
        } else {
          this.abortConnection();
        }
        return;
      }
      if (
        status.result !== undefined &&
        status.terminalEventType !== undefined
      ) {
        if (
          expectedEvent !== undefined &&
          expectedEvent !== status.terminalEventType
        ) {
          this.failIncompatible('contradictory Run terminal evidence');
          return;
        }
        while (this.approvalResponseGates.size > 0) {
          await Promise.all([...this.approvalResponseGates]);
        }
        if (this.isTerminal()) return;
        if (status.result.status === 'completed') {
          if (status.result.finalMessage !== undefined) {
            this.emit({
              type: 'message.completed',
              data: { message: status.result.finalMessage },
            });
          }
          if (status.result.usage !== undefined) {
            this.emit({ type: 'usage.updated', data: status.result.usage });
          }
        }
        if (expectedEvent !== undefined) {
          await Promise.race([
            this.streamClosed,
            boundedDelay(this.options.lateEventDrainTimeoutMs),
          ]);
          if (this.isTerminal()) return;
        }
        while (this.approvalResponseGates.size > 0) {
          await Promise.all([...this.approvalResponseGates]);
        }
        if (this.isTerminal()) return;
        this.finish(status.result, terminalEventType(status.result.status));
        this.controller.abort();
        return;
      }
      if (Date.now() >= deadline) {
        this.abortConnection();
        return;
      }
      await boundedDelay(this.options.reconcilePollIntervalMs);
    }
  }

  private async cancelOnce(): Promise<CancelResult> {
    try {
      parseHermesStopResponse(
        await requestProviderJson(
          this.transport,
          `${runPath(this.providerRunId)}/stop`,
          { method: 'POST' },
          this.profile,
          'stop Run',
          'run',
        ),
        this.providerRunId,
      );
    } catch (error) {
      const mapped = mapError(error, this.profile, 'stop Run');
      if (uncertainMutationFailure(mapped)) this.abortConnection();
      throw mapped;
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
    if (outcome.status === 'connection_aborted') {
      return { mode: 'connection_aborted' };
    }
    return { mode: 'already_terminal' };
  }

  private fail(error: HarnessError): void {
    this.finish(
      {
        status: 'failed',
        providerResult: {
          error: error.code,
          ...(error.providerCode === undefined
            ? {}
            : { providerCode: error.providerCode }),
        },
      },
      'run.failed',
    );
  }

  private finish(result: RunResult, type: HarnessEvent['type']): void {
    if (this.isTerminal()) return;
    this.onSettling(this);
    this.finalResult = result;
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.eventQueue.pushTerminal(this.portableEvent({ type, data: result }));
    this.eventQueue.close();
    this.resolveSettlement(result);
  }

  private portableEvent(mapped: {
    readonly type: HarnessEvent['type'];
    readonly data: unknown;
    readonly providerEventType?: string;
    readonly raw?: unknown;
  }): HarnessEvent {
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
                'Hermes Agent Run events already have a consumer.',
                { retryable: false, providerId: HERMES_PROVIDER_ID },
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
          'A Hermes Agent event read is already pending.',
          { retryable: false, providerId: HERMES_PROVIDER_ID },
        ),
      );
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

const jsonHeaders = { 'content-type': 'application/json' } as const;

function hermesCapabilityManifest(
  profile: HarnessProfile,
  runtimeIdentity: string,
  observed: HermesCapabilities,
): CapabilityManifest {
  const native: CapabilityStatus = { mode: 'native', source: 'handshake' };
  return {
    providerId: HERMES_PROVIDER_ID,
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
      'session.workspace': {
        mode: 'unsupported',
        source: 'handshake',
      },
      'run.stream': native,
      'run.cancel': observed.features.cancel
        ? native
        : { mode: 'unsupported', source: 'handshake' },
      'run.timeout': observed.features.cancel
        ? {
            mode: 'emulated',
            source: 'configuration',
            reason: 'A local timer invokes the documented Run stop endpoint.',
          }
        : {
            mode: 'adapter_controlled',
            source: 'configuration',
            reason: 'A local timer can only abort the Adapter connection.',
          },
      'run.concurrent': {
        mode: 'unsupported',
        source: 'configuration',
        limits: { perSession: 1 },
      },
      'interaction.approval': observed.features.approval
        ? native
        : { mode: 'unsupported', source: 'handshake' },
      'input.text': native,
      'input.file': { mode: 'unsupported', source: 'schema' },
      'input.image': { mode: 'unsupported', source: 'schema' },
      'unknown_event.raw': {
        mode: 'adapter_controlled',
        source: 'configuration',
      },
      [`${HERMES_SUBAGENT_EXTENSION}.observe`]: {
        mode: 'unknown',
        source: 'schema',
        reason:
          'The current capability document does not advertise child-Session events.',
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
    throw profileInvalid('Hermes Agent providerOptions must be an object.');
  }
  const allowed = new Set([
    'cancelSettlementTimeoutMs',
    'lateEventDrainTimeoutMs',
    'maxRunEvents',
    'reconcilePollIntervalMs',
    'reconcileTimeoutMs',
    'requestTimeoutMs',
    'sseConnectTimeoutMs',
  ]);
  const unknown = Object.keys(options).find((name) => !allowed.has(name));
  if (unknown !== undefined) {
    throw profileInvalid(`Hermes Agent Profile option ${unknown} is unknown.`);
  }
  const maxRunEvents = profileInteger(
    options['maxRunEvents'],
    defaultMaxRunEvents,
    'maxRunEvents',
  );
  if (maxRunEvents < 2 || maxRunEvents > maximumRunEventCapacity) {
    throw profileInvalid(
      'Hermes Agent maxRunEvents must be between 2 and the supported upper bound.',
    );
  }
  return {
    maxRunEvents,
    cancelSettlementTimeoutMs: profileTimer(
      options['cancelSettlementTimeoutMs'],
      defaultCancelSettlementTimeoutMs,
      'cancelSettlementTimeoutMs',
    ),
    lateEventDrainTimeoutMs: profileTimer(
      options['lateEventDrainTimeoutMs'],
      defaultLateEventDrainTimeoutMs,
      'lateEventDrainTimeoutMs',
    ),
    reconcilePollIntervalMs: profileTimer(
      options['reconcilePollIntervalMs'],
      defaultReconcilePollIntervalMs,
      'reconcilePollIntervalMs',
    ),
    reconcileTimeoutMs: profileTimer(
      options['reconcileTimeoutMs'],
      defaultReconcileTimeoutMs,
      'reconcileTimeoutMs',
    ),
    ...(options['requestTimeoutMs'] === undefined
      ? {}
      : {
          requestTimeoutMs: profileTimer(
            options['requestTimeoutMs'],
            0,
            'requestTimeoutMs',
          ),
        }),
    ...(options['sseConnectTimeoutMs'] === undefined
      ? {}
      : {
          sseConnectTimeoutMs: profileTimer(
            options['sseConnectTimeoutMs'],
            0,
            'sseConnectTimeoutMs',
          ),
        }),
  };
}

function validateProfile(
  profile: HarnessProfile,
  factoryOptions: HermesProviderFactoryOptions,
): void {
  if (
    profile.providerId !== HERMES_PROVIDER_ID ||
    profile.connection.kind !== 'endpoint' ||
    (profile.connection.transport !== undefined &&
      profile.connection.transport !== 'http') ||
    profile.connection.url.length === 0
  ) {
    throw profileInvalid(
      'Hermes Agent requires an HTTP endpoint Profile owned by the host or an external service.',
      profile,
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(profile.connection.url);
  } catch {
    throw profileInvalid(
      'Hermes Agent endpoint URL must be absolute.',
      profile,
    );
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw profileInvalid(
      'Hermes Agent endpoint URL must use HTTP or HTTPS.',
      profile,
    );
  }
  if (
    profile.connection.authRef !== undefined &&
    factoryOptions.resolveAuthHeaders === undefined
  ) {
    throw profileInvalid(
      'Hermes Agent authRef requires a host-provided authentication-header resolver.',
      profile,
    );
  }
}

async function resolveHeaders(
  profile: HarnessProfile,
  factoryOptions: HermesProviderFactoryOptions,
): Promise<HttpHeaderMap | undefined> {
  if (profile.connection.kind !== 'endpoint') {
    throw profileInvalid(undefined, profile);
  }
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
      'The host could not resolve Hermes Agent authentication headers.',
      {
        retryable: false,
        providerId: HERMES_PROVIDER_ID,
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
  notFound: 'compatibility' | 'interaction' | 'run' | 'session',
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

function parseSseJson(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    throw providerIncompatible(undefined, 'Run event JSON');
  }
}

function responseError(
  status: number,
  profile: HarnessProfile,
  phase: string,
  notFound: 'compatibility' | 'interaction' | 'run' | 'session',
): HarnessError {
  if (status === 401 || status === 403) {
    return new HarnessError(
      'authentication_failed',
      `Hermes Agent rejected ${phase} authentication.`,
      {
        retryable: false,
        providerId: HERMES_PROVIDER_ID,
        profileId: profile.profileId,
        providerCode: String(status),
      },
    );
  }
  if (status === 404) {
    const code =
      notFound === 'session'
        ? 'session_not_found'
        : notFound === 'compatibility'
          ? 'provider_api_incompatible'
          : notFound === 'interaction'
            ? 'invalid_request'
            : 'provider_error';
    return new HarnessError(
      code,
      `Hermes Agent could not find the resource for ${phase}.`,
      {
        retryable: false,
        providerId: HERMES_PROVIDER_ID,
        profileId: profile.profileId,
        providerCode: String(status),
      },
    );
  }
  const code =
    status === 400 || status === 422
      ? 'invalid_request'
      : status === 409
        ? 'run_conflict'
        : 'provider_error';
  return new HarnessError(code, `Hermes Agent rejected ${phase}.`, {
    retryable: status === 429 || status >= 500,
    providerId: HERMES_PROVIDER_ID,
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
    return new HarnessError(code, `Hermes Agent ${phase} did not complete.`, {
      retryable:
        error.code === 'request_timeout' ||
        error.code === 'capacity_exceeded' ||
        error.code === 'network_failure',
      providerId: HERMES_PROVIDER_ID,
      profileId: profile.profileId,
      providerCode: error.code,
    });
  }
  return new HarnessError(
    connecting ? 'connection_failed' : 'provider_error',
    `Hermes Agent ${phase} failed.`,
    {
      retryable: false,
      providerId: HERMES_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function uncertainRequestFailure(error: HarnessError): boolean {
  return (
    error.code === 'timeout' ||
    (error.providerCode !== undefined &&
      uncertainTransportCodes.has(error.providerCode))
  );
}

function uncertainMutationFailure(error: HarnessError): boolean {
  if (
    uncertainRequestFailure(error) ||
    error.code === 'provider_api_incompatible'
  ) {
    return true;
  }
  if (error.code !== 'provider_error') return false;
  if (error.providerCode === undefined) return true;
  const status = Number(error.providerCode);
  return !Number.isInteger(status) || status >= 500;
}

function approvalChoice(response: InteractionResponse): string {
  if (response.kind === 'provider') {
    const options = runtimeRecord(response.value);
    if (options !== undefined && Object.keys(options).length === 1) {
      const choice = options['choice'];
      if (
        choice === 'once' ||
        choice === 'session' ||
        choice === 'always' ||
        choice === 'deny'
      ) {
        return choice;
      }
    }
    throw invalidInteraction();
  }
  if (response.kind !== 'approval') throw invalidInteraction();
  if (response.decision === 'deny') return 'deny';
  if (response.providerOptions === undefined) return 'once';
  const options = runtimeRecord(response.providerOptions);
  if (
    options !== undefined &&
    Object.keys(options).length === 1 &&
    (options['scope'] === 'session' || options['scope'] === 'always')
  ) {
    return options['scope'];
  }
  throw invalidInteraction();
}

function validateSseDispatch(event: SseEvent): void {
  if (event.event !== undefined && event.event !== 'message') {
    throw providerIncompatible(undefined, 'SSE dispatch type');
  }
}

function terminalEventType(status: RunResult['status']): HarnessEvent['type'] {
  return status === 'completed'
    ? 'run.completed'
    : status === 'cancelled'
      ? 'run.cancelled'
      : status === 'connection_aborted'
        ? 'connection.aborted'
        : 'run.failed';
}

function sessionPath(sessionId: string): string {
  return `api/sessions/${encodeURIComponent(sessionId)}`;
}

function runPath(providerRunId: string): string {
  return `v1/runs/${encodeURIComponent(providerRunId)}`;
}

function snapshotProfile(profile: HarnessProfile): HarnessProfile {
  return structuredClone(profile);
}

function endpointUrl(profile: HarnessProfile): string {
  if (profile.connection.kind !== 'endpoint') throw profileInvalid();
  return profile.connection.url;
}

function profileInteger(
  value: unknown,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw profileInvalid(`Hermes Agent ${label} must be a positive integer.`);
  }
  return value;
}

function profileTimer(value: unknown, fallback: number, label: string): number {
  const timer = profileInteger(value, fallback, label);
  if (timer > maximumTimerMilliseconds) {
    throw profileInvalid(
      `Hermes Agent ${label} exceeds the supported timer range.`,
    );
  }
  return timer;
}

function validateRunTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximumTimerMilliseconds
  ) {
    throw new HarnessError(
      'invalid_request',
      'Hermes Agent Run timeout must be a positive supported timer.',
      { retryable: false, providerId: HERMES_PROVIDER_ID },
    );
  }
}

function boundedDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

function jsonBody(value: unknown): string {
  try {
    const body: unknown = JSON.stringify(value);
    if (typeof body !== 'string') throw new TypeError('undefined JSON');
    return body;
  } catch {
    throw new HarnessError(
      'invalid_request',
      'Hermes Agent request data must be JSON serializable.',
      { retryable: false, providerId: HERMES_PROVIDER_ID },
    );
  }
}

function runtimeRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function profileInvalid(
  message = 'Hermes Agent Profile is invalid.',
  profile?: HarnessProfile,
): HarnessError {
  return new HarnessError('profile_invalid', message, {
    retryable: false,
    providerId: HERMES_PROVIDER_ID,
    ...(profile === undefined ? {} : { profileId: profile.profileId }),
  });
}

function providerIncompatible(
  profile: HarnessProfile | undefined,
  surface: string,
): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    `Hermes Agent returned an incompatible ${surface}.`,
    {
      retryable: false,
      providerId: HERMES_PROVIDER_ID,
      ...(profile === undefined ? {} : { profileId: profile.profileId }),
    },
  );
}

function invalidInteraction(profile?: HarnessProfile): HarnessError {
  return new HarnessError(
    'invalid_request',
    'Hermes Agent interaction response is invalid or no longer pending.',
    {
      retryable: false,
      providerId: HERMES_PROVIDER_ID,
      ...(profile === undefined ? {} : { profileId: profile.profileId }),
    },
  );
}

function sessionMismatch(profile: HarnessProfile): HarnessError {
  return new HarnessError(
    'session_provider_mismatch',
    'Hermes Agent returned a Session that does not match its reference.',
    {
      retryable: false,
      providerId: HERMES_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function sessionUnsafe(profile?: HarnessProfile): HarnessError {
  return new HarnessError(
    'connection_aborted',
    'Hermes Agent Session settlement is uncertain and requires explicit recovery.',
    {
      retryable: false,
      providerId: HERMES_PROVIDER_ID,
      ...(profile === undefined ? {} : { profileId: profile.profileId }),
    },
  );
}

function sessionClosed(): HarnessError {
  return new HarnessError(
    'connection_aborted',
    'Hermes Agent Session is closed.',
    {
      retryable: false,
      providerId: HERMES_PROVIDER_ID,
    },
  );
}
