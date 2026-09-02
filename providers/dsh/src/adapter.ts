import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import {
  ExtensionRegistry,
  HarnessError,
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
  type JsonRpcInboundMessage,
  type JsonRpcRequestOptions,
  type JsonRpcStdioTransportOptions,
} from '@harapter/transport-jsonrpc-stdio';
import {
  DSH_NOTIFICATION_EXTENSION,
  DSH_PROVIDER_ID,
  DSH_SESSION_COMPATIBILITY_REF,
  dshCompatibilityIdentity,
  mapDshSessionEvent,
  parseDshInitializeResponse,
  parseDshPromptResponse,
  parseDshSessionEventNotification,
  parseDshStatusNotification,
  parseDshSubagentFinished,
  parseDshSubagentStarted,
  prepareDshPrompt,
  redactDshEvent,
  validateDshSessionInput,
  type DshInitializeParams,
  type DshRawEvent,
  type DshRuntimeIdentity,
  type DshSessionEvent,
  type MappedDshEvent,
} from './protocol.js';

const descriptor: ProviderDescriptor = {
  providerId: DSH_PROVIDER_ID,
  displayName: 'DeepSeek Harness SDK Runtime',
  connectionKinds: ['process'],
  documentationUrl:
    'https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/sdk',
};

const defaultMaxRunEvents = 128;
const maximumRunEvents = 4_096;
const defaultShutdownTimeoutMs = 1_000;
const childTerminationTimeoutMs = 2_000;
const maximumTimerMilliseconds = 2_147_483_647;

/** Connection settings accepted by the DeepSeek Harness Provider Adapter. */
export interface DshProfileOptions {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly maxTokens?: number;
  readonly maxBufferedMessages?: number;
  readonly maxMessageBytes?: number;
  readonly maxPendingInboundRequests?: number;
  readonly maxPendingRequests?: number;
  readonly maxPendingWrites?: number;
  readonly maxRunEvents?: number;
  readonly requestTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}

/** Request options for explicit Provider-native SDK protocol calls. */
export interface DshNativeRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Provider extension for observing every bounded, redacted notification. */
export interface DshNotificationObserver {
  onNotification(listener: (event: DshRawEvent) => void): () => void;
}

/** Explicit Provider-native escape hatch for initialized SDK protocol traffic. */
export interface DshNativeClient {
  readonly runtimeIdentity: string;
  request<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: DshNativeRequestOptions,
  ): Promise<TResult>;
  notify(method: string, params?: unknown): Promise<void>;
  onUnknownEvent(listener: (event: DshRawEvent) => void): () => void;
}

interface ResolvedConnectionOptions {
  readonly initialize: DshInitializeParams;
  readonly maxRunEvents: number;
  readonly shutdownTimeoutMs: number;
  readonly transport: Omit<
    JsonRpcStdioTransportOptions,
    'cleanup' | 'readable' | 'writable'
  >;
}

type DshChildProcess = ChildProcessByStdio<Writable, Readable, null>;

type PendingRunNotification =
  | { readonly kind: 'event'; readonly event: DshSessionEvent }
  | { readonly kind: 'status'; readonly status: 'idle' | 'running' }
  | { readonly kind: 'raw'; readonly event: DshRawEvent };

/** Create a fresh DeepSeek Harness SDK Runtime Adapter factory. */
export function createDshProviderFactory(): ProviderAdapterFactory {
  return {
    descriptor: () => ({
      ...descriptor,
      connectionKinds: [...descriptor.connectionKinds],
    }),
    connect: async (profile) => connectDsh(profile),
  };
}

async function connectDsh(profile: HarnessProfile): Promise<HarnessClient> {
  validateProfile(profile);
  const options = connectionOptions(profile.providerOptions, profile);
  let transport: JsonRpcStdioTransport;
  try {
    transport = await spawnTransport(profile, options.transport);
  } catch (error) {
    throw mapError(error, profile, 'spawn', true);
  }

  try {
    const response = await transport.request('initialize', options.initialize);
    const runtime = parseDshInitializeResponse(response);
    return new DshClient(
      snapshotProfile(profile),
      transport,
      runtime,
      options.initialize,
      options.maxRunEvents,
      options.shutdownTimeoutMs,
    );
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw mapError(error, profile, 'initialize', true);
  }
}

