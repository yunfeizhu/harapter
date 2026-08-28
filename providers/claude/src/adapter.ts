import { randomUUID } from 'node:crypto';
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
  type InteractionRequest,
  type InteractionResponse,
  type ProviderAdapterFactory,
  type ProviderDescriptor,
  type RunOptions,
  type RunRef,
  type RunResult,
  type SessionRef,
} from '@harapter/core';
import {
  CLAUDE_PROVIDER_ID,
  CLAUDE_SESSION_COMPATIBILITY_REF,
  claudeInteractionRequest,
  claudeSessionStateFromRef,
  createClaudeEventState,
  mapClaudeSdkMessage,
  prepareClaudeSession,
  prepareClaudeUserMessage,
  redactClaudeSdkValue,
  snapshotClaudeSessionState,
  type ClaudeInitObservation,
  type ClaudeMappedEvent,
  type ClaudeSessionState,
} from './protocol.js';
import {
  createClaudeNativeClient,
  isClaudeSdkBinding,
  loadOfficialClaudeSdkBinding,
  parseClaudeSdkSessionInfo,
  type ClaudeNativeClient,
  type ClaudeSdkBinding,
  type ClaudeSdkPermissionResult,
  type ClaudeSdkQuery,
  type ClaudeSdkQueryOptions,
} from './sdk.js';

const descriptor: ProviderDescriptor = {
  providerId: CLAUDE_PROVIDER_ID,
  displayName: 'Claude Agent SDK',
  connectionKinds: ['sdk'],
  documentationUrl: 'https://code.claude.com/docs/en/agent-sdk/overview',
};

const defaultCancelSettlementTimeoutMs = 10_000;
const defaultInitializationTimeoutMs = 10_000;
const defaultMaxRunEvents = 128;
const maximumRunEventCapacity = 4_096;
const maximumTimerMilliseconds = 2_147_483_647;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Injectable dependencies for tests and host-controlled SDK loading. */
export interface ClaudeProviderFactoryOptions {
  readonly binding?: ClaudeSdkBinding;
  readonly createUuid?: () => string;
  readonly now?: () => string;
}

/** Connection limits accepted in a Claude SDK Profile. */
export interface ClaudeProfileOptions {
  readonly cancelSettlementTimeoutMs?: number;
  readonly initializationTimeoutMs?: number;
  readonly maxRunEvents?: number;
}

interface ValidatedProfileOptions {
  readonly cancelSettlementTimeoutMs: number;
  readonly initializationTimeoutMs: number;
  readonly maxRunEvents: number;
}

interface ValidatedRunOptions {
  readonly maxBudgetUsd?: number;
  readonly maxTurns?: number;
  readonly timeoutMs?: number;
}

interface PendingInteraction {
  readonly input: Readonly<Record<string, unknown>>;
  readonly request: InteractionRequest;
  readonly resolve: (result: ClaudeSdkPermissionResult) => void;
  readonly run: ClaudeRun;
  readonly toolName: string;
}

/** Create the independently registered Claude Agent SDK Provider factory. */
export function createClaudeProviderFactory(
  options: ClaudeProviderFactoryOptions = {},
): ProviderAdapterFactory {
  const createUuid = options.createUuid ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    descriptor: () => cloneDescriptor(descriptor),
    connect: async (profile) => {
      validateProfile(profile);
      const binding = await resolveBinding(profile, options.binding);
      return new ClaudeClient(
        profile,
        binding,
        validateProfileOptions(profile.providerOptions),
        createUuid,
        now,
      );
    },
  };
}

class ClaudeClient implements HarnessClient {
  readonly #activeBySession = new Map<string, ClaudeRun>();
  readonly #binding: ClaudeSdkBinding;
  readonly #createUuid: () => string;
  readonly #extensions = new ExtensionRegistry(CLAUDE_PROVIDER_ID);
  readonly #now: () => string;
  readonly #options: ValidatedProfileOptions;
  readonly #pendingInteractions = new Map<string, PendingInteraction>();
  readonly #profile: HarnessProfile;
  readonly #quarantinedSessions = new Set<string>();
  readonly #sessions = new Map<string, ClaudeSession>();
  #closed = false;
  #observedCapabilities: readonly string[] = [];
  #observedClaudeCodeVersion: string | undefined;

  constructor(
    profile: HarnessProfile,
    binding: ClaudeSdkBinding,
    options: ValidatedProfileOptions,
    createUuid: () => string,
    now: () => string,
  ) {
    this.#profile = profile;
    this.#binding = binding;
    this.#options = options;
    this.#createUuid = createUuid;
    this.#now = now;
  }

  descriptor(): Promise<ClientDescriptor> {
    return Promise.resolve({
      providerId: CLAUDE_PROVIDER_ID,
      profileId: this.#profile.profileId,
      displayName: this.#profile.displayName,
      connectionKind: 'sdk',
      runtime: {
        name: 'Claude Agent SDK',
        version: this.#binding.sdkVersion,
        protocol: 'query() streaming input',
        protocolVersion: 'stable',
      },
      compatibility:
        this.#observedClaudeCodeVersion === undefined
          ? 'experimental'
          : 'supported',
      ...(this.#observedClaudeCodeVersion === undefined
        ? {
            warnings: [
              {
                code: 'runtime_unobserved',
                message:
                  'The SDK-managed Claude runtime is observed on the first Run.',
              },
            ],
          }
        : {}),
    });
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(
      claudeCapabilities(
        this.#profile,
        this.#runtimeIdentity(),
        this.#now(),
        this.#observedCapabilities,
      ),
    );
  }

