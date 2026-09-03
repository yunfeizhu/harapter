import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

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
  AcpClient,
  AcpClientError,
  type AcpAgentCapabilities,
  type AcpClientOptions,
  type AcpEvent,
  type AcpPermissionOption,
  type AcpPermissionOutcome,
  type AcpPermissionRequest,
  type AcpRawObservation,
} from '@harapter/transport-acp';
import {
  JsonRpcRemoteError,
  JsonRpcTransportError,
} from '@harapter/transport-jsonrpc-stdio';

import {
  OPENCLAW_OBSERVATION_EXTENSION,
  OPENCLAW_PROVIDER_ID,
  OPENCLAW_SESSION_COMPATIBILITY_REF,
  mapOpenClawSessionUpdate,
  openClawCompatibilityIdentity,
  parseOpenClawRuntime,
  prepareOpenClawPrompt,
  redactOpenClawObservation,
  type MappedOpenClawEvent,
  type OpenClawRuntime,
} from './protocol.js';

const descriptor: ProviderDescriptor = {
  providerId: OPENCLAW_PROVIDER_ID,
  displayName: 'OpenClaw ACP Gateway',
  connectionKinds: ['process'],
  documentationUrl: 'https://docs.openclaw.ai/cli/acp',
};

const defaultOperationTimeoutMs = 30_000;
const defaultCancelSettlementTimeoutMs = 10_000;
const defaultMaxRunEvents = 128;
const maximumRunEvents = 4_096;
const maximumTimerMilliseconds = 2_147_483_647;
const childTerminationTimeoutMs = 2_000;
const forbiddenRoutingArguments = [
  '--require-existing',
  '--reset-session',
  '--session',
  '--session-label',
];

/** Connection limits accepted in an OpenClaw Profile's providerOptions. */
export interface OpenClawProfileOptions {
  readonly cancelSettlementTimeoutMs?: number;
  readonly maxBufferedEvents?: number;
  readonly maxBufferedMessages?: number;
  readonly maxMessageBytes?: number;
  readonly maxPendingInboundRequests?: number;
  readonly maxPendingRequests?: number;
  readonly maxPendingWrites?: number;
  readonly maxRunEvents?: number;
  readonly operationTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

/** Provider extension for observing bounded, redacted ACP observations. */
export interface OpenClawObservationExtension {
  onObservation(listener: (event: unknown) => void): () => void;
}

/** Explicit Provider-native access to namespaced ACP extensions. */
export interface OpenClawNativeClient {
  readonly runtimeIdentity: string;
  requestExtension<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>,
  ): Promise<TResult>;
  notifyExtension(method: string, params?: unknown): Promise<void>;
  onUnknownEvent(listener: (event: unknown) => void): () => void;
}

interface ResolvedConnectionOptions {
  readonly acp: Omit<
    AcpClientOptions,
    'cleanup' | 'readable' | 'requestPermission' | 'writable'
  >;
  readonly cancelSettlementTimeoutMs: number;
  readonly maxRunEvents: number;
  readonly operationTimeoutMs: number;
}

interface OpenClawSessionState {
  readonly strategy: 'isolated';
  readonly sessionKey: string;
  readonly cwd: string;
}

interface PendingApproval {
  readonly localId: string;
  readonly request: AcpPermissionRequest;
  readonly run: OpenClawRun;
  readonly settle: (outcome: AcpPermissionOutcome) => void;
}

type OpenClawChildProcess = ChildProcessByStdio<Writable, Readable, null>;

/** Create a fresh OpenClaw ACP Provider Adapter factory. */
export function createOpenClawProviderFactory(): ProviderAdapterFactory {
  return {
    descriptor: () => ({
      ...descriptor,
      connectionKinds: [...descriptor.connectionKinds],
    }),
    connect: async (profile) => connectOpenClaw(profile),
  };
}

async function connectOpenClaw(
  profile: HarnessProfile,
): Promise<HarnessClient> {
  validateProfile(profile);
  const options = connectionOptions(profile.providerOptions, profile);
  let connected: OpenClawClient | undefined;
  let acp: AcpClient;
  try {
    acp = await spawnAcp(
      profile,
      options.acp,
      (request) =>
        connected?.requestPermission(request) ?? { outcome: 'cancelled' },
    );
  } catch (error) {
    throw mapError(error, profile, 'spawn', true);
  }

  try {
    const initialized = await acp.initialize(
      {
        clientInfo: {
          name: 'harapter',
          title: 'Harapter',
          version: '0.0.0',
        },
      },
      { timeoutMs: options.operationTimeoutMs },
    );
    const runtime = parseOpenClawRuntime(initialized);
    connected = new OpenClawClient(
      snapshotProfile(profile),
      acp,
      runtime,
      options,
    );
    connected.startPump();
    return connected;
  } catch (error) {
    await acp.close().catch(() => undefined);
    throw mapError(error, profile, 'initialize', true);
  }
}

