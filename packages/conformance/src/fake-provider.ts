import {
  ExtensionRegistry,
  HarnessError,
  assertSessionCompatibility,
  assertSessionOwnership,
  profileId,
  providerId,
  providerSessionId,
  runId,
  type CancelResult,
  type CapabilityManifest,
  type CapabilityStatus,
  type CreateSessionInput,
  type HarnessClient,
  type HarnessEvent,
  type HarnessInput,
  type HarnessProfile,
  type HarnessRun,
  type HarnessSession,
  type InteractionRequest,
  type InteractionResponse,
  type InputPart,
  type ProviderAdapterFactory,
  type ProviderDescriptor,
  type ProviderId,
  type ProviderSessionId,
  type RunOptions,
  type RunRef,
  type RunResult,
  type SessionRef,
} from '@harapter/core';

/** Default dynamic identity used by the deterministic Fake Provider. */
export const FAKE_PROVIDER_ID = providerId('harapter.fake');

/** Default host Profile identity used by conformance tests. */
export const FAKE_PROFILE_ID = profileId('fake-local');

const FAKE_RUNTIME_IDENTITY = 'harapter-fake@1;protocol=1';

/** Controls for the deterministic, bounded Fake Provider. */
export interface FakeProviderOptions {
  providerId?: ProviderId;
  cancelMode?:
    | 'native'
    | 'emulated'
    | 'adapter_controlled'
    | 'unsupported'
    | 'unknown'
    | 'missing';
  resumeMode?: 'native' | 'unsupported';
  nativeClient?: boolean;
  includeUnknownEvent?: boolean;
  rawEvents?: boolean;
  /** One synthetic request per Run; absent by default. */
  interaction?: Omit<InteractionRequest, 'requestId'>;
}

/**
 * Create a valid Profile for the Fake Provider.
 * @param overrides - Fields replaced for a specific test.
 * @returns A detached Profile.
 */
export function createFakeProfile(
  overrides: Partial<HarnessProfile> = {},
): HarnessProfile {
  return {
    providerId: FAKE_PROVIDER_ID,
    profileId: FAKE_PROFILE_ID,
    displayName: 'Harapter Fake Provider',
    connection: {
      kind: 'sdk',
      client: { kind: 'harapter-fake' },
      ownership: 'adapter',
    },
    ...overrides,
  };
}

/**
 * Create an independently configurable Fake Provider factory.
 * @param options - Deterministic capability and event controls.
 * @returns A Provider factory suitable for unit and conformance tests.
 */
export function createFakeProviderFactory(
  options: FakeProviderOptions = {},
): ProviderAdapterFactory {
  const resolved: ResolvedFakeProviderOptions = {
    providerId: options.providerId ?? FAKE_PROVIDER_ID,
    cancelMode: options.cancelMode ?? 'native',
    resumeMode: options.resumeMode ?? 'native',
    nativeClient: options.nativeClient ?? true,
    includeUnknownEvent: options.includeUnknownEvent ?? false,
    rawEvents: options.rawEvents ?? false,
    interaction:
      options.interaction === undefined
        ? undefined
        : structuredClone(options.interaction),
  };
  const descriptor: ProviderDescriptor = {
    providerId: resolved.providerId,
    displayName: 'Harapter Fake Provider',
    connectionKinds: ['sdk'],
  };
  const state: FakeProviderState = {
    sessionSerial: 0,
    runSerial: 0,
    sessions: new Map(),
  };

  return {
    descriptor: () => ({
      ...descriptor,
      connectionKinds: [...descriptor.connectionKinds],
    }),
    connect: (profile) =>
      promiseFrom(() => {
        if (
          profile.providerId !== resolved.providerId ||
          profile.connection.kind !== 'sdk'
        ) {
          throw new HarnessError(
            'profile_invalid',
            'Fake Provider Profile does not match the Adapter.',
            {
              retryable: false,
              providerId: resolved.providerId,
              profileId: profile.profileId,
            },
          );
        }
        return new FakeClient(profile, resolved, state);
      }),
  };
}

