import { randomUUID } from 'node:crypto';
import {
  ExtensionRegistry,
  HarnessError,
  assertSessionOwnership,
  providerSessionId,
  runId,
  type CapabilityManifest,
  type ClientDescriptor,
  type CreateSessionInput,
  type HarnessClient,
  type HarnessInput,
  type HarnessProfile,
  type HarnessRun,
  type HarnessSession,
  type InteractionResponse,
  type RunOptions,
  type SessionRef,
} from '@harapter/core';
import {
  DSH_PROVIDER_ID,
  DSH_NOTIFICATION_EXTENSION,
  prepareDshPrompt,
  redactDshEvent,
  type DshRawEvent,
} from './protocol.js';
import type { DshNotificationObserver } from './adapter.js';
import {
  DSH_GATEWAY_PROTOCOL,
  DSH_GATEWAY_SESSION_EXTENSION,
  type DshGatewayNativeClient,
  type DshGatewaySessions,
  type DshProviderFactoryOptions,
} from './gateway-types.js';
import {
  DshGatewayTransport,
  isGatewayPreconditionError,
  gatewayError,
  gatewayRecord,
  type GatewayStream,
} from './gateway-transport.js';
import {
  gatewayString,
  parseGatewaySnapshot,
  validateGatewayCatalog,
  type GatewaySessionLog,
} from './gateway-protocol.js';
import {
  gatewayDeadline,
  resolveGatewayProfile,
  type GatewayLimits,
} from './gateway-config.js';
import { DshGatewayRun } from './gateway-run.js';

/** Connect only to a host-managed, explicitly attested experimental Gateway. */
export async function connectDshGateway(
  profile: HarnessProfile,
  factory: DshProviderFactoryOptions,
): Promise<HarnessClient> {
  let snapshot: HarnessProfile;
  try {
    snapshot = structuredClone(profile);
  } catch {
    throw gatewayError('profile_invalid');
  }
  const { url, cookie, limits, compatibilityRef } = await resolveGatewayProfile(
    snapshot,
    factory,
  );
  let transport: DshGatewayTransport | undefined;
  try {
    transport = await DshGatewayTransport.connect({ url, cookie, ...limits });
    validateGatewayCatalog(await transport.request('session/modelCatalog', {}));
    return new DshGatewayClient(snapshot, transport, limits, compatibilityRef);
  } catch (error) {
    transport?.close();
    throw error instanceof HarnessError
      ? error
      : gatewayError('connection_failed');
  }
}