class OpenClawClient implements HarnessClient {
  private readonly extensionRegistry = new ExtensionRegistry(
    OPENCLAW_PROVIDER_ID,
  );
  private readonly nativeClient: OpenClawNativeClient;
  private readonly observationListeners = new Set<(event: unknown) => void>();
  private readonly unknownListeners = new Set<(event: unknown) => void>();
  private readonly sessions = new Map<string, OpenClawSession>();
  private readonly sessionReservations = new Set<ProviderSessionId>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private activeRun: OpenClawRun | undefined;
  private approvalObserved = false;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private interactionSerial = 0;
  private runSerial = 0;

  constructor(
    private readonly profile: HarnessProfile,
    private readonly acp: AcpClient,
    private readonly runtime: OpenClawRuntime,
    private readonly options: ResolvedConnectionOptions,
  ) {
    const observer: OpenClawObservationExtension = Object.freeze({
      onObservation: (listener: (event: unknown) => void) => {
        this.observationListeners.add(listener);
        return () => this.observationListeners.delete(listener);
      },
    });
    this.extensionRegistry.register(
      {
        name: OPENCLAW_OBSERVATION_EXTENSION,
        providerId: OPENCLAW_PROVIDER_ID,
        displayName: 'OpenClaw ACP observation channel',
        description: 'Bounded, redacted unknown ACP observations.',
        documentationUrl: 'https://docs.openclaw.ai/cli/acp',
        stability: 'experimental',
      },
      observer,
    );
    this.nativeClient = Object.freeze({
      runtimeIdentity: this.runtimeIdentity(),
      requestExtension: <TResult>(
        method: string,
        params?: unknown,
        requestOptions?: Readonly<{
          signal?: AbortSignal;
          timeoutMs?: number;
        }>,
      ) => this.acp.requestExtension<TResult>(method, params, requestOptions),
      notifyExtension: (method: string, params?: unknown) =>
        this.acp.notifyExtension(method, params),
      onUnknownEvent: (listener: (event: unknown) => void) => {
        this.unknownListeners.add(listener);
        return () => this.unknownListeners.delete(listener);
      },
    });
  }