interface ResolvedFakeProviderOptions {
  providerId: ProviderId;
  cancelMode:
    | 'native'
    | 'emulated'
    | 'adapter_controlled'
    | 'unsupported'
    | 'unknown'
    | 'missing';
  resumeMode: 'native' | 'unsupported';
  nativeClient: boolean;
  includeUnknownEvent: boolean;
  rawEvents: boolean;
  interaction: Omit<InteractionRequest, 'requestId'> | undefined;
}

interface FakeNativeClient {
  readonly kind: 'harapter-fake-native';
  readonly providerId: ProviderId;
}

interface FakeProviderState {
  sessionSerial: number;
  runSerial: number;
  readonly sessions: Map<ProviderSessionId, FakeNativeSessionState>;
}

interface FakeNativeSessionState {
  readonly providerId: ProviderId;
  readonly profileId: HarnessProfile['profileId'];
  readonly sessionId: ProviderSessionId;
  activeRun: FakeRun | undefined;
}

class FakeClient implements HarnessClient {
  private readonly activeRuns = new Set<FakeRun>();
  private readonly extensionRegistry: ExtensionRegistry;
  private readonly nativeClient: FakeNativeClient;
  private closed = false;

  constructor(
    private readonly profile: HarnessProfile,
    private readonly options: ResolvedFakeProviderOptions,
    private readonly state: FakeProviderState,
  ) {
    this.extensionRegistry = new ExtensionRegistry(options.providerId);
    this.extensionRegistry.register(
      {
        name: `${options.providerId}.echo`,
        providerId: options.providerId,
        displayName: 'Deterministic Echo',
        stability: 'stable',
      },
      { echo: (value: string) => value },
    );
    this.nativeClient = {
      kind: 'harapter-fake-native',
      providerId: options.providerId,
    };
  }

  descriptor() {
    return Promise.resolve({
      providerId: this.options.providerId,
      profileId: this.profile.profileId,
      displayName: this.profile.displayName,
      connectionKind: this.profile.connection.kind,
      runtime: {
        name: 'Harapter deterministic Fake Provider',
        version: '1',
        protocol: 'in-process',
        protocolVersion: '1',
      },
      compatibility: 'supported' as const,
    });
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(fakeCapabilities(this.profile, this.options));
  }

  createSession(_input?: CreateSessionInput): Promise<HarnessSession> {
    return promiseFrom(() => {
      this.assertOpen();
      const id = providerSessionId(
        `fake-session-${String(++this.state.sessionSerial)}`,
      );
      const nativeSession: FakeNativeSessionState = {
        providerId: this.options.providerId,
        profileId: this.profile.profileId,
        sessionId: id,
        activeRun: undefined,
      };
      this.state.sessions.set(id, nativeSession);
      return new FakeSession(this, nativeSession);
    });
  }

  resumeSession(ref: SessionRef): Promise<HarnessSession> {
    return promiseFrom(() => {
      this.assertOpen();
      assertSessionOwnership(
        ref,
        this.options.providerId,
        this.profile.profileId,
      );
      if (this.options.resumeMode === 'unsupported') {
        throw new HarnessError(
          'unsupported_capability',
          'Fake Provider native resume is disabled.',
          {
            retryable: false,
            providerId: this.options.providerId,
            profileId: this.profile.profileId,
            details: { capability: 'session.resume' },
          },
        );
      }
      assertSessionCompatibility(ref, FAKE_RUNTIME_IDENTITY);
      const nativeSession = this.state.sessions.get(ref.providerSessionId);
      if (
        nativeSession?.providerId !== this.options.providerId ||
        nativeSession.profileId !== this.profile.profileId
      ) {
        throw new HarnessError('session_not_found', 'Session does not exist.', {
          retryable: false,
          providerId: this.options.providerId,
          profileId: this.profile.profileId,
        });
      }
      return new FakeSession(this, nativeSession);
    });
  }

  extensions(): ExtensionRegistry {
    return this.extensionRegistry;
  }

  native<T = unknown>(guard?: (value: unknown) => value is T): T | undefined {
    const value: unknown = this.options.nativeClient
      ? this.nativeClient
      : undefined;
    if (value === undefined || (guard !== undefined && !guard(value))) {
      return undefined;
    }
    return value as T;
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    for (const run of [...this.activeRuns]) run.abortConnection();
    return Promise.resolve();
  }

