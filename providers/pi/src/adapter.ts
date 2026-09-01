import {
  spawn,
  type ChildProcessByStdio,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
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
  type RunId,
  type RunResult,
  type SessionRef,
} from '@harapter/core';
import {
  JsonlProcessTransport,
  JsonlTransportError,
  type JsonlMessage,
} from '@harapter/transport-jsonl-process';

import {
  PI_OBSERVATION_EXTENSION,
  PI_PROVIDER_ID,
  PI_SESSION_COMPATIBILITY_REF,
  mapPiRunEvent,
  parsePiAssistantOutcome,
  parsePiSessionState,
  parsePiVersionOutput,
  piCompatibilityIdentity,
  preparePiPrompt,
  redactPiObservation,
  type MappedPiEvent,
  type PiAssistantOutcome,
} from './protocol.js';

const descriptor: ProviderDescriptor = {
  providerId: PI_PROVIDER_ID,
  displayName: 'Pi Agent',
  connectionKinds: ['process'],
  documentationUrl:
    'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md',
};

const defaultOperationTimeoutMs = 30_000;
const defaultCancelSettlementTimeoutMs = 10_000;
const defaultMaxRunEvents = 128;
const defaultMaxPendingRequests = 32;
const defaultMaxPendingInteractions = 32;
const maximumRunEvents = 4_096;
const maximumTimerMilliseconds = 2_147_483_647;
const maximumVersionBytes = 256;
const childTerminationTimeoutMs = 2_000;
const forbiddenRuntimeArguments = new Set([
  '--api-key',
  '--append-system-prompt',
  '--continue',
  '--export',
  '--extension',
  '--fork',
  '--help',
  '--mode',
  '--no-extensions',
  '--no-prompt-templates',
  '--no-session',
  '--no-skills',
  '--print',
  '--prompt-template',
  '--resume',
  '--session',
  '--session-dir',
  '--session-id',
  '--skill',
  '--system-prompt',
  '--version',
  '-c',
  '-e',
  '-h',
  '-ne',
  '-np',
  '-ns',
  '-p',
  '-r',
  '-v',
]);
const nativeReadCommands = new Set([
  'get_available_models',
  'get_available_thinking_levels',
  'get_commands',
  'get_entries',
  'get_last_assistant_text',
  'get_messages',
  'get_session_stats',
  'get_state',
  'get_tree',
]);
const interactiveMethods = new Set(['select', 'confirm', 'input', 'editor']);

/** Connection limits accepted in a Pi Profile's providerOptions. */
export interface PiProfileOptions {
  readonly cancelSettlementTimeoutMs?: number;
  readonly maxBufferedMessages?: number;
  readonly maxMessageBytes?: number;
  readonly maxPendingInteractions?: number;
  readonly maxPendingRequests?: number;
  readonly maxPendingWrites?: number;
  readonly maxRunEvents?: number;
  readonly operationTimeoutMs?: number;
  readonly persistSessions?: boolean;
  readonly writeTimeoutMs?: number;
}

/** Provider extension for observing bounded, redacted Pi RPC messages. */
export interface PiObservationExtension {
  onObservation(listener: (event: unknown) => void): () => void;
}

/** Typed response accepted for a Pi extension UI interaction. */
export type PiProviderInteractionResponse =
  | Readonly<{ cancelled: true }>
  | Readonly<{ confirmed: boolean }>
  | Readonly<{ value: string }>;

/** Read-only Provider-native access that cannot mutate Session ownership. */
export interface PiNativeClient {
  readonly runtimeIdentity: string;
  request<TResult = unknown>(
    sessionId: ProviderSessionId,
    command: Readonly<Record<string, unknown>> & { readonly type: string },
    options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>,
  ): Promise<TResult>;
  onObservation(listener: (event: unknown) => void): () => void;
}

interface ResolvedOptions {
  readonly cancelSettlementTimeoutMs: number;
  readonly maxPendingInteractions: number;
  readonly maxPendingRequests: number;
  readonly maxRunEvents: number;
  readonly operationTimeoutMs: number;
  readonly persistSessions: boolean;
  readonly transport: Readonly<{
    maxBufferedMessages?: number;
    maxMessageBytes?: number;
    maxPendingWrites?: number;
    writeTimeoutMs?: number;
  }>;
}

interface PiSessionRefState {
  readonly strategy: 'isolated-process';
  readonly persisted: boolean;
}

interface PendingRequest {
  readonly command: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: PiRpcFailure) => void;
  readonly signal: AbortSignal | undefined;
  readonly abortListener: (() => void) | undefined;
  readonly timer: NodeJS.Timeout;
}

interface PendingInteraction {
  readonly nativeId: string;
  readonly method: 'select' | 'confirm' | 'input' | 'editor';
  readonly run: PiRun;
}

type PiChild = ChildProcessByStdio<Writable, Readable, null>;
type PiVersionChild = ChildProcessByStdio<null, Readable, null>;
type PiOwnedChild = PiChild | PiVersionChild;

/** Create a fresh Pi Agent RPC Provider Adapter factory. */
export function createPiProviderFactory(): ProviderAdapterFactory {
  return {
    descriptor: () => ({
      ...descriptor,
      connectionKinds: [...descriptor.connectionKinds],
    }),
    connect: async (profile) => connectPi(profile),
  };
}

async function connectPi(profile: HarnessProfile): Promise<HarnessClient> {
  const stableProfile = snapshotProfile(profile);
  validateProfile(stableProfile);
  const options = connectionOptions(
    stableProfile.providerOptions,
    stableProfile,
  );
  let runtimeVersion: string;
  try {
    runtimeVersion = await probeRuntimeVersion(
      stableProfile,
      options.operationTimeoutMs,
    );
  } catch (error) {
    throw mapError(error, stableProfile, 'probe Runtime', true);
  }
  return new PiClient(stableProfile, runtimeVersion, options);
}

class PiClient implements HarnessClient {
  private readonly extensionRegistry = new ExtensionRegistry(PI_PROVIDER_ID);
  private readonly observationListeners = new Set<(event: unknown) => void>();
  private readonly openingSessions = new Map<
    Promise<PiProcessSession>,
    AbortController
  >();
  private readonly sessions = new Map<ProviderSessionId, PiProcessSession>();
  private readonly nativeClient: PiNativeClient;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private interactionObserved = false;
  private runSerial = 0;