  createSession(input: CreateSessionInput = {}): Promise<HarnessSession> {
    return Promise.resolve().then(() => {
      this.#assertOpen();
      const sessionId = this.#createUuid();
      if (!uuidPattern.test(sessionId) || this.#sessions.has(sessionId)) {
        throw new HarnessError(
          'provider_api_incompatible',
          'Claude Session ID generation did not produce a unique UUID.',
          {
            retryable: false,
            providerId: CLAUDE_PROVIDER_ID,
            profileId: this.#profile.profileId,
            providerCode: 'session_id',
          },
        );
      }
      return this.#addSession(sessionId, prepareClaudeSession(input));
    });
  }

  async resumeSession(ref: SessionRef): Promise<HarnessSession> {
    this.#assertOpen();
    assertSessionOwnership(ref, CLAUDE_PROVIDER_ID, this.#profile.profileId);
    assertSessionCompatibility(ref, CLAUDE_SESSION_COMPATIBILITY_REF);
    const sessionId = String(ref.providerSessionId);
    if (!uuidPattern.test(sessionId)) {
      throw new HarnessError(
        'session_provider_mismatch',
        'Claude Session ID is not compatible with the SDK.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
        },
      );
    }
    const state = claudeSessionStateFromRef(ref);
    if (this.#quarantinedSessions.has(sessionId)) {
      throw this.#quarantinedError();
    }
    const existing = this.#sessions.get(sessionId);
    if (existing !== undefined) return existing;
    let nativeInfo: unknown;
    try {
      nativeInfo = await this.#binding.getSessionInfo(sessionId, {
        ...(state.cwd === undefined ? {} : { dir: state.cwd }),
      });
    } catch {
      throw new HarnessError(
        'connection_failed',
        'Claude SDK could not inspect the requested Session.',
        {
          retryable: true,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
          providerCode: 'get_session_info',
        },
      );
    }
    this.#assertOpen();
    if (this.#quarantinedSessions.has(sessionId)) {
      throw this.#quarantinedError();
    }
    if (nativeInfo === undefined) {
      if (!state.materialized) return this.#addSession(sessionId, state);
      throw new HarnessError(
        'session_not_found',
        'Claude SDK did not find the requested Session.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
        },
      );
    }
    const info = parseClaudeSdkSessionInfo(nativeInfo);
    if (info === undefined) {
      throw new HarnessError(
        'provider_api_incompatible',
        'Claude SDK returned incompatible Session information.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
          providerCode: 'session_info_shape',
        },
      );
    }
    if (info.sessionId !== sessionId) {
      throw new HarnessError(
        'session_not_found',
        'Claude SDK did not find the requested Session.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
        },
      );
    }
    if (
      state.cwd !== undefined &&
      info.cwd !== undefined &&
      state.cwd !== info.cwd
    ) {
      throw new HarnessError(
        'session_provider_mismatch',
        'Claude Session workspace does not match the creating Session.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
        },
      );
    }
    const resumedCwd = state.cwd ?? info.cwd;
    if (resumedCwd === undefined) {
      throw new HarnessError(
        'session_provider_mismatch',
        'Claude Session workspace cannot be proven for native resume.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
        },
      );
    }
    return this.#addSession(sessionId, {
      ...state,
      cwd: resumedCwd,
      materialized: true,
    });
  }

  extensions(): ExtensionRegistry {
    return this.#extensions;
  }

  native<T = unknown>(guard?: (value: unknown) => value is T): T | undefined {
    const value: unknown = createClaudeNativeClient(
      this.#runtimeIdentity(),
      this.#binding,
    );
    if (guard !== undefined && !guard(value)) return undefined;
    return value as T;
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    for (const run of [...this.#activeBySession.values()]) {
      run.abortConnection('client_closed');
    }
    for (const session of this.#sessions.values()) session.markClosed();
    this.#sessions.clear();
    return Promise.resolve();
  }

  start(
    session: ClaudeSession,
    input: HarnessInput,
    options: RunOptions = {},
  ): Promise<HarnessRun> {
    return Promise.resolve().then(() => {
      this.#assertOpen();
      session.assertOpen();
      const sessionId = session.sessionId;
      if (this.#quarantinedSessions.has(sessionId)) {
        throw this.#quarantinedError();
      }
      if (this.#activeBySession.has(sessionId)) {
        throw new HarnessError(
          'run_conflict',
          'Claude Session already has an active Run.',
          {
            retryable: true,
            providerId: CLAUDE_PROVIDER_ID,
            profileId: this.#profile.profileId,
          },
        );
      }
      const runOptions = validateRunOptions(options);
      const runIdentifier = runId(this.#createUuid());
      const message = prepareClaudeUserMessage(input, this.#createUuid());
      const run = new ClaudeRun(
        this,
        session,
        runIdentifier,
        message,
        runOptions,
      );
      this.#activeBySession.set(sessionId, run);
      try {
        run.begin();
        return run;
      } catch {
        this.#activeBySession.delete(sessionId);
        throw mapStartupError(this.#profile);
      }
    });
  }

  respond(
    session: ClaudeSession,
    requestId: string,
    response: InteractionResponse,
  ): Promise<void> {
    return Promise.resolve().then(() => {
      session.assertOpen();
      const pending = this.#pendingInteractions.get(requestId);
      if (pending?.run.sessionId !== session.sessionId) {
        throw new HarnessError(
          'invalid_request',
          'Claude interaction request is not pending for this Session.',
          {
            retryable: false,
            providerId: CLAUDE_PROVIDER_ID,
            profileId: this.#profile.profileId,
          },
        );
      }
      const result = interactionResult(pending, response);
      if (!this.#pendingInteractions.delete(requestId)) {
        throw new HarnessError(
          'invalid_request',
          'Claude interaction request has already been claimed.',
          {
            retryable: false,
            providerId: CLAUDE_PROVIDER_ID,
            profileId: this.#profile.profileId,
          },
        );
      }
      if (!pending.run.emitInteractionResolved(requestId, response)) {
        pending.resolve(deniedPermission(true));
        if (!pending.run.isTerminal) {
          pending.run.abortConnection('event_buffer_overflow');
        }
        return;
      }
      pending.resolve(result);
    });
  }

  closeSession(session: ClaudeSession): void {
    if (session.isClosed) return;
    session.markClosed();
    const active = this.#activeBySession.get(session.sessionId);
    active?.abortConnection('session_closed');
    this.#sessions.delete(session.sessionId);
  }

  queryOptions(
    session: ClaudeSession,
    run: ClaudeRun,
    runOptions: ValidatedRunOptions,
    abortController: AbortController,
  ): ClaudeSdkQueryOptions {
    const state = session.state;
    return {
      abortController,
      ...(state.allowedTools === undefined
        ? {}
        : { allowedTools: [...state.allowedTools] }),
      canUseTool: async (toolName, input, options) =>
        this.#requestInteraction(run, toolName, input, options),
      ...(state.cwd === undefined ? {} : { cwd: state.cwd }),
      includePartialMessages: true,
      ...(runOptions.maxBudgetUsd === undefined
        ? {}
        : { maxBudgetUsd: runOptions.maxBudgetUsd }),
      ...(runOptions.maxTurns === undefined
        ? {}
        : { maxTurns: runOptions.maxTurns }),
      ...(state.model === undefined ? {} : { model: state.model }),
      permissionMode: state.permissionMode,
      ...(state.materialized
        ? { resume: session.sessionId }
        : { sessionId: session.sessionId }),
      settingSources: [],
      ...(state.systemPrompt === undefined
        ? {}
        : { systemPrompt: state.systemPrompt }),
    };
  }

  createQuery(
    prompt: AsyncIterable<Readonly<Record<string, unknown>>>,
    options: ClaudeSdkQueryOptions,
  ): ClaudeSdkQuery {
    return this.#binding.query({ prompt, options });
  }

  observeInit(
    session: ClaudeSession,
    observation: ClaudeInitObservation,
  ): void {
    if (
      session.state.cwd !== undefined &&
      session.state.cwd !== observation.cwd
    ) {
      throw new HarnessError(
        'provider_api_incompatible',
        'Claude SDK initialized the Session in a different workspace.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
          providerCode: 'cwd_mismatch',
        },
      );
    }
    if (
      session.state.model !== undefined &&
      session.state.model !== observation.model
    ) {
      throw new HarnessError(
        'provider_api_incompatible',
        'Claude SDK initialized the Session with a different model.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
          providerCode: 'model_mismatch',
        },
      );
    }
    if (session.state.permissionMode !== observation.permissionMode) {
      throw new HarnessError(
        'provider_api_incompatible',
        'Claude SDK initialized the Session with a different permission mode.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
          providerCode: 'permission_mode_mismatch',
        },
      );
    }
    session.observeWorkspace(observation.cwd);
    this.#observedClaudeCodeVersion = observation.claudeCodeVersion;
    this.#observedCapabilities = [...observation.capabilities];
  }

  finishRun(run: ClaudeRun, uncertain: boolean): void {
    this.#activeBySession.delete(run.sessionId);
    if (uncertain) this.#quarantinedSessions.add(run.sessionId);
    this.#resolveRunInteractions(run);
  }

  profile(): HarnessProfile {
    return this.#profile;
  }

  maxRunEvents(): number {
    return this.#options.maxRunEvents;
  }

  cancelSettlementTimeoutMs(): number {
    return this.#options.cancelSettlementTimeoutMs;
  }

  initializationTimeoutMs(): number {
    return this.#options.initializationTimeoutMs;
  }

  now(): string {
    return this.#now();
  }

  async #requestInteraction(
    run: ClaudeRun,
    toolNameValue: unknown,
    inputValue: unknown,
    optionsValue: unknown,
  ): Promise<ClaudeSdkPermissionResult> {
    if (run.hasTerminated()) return deniedPermission(true);
    if (!(await run.waitForInitialization())) return deniedPermission(true);
    if (run.hasTerminated()) return deniedPermission(true);
    const mapped = claudeInteractionRequest(
      toolNameValue,
      inputValue,
      optionsValue,
    );
    if (this.#pendingInteractions.has(mapped.request.requestId)) {
      throw new HarnessError(
        'provider_api_incompatible',
        'Claude SDK reused an active interaction request ID.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
          providerCode: 'interaction_duplicate',
        },
      );
    }
    const optionsRecord = optionsValue as Readonly<Record<string, unknown>>;
    const signal = optionsRecord['signal'];
    if (!(signal instanceof AbortSignal)) {
      throw new HarnessError(
        'provider_api_incompatible',
        'Claude permission callback did not include an AbortSignal.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
          providerCode: 'interaction_signal',
        },
      );
    }

    return new Promise<ClaudeSdkPermissionResult>((resolve) => {
      let settled = false;
      const settle = (result: ClaudeSdkPermissionResult): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = (): void => {
        const pending = this.#pendingInteractions.get(mapped.request.requestId);
        if (pending?.run !== run) return;
        this.#pendingInteractions.delete(mapped.request.requestId);
        if (
          !run.emitInteractionResolved(mapped.request.requestId, {
            kind: 'approval',
            decision: 'deny',
          }) &&
          !run.isTerminal
        ) {
          run.abortConnection('event_buffer_overflow');
        }
        settle(deniedPermission(true));
      };
      this.#pendingInteractions.set(mapped.request.requestId, {
        input: mapped.input,
        request: mapped.request,
        resolve: settle,
        run,
        toolName: mapped.toolName,
      });
      signal.addEventListener('abort', onAbort, { once: true });
      if (!run.emitInteractionRequested(mapped.request)) {
        this.#pendingInteractions.delete(mapped.request.requestId);
        if (!run.isTerminal) run.abortConnection('event_buffer_overflow');
        settle(deniedPermission(true));
        return;
      }
      if (signal.aborted) onAbort();
    });
  }

  #resolveRunInteractions(run: ClaudeRun): void {
    for (const [requestId, pending] of this.#pendingInteractions) {
      if (pending.run !== run) continue;
      this.#pendingInteractions.delete(requestId);
      if (
        !run.emitInteractionResolved(requestId, {
          kind: 'approval',
          decision: 'deny',
        }) &&
        !run.isTerminal
      ) {
        run.abortConnection('event_buffer_overflow');
      }
      pending.resolve(deniedPermission(true));
    }
  }

  #runtimeIdentity(): string {
    return [
      `provider=${CLAUDE_PROVIDER_ID}`,
      'strategy=agent-sdk-query',
      `sdk=${this.#binding.sdkVersion}`,
      `runtime=${this.#observedClaudeCodeVersion ?? 'unobserved'}`,
    ].join(';');
  }

  #addSession(sessionId: string, state: ClaudeSessionState): ClaudeSession {
    if (this.#sessions.has(sessionId)) {
      throw new HarnessError(
        'run_conflict',
        'Claude Session is already open on this Client.',
        {
          retryable: true,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
        },
      );
    }
    const session = new ClaudeSession(this, sessionId, state);
    this.#sessions.set(sessionId, session);
    return session;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new HarnessError(
        'connection_aborted',
        'Claude SDK Client is closed.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#profile.profileId,
        },
      );
    }
  }

  #quarantinedError(): HarnessError {
    return new HarnessError(
      'connection_aborted',
      'Claude Session state is uncertain after a local connection abort.',
      {
        retryable: false,
        providerId: CLAUDE_PROVIDER_ID,
        profileId: this.#profile.profileId,
        providerCode: 'session_quarantined',
      },
    );
  }
}