  createRun(
    sessionId: ProviderSessionId,
    text: string,
    timeoutMs?: number,
  ): FakeRun {
    this.assertOpen();
    const portableRunId = runId(`fake-run-${String(++this.state.runSerial)}`);
    const run = new FakeRun(
      {
        providerId: this.options.providerId,
        profileId: this.profile.profileId,
        sessionId,
        runId: portableRunId,
      },
      text,
      this.options,
      () => {
        this.activeRuns.delete(run);
      },
      timeoutMs,
    );
    this.activeRuns.add(run);
    return run;
  }

  capabilityManifest(): CapabilityManifest {
    return fakeCapabilities(this.profile, this.options);
  }

  assertOpen(): void {
    if (this.closed) {
      throw new HarnessError(
        'connection_aborted',
        'Fake Provider Client is closed.',
        {
          retryable: false,
          providerId: this.options.providerId,
          profileId: this.profile.profileId,
        },
      );
    }
  }
}

class FakeSession implements HarnessSession {
  private closed = false;
  private ownedRun: FakeRun | undefined;

  constructor(
    private readonly client: FakeClient,
    private readonly nativeSession: FakeNativeSessionState,
  ) {}

  ref(): SessionRef {
    const manifest = this.client.capabilityManifest();
    return {
      providerId: manifest.providerId,
      profileId: manifest.profileId,
      providerSessionId: this.nativeSession.sessionId,
      ...(manifest.runtimeIdentity === undefined
        ? {}
        : { compatibilityRef: manifest.runtimeIdentity }),
    };
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.client.capabilityManifest());
  }

  start(input: HarnessInput, options?: RunOptions): Promise<HarnessRun> {
    return promiseFrom(() => {
      if (this.closed) {
        throw new HarnessError('session_not_found', 'Session is closed.', {
          retryable: false,
          providerId: this.ref().providerId,
          profileId: this.ref().profileId,
        });
      }
      if (
        this.nativeSession.activeRun !== undefined &&
        !this.nativeSession.activeRun.isTerminal()
      ) {
        throw new HarnessError(
          'run_conflict',
          'Session already has an active Run.',
          {
            retryable: false,
            providerId: this.ref().providerId,
            profileId: this.ref().profileId,
          },
        );
      }
      const textParts = input.parts.filter(
        (part): part is Extract<InputPart, { type: 'text' }> =>
          part.type === 'text',
      );
      if (textParts.length === 0 || textParts.length !== input.parts.length) {
        throw new HarnessError(
          'unsupported_capability',
          'Fake Provider accepts text input only.',
          {
            retryable: false,
            providerId: this.ref().providerId,
            profileId: this.ref().profileId,
            details: { capability: 'input.text' },
          },
        );
      }
      const text = textParts.map((part) => part.text).join('');
      if (
        options?.timeoutMs !== undefined &&
        (!Number.isSafeInteger(options.timeoutMs) ||
          options.timeoutMs <= 0 ||
          options.timeoutMs > 2_147_483_647)
      ) {
        throw new HarnessError(
          'invalid_request',
          'Fake Run timeout must be a positive bounded integer.',
          { retryable: false },
        );
      }
      const run = this.client.createRun(
        this.nativeSession.sessionId,
        text,
        options?.timeoutMs,
      );
      this.ownedRun = run;
      this.nativeSession.activeRun = run;
      run.afterSettlement(() => {
        if (this.nativeSession.activeRun === run) {
          this.nativeSession.activeRun = undefined;
        }
      });
      return run;
    });
  }

  respond(requestId: string, response: InteractionResponse): Promise<void> {
    return promiseFrom(() => {
      this.client.assertOpen();
      if (this.closed) throw invalidInteraction();
      if (
        this.client.capabilityManifest().capabilities[
          `interaction.${response.kind}`
        ]?.mode !== 'native' &&
        this.ownedRun === undefined
      ) {
        throw new HarnessError(
          'unsupported_capability',
          'Fake Provider exposes no matching interactions.',
          { retryable: false },
        );
      }
      if (this.ownedRun === undefined) throw invalidInteraction();
      this.ownedRun.respond(requestId, response);
    });
  }

  close(): Promise<void> {
    return promiseFrom(() => {
      if (
        this.nativeSession.activeRun !== undefined &&
        !this.nativeSession.activeRun.isTerminal()
      ) {
        throw new HarnessError(
          'run_conflict',
          'Cannot close a Session with an active Run.',
          {
            retryable: false,
            providerId: this.ref().providerId,
            profileId: this.ref().profileId,
          },
        );
      }
      this.closed = true;
    });
  }
}