class DshClient implements HarnessClient {
  private readonly extensionRegistry = new ExtensionRegistry(DSH_PROVIDER_ID);
  private readonly nativeClient: DshNativeClient;
  private readonly notificationListeners = new Set<
    (event: DshRawEvent) => void
  >();
  private readonly unknownListeners = new Set<(event: DshRawEvent) => void>();
  private activeRun: DshRun | undefined;
  private closePromise: Promise<void> | undefined;
  private closed = false;
  private runSerial = 0;
  private sessionSerial = 0;

  constructor(
    private readonly profile: HarnessProfile,
    private readonly transport: JsonRpcStdioTransport,
    private readonly runtime: DshRuntimeIdentity,
    private readonly initialize: DshInitializeParams,
    private readonly maxRunEvents: number,
    private readonly shutdownTimeoutMs: number,
  ) {
    const observer: DshNotificationObserver = Object.freeze({
      onNotification: (listener: (event: DshRawEvent) => void) => {
        this.notificationListeners.add(listener);
        return () => {
          this.notificationListeners.delete(listener);
        };
      },
    });
    this.extensionRegistry.register(
      {
        name: DSH_NOTIFICATION_EXTENSION,
        providerId: DSH_PROVIDER_ID,
        displayName: 'DeepSeek Harness notification observer',
        description: 'Bounded, redacted SDK runtime notifications.',
        documentationUrl:
          'https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/README.md',
        stability: 'experimental',
      },
      observer,
    );
    this.nativeClient = Object.freeze({
      runtimeIdentity: this.runtimeIdentity(),
      request: <TResult>(
        method: string,
        params?: unknown,
        options?: DshNativeRequestOptions,
      ) => this.nativeRequest<TResult>(method, params, options),
      notify: (method: string, params?: unknown) =>
        this.nativeNotify(method, params),
      onUnknownEvent: (listener: (event: DshRawEvent) => void) => {
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
      providerId: DSH_PROVIDER_ID,
      profileId: this.profile.profileId,
      displayName: this.profile.displayName,
      connectionKind: 'process',
      runtime: {
        name: this.runtime.name,
        version: this.runtime.version,
        protocol: 'JSON-RPC 2.0 over stdio JSONL',
        protocolVersion: 'current',
      },
      compatibility: 'experimental',
      warnings: [
        {
          code: 'pre_release_upstream_protocol',
          message:
            'The DeepSeek Harness SDK protocol does not negotiate a compatibility version.',
        },
      ],
    });
  }

  capabilities(): Promise<CapabilityManifest> {
    return Promise.resolve(this.capabilityManifest());
  }

  createSession(input: CreateSessionInput = {}): Promise<HarnessSession> {
    return Promise.resolve().then(() => {
      this.assertOpen();
      validateDshSessionInput(input, pathToFileURL(this.initialize.cwd).href);
      const sessionId = providerSessionId(
        `harapter-dsh-session-${String(++this.sessionSerial)}`,
      );
      return new DshSession(this, sessionId);
    });
  }

  resumeSession(ref: SessionRef): Promise<HarnessSession> {
    return Promise.resolve().then(() => {
      this.assertOpen();
      assertSessionOwnership(ref, DSH_PROVIDER_ID, this.profile.profileId);
      throw new HarnessError(
        'unsupported_capability',
        'DeepSeek Harness SDK Sessions cannot be resumed through the current protocol.',
        {
          retryable: false,
          providerId: DSH_PROVIDER_ID,
          profileId: this.profile.profileId,
          details: { capability: 'session.resume' },
        },
      );
    });
  }

  extensions(): ExtensionRegistry {
    return this.extensionRegistry;
  }

  native<T = unknown>(guard?: (value: unknown) => value is T): T | undefined {
    const value: unknown = this.nativeClient;
    return guard !== undefined && !guard(value) ? undefined : (value as T);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce(true);
    return this.closePromise;
  }

  sessionRef(sessionId: ProviderSessionId): SessionRef {
    return {
      providerId: DSH_PROVIDER_ID,
      profileId: this.profile.profileId,
      providerSessionId: sessionId,
      compatibilityRef: DSH_SESSION_COMPATIBILITY_REF,
      providerState: {
        createdRuntimeVersion: this.runtime.version,
      },
    };
  }

  capabilityManifest(): CapabilityManifest {
    return dshCapabilities(this.profile, this.runtimeIdentity());
  }

  hasActiveRun(sessionId?: ProviderSessionId): boolean {
    return (
      this.activeRun !== undefined &&
      (sessionId === undefined || this.activeRun.ref().sessionId === sessionId)
    );
  }

  async startRun(
    sessionId: ProviderSessionId,
    input: HarnessInput,
    options: RunOptions = {},
  ): Promise<HarnessRun> {
    this.assertOpen();
    if (this.activeRun !== undefined) {
      throw new HarnessError(
        'run_conflict',
        'DeepSeek Harness allows one active Harapter Run per connection.',
        {
          retryable: false,
          providerId: DSH_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
    const contentBlocks = prepareDshPrompt(input, options);
    const run = new DshRun(
      {
        providerId: DSH_PROVIDER_ID,
        profileId: this.profile.profileId,
        sessionId,
        runId: runId(`dsh-run-${String(++this.runSerial)}`),
      },
      this.maxRunEvents,
      options.timeoutMs,
      (reason) => {
        this.abortConnection(reason);
      },
      (terminal) => {
        if (this.activeRun === terminal) this.activeRun = undefined;
      },
    );
    this.activeRun = run;
    try {
      const response = await this.transport.request('session/prompt', {
        sessionId,
        contentBlocks,
      });
      const messageId = parseDshPromptResponse(response);
      run.acknowledge(messageId);
      return run;
    } catch (error) {
      const failure = mapError(
        error,
        this.profile,
        'session/prompt',
        false,
        this.transport,
      );
      if (this.activeRun === run) this.activeRun = undefined;
      run.discardBeforeReturn();
      if (!(error instanceof JsonRpcRemoteError)) {
        this.abortConnection('prompt_outcome_unknown');
      }
      throw failure;
    }
  }

  respond(
    sessionId: ProviderSessionId,
    _requestId: string,
    _response: InteractionResponse,
  ): Promise<void> {
    return Promise.resolve().then(() => {
      this.assertOpen();
      throw new HarnessError(
        'unsupported_capability',
        'DeepSeek Harness does not expose host interaction responses in the current SDK protocol.',
        {
          retryable: false,
          providerId: DSH_PROVIDER_ID,
          profileId: this.profile.profileId,
          details: {
            capability: 'interaction.provider',
            sessionId: String(sessionId),
          },
        },
      );
    });
  }

  private async pump(): Promise<void> {
    try {
      for await (const message of this.transport.incoming()) {
        if (message.kind === 'request') await this.handleRequest(message);
        else this.handleNotification(message.method, message.params);
      }
    } catch {
      if (!this.closed) this.abortConnection('transport_ended');
    }
  }

  private async handleRequest(
    message: Extract<JsonRpcInboundMessage, { kind: 'request' }>,
  ): Promise<void> {
    const raw = redactDshEvent(message.method, message.params);
    this.emitNotification(raw);
    this.emitUnknown(raw);
    await this.transport.respondError(message.id, {
      code: -32_601,
      message: 'Harapter does not implement Provider-initiated requests.',
    });
  }

  private handleNotification(method: string, params: unknown): void {
    const raw = redactDshEvent(method, params);
    this.emitNotification(raw);
    try {
      if (method === 'session.event') {
        this.handleSessionEvent(raw, params);
        return;
      }
      if (method === 'session.status') {
        this.handleSessionStatus(raw, params);
        return;
      }
      if (method === 'subagent.started') {
        this.handleSubagentStarted(raw, params);
        return;
      }
      if (method === 'subagent.finished') {
        this.handleSubagentFinished(raw, params);
        return;
      }
      this.emitUnknown(raw);
      this.activeRun?.receive({ kind: 'raw', event: raw });
    } catch (error) {
      this.failProtocol(error);
    }
  }

  private handleSessionEvent(raw: DshRawEvent, params: unknown): void {
    const parsed = parseDshSessionEventNotification(params);
    const run = this.activeRun;
    if (run?.ownsRootSession(parsed.sessionId) === true) {
      run.receive({ kind: 'event', event: parsed.event });
      return;
    }
    if (run?.ownsChildSession(parsed.sessionId) === true) {
      this.emitUnknown(raw);
      run.receive({ kind: 'raw', event: raw });
      return;
    }
    this.emitUnknown(raw);
  }

  private handleSessionStatus(raw: DshRawEvent, params: unknown): void {
    const parsed = parseDshStatusNotification(params);
    const run = this.activeRun;
    if (run?.ownsRootSession(parsed.sessionId) === true) {
      run.receive({ kind: 'status', status: parsed.status });
      return;
    }
    this.emitUnknown(raw);
    if (run?.ownsChildSession(parsed.sessionId) === true) {
      run.receive({ kind: 'raw', event: raw });
    }
  }

  private handleSubagentStarted(raw: DshRawEvent, params: unknown): void {
    const parsed = parseDshSubagentStarted(params);
    const run = this.activeRun;
    if (
      run?.hasPromptCorrelation() === true &&
      run.ownsSession(parsed.parentSessionId)
    ) {
      run.registerChild(parsed.parentSessionId, parsed.childSessionId);
      run.receive({ kind: 'raw', event: raw });
    }
    this.emitUnknown(raw);
  }

  private handleSubagentFinished(raw: DshRawEvent, params: unknown): void {
    const parsed = parseDshSubagentFinished(params);
    const run = this.activeRun;
    if (run?.ownsChildSession(parsed.childSessionId) === true) {
      run.finishChild(parsed.parentSessionId, parsed.childSessionId);
      run.receive({ kind: 'raw', event: raw });
    }
    this.emitUnknown(raw);
  }

  private emitNotification(event: DshRawEvent): void {
    emitToListeners(this.notificationListeners, event);
  }

  private emitUnknown(event: DshRawEvent): void {
    emitToListeners(this.unknownListeners, event);
  }

  private async nativeRequest<TResult>(
    method: string,
    params: unknown,
    options: JsonRpcRequestOptions = {},
  ): Promise<TResult> {
    this.assertOpen();
    return this.transport.request<TResult>(method, params, options);
  }

  private async nativeNotify(method: string, params: unknown): Promise<void> {
    this.assertOpen();
    return this.transport.notify(method, params);
  }

  private failProtocol(error: unknown): void {
    const failure =
      error instanceof HarnessError
        ? error
        : new HarnessError(
            'provider_api_incompatible',
            'DeepSeek Harness emitted an incompatible notification.',
            {
              retryable: false,
              providerId: DSH_PROVIDER_ID,
              profileId: this.profile.profileId,
            },
          );
    this.activeRun?.failProtocol(failure.code);
    this.abortConnection('protocol_incompatible');
  }

  private abortConnection(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.activeRun?.abortConnection(reason);
    this.activeRun = undefined;
    void this.transport.close().catch(() => undefined);
  }

  private async closeOnce(graceful: boolean): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.activeRun?.abortConnection('client_closed');
      this.activeRun = undefined;
    }
    if (graceful && this.transport.isOpen()) {
      await this.transport
        .request('shutdown', undefined, {
          timeoutMs: this.shutdownTimeoutMs,
        })
        .catch(() => undefined);
    }
    try {
      await this.transport.close();
    } catch (error) {
      throw mapError(error, this.profile, 'close', false, this.transport);
    }
  }

  private runtimeIdentity(): string {
    return dshCompatibilityIdentity(this.runtime.version);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new HarnessError(
        'connection_aborted',
        'DeepSeek Harness SDK Runtime is closed.',
        {
          retryable: false,
          providerId: DSH_PROVIDER_ID,
          profileId: this.profile.profileId,
        },
      );
    }
  }
}

class DshSession implements HarnessSession {
  private closed = false;