class ClaudeSession implements HarnessSession {
  readonly #client: ClaudeClient;
  readonly sessionId: string;
  #closed = false;
  #state: ClaudeSessionState;

  constructor(
    client: ClaudeClient,
    sessionId: string,
    state: ClaudeSessionState,
  ) {
    this.#client = client;
    this.sessionId = sessionId;
    this.#state = state;
  }

  get state(): ClaudeSessionState {
    return this.#state;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  ref(): SessionRef {
    const profile = this.#client.profile();
    return {
      providerId: CLAUDE_PROVIDER_ID,
      profileId: profile.profileId,
      providerSessionId: providerSessionId(this.sessionId),
      compatibilityRef: CLAUDE_SESSION_COMPATIBILITY_REF,
      providerState: snapshotClaudeSessionState(this.#state),
    };
  }

  capabilities(): Promise<CapabilityManifest> {
    return this.#client.capabilities();
  }

  start(input: HarnessInput, options?: RunOptions): Promise<HarnessRun> {
    return this.#client.start(this, input, options);
  }

  respond(requestId: string, response: InteractionResponse): Promise<void> {
    return this.#client.respond(this, requestId, response);
  }

  close(): Promise<void> {
    this.#client.closeSession(this);
    return Promise.resolve();
  }

  markClosed(): void {
    this.#closed = true;
  }

  assertOpen(): void {
    if (this.#closed) {
      throw new HarnessError(
        'connection_aborted',
        'Claude Session is closed.',
        {
          retryable: false,
          providerId: CLAUDE_PROVIDER_ID,
          profileId: this.#client.profile().profileId,
        },
      );
    }
  }

  observeWorkspace(cwd: string): void {
    this.#state = {
      ...this.#state,
      cwd,
    };
  }