class FakeRun implements HarnessRun {
  private readonly settlement: Promise<RunResult>;
  private resolveSettlement!: (result: RunResult) => void;
  private readonly settlementCallbacks: (() => void)[] = [];
  private readonly emitted: HarnessEvent[] = [];
  private changed = Promise.withResolvers<undefined>();
  private pending: InteractionRequest | undefined;
  private readonly timer: ReturnType<typeof setTimeout> | undefined;
  private finalResult: RunResult | undefined;
  private completionScheduled = false;

  constructor(
    private readonly reference: RunRef,
    private readonly text: string,
    private readonly options: ResolvedFakeProviderOptions,
    onSettlement: () => void,
    timeoutMs?: number,
  ) {
    this.settlement = new Promise((resolve) => {
      this.resolveSettlement = resolve;
    });
    this.settlementCallbacks.push(onSettlement);
    this.emit('run.started', {});
    if (options.interaction !== undefined) {
      this.pending = {
        ...structuredClone(options.interaction),
        requestId: `${reference.runId}:interaction`,
      };
      this.emit('interaction.requested', structuredClone(this.pending));
    }
    this.timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            this.abortConnection();
          }, timeoutMs);
  }

  ref(): RunRef {
    return { ...this.reference };
  }

  async *events(): AsyncIterable<HarnessEvent> {
    this.scheduleCompletion();
    let index = 0;
    for (;;) {
      const event = this.emitted[index];
      if (event !== undefined) {
        index += 1;
        yield structuredClone(event);
      } else if (this.isTerminal()) return;
      else await this.changed.promise;
    }
  }

  cancel(): Promise<CancelResult> {
    return promiseFrom(() => {
      if (this.isTerminal()) return { mode: 'already_terminal' };
      if (
        this.options.cancelMode === 'unsupported' ||
        this.options.cancelMode === 'unknown' ||
        this.options.cancelMode === 'missing'
      ) {
        throw new HarnessError(
          'unsupported_capability',
          'Fake Provider native cancellation is disabled.',
          {
            retryable: false,
            providerId: this.reference.providerId,
            profileId: this.reference.profileId,
            details: { capability: 'run.cancel' },
          },
        );
      }
      if (this.options.cancelMode === 'adapter_controlled') {
        this.finish({ status: 'connection_aborted' }, 'connection.aborted');
        return { mode: 'connection_aborted' };
      }
      this.finish({ status: 'cancelled' }, 'run.cancelled');
      return { mode: this.options.cancelMode };
    });
  }

  async result(): Promise<RunResult> {
    this.scheduleCompletion();
    return this.settlement;
  }

  isTerminal(): boolean {
    return this.finalResult !== undefined;
  }

  abortConnection(): void {
    if (!this.isTerminal()) {
      this.finish({ status: 'connection_aborted' }, 'connection.aborted');
    }
  }

  afterSettlement(callback: () => void): void {
    if (this.isTerminal()) callback();
    else this.settlementCallbacks.push(callback);
  }

  respond(requestId: string, response: InteractionResponse): void {
    if (
      this.isTerminal() ||
      this.pending?.requestId !== requestId ||
      this.pending.kind !== response.kind
    )
      throw invalidInteraction();
    if (
      response.kind === 'user_input' &&
      (response.parts.length === 0 ||
        response.parts.some((part) => part.type !== 'text'))
    )
      throw invalidInteraction();
    this.resolveInteraction('host');
    this.finish(
      { status: 'completed', finalMessage: this.text },
      'run.completed',
    );
  }

  private scheduleCompletion(): void {
    if (this.completionScheduled || this.isTerminal()) return;
    this.completionScheduled = true;
    queueMicrotask(() => {
      if (!this.isTerminal() && this.pending === undefined) {
        this.finish(
          { status: 'completed', finalMessage: this.text },
          'run.completed',
        );
      }
    });
  }

  private finish(
    result: RunResult,
    terminalType: 'run.completed' | 'run.cancelled' | 'connection.aborted',
  ): void {
    clearTimeout(this.timer);
    this.resolveInteraction('terminal');
    if (result.status === 'completed') {
      this.emit('message.delta', { delta: this.text });
      if (this.options.includeUnknownEvent) {
        this.emitted.push({
          ...this.event(this.emitted.length, 'provider', {}),
          providerEventType: 'fake.unknown',
          ...(this.options.rawEvents
            ? { raw: { kind: 'fake.unknown', value: 'synthetic' } }
            : {}),
        });
      }
      this.emit('message.completed', {
        message: this.text,
      });
    }
    this.emit(terminalType, result);
    this.finalResult = result;
    for (const callback of this.settlementCallbacks.splice(0)) callback();
    this.resolveSettlement(result);
  }

  private resolveInteraction(resolution: 'host' | 'terminal'): void {
    if (this.pending === undefined) return;
    const { requestId } = this.pending;
    this.pending = undefined;
    this.emit('interaction.resolved', { requestId, resolution });
  }

  private emit(type: HarnessEvent['type'], data: unknown): void {
    this.emitted.push(this.event(this.emitted.length, type, data));
    this.changed.resolve(undefined);
    this.changed = Promise.withResolvers<undefined>();
  }

  private event(
    sequence: number,
    type: HarnessEvent['type'],
    data: unknown,
  ): HarnessEvent {
    return {
      id: `${this.reference.runId}:event:${String(sequence)}`,
      type,
      providerId: this.reference.providerId,
      profileId: this.reference.profileId,
      sessionId: this.reference.sessionId,
      runId: this.reference.runId,
      sequence,
      timestamp: `2026-01-01T00:00:${String(sequence).padStart(2, '0')}.000Z`,
      data,
    };
  }
}