  constructor(
    private readonly profile: HarnessProfile,
    private readonly runtimeVersion: string,
    private readonly options: ResolvedOptions,
  ) {
    const observer: PiObservationExtension = Object.freeze({
      onObservation: (listener: (event: unknown) => void) => {
        this.observationListeners.add(listener);
        return () => this.observationListeners.delete(listener);
      },
    });
    this.extensionRegistry.register(
      {
        name: PI_OBSERVATION_EXTENSION,
        providerId: PI_PROVIDER_ID,
        displayName: 'Pi Agent RPC observation channel',
        description: 'Bounded, redacted Pi RPC observations.',
        documentationUrl:
          'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md',
        stability: 'experimental',
      },
      observer,
    );
    this.nativeClient = Object.freeze({
      runtimeIdentity: this.runtimeIdentity(),
      request: <TResult>(
        sessionId: ProviderSessionId,
        command: Readonly<Record<string, unknown>> & {
          readonly type: string;
        },
        requestOptions?: Readonly<{
          signal?: AbortSignal;
          timeoutMs?: number;
        }>,
      ) => this.nativeRequest<TResult>(sessionId, command, requestOptions),
      onObservation: (listener: (event: unknown) => void) => {
        this.observationListeners.add(listener);
        return () => this.observationListeners.delete(listener);
      },
    });
  }