  markMaterialized(): void {
    this.#state = {
      ...this.#state,
      materialized: true,
    };
  }
}

class ClaudeRun implements HarnessRun {
  readonly #abortController = new AbortController();
  readonly #client: ClaudeClient;
  readonly #eventState = createClaudeEventState();
  readonly #events: EventQueue;
  readonly #initialization = deferred<boolean>();
  readonly #message: Readonly<Record<string, unknown>>;
  readonly #options: ValidatedRunOptions;
  readonly #prompt: SingleMessagePrompt;
  readonly #result = deferred<RunResult>();
  readonly #runId: ReturnType<typeof runId>;
  readonly #session: ClaudeSession;
  #cancelPromise: Promise<CancelResult> | undefined;
  #connectionAbortStarted = false;
  #initialized = false;
  #interruptGate:
    | {
        readonly promise: Promise<boolean>;
        readonly resolve: (value: boolean) => void;
      }
    | undefined;
  #nativeInterruptAcknowledged = false;
  #query: ClaudeSdkQuery | undefined;
  #terminal = false;
  #timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    client: ClaudeClient,
    session: ClaudeSession,
    identifier: ReturnType<typeof runId>,
    message: Readonly<Record<string, unknown>>,
    options: ValidatedRunOptions,
  ) {
    this.#client = client;
    this.#session = session;
    this.#runId = identifier;
    this.#message = message;
    this.#options = options;
    this.#events = new EventQueue(client.maxRunEvents());
    this.#prompt = new SingleMessagePrompt(message);
  }

  get sessionId(): string {
    return this.#session.sessionId;
  }

  get isTerminal(): boolean {
    return this.#terminal;
  }

  hasTerminated(): boolean {
    return this.#terminal;
  }

  hasInitialized(): boolean {
    return this.#initialized;
  }

  begin(): void {
    this.#emit({ type: 'run.started', data: {} });
    const queryOptions = this.#client.queryOptions(
      this.#session,
      this,
      this.#options,
      this.#abortController,
    );
    this.#query = this.#client.createQuery(this.#prompt, queryOptions);
    if (this.#terminal) {
      this.#closeQuery();
      return;
    }
    if (this.#options.timeoutMs !== undefined) {
      this.#timeout = setTimeout(() => {
        this.abortConnection('run_timeout');
      }, this.#options.timeoutMs);
    }
    void this.#pump();
  }

  ref(): RunRef {
    const profile = this.#client.profile();
    return {
      providerId: CLAUDE_PROVIDER_ID,
      profileId: profile.profileId,
      sessionId: providerSessionId(this.sessionId),
      runId: this.#runId,
      providerRunId: String(this.#message['uuid']),
    };
  }

  events(): AsyncIterable<HarnessEvent> {
    return this.#events.iterable();
  }

  cancel(): Promise<CancelResult> {
    if (this.#terminal) return Promise.resolve({ mode: 'already_terminal' });
    this.#cancelPromise ??= this.#cancel();
    return this.#cancelPromise;
  }

  result(): Promise<RunResult> {
    return this.#result.promise;
  }

  abortConnection(providerCode: string): void {
    if (this.#terminal || this.#connectionAbortStarted) return;
    this.#connectionAbortStarted = true;
    this.#abortController.abort();
    this.#closeQuery();
    this.#finish(
      { status: 'connection_aborted' },
      'connection.aborted',
      { providerCode },
      true,
    );
  }

  failProtocol(providerCode: string): void {
    if (this.#terminal) return;
    this.#abortController.abort();
    this.#closeQuery();
    this.#finish(
      {
        status: 'failed',
        providerResult: {
          code: 'provider_api_incompatible',
          providerCode,
        },
      },
      'run.failed',
      { code: 'provider_api_incompatible', providerCode },
      true,
    );
  }

  async waitForInitialization(): Promise<boolean> {
    if (this.#initialized) return true;
    if (this.#terminal) return false;
    const deadline = createDeadline(this.#client.initializationTimeoutMs());
    try {
      const outcome = await Promise.race([
        this.#initialization.promise.then(
          (initialized) => ({ kind: 'initialization', initialized }) as const,
        ),
        deadline.promise,
      ]);
      if (outcome.kind === 'initialization') return outcome.initialized;
      if (this.hasInitialized()) return true;
      if (!this.hasTerminated()) this.failProtocol('interaction_before_init');
      return false;
    } finally {
      deadline.cancel();
    }
  }

  emitInteractionRequested(request: InteractionRequest): boolean {
    if (this.#terminal) return false;
    return this.#emit({ type: 'interaction.requested', data: request });
  }

  emitInteractionResolved(
    requestId: string,
    response: InteractionResponse,
  ): boolean {
    if (this.#terminal) return false;
    return this.#emit({
      type: 'interaction.resolved',
      data: {
        requestId,
        kind: response.kind,
        ...(response.kind === 'approval'
          ? { decision: response.decision }
          : {}),
      },
    });
  }

  async #cancel(): Promise<CancelResult> {
    const query = this.#query;
    if (query === undefined) return { mode: 'already_terminal' };
    const deadline = createDeadline(this.#client.cancelSettlementTimeoutMs());
    const interruptGate = deferred<boolean>();
    this.#interruptGate = interruptGate;
    const interrupt = Promise.resolve()
      .then(() => query.interrupt())
      .then(
        () => ({ kind: 'acknowledged' }) as const,
        () => ({ kind: 'rejected' }) as const,
      );
    try {
      const first = await Promise.race([
        interrupt,
        this.#result.promise.then(
          (result) => ({ kind: 'result', result }) as const,
        ),
        deadline.promise,
      ]);
      if (first.kind === 'result') return cancelResult(first.result);
      if (first.kind === 'deadline') {
        interruptGate.resolve(false);
        this.abortConnection('interrupt_settlement_timeout');
        return { mode: 'connection_aborted' };
      }
      if (first.kind === 'rejected') {
        interruptGate.resolve(false);
        await Promise.resolve();
        if (this.#terminal) return cancelResult(await this.#result.promise);
        this.abortConnection('interrupt_failed');
        return { mode: 'connection_aborted' };
      }
      if (this.#terminal) return cancelResult(await this.#result.promise);
      this.#nativeInterruptAcknowledged = true;
      interruptGate.resolve(true);
      const settled = await Promise.race([
        this.#result.promise.then(
          (result) => ({ kind: 'result', result }) as const,
        ),
        deadline.promise,
      ]);
      if (settled.kind === 'result') return cancelResult(settled.result);
      this.abortConnection('interrupt_settlement_timeout');
      return { mode: 'connection_aborted' };
    } finally {
      interruptGate.resolve(false);
      if (this.#interruptGate === interruptGate) {
        this.#interruptGate = undefined;
      }
      deadline.cancel();
    }
  }

  async #pump(): Promise<void> {
    const query = this.#query;
    if (query === undefined) return;
    try {
      for await (const value of query) {
        if (this.#terminal) return;
        const interruptGate = this.#interruptGate;
        if (interruptGate !== undefined) await interruptGate.promise;
        if (this.isTerminal) return;
        const observation = mapClaudeSdkMessage(
          value,
          this.#eventState,
          this.sessionId,
          this.#nativeInterruptAcknowledged,
        );
        if (observation.kind === 'init') {
          if (this.#initialized) {
            throw new HarnessError(
              'provider_api_incompatible',
              'Claude SDK emitted more than one initialization message.',
              {
                retryable: false,
                providerId: CLAUDE_PROVIDER_ID,
                profileId: this.#client.profile().profileId,
                providerCode: 'duplicate_init',
              },
            );
          }
          this.#client.observeInit(this.#session, observation.init);
          this.#initialized = true;
          this.#initialization.resolve(true);
          continue;
        }
        if (!this.#initialized) {
          throw new HarnessError(
            'provider_api_incompatible',
            'Claude SDK produced Provider activity before initialization.',
            {
              retryable: false,
              providerId: CLAUDE_PROVIDER_ID,
              profileId: this.#client.profile().profileId,
              providerCode: 'activity_before_init',
            },
          );
        }
        if (observation.kind === 'events') {
          for (const event of observation.events) {
            if (!this.#emit(event)) {
              this.abortConnection('event_buffer_overflow');
              return;
            }
          }
          continue;
        }
        this.#session.markMaterialized();
        const terminal = observation.terminal;
        const eventType = terminalEventType(terminal.result.status);
        this.#finish(
          terminal.result,
          eventType,
          {
            providerCode: terminal.providerCode,
            ...(terminal.terminalReason === undefined
              ? {}
              : { terminalReason: terminal.terminalReason }),
          },
          false,
        );
        return;
      }
      if (!this.#terminal) this.abortConnection('sdk_stream_eof');
    } catch (cause) {
      if (this.#terminal) return;
      if (cause instanceof HarnessError) {
        this.#abortController.abort();
        this.#closeQuery();
        this.#finish(
          {
            status: 'failed',
            providerResult: {
              code: cause.code,
              providerCode: cause.providerCode,
            },
          },
          'run.failed',
          {
            code: cause.code,
            providerCode: cause.providerCode,
          },
          true,
        );
        return;
      }
      this.abortConnection('sdk_stream_error');
    }
  }

  #finish(
    result: RunResult,
    terminalType: Extract<
      HarnessEvent['type'],
      'connection.aborted' | 'run.cancelled' | 'run.completed' | 'run.failed'
    >,
    data: unknown,
    uncertain: boolean,
  ): void {
    if (this.#terminal) return;
    this.#initialization.resolve(false);
    if (this.#timeout !== undefined) clearTimeout(this.#timeout);
    this.#prompt.release();
    if (!uncertain) this.#closeQuery();
    this.#client.finishRun(this, uncertain);
    this.#terminal = true;
    this.#events.pushTerminal(this.#event(terminalType, data));
    this.#result.resolve(result);
  }

  #closeQuery(): void {
    try {
      this.#query?.close();
    } catch {
      // Query disposal is best effort after Harapter owns terminal settlement.
    }
  }

  #emit(event: ClaudeMappedEvent): boolean {
    return this.#events.push(this.#event(event.type, event.data, event));
  }

  #event(
    type: HarnessEvent['type'],
    data: unknown,
    mapped?: ClaudeMappedEvent,
  ): HarnessEvent {
    const profile = this.#client.profile();
    const sequence = this.#events.nextSequence();
    return {
      id: `${String(this.#runId)}:event:${String(sequence)}`,
      type,
      providerId: CLAUDE_PROVIDER_ID,
      profileId: profile.profileId,
      sessionId: providerSessionId(this.sessionId),
      runId: this.#runId,
      sequence,
      timestamp: this.#client.now(),
      data,
      ...(mapped?.providerEventType === undefined
        ? {}
        : { providerEventType: mapped.providerEventType }),
      ...(mapped?.raw === undefined ? {} : { raw: mapped.raw }),
    };
  }
}

class SingleMessagePrompt implements AsyncIterable<
  Readonly<Record<string, unknown>>
> {
  readonly #message: Readonly<Record<string, unknown>>;
  readonly #released = deferred<undefined>();

  constructor(message: Readonly<Record<string, unknown>>) {
    this.#message = message;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<
    Readonly<Record<string, unknown>>
  > {
    yield this.#message;
    await this.#released.promise;
  }

  release(): void {
    this.#released.resolve(undefined);
  }
}

class EventQueue {
  readonly #capacity: number;
  readonly #events: HarnessEvent[] = [];
  #claimed = false;
  #closed = false;
  #sequence = 0;
  #waiter: (() => void) | undefined;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  nextSequence(): number {
    return this.#sequence++;
  }

  push(event: HarnessEvent): boolean {
    if (this.#closed || this.#events.length >= this.#capacity - 1) return false;
    this.#events.push(event);
    this.#wake();
    return true;
  }

  pushTerminal(event: HarnessEvent): void {
    if (this.#closed) return;
    while (this.#events.length >= this.#capacity) this.#events.shift();
    this.#events.push(event);
    this.#closed = true;
    this.#wake();
  }

  iterable(): AsyncIterable<HarnessEvent> {
    if (this.#claimed) {
      throw new HarnessError(
        'run_conflict',
        'Claude Run events already have a consumer.',
        { retryable: false, providerId: CLAUDE_PROVIDER_ID },
      );
    }
    this.#claimed = true;
    return {
      [Symbol.asyncIterator]: () => this.#iterator(),
    };
  }

  async *#iterator(): AsyncGenerator<HarnessEvent> {
    for (;;) {
      const event = this.#events.shift();
      if (event !== undefined) {
        yield event;
        continue;
      }
      if (this.#closed) return;
      await new Promise<void>((resolve) => {
        this.#waiter = resolve;
      });
    }
  }

  #wake(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}

function interactionResult(
  pending: PendingInteraction,
  response: InteractionResponse,
): ClaudeSdkPermissionResult {
  if (pending.request.kind === 'approval') {
    if (response.kind !== 'approval') {
      throw invalidInteraction(
        'Claude approval requires an approval response.',
      );
    }
    if (response.providerOptions !== undefined) {
      throw invalidInteraction(
        'Claude approval Provider options are not supported.',
      );
    }
    return response.decision === 'approve'
      ? {
          behavior: 'allow',
          updatedInput: pending.input,
          decisionClassification: 'user_temporary',
        }
      : deniedPermission(false);
  }
  if (pending.request.kind !== 'user_input' || response.kind !== 'user_input') {
    throw invalidInteraction(
      'Claude user input requires a user_input response.',
    );
  }
  const answers = claudeAnswers(pending, response);
  return {
    behavior: 'allow',
    updatedInput: { ...pending.input, answers },
    decisionClassification: 'user_temporary',
  };
}

function claudeAnswers(
  pending: PendingInteraction,
  response: Extract<InteractionResponse, { kind: 'user_input' }>,
): Readonly<Record<string, string>> {
  if (response.parts.length !== 1) {
    throw invalidInteraction(
      'Claude user input must contain one text or Provider answers part.',
    );
  }
  const part = response.parts[0];
  if (part?.type === 'provider') {
    if (part.name !== 'anthropic.claude-agent-sdk.answers') {
      throw invalidInteraction('Claude Provider answers part name is invalid.');
    }
    const value = record(part.value);
    if (value === undefined || Object.keys(value).length === 0) {
      throw invalidInteraction('Claude Provider answers must be a record.');
    }
    const answers: Record<string, string> = {};
    for (const [question, answer] of Object.entries(value)) {
      if (
        question.length === 0 ||
        question.length > 4_096 ||
        typeof answer !== 'string' ||
        answer.length === 0 ||
        answer.length > 4_096
      ) {
        throw invalidInteraction(
          'Claude Provider answers must be bounded text.',
        );
      }
      answers[question] = answer;
    }
    return answers;
  }
  if (part?.type !== 'text' || part.text.length === 0) {
    throw invalidInteraction('Claude user input text must be non-empty.');
  }
  const questions = pending.input['questions'];
  if (!Array.isArray(questions) || questions.length !== 1) {
    throw invalidInteraction(
      'Claude multi-question input requires a Provider answers part.',
    );
  }
  const question = record(questions[0]);
  if (typeof question?.['question'] !== 'string') {
    throw invalidInteraction('Claude question input is incompatible.');
  }
  return { [question['question']]: part.text };
}

function validateProfile(profile: HarnessProfile): void {
  if (profile.providerId !== CLAUDE_PROVIDER_ID) {
    throw new HarnessError(
      'profile_invalid',
      'Claude Profile Provider ID does not match this Adapter.',
      { retryable: false, providerId: CLAUDE_PROVIDER_ID },
    );
  }
  if (profile.connection.kind !== 'sdk') {
    throw new HarnessError(
      'profile_invalid',
      'Claude Profile must use an SDK connection.',
      { retryable: false, providerId: CLAUDE_PROVIDER_ID },
    );
  }
  if (profile.connection.client !== undefined) {
    throw new HarnessError(
      'profile_invalid',
      'Claude SDK connections accept a query binding through factory, not client.',
      { retryable: false, providerId: CLAUDE_PROVIDER_ID },
    );
  }
  if (
    profile.connection.ownership === 'host' &&
    !isClaudeSdkBinding(profile.connection.factory)
  ) {
    throw new HarnessError(
      'profile_invalid',
      'Host-owned Claude SDK connections require a valid factory binding.',
      { retryable: false, providerId: CLAUDE_PROVIDER_ID },
    );
  }
  if (
    profile.connection.ownership === 'adapter' &&
    profile.connection.factory !== undefined
  ) {
    throw new HarnessError(
      'profile_invalid',
      'Adapter-owned Claude SDK connections cannot include a host factory.',
      { retryable: false, providerId: CLAUDE_PROVIDER_ID },
    );
  }
}

async function resolveBinding(
  profile: HarnessProfile,
  injected: ClaudeSdkBinding | undefined,
): Promise<ClaudeSdkBinding> {
  if (profile.connection.kind !== 'sdk') {
    return loadOfficialClaudeSdkBinding();
  }
  if (profile.connection.ownership === 'host') {
    return profile.connection.factory as ClaudeSdkBinding;
  }
  return injected ?? loadOfficialClaudeSdkBinding();
}

function validateProfileOptions(
  value: Readonly<Record<string, unknown>> | undefined,
): ValidatedProfileOptions {
  const options = value ?? {};
  const allowed = new Set([
    'cancelSettlementTimeoutMs',
    'initializationTimeoutMs',
    'maxRunEvents',
  ]);
  rejectUnknownOptions(options, allowed, 'Claude Profile', profileInvalid);
  return {
    cancelSettlementTimeoutMs: boundedInteger(
      options['cancelSettlementTimeoutMs'],
      defaultCancelSettlementTimeoutMs,
      1,
      maximumTimerMilliseconds,
      'Claude cancel settlement timeout',
      profileInvalid,
    ),
    initializationTimeoutMs: boundedInteger(
      options['initializationTimeoutMs'],
      defaultInitializationTimeoutMs,
      1,
      maximumTimerMilliseconds,
      'Claude initialization timeout',
      profileInvalid,
    ),
    maxRunEvents: boundedInteger(
      options['maxRunEvents'],
      defaultMaxRunEvents,
      2,
      maximumRunEventCapacity,
      'Claude Run event capacity',
      profileInvalid,
    ),
  };
}

function validateRunOptions(options: RunOptions): ValidatedRunOptions {
  if (
    options.metadata !== undefined &&
    Object.keys(options.metadata).length > 0
  ) {
    throw invalidInteraction('Claude Run metadata is not supported.');
  }
  const providerOptions = options.providerOptions ?? {};
  const allowed = new Set(['maxBudgetUsd', 'maxTurns']);
  rejectUnknownOptions(providerOptions, allowed, 'Claude Run');
  const maxTurns = optionalPositiveInteger(
    providerOptions['maxTurns'],
    'Claude maxTurns',
  );
  const maxBudgetUsd = optionalPositiveNumber(
    providerOptions['maxBudgetUsd'],
    'Claude maxBudgetUsd',
  );
  const timeoutMs = optionalPositiveInteger(
    options.timeoutMs,
    'Claude Run timeout',
    maximumTimerMilliseconds,
  );
  return {
    ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
    ...(maxTurns === undefined ? {} : { maxTurns }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function claudeCapabilities(
  profile: HarnessProfile,
  runtimeIdentity: string,
  observedAt: string,
  observedCapabilities: readonly string[],
): CapabilityManifest {
  const schemaNative: CapabilityStatus = {
    mode: 'native',
    source: 'schema',
  };
  const configurationNative: CapabilityStatus = {
    mode: 'native',
    source: 'configuration',
  };
  return {
    providerId: CLAUDE_PROVIDER_ID,
    profileId: profile.profileId,
    capabilities: {
      'session.create': schemaNative,
      'session.resume': schemaNative,
      'session.fork': { mode: 'unsupported', source: 'schema' },
      'session.close': {
        mode: 'adapter_controlled',
        source: 'configuration',
        reason: 'Portable close releases only the local Session handle.',
      },
      'session.workspace': schemaNative,
      'run.stream': schemaNative,
      'run.cancel': schemaNative,
      'run.timeout': {
        mode: 'adapter_controlled',
        source: 'configuration',
        reason:
          'A local timer closes the Query and reports connection abortion.',
      },
      'run.concurrent': {
        mode: 'unsupported',
        source: 'configuration',
        limits: { perSession: 1 },
      },
      'connection.abort': {
        mode: 'adapter_controlled',
        source: 'configuration',
        reason:
          'Query close terminates the SDK-managed process without claiming native Run cancellation.',
      },
      'input.text': schemaNative,
      'input.file': { mode: 'unsupported', source: 'configuration' },
      'input.image': { mode: 'unsupported', source: 'configuration' },
      'event.reasoning': schemaNative,
      'event.tool': schemaNative,
      'event.usage': schemaNative,
      'event.raw': {
        mode: 'adapter_controlled',
        source: 'configuration',
      },
      'interaction.approval': schemaNative,
      'interaction.user_input': schemaNative,
      'native.client': configurationNative,
      ...(observedCapabilities.includes('interrupt_receipt_v1')
        ? {
            'anthropic.claude-code.interrupt_receipt': {
              mode: 'native' as const,
              source: 'handshake' as const,
            },
          }
        : {}),
    },
    observedAt,
    runtimeIdentity,
  };
}

function terminalEventType(
  status: RunResult['status'],
): Extract<
  HarnessEvent['type'],
  'connection.aborted' | 'run.cancelled' | 'run.completed' | 'run.failed'
> {
  const byStatus = {
    completed: 'run.completed',
    cancelled: 'run.cancelled',
    failed: 'run.failed',
    connection_aborted: 'connection.aborted',
  } as const;
  return byStatus[status];
}

function mapStartupError(profile: HarnessProfile): HarnessError {
  return new HarnessError(
    'runtime_not_found',
    'Claude Agent SDK could not start its managed runtime.',
    {
      retryable: false,
      providerId: CLAUDE_PROVIDER_ID,
      profileId: profile.profileId,
      providerCode: 'query_start',
    },
  );
}

function deniedPermission(interrupt: boolean): ClaudeSdkPermissionResult {
  return {
    behavior: 'deny',
    message: 'The Harapter interaction is no longer available.',
    interrupt,
    decisionClassification: 'user_reject',
  };
}

function invalidInteraction(message: string): HarnessError {
  return new HarnessError('invalid_request', message, {
    retryable: false,
    providerId: CLAUDE_PROVIDER_ID,
  });
}

function profileInvalid(message: string): HarnessError {
  return new HarnessError('profile_invalid', message, {
    retryable: false,
    providerId: CLAUDE_PROVIDER_ID,
  });
}

function rejectUnknownOptions(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
  error: (message: string) => HarnessError = invalidInteraction,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw error(`${label} option ${unknown} is not supported.`);
  }
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
  error: (message: string) => HarnessError = invalidInteraction,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw error(`${label} is outside the supported range.`);
  }
  return value;
}

function optionalPositiveInteger(
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw invalidInteraction(`${label} must be a positive integer.`);
  }
  return value;
}

function optionalPositiveNumber(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalidInteraction(`${label} must be a positive number.`);
  }
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function cancelResult(result: RunResult): CancelResult {
  return result.status === 'cancelled'
    ? { mode: 'native' }
    : result.status === 'connection_aborted'
      ? { mode: 'connection_aborted' }
      : { mode: 'already_terminal' };
}

function createDeadline(milliseconds: number): {
  readonly cancel: () => void;
  readonly promise: Promise<{ readonly kind: 'deadline' }>;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<{ readonly kind: 'deadline' }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'deadline' });
    }, milliseconds);
  });
  return {
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    promise,
  };
}

function cloneDescriptor(value: ProviderDescriptor): ProviderDescriptor {
  return {
    ...value,
    connectionKinds: [...value.connectionKinds],
  };
}

export type { ClaudeNativeClient, ClaudeSdkBinding };
export { redactClaudeSdkValue };