function fakeCapabilities(
  profile: HarnessProfile,
  options: ResolvedFakeProviderOptions,
): CapabilityManifest {
  const native: CapabilityStatus = {
    mode: 'native',
    source: 'schema',
  };
  const unsupported: CapabilityStatus = {
    mode: 'unsupported',
    source: 'configuration',
  };
  return {
    providerId: options.providerId,
    profileId: profile.profileId,
    capabilities: {
      'session.create': native,
      'session.resume': options.resumeMode === 'native' ? native : unsupported,
      'session.fork': unsupported,
      'session.close': {
        mode: 'adapter_controlled',
        source: 'configuration',
      },
      'run.stream': native,
      'run.timeout': {
        mode: 'adapter_controlled',
        source: 'configuration',
        reason:
          'A local timer settles the synthetic Run as connection aborted.',
      },
      ...(options.cancelMode === 'missing'
        ? {}
        : {
            'run.cancel':
              options.cancelMode === 'native'
                ? native
                : { mode: options.cancelMode, source: 'configuration' },
          }),
      'connection.abort': {
        mode: 'adapter_controlled',
        source: 'configuration',
      },
      'input.text': native,
      'input.image': unsupported,
      'input.file': unsupported,
      'interaction.approval':
        options.interaction?.kind === 'approval' ? native : unsupported,
      'interaction.user_input':
        options.interaction?.kind === 'user_input' ? native : unsupported,
      'interaction.provider':
        options.interaction?.kind === 'provider' ? native : unsupported,
      'event.raw': options.rawEvents
        ? { mode: 'adapter_controlled', source: 'configuration' }
        : unsupported,
      'native.client': options.nativeClient ? native : unsupported,
    },
    observedAt: '2026-01-01T00:00:00.000Z',
    runtimeIdentity: FAKE_RUNTIME_IDENTITY,
  };
}

function invalidInteraction(): HarnessError {
  return new HarnessError(
    'invalid_request',
    'No matching pending Fake interaction or invalid response.',
    { retryable: false },
  );
}

function promiseFrom<T>(operation: () => T): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    return Promise.reject(
      error instanceof Error
        ? error
        : new HarnessError(
            'provider_error',
            'Fake Provider operation rejected with a non-Error value.',
            { retryable: false },
          ),
    );
  }
}