  constructor(
    private readonly client: DshClient,
    private readonly sessionId: ProviderSessionId,
  ) {}

  ref(): SessionRef {
    return this.client.sessionRef(this.sessionId);
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
    if (this.closed) return Promise.resolve();
    if (this.client.hasActiveRun(this.sessionId)) {
      return Promise.reject(
        new HarnessError(
          'run_conflict',
          'Cannot close a DeepSeek Harness Session with an active Run.',
          {
            retryable: false,
            providerId: DSH_PROVIDER_ID,
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
      throw new HarnessError(
        'session_not_found',
        'DeepSeek Harness Session is closed.',
        {
          retryable: false,
          providerId: DSH_PROVIDER_ID,
          profileId: this.ref().profileId,
        },
      );
    }
  }
}

class DshRun implements HarnessRun {
  private readonly childParents = new Map<string, string>();
  private readonly eventQueue: EventQueue;
  private readonly pending: PendingRunNotification[] = [];
  private readonly settlement: Promise<RunResult>;
  private readonly timeout: NodeJS.Timeout | undefined;
  private correlationStarted = false;
  private finalMessage: string | undefined;
  private finalResult: RunResult | undefined;
  private lastEventSequence: number | undefined;
  private messageId: string | undefined;
  private resolveSettlement!: (result: RunResult) => void;
  private sequence = 0;
  private terminal: ReturnType<typeof mapDshSessionEvent>['terminal'];
  private terminalCount = 0;
  private usage: UsageSummary | undefined;

  constructor(
    private readonly reference: RunRef,
    private readonly maxRunEvents: number,
    timeoutMs: number | undefined,
    private readonly abortOwnerConnection: (reason: string) => void,
    private readonly onTerminal: (run: DshRun) => void,
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
            this.abortOwnerConnection('local_timeout');
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
    return Promise.reject(
      new HarnessError(
        'unsupported_capability',
        'DeepSeek Harness does not expose native Run cancellation in the current SDK protocol.',
        {
          retryable: false,
          providerId: DSH_PROVIDER_ID,
          profileId: this.reference.profileId,
          details: { capability: 'run.cancel' },
        },
      ),
    );
  }

  result(): Promise<RunResult> {
    return this.settlement;
  }

  ownsSession(sessionId: string): boolean {
    return this.ownsRootSession(sessionId) || this.ownsChildSession(sessionId);
  }

  hasPromptCorrelation(): boolean {
    return this.correlationStarted;
  }

  ownsChildSession(sessionId: string): boolean {
    return this.childParents.has(sessionId);
  }

  registerChild(parentSessionId: string, childSessionId: string): void {
    if (
      !this.ownsSession(parentSessionId) ||
      this.ownsSession(childSessionId)
    ) {
      throw new HarnessError(
        'provider_api_incompatible',
        'DeepSeek Harness emitted an incompatible subagent relationship.',
        { retryable: false, providerId: DSH_PROVIDER_ID },
      );
    }
    this.childParents.set(childSessionId, parentSessionId);
  }

  finishChild(parentSessionId: string, childSessionId: string): void {
    if (this.childParents.get(childSessionId) !== parentSessionId) {
      throw new HarnessError(
        'provider_api_incompatible',
        'DeepSeek Harness emitted an incompatible subagent completion.',
        { retryable: false, providerId: DSH_PROVIDER_ID },
      );
    }
    const removed = new Set([childSessionId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [candidate, parent] of this.childParents) {
        if (removed.has(parent) && !removed.has(candidate)) {
          removed.add(candidate);
          changed = true;
        }
      }
    }
    for (const sessionId of removed) this.childParents.delete(sessionId);
  }

  acknowledge(messageId: string): void {
    if (this.isTerminal()) return;
    this.messageId = messageId;
    const pending = this.pending.splice(0);
    for (const notification of pending) this.process(notification);
  }

  receive(notification: PendingRunNotification): void {
    if (this.isTerminal()) return;
    if (this.messageId === undefined) {
      if (this.pending.length >= this.maxRunEvents - 1) {
        this.abortOwnerConnection('event_buffer_overflow');
        return;
      }
      this.pending.push(notification);
      return;
    }
    this.process(notification);
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

  discardBeforeReturn(): void {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.childParents.clear();
    this.pending.length = 0;
    this.eventQueue.close();
  }

  isTerminal(): boolean {
    return this.finalResult !== undefined;
  }

  private process(notification: PendingRunNotification): void {
    if (notification.kind === 'raw') {
      if (this.correlationStarted) {
        this.emit({
          type: 'provider',
          data: { method: notification.event.method },
          providerEventType: notification.event.method,
          raw: notification.event,
        });
      }
      return;
    }
    if (notification.kind === 'status') {
      if (notification.status === 'idle' && this.correlationStarted) {
        this.finishAtIdle();
      }
      return;
    }

    if (
      this.correlationStarted &&
      (this.lastEventSequence === undefined ||
        notification.event.seq !== this.lastEventSequence + 1)
    ) {
      this.failProtocol('provider_api_incompatible');
      this.abortOwnerConnection('protocol_incompatible');
      return;
    }
    if (!this.correlationStarted) {
      if (notification.event.type !== 'agent/inbox/spliced') return;
      const mapping = mapDshSessionEvent(notification.event);
      if (mapping.insertedMessageIds.includes(this.messageId ?? '')) {
        if (
          mapping.insertedMessageCount !== 1 ||
          mapping.insertedMessageIds.length !== 1 ||
          mapping.insertedMessageIds[0] !== this.messageId
        ) {
          this.failProtocol('ambiguous_prompt_receipt');
          this.abortOwnerConnection('protocol_incompatible');
          return;
        }
        this.correlationStarted = true;
        this.lastEventSequence = notification.event.seq;
      } else {
        return;
      }
      for (const event of mapping.events) this.emit(event);
      return;
    }

    const mapping = mapDshSessionEvent(notification.event);
    if (mapping.insertedMessageCount > 0) {
      this.failProtocol('competing_prompt');
      this.abortOwnerConnection('protocol_incompatible');
      return;
    }
    this.lastEventSequence = notification.event.seq;

    if (mapping.terminal !== undefined) {
      this.terminalCount += 1;
      this.terminal ??= mapping.terminal;
    }
    for (const event of mapping.events) this.emit(event);
  }

  private emit(mapped: MappedDshEvent): void {
    if (this.isTerminal()) return;
    if (mapped.finalMessage !== undefined) {
      this.finalMessage = mapped.finalMessage;
    }
    if (mapped.usage !== undefined) this.usage = mapped.usage;
    if (!this.eventQueue.push(this.portableEvent(mapped))) {
      this.abortOwnerConnection('event_buffer_overflow');
    }
  }

  private finishAtIdle(): void {
    if (this.terminalCount !== 1 || this.terminal === undefined) {
      this.finish(
        {
          status: 'failed',
          providerResult: {
            reason:
              this.terminalCount === 0
                ? 'missing_terminal_reason'
                : 'duplicate_terminal_reason',
          },
        },
        'run.failed',
      );
      return;
    }
    const terminal = this.terminal;
    const result: RunResult = {
      ...terminal.result,
      ...(terminal.result.status === 'completed' &&
      this.finalMessage !== undefined
        ? { finalMessage: this.finalMessage }
        : {}),
      ...(this.usage === undefined ? {} : { usage: this.usage }),
    };
    this.finish(result, terminal.valid ? terminal.eventType : 'run.failed');
  }

  private finish(result: RunResult, type: HarnessEvent['type']): void {
    if (this.isTerminal()) return;
    this.finalResult = result;
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.childParents.clear();
    this.eventQueue.pushTerminal(this.portableEvent({ type, data: result }));
    this.eventQueue.close();
    this.onTerminal(this);
    this.resolveSettlement(result);
  }

  private portableEvent(mapped: MappedDshEvent): HarnessEvent {
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

  ownsRootSession(sessionId: string): boolean {
    return this.reference.sessionId === sessionId;
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
                'DeepSeek Harness Run events already have a consumer.',
                { retryable: false, providerId: DSH_PROVIDER_ID },
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
    if (event !== undefined) {
      return Promise.resolve({ done: false, value: event });
    }
    if (this.closed) return Promise.resolve({ done: true, value: undefined });
    if (this.waiter !== undefined) {
      return Promise.reject(
        new HarnessError(
          'run_conflict',
          'A DeepSeek Harness event read is already pending.',
          { retryable: false, providerId: DSH_PROVIDER_ID },
        ),
      );
    }
    return new Promise((resolveNext) => {
      this.waiter = resolveNext;
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
      emitJsonRpcVersion: true,
      readable: child.stdout,
      writable: child.stdin,
      cleanup: () => terminateChild(child),
    });
  } catch (error) {
    await terminateChild(child);
    throw error;
  }
}

function processStarted(child: DshChildProcess): Promise<void> {
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

async function terminateChild(child: DshChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (await waitForChildExit(child, childTerminationTimeoutMs)) return;
  child.kill('SIGKILL');
  if (await waitForChildExit(child, childTerminationTimeoutMs)) return;
  throw new Error(
    'DeepSeek Harness child process did not exit after forced termination.',
  );
}

function waitForChildExit(
  child: DshChildProcess,
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

function dshCapabilities(
  profile: HarnessProfile,
  runtimeIdentity: string,
): CapabilityManifest {
  const native: CapabilityStatus = { mode: 'native', source: 'schema' };
  const unsupported: CapabilityStatus = {
    mode: 'unsupported',
    source: 'schema',
  };
  return {
    providerId: DSH_PROVIDER_ID,
    profileId: profile.profileId,
    capabilities: {
      'session.create': native,
      'session.resume': unsupported,
      'session.fork': unsupported,
      'session.close': {
        mode: 'adapter_controlled',
        reason: 'Closing a Harapter Session only closes its local handle.',
        source: 'configuration',
      },
      'run.stream': native,
      'run.cancel': unsupported,
      'run.timeout': {
        mode: 'adapter_controlled',
        reason: 'A local timeout aborts the owning runtime connection.',
        source: 'configuration',
      },
      'connection.abort': {
        mode: 'adapter_controlled',
        source: 'configuration',
      },
      'input.text': native,
      'input.image': unsupported,
      'input.file': unsupported,
      'interaction.approval': unsupported,
      'interaction.user_input': unsupported,
      'interaction.provider': unsupported,
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
): ResolvedConnectionOptions {
  const options = value ?? {};
  const allowed = new Set([
    'maxBufferedMessages',
    'maxMessageBytes',
    'maxPendingInboundRequests',
    'maxPendingRequests',
    'maxPendingWrites',
    'maxRunEvents',
    'maxTokens',
    'model',
    'provider',
    'reasoningEffort',
    'requestTimeoutMs',
    'shutdownTimeoutMs',
  ]);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw profileInvalid(profile);
  }
  const provider = nonEmptyProfileString(options['provider'], 'provider');
  const model = nonEmptyProfileString(options['model'], 'model');
  const transport: Record<string, number | boolean> = {
    emitJsonRpcVersion: true,
  };
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
  const reasoningEffort =
    options['reasoningEffort'] === undefined
      ? undefined
      : nonEmptyProfileString(options['reasoningEffort'], 'reasoningEffort');
  const maxTokens =
    options['maxTokens'] === undefined
      ? undefined
      : positiveProfileInteger(options['maxTokens'], 'maxTokens');
  const cwd = resolve(
    profile.connection.kind === 'process'
      ? (profile.connection.cwd ?? process.cwd())
      : process.cwd(),
  );
  return {
    initialize: {
      cwd,
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    },
    maxRunEvents: runEventCapacity(options['maxRunEvents']),
    shutdownTimeoutMs:
      options['shutdownTimeoutMs'] === undefined
        ? defaultShutdownTimeoutMs
        : positiveProfileTimer(
            options['shutdownTimeoutMs'],
            'shutdownTimeoutMs',
          ),
    transport,
  };
}

function runEventCapacity(value: unknown): number {
  if (value === undefined) return defaultMaxRunEvents;
  const capacity = positiveProfileInteger(value, 'maxRunEvents');
  if (capacity < 2) {
    throw new HarnessError(
      'profile_invalid',
      'DeepSeek Harness maxRunEvents must reserve a terminal event.',
      { retryable: false, providerId: DSH_PROVIDER_ID },
    );
  }
  if (capacity > maximumRunEvents) {
    throw new HarnessError(
      'profile_invalid',
      `DeepSeek Harness maxRunEvents cannot exceed ${String(maximumRunEvents)}.`,
      { retryable: false, providerId: DSH_PROVIDER_ID },
    );
  }
  return capacity;
}

function validateProfile(profile: HarnessProfile): void {
  if (
    profile.providerId !== DSH_PROVIDER_ID ||
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
    'DeepSeek Harness requires an adapter-owned process Profile, provider and model options, and no unresolved Secret references.',
    {
      retryable: false,
      providerId: DSH_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}

function nonEmptyProfileString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HarnessError(
      'profile_invalid',
      `DeepSeek Harness ${label} must be a non-empty string.`,
      { retryable: false, providerId: DSH_PROVIDER_ID },
    );
  }
  return value;
}

function positiveProfileInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HarnessError(
      'profile_invalid',
      `DeepSeek Harness ${label} must be a positive integer.`,
      { retryable: false, providerId: DSH_PROVIDER_ID },
    );
  }
  return value;
}

function positiveProfileTimer(value: unknown, label: string): number {
  const timeout = positiveProfileInteger(value, label);
  if (timeout > maximumTimerMilliseconds) {
    throw new HarnessError(
      'profile_invalid',
      `DeepSeek Harness ${label} exceeds the supported timer range.`,
      { retryable: false, providerId: DSH_PROVIDER_ID },
    );
  }
  return timeout;
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
      'DeepSeek Harness Run timeoutMs must be a positive supported timer value.',
      { retryable: false, providerId: DSH_PROVIDER_ID },
    );
  }
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
  listeners: ReadonlySet<(event: DshRawEvent) => void>,
  event: DshRawEvent,
): void {
  for (const listener of [...listeners]) {
    try {
      listener(structuredClone(event));
    } catch {
      // Provider observers cannot break lifecycle processing.
    }
  }
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
    return new HarnessError(
      remote.code === -32_601 ? 'provider_api_incompatible' : 'provider_error',
      `DeepSeek Harness rejected ${phase}.`,
      {
        retryable: false,
        providerId: DSH_PROVIDER_ID,
        profileId: profile.profileId,
        providerCode: String(remote.code),
      },
    );
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
      `DeepSeek Harness ${phase} did not complete.`,
      {
        retryable:
          error.code === 'request_timeout' ||
          error.code === 'capacity_exceeded',
        providerId: DSH_PROVIDER_ID,
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
      'The configured DeepSeek Harness runtime was not found.',
      {
        retryable: false,
        providerId: DSH_PROVIDER_ID,
        profileId: profile.profileId,
      },
    );
  }
  return new HarnessError(
    connecting ? 'connection_failed' : 'provider_error',
    `DeepSeek Harness ${phase} failed.`,
    {
      retryable: false,
      providerId: DSH_PROVIDER_ID,
      profileId: profile.profileId,
    },
  );
}