class DshGatewayClient implements HarnessClient {
  private readonly sessions = new Map<string, DshGatewaySession>();
  private readonly registry = new ExtensionRegistry(DSH_PROVIDER_ID);
  private readonly nativeClient: DshGatewayNativeClient;
  private readonly observers = new Set<(event: DshRawEvent) => unknown>();
  private closed = false;
  private mutation = false;
  private activeRun: DshGatewayRun | undefined;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly profile: HarnessProfile,
    private readonly transport: DshGatewayTransport,
    private readonly limits: GatewayLimits,
    private readonly compatibilityRef: string,
  ) {
    const controls: DshGatewaySessions = {
      fork: (ref) => this.fork(ref),
      cancelSession: (ref) => this.cancelSession(ref),
    };
    this.nativeClient = Object.freeze({
      ...controls,
      protocol: DSH_GATEWAY_PROTOCOL,
      runtimeIdentity: compatibilityRef,
    });
    this.registry.register(
      {
        name: DSH_GATEWAY_SESSION_EXTENSION,
        providerId: DSH_PROVIDER_ID,
        displayName: 'DSH Gateway Session controls',
        stability: 'experimental',
        description:
          'Native completed-prefix fork and Session-wide cancellation retaining the inbox.',
      },
      Object.freeze(controls),
    );
    const observer: DshNotificationObserver = {
      onNotification: (listener) => {
        this.assertOpen();
        if (this.observers.size >= 16)
          throw gatewayError('run_conflict', 'observer_capacity');
        this.observers.add(listener);
        return () => {
          this.observers.delete(listener);
        };
      },
    };
    this.registry.register(
      {
        name: DSH_NOTIFICATION_EXTENSION,
        providerId: DSH_PROVIDER_ID,
        displayName: 'DSH Gateway notification observer',
        stability: 'experimental',
        description:
          'Bounded redacted observations for attached Sessions, including idle and unknown activity.',
      },
      Object.freeze(observer),
    );
    transport.onClose((error) => {
      this.abort(error.providerCode ?? 'connection_lost');
    });
  }

  descriptor(): Promise<ClientDescriptor> {
    return Promise.resolve({
      providerId: DSH_PROVIDER_ID,
      profileId: this.profile.profileId,
      displayName: 'DSH Gateway',
      connectionKind: 'endpoint',
      compatibility: 'experimental',
      runtime: {
        name: 'deepseek-harness-gateway',
        protocol: DSH_GATEWAY_PROTOCOL,
      },
      warnings: [
        {
          code: 'host_attested_protocol',
          message:
            'Gateway composition and native-store identity are host attestations; no negotiated runtime version is available.',
        },
      ],
    });
  }

  capabilities(): Promise<CapabilityManifest> {
    const native = { mode: 'native', source: 'schema' } as const;
    const unsupported = { mode: 'unsupported', source: 'schema' } as const;
    const controlled = {
      mode: 'adapter_controlled',
      source: 'configuration',
    } as const;
    return Promise.resolve({
      providerId: DSH_PROVIDER_ID,
      profileId: this.profile.profileId,
      observedAt: new Date().toISOString(),
      runtimeIdentity: this.compatibilityRef,
      capabilities: {
        'session.create': native,
        'session.resume': { ...native, limits: { maxHistoryEvents: 4096 } },
        'session.close': controlled,
        'session.fork': unsupported,
        'run.stream': {
          ...native,
          limits: { tokenDeltas: false, transparentReconnect: false },
        },
        'run.cancel': unsupported,
        'run.timeout': controlled,
        'connection.abort': controlled,
        'input.text': native,
        'input.image': unsupported,
        'input.file': unsupported,
        'interaction.approval': unsupported,
        'interaction.user_input': unsupported,
        'interaction.provider': unsupported,
        'event.raw': controlled,
        'native.client': native,
        [`${DSH_GATEWAY_SESSION_EXTENSION}.fork`]: native,
        [`${DSH_GATEWAY_SESSION_EXTENSION}.cancelSession`]: {
          ...native,
          limits: { scope: 'session', retainsInbox: true },
        },
      },
    });
  }

  async createSession(input: CreateSessionInput = {}): Promise<HarnessSession> {
    this.assertOpen();
    if (Object.keys(input).length !== 0)
      throw gatewayError('unsupported_capability', 'session_options');
    this.assertCapacity();
    return this.mutate(async () => {
      const result = gatewayRecord(
        await this.transport.request('session/create', { request: {} }),
      );
      if (!gatewayString(result?.['sessionId']))
        throw gatewayError('provider_api_incompatible', 'create_receipt');
      return this.attach(result['sessionId']);
    }, true);
  }

  async resumeSession(reference: SessionRef): Promise<HarnessSession> {
    this.assertReference(reference);
    const ref = structuredClone(reference);
    const existing = this.sessions.get(ref.providerSessionId);
    if (existing !== undefined) {
      this.matchReference(existing.ref(), ref);
      return existing;
    }
    return this.mutate(async () => {
      this.assertCapacity();
      return this.attach(ref.providerSessionId, ref);
    });
  }

  extensions(): ExtensionRegistry {
    return this.registry;
  }
  native<T = unknown>(guard?: (value: unknown) => value is T): T | undefined {
    return guard === undefined || guard(this.nativeClient)
      ? (this.nativeClient as T)
      : undefined;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  async start(
    session: DshGatewaySession,
    input: HarnessInput,
    options: RunOptions = {},
  ): Promise<HarnessRun> {
    this.assertOpen();
    if (this.activeRun !== undefined || this.mutation)
      throw gatewayError('run_conflict');
    const content = prepareDshPrompt(input, options);
    const timeoutMs = options.timeoutMs ?? this.limits.runTimeoutMs;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 2_147_483_647
    )
      throw gatewayError('invalid_request');
    const requestId = randomUUID();
    const args = {
      request: {
        sessionId: session.ref().providerSessionId,
        requestId,
        mode: 'queue',
        content,
      },
    };
    this.transport.validateRequest('session/prompt', args);
    session.log.begin(requestId);
    const run = new DshGatewayRun(
      {
        providerId: DSH_PROVIDER_ID,
        profileId: this.profile.profileId,
        sessionId: session.ref().providerSessionId,
        runId: runId(`harapter-dsh-${randomUUID()}`),
      },
      this.limits.maxRunEvents,
      timeoutMs,
      (reason) => {
        this.abort(reason);
      },
      () => {
        if (this.activeRun === run) this.activeRun = undefined;
        session.run = undefined;
        session.log.release();
      },
    );
    session.run = run;
    this.activeRun = run;
    try {
      const receipt = gatewayRecord(
        await this.transport.request('session/prompt', args),
      );
      if (receipt?.['accepted'] !== true)
        throw gatewayError('provider_api_incompatible', 'prompt_receipt');
      this.assertOpen();
      run.acknowledge();
      return run;
    } catch (error) {
      if (isGatewayPreconditionError(error)) run.rejected();
      else this.abort('prompt_uncertain');
      throw error;
    }
  }

  async detach(session: DshGatewaySession): Promise<void> {
    if (session.run !== undefined)
      throw gatewayError('run_conflict', 'session_running');
    const id = session.ref().providerSessionId;
    if (this.sessions.get(id) === session) this.sessions.delete(id);
    await session.dispose();
  }

  abort(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.activeRun?.connectionAborted(reason);
    this.observers.clear();
    this.transport.close();
  }

  observe(raw: DshRawEvent): void {
    for (const listener of this.observers) {
      try {
        void Promise.resolve(listener(structuredClone(raw))).catch(
          () => undefined,
        );
      } catch {
        /* Host observers cannot alter native lifecycle processing. */
      }
    }
  }

  private async closeOnce(): Promise<void> {
    this.abort('client_closed');
    await Promise.all(
      [...this.sessions.values()].map(async (session) => session.dispose()),
    );
    this.sessions.clear();
  }

  private async fork(reference: SessionRef): Promise<HarnessSession> {
    const parent = this.attached(reference);
    this.assertCapacity();
    return this.mutate(async () => {
      const receipt = gatewayRecord(
        await this.transport.request('session/fork', {
          request: { sessionId: parent.ref().providerSessionId },
        }),
      );
      if (
        !gatewayString(receipt?.['sessionId']) ||
        receipt['sessionId'] === reference.providerSessionId
      )
        throw gatewayError('provider_api_incompatible', 'fork_receipt');
      return this.attach(
        receipt['sessionId'],
        undefined,
        parent.ref().providerSessionId,
      );
    }, true);
  }

  private async cancelSession(
    reference: SessionRef,
  ): Promise<{ readonly accepted: true }> {
    const session = this.attached(reference);
    return this.mutate(async () => {
      const result = gatewayRecord(
        await this.transport.request('session/cancel', {
          request: { sessionId: session.ref().providerSessionId },
        }),
      );
      if (result?.['accepted'] !== true)
        throw gatewayError('provider_api_incompatible', 'cancel_receipt');
      return { accepted: true } as const;
    }, true);
  }

  private async attach(
    id: string,
    expected?: SessionRef,
    parent?: string,
  ): Promise<DshGatewaySession> {
    if (this.sessions.has(id))
      throw gatewayError('provider_api_incompatible', 'duplicate_session');
    const stream = this.transport.open('session/follow', {
      request: {
        address: { kind: 'session', sessionId: id },
        maxMessages: 200,
      },
    });
    const reader = stream.events[Symbol.asyncIterator]();
    try {
      const first = await gatewayDeadline(
        reader.next(),
        this.limits.requestTimeoutMs,
        () => {
          stream.close();
        },
      );
      if (first.done)
        throw gatewayError('connection_aborted', 'missing_snapshot');
      this.observe(redactDshEvent('gateway.snapshot', first.value));
      const snapshot = parseGatewaySnapshot(first.value, id);
      const ref: SessionRef = {
        providerId: DSH_PROVIDER_ID,
        profileId: this.profile.profileId,
        providerSessionId: providerSessionId(id),
        compatibilityRef: this.compatibilityRef,
        providerState: { headerFingerprint: snapshot.headerFingerprint },
      };
      if (expected !== undefined) this.matchReference(ref, expected);
      if (parent !== undefined && snapshot.parentSession !== parent)
        throw gatewayError('session_provider_mismatch', 'fork_lineage');
      this.assertOpen();
      const session = new DshGatewaySession(
        this,
        ref,
        snapshot.log,
        stream,
        reader,
      );
      this.sessions.set(id, session);
      return session;
    } catch (error) {
      stream.close();
      throw error;
    }
  }

  private attached(ref: SessionRef): DshGatewaySession {
    this.assertReference(ref);
    const session = this.sessions.get(ref.providerSessionId);
    if (session === undefined)
      throw gatewayError('session_not_found', 'session_not_attached');
    this.matchReference(session.ref(), ref);
    return session;
  }

  private assertReference(ref: SessionRef): void {
    this.assertOpen();
    assertSessionOwnership(ref, DSH_PROVIDER_ID, this.profile.profileId);
    if (
      ref.compatibilityRef !== this.compatibilityRef ||
      !gatewayString(ref.providerSessionId) ||
      !gatewayString(gatewayRecord(ref.providerState)?.['headerFingerprint'])
    )
      throw gatewayError('session_provider_mismatch');
  }

  private matchReference(actual: SessionRef, expected: SessionRef): void {
    if (
      gatewayRecord(actual.providerState)?.['headerFingerprint'] !==
      gatewayRecord(expected.providerState)?.['headerFingerprint']
    )
      throw gatewayError('session_provider_mismatch');
  }

  private async mutate<T>(
    action: () => Promise<T>,
    writes = false,
  ): Promise<T> {
    this.assertOpen();
    if (this.mutation)
      throw gatewayError('run_conflict', 'session_operation_pending');
    this.mutation = true;
    try {
      return await action();
    } catch (error) {
      if (writes && !isGatewayPreconditionError(error))
        this.abort('session_mutation_uncertain');
      throw error;
    } finally {
      this.mutation = false;
    }
  }
  private assertCapacity(): void {
    if (this.sessions.size >= this.limits.maxSessions)
      throw gatewayError('run_conflict', 'session_capacity');
  }
  private assertOpen(): void {
    if (this.closed) throw gatewayError('connection_aborted');
  }
}