  descriptor(): Promise<ClientDescriptor> {
    return Promise.resolve({
      providerId: PI_PROVIDER_ID,
      profileId: this.profile.profileId,
      displayName: this.profile.displayName,
      connectionKind: 'process',
      runtime: {
        name: 'pi',
        version: this.runtimeVersion,
        protocol: 'Pi RPC over strict JSONL stdio',
        protocolVersion: 'current',
      },
      compatibility: 'experimental',
      warnings: [
        {
          code: 'live_runtime_evidence_optional',
          message:
            'Compatibility is established by official interface review and synthetic conformance; live Pi runtime evidence is host opt-in.',
        },
      ],
    });
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.capabilityManifest());
  }

  async createSession(input: CreateSessionInput = {}): Promise<HarnessSession> {
    this.assertOpen();
    const state = prepareSessionInput(input, this.profile, this.options);
    const session = await this.openSession(state);
    return session;
  }

  async resumeSession(ref: SessionRef): Promise<HarnessSession> {
    this.assertOpen();
    if (!this.options.persistSessions) {
      throw unsupported(
        this.profile,
        'session.resume',
        'This Pi Profile disables native Session persistence.',
      );
    }
    assertSessionOwnership(ref, PI_PROVIDER_ID, this.profile.profileId);
    assertSessionCompatibility(ref, PI_SESSION_COMPATIBILITY_REF);
    const state = sessionStateFromRef(ref);
    if (!state.persisted) {
      throw unsupported(
        this.profile,
        'session.resume',
        'The Pi Session reference was created without persistence.',
      );
    }
    return this.openSession(state, ref.providerSessionId);
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

  capabilityManifest(): CapabilityManifest {
    return piCapabilities(
      this.profile,
      this.options,
      this.runtimeIdentity(),
      this.interactionObserved,
    );
  }

  forget(session: PiProcessSession): void {
    const id = session.ref().providerSessionId;
    if (this.sessions.get(id) === session) this.sessions.delete(id);
  }

  observe(value: unknown): void {
    const observation = redactPiObservation(value);
    for (const listener of [...this.observationListeners]) {
      try {
        listener(structuredClone(observation));
      } catch {
        // Provider observers cannot affect lifecycle processing.
      }
    }
  }

  markInteractionObserved(): void {
    this.interactionObserved = true;
  }

  allocateRunId(): RunId {
    return runId(`pi-run-${String(++this.runSerial)}`);
  }

  private openSession(
    state: PiSessionRefState,
    resumeId?: ProviderSessionId,
  ): Promise<PiProcessSession> {
    const controller = new AbortController();
    const opening = this.openSessionOnce(state, resumeId, controller.signal);
    this.openingSessions.set(opening, controller);
    void opening.then(
      () => this.openingSessions.delete(opening),
      (error: unknown) => {
        if (!isChildCleanupFailure(error)) {
          this.openingSessions.delete(opening);
        }
      },
    );
    return opening;
  }

  private async openSessionOnce(
    state: PiSessionRefState,
    resumeId: ProviderSessionId | undefined,
    signal: AbortSignal,
  ): Promise<PiProcessSession> {
    let peer: PiRpcPeer | undefined;
    try {
      peer = await spawnPiPeer(
        this.profile,
        this.options,
        state,
        resumeId,
        (observation) => {
          this.observe(observation);
        },
      );
      const response = await peer.request(
        { type: 'get_state' },
        { signal, timeoutMs: this.options.operationTimeoutMs },
      );
      const nativeState = parsePiSessionState(response);
      this.assertOpen();
      if (nativeState.isStreaming || nativeState.isCompacting) {
        throw new HarnessError(
          'provider_api_incompatible',
          'Pi Agent opened a Session that was not idle.',
          {
            retryable: false,
            providerId: PI_PROVIDER_ID,
            profileId: this.profile.profileId,
          },
        );
      }
      const sessionId = providerSessionId(nativeState.sessionId);
      if (resumeId !== undefined && sessionId !== resumeId) {
        throw new HarnessError(
          'session_provider_mismatch',
          'Pi Agent resumed a different native Session.',
          {
            retryable: false,
            providerId: PI_PROVIDER_ID,
            profileId: this.profile.profileId,
          },
        );
      }
      if (this.sessions.has(sessionId)) {
        throw new HarnessError(
          'session_provider_mismatch',
          'The Pi Session is already active on this Client.',
          {
            retryable: false,
            providerId: PI_PROVIDER_ID,
            profileId: this.profile.profileId,
          },
        );
      }
      const session = new PiProcessSession(
        this,
        this.profile,
        sessionId,
        state,
        peer,
        this.options,
      );
      peer.bind(session);
      this.sessions.set(sessionId, session);
      return session;
    } catch (error) {
      if (peer !== undefined) {
        try {
          await peer.close();
        } catch {
          throw childCleanupFailure(this.profile);
        }
      }
      if (signal.aborted && this.closed) this.assertOpen();
      throw mapError(error, this.profile, 'open Session');
    }
  }

  private async nativeRequest<TResult>(
    sessionId: ProviderSessionId,
    command: Readonly<Record<string, unknown>> & { readonly type: string },
    options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>,
  ): Promise<TResult> {
    this.assertOpen();
    if (!nativeReadCommands.has(command.type) || 'id' in command) {
      throw new HarnessError(
        'unsupported_capability',
        'Pi native access permits only ownership-preserving read commands.',
        {
          retryable: false,
          providerId: PI_PROVIDER_ID,
          profileId: this.profile.profileId,
          details: { capability: 'native.client' },
        },
      );
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new HarnessError('session_not_found', 'Pi Session is not active.', {
        retryable: false,
        providerId: PI_PROVIDER_ID,
        profileId: this.profile.profileId,
      });
    }
    return session.nativeRequest<TResult>(command, options);
  }

  private async closeOnce(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const openings = [...this.openingSessions.entries()];
    for (const [, controller] of openings) controller.abort();
    const sessions = [...this.sessions.values()];
    const results = await Promise.allSettled([
      ...sessions.map(async (session) => session.forceClose('client_closed')),
      ...openings.map(async ([opening]) => {
        const opened = await opening;
        await opened.forceClose('client_closed');
      }),
    ]);
    const cleanupFailure = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' && isChildCleanupFailure(result.reason),
    );
    if (cleanupFailure !== undefined) throw cleanupFailure.reason;
  }

  private runtimeIdentity(): string {
    return piCompatibilityIdentity(this.runtimeVersion);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new HarnessError(
        'connection_aborted',
        'The Pi Agent Client is closed.',
        {
          retryable: false,
          providerId: PI_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
  }
}

class PiProcessSession implements HarnessSession {
  private readonly pendingInteractions = new Map<string, PendingInteraction>();
  private lifecycleState: 'open' | 'closing' | 'closed' = 'open';
  private closePromise: Promise<void> | undefined;
  private forceClosePromise: Promise<void> | undefined;
  private activeRun: PiRun | undefined;
  private connectionAborted = false;
  private interactionSerial = 0;

  constructor(
    private readonly client: PiClient,
    private readonly profile: HarnessProfile,
    private readonly sessionId: ProviderSessionId,
    private readonly state: PiSessionRefState,
    private readonly peer: PiRpcPeer,
    private readonly options: ResolvedOptions,
  ) {}

  ref(): SessionRef {
    return {
      providerId: PI_PROVIDER_ID,
      profileId: this.profile.profileId,
      providerSessionId: this.sessionId,
      compatibilityRef: PI_SESSION_COMPATIBILITY_REF,
      providerState: { ...this.state },
    };
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.client.capabilityManifest());
  }

  start(input: HarnessInput, options: RunOptions = {}): Promise<HarnessRun> {
    try {
      return Promise.resolve(this.startOnce(input, options));
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new HarnessError('provider_error', 'Pi Agent Run setup failed.', {
              retryable: false,
              providerId: PI_PROVIDER_ID,
              profileId: this.profile.profileId,
            }),
      );
    }
  }

  private startOnce(input: HarnessInput, options: RunOptions): HarnessRun {
    this.assertOpen();
    if (this.activeRun !== undefined) {
      throw new HarnessError(
        'run_conflict',
        'Pi Agent permits one active Run per Session process.',
        {
          retryable: false,
          providerId: PI_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    validateRunOptions(options);
    const prompt = preparePiPrompt(input);
    const run = new PiRun(
      {
        providerId: PI_PROVIDER_ID,
        profileId: this.profile.profileId,
        sessionId: this.sessionId,
        runId: this.client.allocateRunId(),
      },
      this.options.maxRunEvents,
      options.timeoutMs,
      this.options.cancelSettlementTimeoutMs,
      () => this.sendAbort(),
      (reason) => {
        this.abortConnection(reason);
      },
      (terminal) => {
        this.settleInteractions(terminal);
        if (this.activeRun === terminal) this.activeRun = undefined;
      },
    );
    this.activeRun = run;
    void this.peer
      .request(
        { type: 'prompt', message: prompt },
        { timeoutMs: this.options.operationTimeoutMs },
      )
      .then(() => {
        run.acknowledgePrompt();
      })
      .catch((error: unknown) => {
        this.handlePromptFailure(run, error);
      });
    return run;
  }

  async respond(
    requestId: string,
    response: InteractionResponse,
  ): Promise<void> {
    this.assertOpen();
    const pending = this.pendingInteractions.get(requestId);
    if (pending === undefined || response.kind !== 'provider') {
      throw invalidInteraction(this.profile);
    }
    const outbound = prepareInteractionResponse(pending, response.value);
    try {
      await this.peer.send(outbound);
    } catch {
      this.abortConnection('interaction_response_failed');
      throw new HarnessError(
        'connection_aborted',
        'Pi Agent interaction response could not be confirmed.',
        {
          retryable: false,
          providerId: PI_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    this.pendingInteractions.delete(requestId);
    pending.run.resolveInteraction(requestId, pending.method);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.lifecycleState = 'closing';
    const attempt = this.closeOnce();
    this.closePromise = attempt;
    void attempt.catch((error: unknown) => {
      if (this.closePromise === attempt) {
        this.closePromise = undefined;
        if (
          !(error instanceof HarnessError) ||
          error.code !== 'connection_aborted'
        ) {
          this.lifecycleState = 'open';
        }
      }
    });
    return attempt;
  }

  receive(value: JsonlMessage): void {
    const run = this.activeRun;
    if (run === undefined) {
      this.client.observe(value);
      return;
    }
    run.receive(value);
  }

  receiveExtensionRequest(value: JsonlMessage): void {
    const method = value['method'];
    const nativeId = value['id'];
    const run = this.activeRun;
    if (
      run === undefined ||
      typeof nativeId !== 'string' ||
      typeof method !== 'string' ||
      !interactiveMethods.has(method)
    ) {
      this.client.observe(value);
      if (typeof nativeId === 'string' && typeof method === 'string') {
        void this.peer
          .send({
            type: 'extension_ui_response',
            id: nativeId,
            cancelled: true,
          })
          .catch(() => {
            this.abortConnection('interaction_response_failed');
          });
      }
      return;
    }
    if (this.pendingInteractions.size >= this.options.maxPendingInteractions) {
      this.abortConnection('interaction_capacity_exceeded');
      return;
    }
    const localId = `pi-interaction-${String(++this.interactionSerial)}`;
    const typedMethod = method as PendingInteraction['method'];
    this.pendingInteractions.set(localId, {
      nativeId,
      method: typedMethod,
      run,
    });
    this.client.markInteractionObserved();
    run.requestInteraction(localId, typedMethod, value);
  }

  failConnection(reason: string): void {
    this.abortConnection(reason);
  }

  failProtocol(): void {
    if (this.connectionAborted) return;
    this.connectionAborted = true;
    this.activeRun?.failProtocol('provider_api_incompatible');
    this.settleInteractions(this.activeRun);
    void this.peer.close().catch(() => undefined);
  }

  async nativeRequest<TResult>(
    command: Readonly<Record<string, unknown>> & { readonly type: string },
    options?: Readonly<{ signal?: AbortSignal; timeoutMs?: number }>,
  ): Promise<TResult> {
    this.assertOpen();
    try {
      return (await this.peer.request(command, options)) as TResult;
    } catch (error) {
      throw mapError(error, this.profile, 'native request');
    }
  }

  forceClose(reason: string): Promise<void> {
    this.forceClosePromise ??= this.forceCloseOnce(reason);
    return this.forceClosePromise;
  }

  private async forceCloseOnce(reason: string): Promise<void> {
    this.lifecycleState = 'closed';
    this.connectionAborted = true;
    this.activeRun?.abortConnection(reason);
    this.settleInteractions(this.activeRun);
    try {
      await this.peer.close();
    } catch {
      throw childCleanupFailure(this.profile);
    }
    this.client.forget(this);
  }

  private async closeOnce(): Promise<void> {
    if (this.activeRun !== undefined) {
      throw new HarnessError(
        'run_conflict',
        'Cannot close a Pi Session with an active Run.',
        {
          retryable: false,
          providerId: PI_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    await this.forceClose('session_closed');
  }

  private sendAbort(): Promise<unknown> {
    return this.peer.request(
      { type: 'abort' },
      { timeoutMs: this.options.operationTimeoutMs },
    );
  }

  private handlePromptFailure(run: PiRun, error: unknown): void {
    if (run.isTerminal()) return;
    if (error instanceof PiRpcFailure && error.code === 'remote_rejected') {
      run.failProtocol('prompt_rejected');
      return;
    }
    this.abortConnection('prompt_ack_uncertain');
  }

  private settleInteractions(run: PiRun | undefined): void {
    if (run === undefined) return;
    for (const [requestId, pending] of [...this.pendingInteractions]) {
      if (pending.run !== run) continue;
      this.pendingInteractions.delete(requestId);
      pending.run.resolveInteraction(requestId, 'cancelled');
    }
  }

  private abortConnection(reason: string): void {
    if (this.connectionAborted) return;
    this.connectionAborted = true;
    this.activeRun?.abortConnection(reason);
    this.settleInteractions(this.activeRun);
    void this.peer.close().catch(() => undefined);
  }

  private assertOpen(): void {
    if (
      this.lifecycleState !== 'open' ||
      this.connectionAborted ||
      !this.peer.isOpen()
    ) {
      throw new HarnessError(
        this.lifecycleState === 'closed'
          ? 'session_not_found'
          : 'connection_aborted',
        'The Pi Session process is not available.',
        {
          retryable: false,
          providerId: PI_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
  }
}

class PiRun implements HarnessRun {
  private readonly eventQueue: EventQueue;
  private readonly settlement: Promise<RunResult>;
  private readonly timeout: NodeJS.Timeout | undefined;
  private acknowledged = false;
  private settled = false;
  private cancelPromise: Promise<CancelResult> | undefined;
  private cancelReason: 'timeout' | undefined;
  private cancelConfirmed = false;
  private cancelRequested = false;
  private finalResult: RunResult | undefined;
  private lastAssistant: PiAssistantOutcome | undefined;
  private resolveSettlement!: (result: RunResult) => void;
  private sequence = 0;

  constructor(
    private readonly reference: RunRef,
    maxRunEvents: number,
    timeoutMs: number | undefined,
    private readonly cancelSettlementTimeoutMs: number,
    private readonly sendCancel: () => Promise<unknown>,
    private readonly abortOwnerConnection: (reason: string) => void,
    private readonly onTerminal: (run: PiRun) => void,
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

  acknowledgePrompt(): void {
    if (this.isTerminal()) return;
    this.acknowledged = true;
    this.finishIfReady();
  }

  receive(value: JsonlMessage): void {
    if (this.isTerminal()) return;
    const type = value['type'];
    if (type === 'agent_settled') {
      this.settled = true;
      this.finishIfReady();
      return;
    }
    if (type === 'message_end') {
      const outcome = parsePiAssistantOutcome(value['message']);
      if (outcome !== undefined) {
        this.lastAssistant = outcome;
        if (outcome.text.length > 0) {
          this.emit({
            type: 'message.completed',
            data: { text: outcome.text },
            providerEventType: 'message_end',
          });
        }
        if (outcome.reasoning.length > 0) {
          this.emit({
            type: 'reasoning.completed',
            data: { text: outcome.reasoning },
            providerEventType: 'message_end',
          });
        }
        this.emit({
          type: 'usage.updated',
          data: outcome.usage,
          usage: outcome.usage,
          providerEventType: 'message_end',
        });
        return;
      }
    }
    for (const mapped of mapPiRunEvent(value)) this.emit(mapped);
  }

  requestInteraction(
    requestId: string,
    method: PendingInteraction['method'],
    value: JsonlMessage,
  ): void {
    if (this.isTerminal()) return;
    this.emit({
      type: 'interaction.requested',
      data: {
        requestId,
        kind: 'provider',
        title: boundedText(value['title']),
        ...(method === 'confirm'
          ? { prompt: boundedText(value['message']) }
          : {}),
        schema: interactionSchema(method, value),
        providerState: { method },
      },
      providerEventType: 'extension_ui_request',
    });
  }

  resolveInteraction(requestId: string, outcome: string): void {
    if (this.isTerminal()) return;
    this.emit({
      type: 'interaction.resolved',
      data: { requestId, kind: 'provider', outcome },
      providerEventType: 'extension_ui_response',
    });
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

  private finishIfReady(): void {
    if (!this.acknowledged || !this.settled || this.isTerminal()) return;
    const outcome = this.lastAssistant;
    if (outcome === undefined) {
      this.failProtocol('missing_assistant_terminal');
      return;
    }
    if (outcome.stopReason === 'stop') {
      this.finish(
        {
          status: 'completed',
          ...(outcome.text.length === 0 ? {} : { finalMessage: outcome.text }),
          usage: outcome.usage,
          providerResult: { stopReason: outcome.stopReason },
        },
        'run.completed',
      );
      return;
    }
    if (outcome.stopReason === 'aborted') {
      if (!this.cancelRequested) {
        this.failProtocol('unconfirmed_native_cancellation');
        return;
      }
      if (!this.cancelConfirmed) return;
      this.finish(
        {
          status: 'cancelled',
          usage: outcome.usage,
          providerResult: {
            stopReason: outcome.stopReason,
            ...(this.cancelReason === undefined
              ? {}
              : { reason: this.cancelReason }),
          },
        },
        'run.cancelled',
      );
      return;
    }
    this.finish(
      {
        status: 'failed',
        usage: outcome.usage,
        providerResult: { stopReason: outcome.stopReason },
      },
      'run.failed',
    );
  }

  private async cancelOnce(): Promise<CancelResult> {
    this.cancelRequested = true;
    try {
      await this.sendCancel();
    } catch {
      this.abortOwnerConnection('cancel_confirmation_failed');
      return { mode: 'connection_aborted' };
    }
    this.cancelConfirmed = true;
    this.finishIfReady();
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
    this.finalResult = result;
    this.onTerminal(this);
    this.eventQueue.pushTerminal(this.portableEvent({ type, data: result }));
    this.eventQueue.close();
    this.resolveSettlement(result);
  }

  private emit(mapped: MappedPiEvent): void {
    if (this.finalResult !== undefined) return;
    if (!this.eventQueue.push(this.portableEvent(mapped))) {
      this.abortOwnerConnection('event_buffer_overflow');
    }
  }

  private portableEvent(mapped: MappedPiEvent): HarnessEvent {
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

class PiRpcPeer {
  private readonly abandoned = new Map<string, string>();
  private readonly pending = new Map<string, PendingRequest>();
  private owner: PiProcessSession | undefined;
  private closed = false;
  private requestSerial = 0;

  constructor(
    private readonly transport: JsonlProcessTransport,
    private readonly maxPendingRequests: number,
    private readonly operationTimeoutMs: number,
    private readonly observe: (value: unknown) => void,
  ) {
    void this.pump();
  }

  bind(owner: PiProcessSession): void {
    if (this.owner !== undefined) {
      throw new PiRpcFailure('protocol', 'Pi RPC peer is already bound.');
    }
    this.owner = owner;
  }

  request(
    command: Readonly<Record<string, unknown>> & { readonly type: string },
    options: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {},
  ): Promise<unknown> {
    if (this.closed || !this.transport.isOpen()) {
      return Promise.reject(
        new PiRpcFailure('connection', 'Pi RPC peer is closed.'),
      );
    }
    if (this.pending.size >= this.maxPendingRequests) {
      return Promise.reject(
        new PiRpcFailure('capacity', 'Pi RPC request capacity was reached.'),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(
        new PiRpcFailure('aborted', 'Pi RPC request wait was aborted.'),
      );
    }
    const timeoutMs = positiveTimer(
      options.timeoutMs ?? this.operationTimeoutMs,
      'request timeout',
    );
    const id = `harapter-pi-${String(++this.requestSerial)}`;
    return new Promise((resolve, reject) => {
      const abortListener =
        options.signal === undefined
          ? undefined
          : () => {
              this.abandonPending(
                id,
                new PiRpcFailure('aborted', 'Pi RPC request wait was aborted.'),
              );
            };
      const timer = setTimeout(() => {
        this.abandonPending(
          id,
          new PiRpcFailure('timeout', 'Pi RPC request wait timed out.'),
        );
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, {
        command: command.type,
        resolve,
        reject,
        signal: options.signal,
        abortListener,
        timer,
      });
      if (abortListener !== undefined) {
        options.signal?.addEventListener('abort', abortListener, {
          once: true,
        });
      }
      void this.transport.send({ ...command, id }, { timeoutMs }).catch(() => {
        this.fail('connection');
      });
    });
  }

  send(message: JsonlMessage): Promise<void> {
    if (this.closed) {
      return Promise.reject(
        new PiRpcFailure('connection', 'Pi RPC peer is closed.'),
      );
    }
    return this.transport.send(message, {
      timeoutMs: this.operationTimeoutMs,
    });
  }

  isOpen(): boolean {
    return !this.closed && this.transport.isOpen();
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.rejectAll(new PiRpcFailure('connection', 'Pi RPC peer was closed.'));
      this.abandoned.clear();
    }
    await this.transport.close();
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.transport.incoming()) {
        this.handleMessage(message);
      }
      if (!this.closed) this.fail('connection');
    } catch (error) {
      if (this.closed) return;
      const protocol =
        error instanceof HarnessError &&
        error.code === 'provider_api_incompatible';
      const malformed =
        error instanceof JsonlTransportError &&
        error.code === 'malformed_message';
      this.fail(protocol || malformed ? 'protocol' : 'connection');
    }
  }

  private handleMessage(message: JsonlMessage): void {
    const type = message['type'];
    if (type === 'response') {
      this.handleResponse(message);
      return;
    }
    if (type === 'extension_ui_request') {
      this.owner?.receiveExtensionRequest(message);
      if (this.owner === undefined) this.observe(message);
      return;
    }
    if (typeof type !== 'string') {
      throw new HarnessError(
        'provider_api_incompatible',
        'Pi Agent emitted an incompatible RPC event envelope.',
        { retryable: false, providerId: PI_PROVIDER_ID },
      );
    }
    this.observe(message);
    this.owner?.receive(message);
  }

  private handleResponse(message: JsonlMessage): void {
    const id = message['id'];
    const command = message['command'];
    const success = message['success'];
    if (
      typeof id !== 'string' ||
      typeof command !== 'string' ||
      typeof success !== 'boolean'
    ) {
      this.fail('protocol');
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      if (this.abandoned.get(id) === command) {
        this.abandoned.delete(id);
        return;
      }
      this.fail('protocol');
      return;
    }
    if (pending.command !== command) {
      this.fail('protocol');
      return;
    }
    this.removePending(id, pending);
    if (success) pending.resolve(message['data']);
    else {
      pending.reject(
        new PiRpcFailure('remote_rejected', 'Pi RPC command was rejected.'),
      );
    }
  }

  private abandonPending(id: string, error: PiRpcFailure): void {
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.removePending(id, pending);
    pending.reject(error);
    if (this.abandoned.size >= this.maxPendingRequests) {
      this.fail('connection');
      return;
    }
    this.abandoned.set(id, pending.command);
  }

  private rejectAll(error: PiRpcFailure): void {
    for (const [id, pending] of [...this.pending]) {
      this.removePending(id, pending);
      pending.reject(error);
    }
  }

  private removePending(id: string, pending: PendingRequest): void {
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (pending.abortListener !== undefined) {
      pending.signal?.removeEventListener('abort', pending.abortListener);
    }
  }

  private fail(kind: 'protocol' | 'connection'): void {
    if (this.closed) return;
    this.closed = true;
    this.abandoned.clear();
    this.rejectAll(
      new PiRpcFailure(kind, `Pi RPC ${kind} failure ended the connection.`),
    );
    if (kind === 'protocol') this.owner?.failProtocol();
    else this.owner?.failConnection('transport_ended');
    void this.transport.close().catch(() => undefined);
  }
}

class PiRpcFailure extends Error {
  constructor(
    readonly code:
      | 'aborted'
      | 'capacity'
      | 'connection'
      | 'protocol'
      | 'remote_rejected'
      | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'PiRpcFailure';
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
                'Pi Agent Run events already have a consumer.',
                { retryable: false, providerId: PI_PROVIDER_ID },
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
          'A Pi Agent Run event read is already pending.',
          { retryable: false, providerId: PI_PROVIDER_ID },
        ),
      );
    }
    return new Promise((resolveNext) => {
      this.waiter = resolveNext;
    });
  }
}

async function spawnPiPeer(
  profile: HarnessProfile,
  options: ResolvedOptions,
  state: PiSessionRefState,
  resumeId: ProviderSessionId | undefined,
  observe: (value: unknown) => void,
): Promise<PiRpcPeer> {
  if (profile.connection.kind !== 'process') throw profileInvalid(profile);
  const child = spawn(
    profile.connection.command,
    buildSessionArguments(profile, state, resumeId),
    {
      cwd: profile.connection.cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
    },
  );
  await processStarted(child);
  try {
    const transport = new JsonlProcessTransport({
      readable: child.stdout,
      writable: child.stdin,
      cleanup: () => terminateChild(child),
      ...options.transport,
    });
    return new PiRpcPeer(
      transport,
      options.maxPendingRequests,
      options.operationTimeoutMs,
      observe,
    );
  } catch (error) {
    try {
      await terminateChild(child);
    } catch {
      throw childCleanupFailure(profile);
    }
    throw error;
  }
}

async function probeRuntimeVersion(
  profile: HarnessProfile,
  timeoutMs: number,
): Promise<string> {
  if (profile.connection.kind !== 'process') throw profileInvalid(profile);
  const child = spawn(
    profile.connection.command,
    [...(profile.connection.args ?? []), '--version'],
    {
      cwd: profile.connection.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  await processStarted(child);
  const output = await collectVersionOutput(child, timeoutMs);
  return parsePiVersionOutput(output);
}

async function collectVersionOutput(
  child: PiVersionChild,
  timeoutMs: number,
): Promise<string> {
  try {
    return await waitForVersionOutput(child, timeoutMs);
  } catch (error) {
    await terminateChild(child);
    throw error;
  }
}

function waitForVersionOutput(
  child: PiVersionChild,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolveOutput, rejectOutput) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: PiRpcFailure): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error !== undefined) rejectOutput(error);
      else resolveOutput(Buffer.concat(chunks).toString('utf8'));
    };
    const onData = (chunk: Buffer | Uint8Array | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maximumVersionBytes) {
        finish(
          new PiRpcFailure('protocol', 'Pi version output exceeded its bound.'),
        );
        return;
      }
      chunks.push(buffer);
    };
    const onExit = (code: number | null): void => {
      finish(
        code === 0
          ? undefined
          : new PiRpcFailure(
              'connection',
              'Pi version probe exited unsuccessfully.',
            ),
      );
    };
    const onError = (): void => {
      finish(new PiRpcFailure('connection', 'Pi version probe failed.'));
    };
    const timer = setTimeout(() => {
      finish(new PiRpcFailure('timeout', 'Pi version probe timed out.'));
    }, timeoutMs);
    timer.unref();
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function processStarted(
  child: PiChild | PiVersionChild | ChildProcessWithoutNullStreams,
): Promise<void> {
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

async function terminateChild(child: PiOwnedChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (await waitForChildExit(child, childTerminationTimeoutMs)) return;
  child.kill('SIGKILL');
  if (await waitForChildExit(child, childTerminationTimeoutMs)) return;
  throw new Error('Pi Agent child process did not exit.');
}

function waitForChildExit(
  child: PiOwnedChild,
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

function piCapabilities(
  profile: HarnessProfile,
  options: ResolvedOptions,
  runtimeIdentity: string,
  interactionObserved: boolean,
): CapabilityManifest {
  const native: CapabilityStatus = { mode: 'native', source: 'schema' };
  const unsupportedStatus: CapabilityStatus = {
    mode: 'unsupported',
    source: 'schema',
  };
  return {
    providerId: PI_PROVIDER_ID,
    profileId: profile.profileId,
    capabilities: {
      'session.create': native,
      'session.resume': options.persistSessions ? native : unsupportedStatus,
      'session.close': {
        mode: 'adapter_controlled',
        reason: 'Closing the process does not delete the native Pi Session.',
        source: 'configuration',
      },
      'session.workspace': unsupportedStatus,
      'session.fork': unsupportedStatus,
      'run.stream': native,
      'run.cancel': native,
      'run.timeout': {
        mode: 'emulated',
        reason: 'A local timer requests native Pi abort.',
        source: 'configuration',
      },
      'run.concurrent': {
        mode: 'unsupported',
        limits: { perSession: 1 },
        source: 'configuration',
      },
      'connection.abort': {
        mode: 'adapter_controlled',
        source: 'configuration',
      },
      'input.text': native,
      'input.image': unsupportedStatus,
      'input.file': unsupportedStatus,
      'interaction.approval': unsupportedStatus,
      'interaction.user_input': unsupportedStatus,
      'interaction.provider': interactionObserved
        ? native
        : {
            mode: 'unknown',
            reason:
              'Pi extension UI interactions are runtime-extension dependent.',
            source: 'schema',
          },
      'event.raw': { mode: 'adapter_controlled', source: 'configuration' },
      'native.client': native,
    },
    observedAt: new Date().toISOString(),
    runtimeIdentity,
  };
}

function connectionOptions(
  value: Readonly<Record<string, unknown>> | undefined,
  profile: HarnessProfile,
): ResolvedOptions {
  const options = value ?? {};
  const allowed = new Set([
    'cancelSettlementTimeoutMs',
    'maxBufferedMessages',
    'maxMessageBytes',
    'maxPendingInteractions',
    'maxPendingRequests',
    'maxPendingWrites',
    'maxRunEvents',
    'operationTimeoutMs',
    'persistSessions',
    'writeTimeoutMs',
  ]);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw profileInvalid(profile);
  }
  if (
    options['persistSessions'] !== undefined &&
    typeof options['persistSessions'] !== 'boolean'
  ) {
    throw profileInvalid(profile);
  }
  const maxRunEvents =
    options['maxRunEvents'] === undefined
      ? defaultMaxRunEvents
      : positiveInteger(options['maxRunEvents'], profile);
  if (maxRunEvents < 2 || maxRunEvents > maximumRunEvents) {
    throw profileInvalid(profile);
  }
  const transport: Record<string, number> = {};
  for (const key of [
    'maxBufferedMessages',
    'maxMessageBytes',
    'maxPendingWrites',
    'writeTimeoutMs',
  ] as const) {
    const option = options[key];
    if (option !== undefined) transport[key] = positiveInteger(option, profile);
  }
  return {
    cancelSettlementTimeoutMs:
      options['cancelSettlementTimeoutMs'] === undefined
        ? defaultCancelSettlementTimeoutMs
        : positiveTimer(
            options['cancelSettlementTimeoutMs'],
            'cancel settlement timeout',
            profile,
          ),
    maxPendingInteractions:
      options['maxPendingInteractions'] === undefined
        ? defaultMaxPendingInteractions
        : positiveInteger(options['maxPendingInteractions'], profile),
    maxPendingRequests:
      options['maxPendingRequests'] === undefined
        ? defaultMaxPendingRequests
        : positiveInteger(options['maxPendingRequests'], profile),
    maxRunEvents,
    operationTimeoutMs:
      options['operationTimeoutMs'] === undefined
        ? defaultOperationTimeoutMs
        : positiveTimer(
            options['operationTimeoutMs'],
            'operation timeout',
            profile,
          ),
    persistSessions: options['persistSessions'] !== false,
    transport,
  };
}

function validateProfile(profile: HarnessProfile): void {
  if (
    profile.providerId !== PI_PROVIDER_ID ||
    profile.connection.kind !== 'process' ||
    profile.connection.ownership !== 'adapter' ||
    profile.connection.command.length === 0 ||
    !isAbsolute(profile.connection.command) ||
    profile.connection.envRefs !== undefined ||
    (profile.connection.args ?? []).some((argument) => {
      const name = argument.split('=', 1)[0];
      return name === '--' || forbiddenRuntimeArguments.has(name ?? argument);
    })
  ) {
    throw profileInvalid(profile);
  }
}

function prepareSessionInput(
  input: CreateSessionInput,
  profile: HarnessProfile,
  options: ResolvedOptions,
): PiSessionRefState {
  if (
    input.workspace !== undefined ||
    input.systemContext !== undefined ||
    input.model !== undefined ||
    input.providerOptions !== undefined ||
    input.metadata !== undefined
  ) {
    throw new HarnessError(
      'unsupported_capability',
      'Pi Session creation does not map portable Session options.',
      {
        retryable: false,
        providerId: PI_PROVIDER_ID,
        profileId: profile.profileId,
        details: { capability: 'session.create.options' },
      },
    );
  }
  return {
    strategy: 'isolated-process',
    persisted: options.persistSessions,
  };
}

function sessionStateFromRef(ref: SessionRef): PiSessionRefState {
  const state = record(ref.providerState);
  if (
    state?.['strategy'] !== 'isolated-process' ||
    typeof state['persisted'] !== 'boolean' ||
    Object.keys(state).some((key) => key !== 'strategy' && key !== 'persisted')
  ) {
    throw new HarnessError(
      'session_provider_mismatch',
      'Pi Session reference has incompatible native state.',
      { retryable: false, providerId: PI_PROVIDER_ID },
    );
  }
  return {
    strategy: 'isolated-process',
    persisted: state['persisted'],
  };
}

function buildSessionArguments(
  profile: HarnessProfile,
  state: PiSessionRefState,
  resumeId: ProviderSessionId | undefined,
): string[] {
  const args = [
    ...(profile.connection.kind === 'process'
      ? (profile.connection.args ?? [])
      : []),
  ];
  args.push(
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--mode',
    'rpc',
  );
  if (!state.persisted) args.push('--no-session');
  if (resumeId !== undefined) args.push('--session', resumeId);
  return args;
}

function validateRunOptions(options: RunOptions): void {
  if (options.providerOptions !== undefined || options.metadata !== undefined) {
    throw new HarnessError(
      'unsupported_capability',
      'Pi Agent Run Provider options and metadata are not mapped.',
      {
        retryable: false,
        providerId: PI_PROVIDER_ID,
        details: { capability: 'run.options' },
      },
    );
  }
  validateRunTimeout(options.timeoutMs);
}

function validateRunTimeout(value: number | undefined): void {
  if (value === undefined) return;
  positiveTimer(value, 'Run timeout');
}

function prepareInteractionResponse(
  pending: PendingInteraction,
  value: unknown,
): JsonlMessage {
  const response = record(value);
  if (response?.['cancelled'] === true && Object.keys(response).length === 1) {
    return {
      type: 'extension_ui_response',
      id: pending.nativeId,
      cancelled: true,
    };
  }
  if (
    pending.method === 'confirm' &&
    typeof response?.['confirmed'] === 'boolean' &&
    Object.keys(response).length === 1
  ) {
    return {
      type: 'extension_ui_response',
      id: pending.nativeId,
      confirmed: response['confirmed'],
    };
  }
  if (
    pending.method !== 'confirm' &&
    typeof response?.['value'] === 'string' &&
    Object.keys(response).length === 1
  ) {
    return {
      type: 'extension_ui_response',
      id: pending.nativeId,
      value: response['value'],
    };
  }
  throw new HarnessError(
    'invalid_request',
    'Pi interaction response does not match the requested method.',
    { retryable: false, providerId: PI_PROVIDER_ID },
  );
}

function interactionSchema(
  method: PendingInteraction['method'],
  value: JsonlMessage,
): Readonly<Record<string, unknown>> {
  if (method === 'confirm') return { method, response: 'confirmed' };
  if (method === 'select') {
    const options = Array.isArray(value['options'])
      ? value['options']
          .filter((option): option is string => typeof option === 'string')
          .slice(0, 64)
          .map((option) => option.slice(0, 128))
      : [];
    return { method, options, response: 'value' };
  }
  return { method, response: 'value' };
}

function boundedText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, 256)
    : undefined;
}

function positiveInteger(value: unknown, profile?: HarnessProfile): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    if (profile !== undefined) throw profileInvalid(profile);
    throw new PiRpcFailure('protocol', 'Pi RPC limit is invalid.');
  }
  return value;
}

function positiveTimer(
  value: unknown,
  label: string,
  profile?: HarnessProfile,
): number {
  const result = positiveInteger(value, profile);
  if (result > maximumTimerMilliseconds) {
    if (profile !== undefined) throw profileInvalid(profile);
    throw new PiRpcFailure('protocol', `Pi ${label} is invalid.`);
  }
  return result;
}

function invalidInteraction(profile: HarnessProfile): HarnessError {
  return new HarnessError(
    'invalid_request',
    'Pi interaction response does not match an active Provider request.',
    {
      retryable: false,
      providerId: PI_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function unsupported(
  profile: HarnessProfile,
  capability: string,
  message: string,
): HarnessError {
  return new HarnessError('unsupported_capability', message, {
    retryable: false,
    providerId: PI_PROVIDER_ID,
    profileId: profile.profileId,
    details: { capability },
  });
}

function profileInvalid(profile: HarnessProfile): HarnessError {
  return new HarnessError(
    'profile_invalid',
    'Pi Agent requires an absolute adapter-owned process command without unresolved secrets or lifecycle-conflicting arguments.',
    {
      retryable: false,
      providerId: PI_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function childCleanupFailure(profile: HarnessProfile): HarnessError {
  return new HarnessError(
    'connection_aborted',
    'Pi Agent child process cleanup could not be confirmed.',
    {
      retryable: false,
      providerId: PI_PROVIDER_ID,
      profileId: profile.profileId,
      providerCode: 'child_cleanup_failed',
    },
  );
}

function isChildCleanupFailure(error: unknown): error is HarnessError {
  return (
    error instanceof HarnessError &&
    error.providerCode === 'child_cleanup_failed'
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
      ...(profile.connection.kind === 'process'
        ? { cwd: resolve(profile.connection.cwd ?? process.cwd()) }
        : {}),
    },
    ...(profile.providerOptions === undefined
      ? {}
      : { providerOptions: { ...profile.providerOptions } }),
  };
}

function mapError(
  error: unknown,
  profile: HarnessProfile,
  phase: string,
  connecting = false,
): HarnessError {
  if (error instanceof HarnessError) return error;
  const systemCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (connecting && systemCode === 'ENOENT') {
    return new HarnessError(
      'runtime_not_found',
      'The configured Pi Agent runtime was not found.',
      {
        retryable: false,
        providerId: PI_PROVIDER_ID,
        profileId: profile.profileId,
      },
    );
  }
  if (error instanceof PiRpcFailure) {
    const code =
      error.code === 'protocol'
        ? 'provider_api_incompatible'
        : error.code === 'timeout' || error.code === 'aborted'
          ? 'timeout'
          : error.code === 'remote_rejected'
            ? 'provider_error'
            : error.code === 'capacity'
              ? 'provider_error'
              : connecting
                ? 'connection_failed'
                : 'connection_aborted';
    return new HarnessError(code, `Pi Agent ${phase} did not complete.`, {
      retryable: error.code === 'timeout',
      providerId: PI_PROVIDER_ID,
      profileId: profile.profileId,
      providerCode: error.code,
    });
  }
  if (error instanceof JsonlTransportError) {
    return new HarnessError(
      connecting ? 'connection_failed' : 'connection_aborted',
      `Pi Agent ${phase} did not complete.`,
      {
        retryable: false,
        providerId: PI_PROVIDER_ID,
        profileId: profile.profileId,
        providerCode: error.code,
      },
    );
  }
  return new HarnessError(
    connecting ? 'connection_failed' : 'provider_error',
    `Pi Agent ${phase} did not complete.`,
    {
      retryable: false,
      providerId: PI_PROVIDER_ID,
      profileId: profile.profileId,
    },
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