  descriptor(): Promise<ClientDescriptor> {
    return Promise.resolve({
      providerId: OPENCLAW_PROVIDER_ID,
      profileId: this.profile.profileId,
      displayName: this.profile.displayName,
      connectionKind: 'process',
      runtime: {
        name: this.runtime.name,
        version: this.runtime.version,
        protocol: 'ACP over stdio JSON-RPC 2.0',
        protocolVersion: '1',
      },
      compatibility: 'supported',
    });
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.capabilityManifest());
  }

  async createSession(input: CreateSessionInput = {}): Promise<HarnessSession> {
    this.assertOpen();
    const cwd = prepareSessionInput(input, this.profile);
    const sessionKey = `acp-bridge:harapter-${randomUUID()}`;
    try {
      const created = await this.acp.newSession(
        {
          cwd,
          mcpServers: [],
          _meta: { sessionKey },
        },
        { timeoutMs: this.options.operationTimeoutMs },
      );
      const sessionId = providerSessionId(created.sessionId);
      this.assertSessionReusable(sessionId);
      const session = new OpenClawSession(this, sessionId, {
        strategy: 'isolated',
        sessionKey,
        cwd,
      });
      this.sessions.set(sessionId, session);
      return session;
    } catch (error) {
      throw this.operationError(
        error,
        'create Session',
        'session_create_uncertain',
      );
    }
  }

  async resumeSession(ref: SessionRef): Promise<HarnessSession> {
    this.assertOpen();
    assertSessionOwnership(ref, OPENCLAW_PROVIDER_ID, this.profile.profileId);
    assertSessionCompatibility(ref, OPENCLAW_SESSION_COMPATIBILITY_REF);
    const state = sessionStateFromRef(ref);
    this.reserveSession(ref.providerSessionId);
    try {
      await this.acp.resumeSession(
        {
          sessionId: ref.providerSessionId,
          cwd: state.cwd,
          _meta: {
            sessionKey: state.sessionKey,
            requireExisting: true,
          },
        },
        { timeoutMs: this.options.operationTimeoutMs },
      );
      const session = new OpenClawSession(this, ref.providerSessionId, state);
      this.sessions.set(ref.providerSessionId, session);
      this.sessionReservations.delete(ref.providerSessionId);
      return session;
    } catch (error) {
      this.sessionReservations.delete(ref.providerSessionId);
      throw this.operationError(
        error,
        'resume Session',
        'session_resume_uncertain',
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
    this.closePromise ??= this.closeOnce('client_closed');
    return this.closePromise;
  }

  startPump(): void {
    void this.pump();
  }

  sessionRef(
    sessionId: ProviderSessionId,
    state: OpenClawSessionState,
  ): SessionRef {
    return {
      providerId: OPENCLAW_PROVIDER_ID,
      profileId: this.profile.profileId,
      providerSessionId: sessionId,
      compatibilityRef: OPENCLAW_SESSION_COMPATIBILITY_REF,
      providerState: { ...state },
    };
  }

  capabilityManifest(): CapabilityManifest {
    return openClawCapabilities(
      this.profile,
      this.runtime.capabilities,
      this.runtimeIdentity(),
      this.approvalObserved,
    );
  }

  hasActiveRun(sessionId?: ProviderSessionId): boolean {
    return (
      this.activeRun !== undefined &&
      (sessionId === undefined || this.activeRun.ref().sessionId === sessionId)
    );
  }

  startRun(
    sessionId: ProviderSessionId,
    input: HarnessInput,
    options: RunOptions = {},
  ): Promise<HarnessRun> {
    this.assertOpen();
    if (this.activeRun !== undefined) {
      throw new HarnessError(
        'run_conflict',
        'OpenClaw ACP allows one active Harapter Run per connection.',
        {
          retryable: false,
          providerId: OPENCLAW_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    validateRunOptions(options);
    const prompt = prepareOpenClawPrompt(input, {
      image: this.runtime.capabilities.prompt.image,
    });
    const run = new OpenClawRun(
      {
        providerId: OPENCLAW_PROVIDER_ID,
        profileId: this.profile.profileId,
        sessionId,
        runId: runId(`openclaw-run-${String(++this.runSerial)}`),
      },
      this.options.maxRunEvents,
      options.timeoutMs,
      this.options.cancelSettlementTimeoutMs,
      () => this.acp.cancelSession(sessionId),
      (reason) => {
        this.abortConnection(reason);
      },
      (terminal) => {
        this.settleApprovals(terminal);
        if (this.activeRun === terminal) this.activeRun = undefined;
      },
    );
    this.activeRun = run;
    void this.acp
      .prompt({ sessionId, prompt })
      .then((result) => {
        run.finishPrompt(result.stopReason);
      })
      .catch((error: unknown) => {
        this.failPrompt(run, error);
      });
    return Promise.resolve(run);
  }

  respond(
    sessionId: ProviderSessionId,
    requestId: string,
    response: InteractionResponse,
  ): Promise<void> {
    this.assertOpen();
    const pending = this.pendingApprovals.get(requestId);
    if (
      pending?.run.ref().sessionId !== sessionId ||
      response.kind !== 'approval'
    ) {
      throw new HarnessError(
        'invalid_request',
        'OpenClaw interaction response does not match an active approval.',
        {
          retryable: false,
          providerId: OPENCLAW_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    const option = selectPermissionOption(pending.request.options, response);
    this.pendingApprovals.delete(requestId);
    pending.run.resolveInteraction(requestId, response.decision);
    pending.settle({ outcome: 'selected', optionId: option.optionId });
    return Promise.resolve();
  }

  async closeSession(session: OpenClawSession): Promise<void> {
    const sessionId = session.ref().providerSessionId;
    if (!this.sessions.has(sessionId)) return;
    if (this.hasActiveRun(sessionId)) {
      throw new HarnessError(
        'run_conflict',
        'Cannot close an OpenClaw Session with an active Run.',
        {
          retryable: false,
          providerId: OPENCLAW_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    this.assertOpen();
    this.sessionReservations.add(sessionId);
    try {
      await this.acp.closeSession(sessionId, {
        timeoutMs: this.options.operationTimeoutMs,
      });
      this.sessions.delete(sessionId);
    } catch (error) {
      throw this.operationError(
        error,
        'close Session',
        'session_close_uncertain',
      );
    } finally {
      this.sessionReservations.delete(sessionId);
    }
  }

  requestPermission(
    request: AcpPermissionRequest,
  ): Promise<AcpPermissionOutcome> | AcpPermissionOutcome {
    const run = this.activeRun;
    if (
      this.closed ||
      run?.ref().sessionId !== request.sessionId ||
      request.options.length === 0
    ) {
      return { outcome: 'cancelled' };
    }
    this.approvalObserved = true;
    const localId = `openclaw-approval-${String(++this.interactionSerial)}`;
    return new Promise((settle) => {
      this.pendingApprovals.set(localId, {
        localId,
        request,
        run,
        settle,
      });
      run.requestInteraction(localId, request);
    });
  }

  private async pump(): Promise<void> {
    try {
      for await (const event of this.acp.events()) this.handleEvent(event);
      if (!this.closed) this.abortConnection('transport_ended');
    } catch (error) {
      if (this.closed) return;
      if (isProtocolFailure(error)) {
        this.activeRun?.failProtocol('provider_api_incompatible');
        this.abortConnection('protocol_incompatible');
        return;
      }
      this.abortConnection('transport_ended');
    }
  }

  private handleEvent(event: AcpEvent): void {
    if (event.kind === 'unknown') {
      const observation = redactOpenClawObservation(event.observation);
      emitToListeners(this.observationListeners, observation);
      emitToListeners(this.unknownListeners, observation);
      this.activeRun?.receiveUnknown(event.observation, observation);
      return;
    }
    const run = this.activeRun;
    if (run?.ref().sessionId !== event.sessionId) return;
    for (const mapped of mapOpenClawSessionUpdate(event.update)) {
      run.receive(mapped);
    }
  }

  private failPrompt(run: OpenClawRun, error: unknown): void {
    if (run.isTerminal()) return;
    if (isProtocolFailure(error)) {
      run.failProtocol('provider_api_incompatible');
      this.abortConnection('protocol_incompatible');
      return;
    }
    const mapped = mapError(error, this.profile, 'prompt');
    if (mapped.code === 'connection_aborted' || mapped.code === 'timeout') {
      this.abortConnection(
        mapped.code === 'timeout' ? 'prompt_wait_uncertain' : 'transport_ended',
      );
      return;
    }
    run.failProtocol(mapped.code);
  }

  private settleApprovals(run: OpenClawRun): void {
    for (const pending of [...this.pendingApprovals.values()]) {
      if (pending.run !== run) continue;
      this.pendingApprovals.delete(pending.localId);
      pending.run.resolveInteraction(pending.localId, 'cancelled');
      pending.settle({ outcome: 'cancelled' });
    }
  }

  private abortConnection(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    const active = this.activeRun;
    if (active !== undefined) {
      this.settleApprovals(active);
      active.abortConnection(reason);
      this.activeRun = undefined;
    }
    void this.acp.close().catch(() => undefined);
  }

  private async closeOnce(reason: string): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      const active = this.activeRun;
      if (active !== undefined) {
        this.settleApprovals(active);
        active.abortConnection(reason);
        this.activeRun = undefined;
      }
    }
    try {
      await this.acp.close();
    } catch (error) {
      throw mapError(error, this.profile, 'close');
    }
  }

  private assertSessionReusable(sessionId: ProviderSessionId): void {
    if (
      this.sessions.has(sessionId) ||
      this.sessionReservations.has(sessionId)
    ) {
      throw new HarnessError(
        'session_provider_mismatch',
        'OpenClaw returned a Session identifier already active on this connection.',
        {
          retryable: false,
          providerId: OPENCLAW_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
  }

  private reserveSession(sessionId: ProviderSessionId): void {
    this.assertSessionReusable(sessionId);
    this.sessionReservations.add(sessionId);
  }

  private operationError(
    error: unknown,
    phase: string,
    uncertaintyReason: string,
  ): HarnessError {
    const mapped = mapError(error, this.profile, phase);
    if (mapped.code !== 'timeout' && mapped.code !== 'connection_aborted') {
      return mapped;
    }
    this.abortConnection(uncertaintyReason);
    return new HarnessError(
      'connection_aborted',
      `OpenClaw ${phase} did not establish an authoritative outcome.`,
      {
        retryable: false,
        providerId: OPENCLAW_PROVIDER_ID,
        profileId: this.profile.profileId,
        ...(mapped.providerCode === undefined
          ? {}
          : { providerCode: mapped.providerCode }),
      },
    );
  }

  private runtimeIdentity(): string {
    return openClawCompatibilityIdentity(this.runtime.version);
  }

  private assertOpen(): void {
    if (this.closed || !this.acp.isOpen()) {
      throw new HarnessError(
        'connection_aborted',
        'The OpenClaw ACP connection is closed.',
        {
          retryable: false,
          providerId: OPENCLAW_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
  }
}

class OpenClawSession implements HarnessSession {
  private lifecycleState: 'open' | 'closing' | 'closed' = 'open';
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly client: OpenClawClient,
    private readonly sessionId: ProviderSessionId,
    private readonly state: OpenClawSessionState,
  ) {}

  ref(): SessionRef {
    return this.client.sessionRef(this.sessionId, this.state);
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.client.capabilityManifest());
  }

  async start(input: HarnessInput, options?: RunOptions): Promise<HarnessRun> {
    this.assertOpen();
    return this.client.startRun(this.sessionId, input, options);
  }

  async respond(
    requestId: string,
    response: InteractionResponse,
  ): Promise<void> {
    this.assertOpen();
    return this.client.respond(this.sessionId, requestId, response);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.lifecycleState = 'closing';
    const attempt = this.closeOnce();
    this.closePromise = attempt;
    void attempt.catch((error: unknown) => {
      if (this.closePromise === attempt) {
        if (
          error instanceof HarnessError &&
          error.code === 'connection_aborted'
        ) {
          return;
        }
        this.closePromise = undefined;
        this.lifecycleState = 'open';
      }
    });
    return attempt;
  }

  private async closeOnce(): Promise<void> {
    await this.client.closeSession(this);
    this.lifecycleState = 'closed';
  }

  private assertOpen(): void {
    if (this.lifecycleState !== 'open') {
      throw new HarnessError(
        'session_not_found',
        'The OpenClaw Session is closed.',
        {
          retryable: false,
          providerId: OPENCLAW_PROVIDER_ID,
          profileId: this.ref().profileId,
        },
      );
    }
  }
}

class OpenClawRun implements HarnessRun {
  private readonly eventQueue: EventQueue;
  private readonly settlement: Promise<RunResult>;
  private readonly timeout: NodeJS.Timeout | undefined;
  private cancelPromise: Promise<CancelResult> | undefined;
  private cancelReason: 'timeout' | undefined;
  private finalMessage = '';
  private finalResult: RunResult | undefined;
  private reasoning = '';
  private resolveSettlement!: (result: RunResult) => void;
  private sequence = 0;
  private usage: UsageSummary | undefined;

  constructor(
    private readonly reference: RunRef,
    maxRunEvents: number,
    timeoutMs: number | undefined,
    private readonly cancelSettlementTimeoutMs: number,
    private readonly sendCancel: () => Promise<void>,
    private readonly abortOwnerConnection: (reason: string) => void,
    private readonly onTerminal: (run: OpenClawRun) => void,
  ) {
    validateRunTimeout(timeoutMs);
    this.eventQueue = new EventQueue(maxRunEvents);
    this.settlement = new Promise((resolveSettlement) => {
      this.resolveSettlement = resolveSettlement;
    });
    this.timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.cancelReason = 'timeout';
            void this.cancel().catch(() => {
              this.abortOwnerConnection('timeout_cancellation_failed');
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

  receive(mapped: MappedOpenClawEvent): void {
    if (this.isTerminal()) return;
    if (mapped.messageDelta !== undefined) {
      this.finalMessage += mapped.messageDelta;
    }
    if (mapped.reasoningDelta !== undefined)
      this.reasoning += mapped.reasoningDelta;
    if (mapped.usage !== undefined) this.usage = mapped.usage;
    this.emit(mapped);
  }

  receiveUnknown(observation: AcpRawObservation, redacted: unknown): void {
    if (this.isTerminal()) return;
    this.emit({
      type: 'provider',
      data: { method: observation.method },
      providerEventType: observation.method,
      raw: redacted,
    });
  }

  requestInteraction(requestId: string, request: AcpPermissionRequest): void {
    if (this.isTerminal()) return;
    this.emit({
      type: 'interaction.requested',
      data: {
        requestId,
        kind: 'approval',
        ...(request.toolCall.title === undefined ||
        request.toolCall.title === null
          ? {}
          : { title: request.toolCall.title.slice(0, 128) }),
        schema: {
          options: request.options.map(({ kind, name, optionId }) => ({
            kind,
            name: name.slice(0, 128),
            optionId,
          })),
        },
      },
    });
  }

  resolveInteraction(requestId: string, decision: string): void {
    if (this.isTerminal()) return;
    this.emit({
      type: 'interaction.resolved',
      data: { requestId, kind: 'approval', decision },
    });
  }

  finishPrompt(stopReason: string): void {
    if (this.isTerminal()) return;
    if (stopReason === 'end_turn') {
      this.finish(
        {
          status: 'completed',
          ...(this.finalMessage.length === 0
            ? {}
            : { finalMessage: this.finalMessage }),
          ...(this.usage === undefined ? {} : { usage: this.usage }),
          providerResult: { stopReason },
        },
        'run.completed',
      );
      return;
    }
    if (stopReason === 'cancelled') {
      this.finish(
        {
          status: 'cancelled',
          ...(this.usage === undefined ? {} : { usage: this.usage }),
          providerResult: {
            stopReason,
            ...(this.cancelReason === undefined
              ? {}
              : { reason: this.cancelReason }),
          },
        },
        'run.cancelled',
      );
      return;
    }
    if (
      stopReason === 'refusal' ||
      stopReason === 'max_tokens' ||
      stopReason === 'max_turn_requests'
    ) {
      this.finish(
        { status: 'failed', providerResult: { stopReason } },
        'run.failed',
      );
      return;
    }
    this.failProtocol('provider_api_incompatible');
  }

  failProtocol(reason: string): void {
    if (this.isTerminal()) return;
    this.finish({ status: 'failed', providerResult: { reason } }, 'run.failed');
  }

  abortConnection(reason: string): void {
    if (this.isTerminal()) return;
    this.finish(
      { status: 'connection_aborted', providerResult: { reason } },
      'connection.aborted',
    );
  }

  isTerminal(): boolean {
    return this.finalResult !== undefined;
  }

  private async cancelOnce(): Promise<CancelResult> {
    try {
      await this.sendCancel();
    } catch {
      this.abortOwnerConnection('cancel_notification_failed');
      return { mode: 'connection_aborted' };
    }
    const result = await withTimeout(
      this.settlement,
      this.cancelSettlementTimeoutMs,
    );
    if (result === undefined) {
      this.abortOwnerConnection('cancel_terminal_timeout');
      return { mode: 'connection_aborted' };
    }
    if (result.status === 'cancelled') return { mode: 'native' };
    if (result.status === 'connection_aborted') {
      return { mode: 'connection_aborted' };
    }
    return { mode: 'already_terminal' };
  }

  private finish(result: RunResult, type: HarnessEvent['type']): void {
    if (this.isTerminal()) return;
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    let terminalResult = result;
    let terminalType = type;
    let overflowed = false;
    if (this.finalMessage.length > 0) {
      overflowed = !this.eventQueue.push(
        this.portableEvent({
          type: 'message.completed',
          data: { text: this.finalMessage },
        }),
      );
    }
    if (!overflowed && this.reasoning.length > 0) {
      overflowed = !this.eventQueue.push(
        this.portableEvent({
          type: 'reasoning.completed',
          data: { text: this.reasoning },
        }),
      );
    }
    if (overflowed) {
      terminalResult = {
        status: 'connection_aborted',
        providerResult: { reason: 'event_buffer_overflow' },
      };
      terminalType = 'connection.aborted';
    }
    this.finalResult = terminalResult;
    this.onTerminal(this);
    this.eventQueue.pushTerminal(
      this.portableEvent({ type: terminalType, data: terminalResult }),
    );
    this.eventQueue.close();
    this.resolveSettlement(terminalResult);
    if (overflowed) this.abortOwnerConnection('event_buffer_overflow');
  }

  private emit(mapped: MappedOpenClawEvent): void {
    if (this.finalResult !== undefined) return;
    if (!this.eventQueue.push(this.portableEvent(mapped))) {
      this.abortOwnerConnection('event_buffer_overflow');
    }
  }

  private portableEvent(mapped: MappedOpenClawEvent): HarnessEvent {
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
                'OpenClaw Run events already have a consumer.',
                { retryable: false, providerId: OPENCLAW_PROVIDER_ID },
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
          'An OpenClaw Run event read is already pending.',
          { retryable: false, providerId: OPENCLAW_PROVIDER_ID },
        ),
      );
    }
    return new Promise((resolveNext) => {
      this.waiter = resolveNext;
    });
  }
}

async function spawnAcp(
  profile: HarnessProfile,
  options: ResolvedConnectionOptions['acp'],
  requestPermission: (
    request: AcpPermissionRequest,
  ) => Promise<AcpPermissionOutcome> | AcpPermissionOutcome,
): Promise<AcpClient> {
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
    return new AcpClient({
      ...options,
      readable: child.stdout,
      writable: child.stdin,
      requestPermission,
      cleanup: () => terminateChild(child),
    });
  } catch (error) {
    await terminateChild(child);
    throw error;
  }
}

function processStarted(child: OpenClawChildProcess): Promise<void> {
  return new Promise((resolveStarted, rejectStarted) => {
    const onSpawn = (): void => {
      child.off('error', onError);
      child.on('error', () => undefined);
      resolveStarted();
    };
    const onError = (error: Error): void => {
      child.off('spawn', onSpawn);
      rejectStarted(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

async function terminateChild(child: OpenClawChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (await waitForChildExit(child, childTerminationTimeoutMs)) return;
  child.kill('SIGKILL');
  if (await waitForChildExit(child, childTerminationTimeoutMs)) return;
  throw new Error('OpenClaw ACP child process did not exit.');
}

function waitForChildExit(
  child: OpenClawChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolveExit) => {
    let settled = false;
    const onExit = (): void => {
      finish(true);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    function finish(exited: boolean): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolveExit(exited);
    }
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
}

function openClawCapabilities(
  profile: HarnessProfile,
  capabilities: AcpAgentCapabilities,
  runtimeIdentity: string,
  approvalObserved: boolean,
): CapabilityManifest {
  const native: CapabilityStatus = { mode: 'native', source: 'handshake' };
  const unsupported: CapabilityStatus = {
    mode: 'unsupported',
    source: 'handshake',
  };
  return {
    providerId: OPENCLAW_PROVIDER_ID,
    profileId: profile.profileId,
    capabilities: {
      'session.create': native,
      'session.resume': capabilities.session.resume ? native : unsupported,
      'session.close': capabilities.session.close ? native : unsupported,
      'session.workspace': {
        mode: 'unknown',
        reason:
          'ACP accepts cwd, but Gateway tool execution in that workspace lacks live evidence.',
        source: 'schema',
      },
      'session.fork': unsupported,
      'run.stream': native,
      'run.cancel': { mode: 'native', source: 'schema' },
      'run.timeout': {
        mode: 'emulated',
        reason: 'A local timer requests native ACP cancellation.',
        source: 'configuration',
      },
      'run.concurrent': {
        mode: 'unsupported',
        limits: { maxActiveRunsPerConnection: 1 },
        source: 'configuration',
      },
      'connection.abort': {
        mode: 'adapter_controlled',
        source: 'configuration',
      },
      'input.text': native,
      'input.image': capabilities.prompt.image ? native : unsupported,
      'input.file': unsupported,
      'interaction.approval': approvalObserved
        ? { mode: 'native', source: 'schema' }
        : {
            mode: 'unknown',
            reason:
              'ACP initialization does not advertise permission requests.',
            source: 'handshake',
          },
      'interaction.user_input': unsupported,
      'interaction.provider': unsupported,
      'event.raw': { mode: 'adapter_controlled', source: 'configuration' },
      'native.client': { mode: 'native', source: 'schema' },
    },
    observedAt: new Date().toISOString(),
    runtimeIdentity,
  };
}

function connectionOptions(
  value: Readonly<Record<string, unknown>> | undefined,
  profile: HarnessProfile,
): ResolvedConnectionOptions {
  const options = value ?? {};
  const allowed = new Set([
    'cancelSettlementTimeoutMs',
    'maxBufferedEvents',
    'maxBufferedMessages',
    'maxMessageBytes',
    'maxPendingInboundRequests',
    'maxPendingRequests',
    'maxPendingWrites',
    'maxRunEvents',
    'operationTimeoutMs',
    'requestTimeoutMs',
  ]);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw profileInvalid(profile);
  }
  const acp: Record<string, number> = {
    requestTimeoutMs:
      options['requestTimeoutMs'] === undefined
        ? maximumTimerMilliseconds
        : positiveProfileTimer(options['requestTimeoutMs'], 'requestTimeoutMs'),
  };
  for (const name of [
    'maxBufferedEvents',
    'maxBufferedMessages',
    'maxMessageBytes',
    'maxPendingInboundRequests',
    'maxPendingRequests',
    'maxPendingWrites',
  ] as const) {
    if (options[name] !== undefined) {
      acp[name] = positiveProfileInteger(options[name], name);
    }
  }
  return {
    acp,
    cancelSettlementTimeoutMs:
      options['cancelSettlementTimeoutMs'] === undefined
        ? defaultCancelSettlementTimeoutMs
        : positiveProfileTimer(
            options['cancelSettlementTimeoutMs'],
            'cancelSettlementTimeoutMs',
          ),
    maxRunEvents: runEventCapacity(options['maxRunEvents']),
    operationTimeoutMs:
      options['operationTimeoutMs'] === undefined
        ? defaultOperationTimeoutMs
        : positiveProfileTimer(
            options['operationTimeoutMs'],
            'operationTimeoutMs',
          ),
  };
}

function validateProfile(profile: HarnessProfile): void {
  const connection = profile.connection;
  if (
    profile.providerId !== OPENCLAW_PROVIDER_ID ||
    connection.kind !== 'process' ||
    connection.ownership !== 'adapter' ||
    connection.command.trim().length === 0 ||
    connection.envRefs !== undefined ||
    (connection.args ?? []).some((argument) =>
      forbiddenRoutingArguments.some(
        (name) => argument === name || argument.startsWith(`${name}=`),
      ),
    )
  ) {
    throw profileInvalid(profile);
  }
}

function prepareSessionInput(
  input: CreateSessionInput,
  profile: HarnessProfile,
): string {
  if (
    input.systemContext !== undefined ||
    input.model !== undefined ||
    input.providerOptions !== undefined ||
    input.metadata !== undefined
  ) {
    throw new HarnessError(
      'unsupported_capability',
      'OpenClaw ACP does not map portable Session model or context controls.',
      {
        retryable: false,
        providerId: OPENCLAW_PROVIDER_ID,
        profileId: profile.profileId,
        details: { capability: 'session.options' },
      },
    );
  }
  if (input.workspace === undefined) {
    return resolve(
      profile.connection.kind === 'process'
        ? (profile.connection.cwd ?? process.cwd())
        : process.cwd(),
    );
  }
  try {
    const url = new URL(input.workspace.uri);
    if (url.protocol !== 'file:') throw new Error('not file');
    return resolve(fileURLToPath(url));
  } catch {
    throw new HarnessError(
      'invalid_request',
      'OpenClaw workspace must be an absolute file URI.',
      {
        retryable: false,
        providerId: OPENCLAW_PROVIDER_ID,
        profileId: profile.profileId,
      },
    );
  }
}

function sessionStateFromRef(ref: SessionRef): OpenClawSessionState {
  const state = record(ref.providerState);
  if (
    state?.['strategy'] !== 'isolated' ||
    typeof state['sessionKey'] !== 'string' ||
    !state['sessionKey'].startsWith('acp-bridge:harapter-') ||
    typeof state['cwd'] !== 'string' ||
    !state['cwd'].startsWith('/')
  ) {
    throw new HarnessError(
      'session_provider_mismatch',
      'OpenClaw Session reference does not contain valid isolated route state.',
      {
        retryable: false,
        providerId: OPENCLAW_PROVIDER_ID,
        profileId: ref.profileId,
      },
    );
  }
  return {
    strategy: 'isolated',
    sessionKey: state['sessionKey'],
    cwd: state['cwd'],
  };
}

function validateRunOptions(options: RunOptions): void {
  validateRunTimeout(options.timeoutMs);
  if (options.providerOptions !== undefined || options.metadata !== undefined) {
    throw new HarnessError(
      'invalid_request',
      'OpenClaw Run Provider options and metadata are not mapped.',
      { retryable: false, providerId: OPENCLAW_PROVIDER_ID },
    );
  }
}

function selectPermissionOption(
  options: readonly AcpPermissionOption[],
  response: Extract<InteractionResponse, { kind: 'approval' }>,
): AcpPermissionOption {
  const permittedKinds =
    response.decision === 'approve'
      ? new Set(['allow_once', 'allow_always'])
      : new Set(['reject_once', 'reject_always']);
  if (response.providerOptions !== undefined) {
    const providerOptions = record(response.providerOptions);
    const explicit = providerOptions?.['optionId'];
    if (
      providerOptions === undefined ||
      Object.keys(providerOptions).length !== 1 ||
      typeof explicit !== 'string'
    ) {
      throw invalidPermissionOption();
    }
    const selected = options.find(({ optionId }) => optionId === explicit);
    if (selected === undefined || !permittedKinds.has(selected.kind)) {
      throw invalidPermissionOption();
    }
    return selected;
  }
  const defaultKind =
    response.decision === 'approve' ? 'allow_once' : 'reject_once';
  const selected = options.find(({ kind }) => kind === defaultKind);
  if (selected === undefined) {
    throw invalidPermissionOption();
  }
  return selected;
}

function invalidPermissionOption(): HarnessError {
  return new HarnessError(
    'invalid_request',
    'OpenClaw approval decision has no compatible Provider option.',
    { retryable: false, providerId: OPENCLAW_PROVIDER_ID },
  );
}

function runEventCapacity(value: unknown): number {
  if (value === undefined) return defaultMaxRunEvents;
  const capacity = positiveProfileInteger(value, 'maxRunEvents');
  if (capacity < 2 || capacity > maximumRunEvents) {
    throw new HarnessError(
      'profile_invalid',
      `OpenClaw maxRunEvents must be between 2 and ${String(maximumRunEvents)}.`,
      { retryable: false, providerId: OPENCLAW_PROVIDER_ID },
    );
  }
  return capacity;
}

function validateRunTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs === undefined) return;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > maximumTimerMilliseconds
  ) {
    throw new HarnessError(
      'invalid_request',
      'OpenClaw Run timeoutMs must be a positive supported timer value.',
      { retryable: false, providerId: OPENCLAW_PROVIDER_ID },
    );
  }
}

function positiveProfileInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HarnessError(
      'profile_invalid',
      `OpenClaw ${label} must be a positive integer.`,
      { retryable: false, providerId: OPENCLAW_PROVIDER_ID },
    );
  }
  return value;
}

function positiveProfileTimer(value: unknown, label: string): number {
  const timeout = positiveProfileInteger(value, label);
  if (timeout > maximumTimerMilliseconds) {
    throw new HarnessError(
      'profile_invalid',
      `OpenClaw ${label} exceeds the supported timer range.`,
      { retryable: false, providerId: OPENCLAW_PROVIDER_ID },
    );
  }
  return timeout;
}

function profileInvalid(profile: HarnessProfile): HarnessError {
  return new HarnessError(
    'profile_invalid',
    'OpenClaw requires an adapter-owned process Profile without unresolved secrets or session-routing arguments.',
    {
      retryable: false,
      providerId: OPENCLAW_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
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

function emitToListeners(
  listeners: ReadonlySet<(event: unknown) => void>,
  event: unknown,
): void {
  for (const listener of [...listeners]) {
    try {
      listener(structuredClone(event));
    } catch {
      // Provider observers cannot affect lifecycle processing.
    }
  }
}

function mapError(
  error: unknown,
  profile: HarnessProfile,
  phase: string,
  connecting = false,
): HarnessError {
  if (error instanceof HarnessError) return error;
  if (error instanceof JsonRpcRemoteError) {
    const remote = error.getRemoteError();
    return new HarnessError(
      remote.code === -32_601 ? 'provider_api_incompatible' : 'provider_error',
      `OpenClaw rejected ${phase}.`,
      {
        retryable: false,
        providerId: OPENCLAW_PROVIDER_ID,
        profileId: profile.profileId,
        providerCode: String(remote.code),
      },
    );
  }
  if (error instanceof AcpClientError) {
    const code = isProtocolFailure(error)
      ? 'provider_api_incompatible'
      : error.code === 'capability_not_advertised'
        ? 'unsupported_capability'
        : error.code === 'client_closed'
          ? connecting
            ? 'connection_failed'
            : 'connection_aborted'
          : 'provider_error';
    return new HarnessError(code, `OpenClaw ${phase} did not complete.`, {
      retryable: false,
      providerId: OPENCLAW_PROVIDER_ID,
      profileId: profile.profileId,
      providerCode: error.code,
    });
  }
  if (error instanceof JsonRpcTransportError) {
    const code =
      error.code === 'request_timeout'
        ? 'timeout'
        : connecting
          ? 'connection_failed'
          : 'connection_aborted';
    return new HarnessError(code, `OpenClaw ${phase} did not complete.`, {
      retryable: error.code === 'request_timeout',
      providerId: OPENCLAW_PROVIDER_ID,
      profileId: profile.profileId,
      providerCode: error.code,
    });
  }
  const systemCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (connecting && systemCode === 'ENOENT') {
    return new HarnessError(
      'runtime_not_found',
      'The configured OpenClaw runtime was not found.',
      {
        retryable: false,
        providerId: OPENCLAW_PROVIDER_ID,
        profileId: profile.profileId,
      },
    );
  }
  return new HarnessError(
    connecting ? 'connection_failed' : 'provider_error',
    `OpenClaw ${phase} did not complete.`,
    {
      retryable: false,
      providerId: OPENCLAW_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function isProtocolFailure(error: unknown): boolean {
  return (
    error instanceof AcpClientError &&
    (error.code === 'invalid_message' ||
      error.code === 'unsupported_protocol_version')
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => {
      resolveTimeout(undefined);
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