class DshGatewaySession implements HarnessSession {
  run: DshGatewayRun | undefined;
  private closed = false;
  private readonly pump: Promise<void>;

  constructor(
    private readonly client: DshGatewayClient,
    private readonly reference: SessionRef,
    readonly log: GatewaySessionLog,
    private readonly stream: GatewayStream,
    private readonly reader: AsyncIterator<unknown>,
  ) {
    this.pump = this.observe();
  }

  ref(): SessionRef {
    return structuredClone(this.reference);
  }
  capabilities(): Promise<CapabilityManifest> {
    return this.client.capabilities();
  }
  async start(input: HarnessInput, options?: RunOptions): Promise<HarnessRun> {
    if (this.closed) throw gatewayError('session_not_found');
    return this.client.start(this, input, options);
  }
  respond(_requestId: string, _response: InteractionResponse): Promise<void> {
    return Promise.reject(
      gatewayError('unsupported_capability', 'interaction_unavailable'),
    );
  }
  close(): Promise<void> {
    return this.client.detach(this);
  }
  async dispose(): Promise<void> {
    this.closed = true;
    this.stream.close();
    await this.pump;
  }

  private isDisposed(): boolean {
    return this.closed;
  }

  private async observe(): Promise<void> {
    try {
      while (!this.isDisposed()) {
        const frame = await this.reader.next();
        if (this.isDisposed()) return;
        if (frame.done)
          throw gatewayError('connection_aborted', 'stream_ended');
        const record = gatewayRecord(frame.value);
        if (record?.['type'] !== 'event')
          throw gatewayError('provider_api_incompatible', 'frame_invalid');
        let raw: DshRawEvent | undefined;
        try {
          raw = redactDshEvent('session.event', { event: record['event'] });
          this.client.observe(raw);
          const mapped = this.log.accept(record['event']);
          this.run?.receive(mapped.events, this.log.terminal());
        } catch (error) {
          if (raw !== undefined)
            this.run?.receive([
              {
                type: 'provider',
                data: { eventType: 'unmapped' },
                providerEventType: 'unmapped',
                raw,
              },
            ]);
          throw error;
        }
      }
    } catch (error) {
      if (!this.closed)
        this.client.abort(
          error instanceof HarnessError
            ? (error.providerCode ?? 'protocol_failure')
            : 'protocol_failure',
        );
    }
  }
}
