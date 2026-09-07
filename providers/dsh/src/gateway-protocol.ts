import { createHash } from 'node:crypto';
import type { RunResult, UsageSummary } from '@harapter/core';
import {
  mapDshSessionEvent,
  parseDshSessionEventNotification,
  redactDshEvent,
  type DshSessionEvent,
  type MappedDshEvent,
} from './protocol.js';
import { gatewayError, gatewayRecord } from './gateway-transport.js';

const passiveEvents = new Set([
  'request/context',
  'request/header',
  'session/title',
  'session/title-llm-request',
  'agent-preset/selected',
  'model/selection',
  'permission/preset',
  'sandbox/mode',
  'approval/policy',
  'llm/retry',
  'llm/retry-started',
]);
const mappedEvents = new Set([
  'assistant/message',
  'assistant/attempt',
  'tool/call',
  'tool/result',
]);

/** One-way diagnostic identity, never a credential or native-path serialization. */
export function gatewayFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Bounded native identity or other required wire string. */
export function gatewayString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048;
}

function integer(value: unknown, minimum = 0): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
  );
}

interface QueuedInput {
  readonly id: string;
  readonly requestId: string | undefined;
}

function user(value: unknown): QueuedInput {
  const input = gatewayRecord(value);
  const source = gatewayRecord(input?.['source']);
  const requestId = source?.['rpcId'];
  if (
    !gatewayString(input?.['id']) ||
    input['role'] !== 'user' ||
    !Array.isArray(input['content']) ||
    !gatewayString(source?.['kind']) ||
    (requestId !== undefined && !gatewayString(requestId))
  )
    throw gatewayError('provider_api_incompatible');
  return {
    id: input['id'],
    requestId:
      source['kind'] === 'user' && typeof requestId === 'string'
        ? requestId
        : undefined,
  };
}

function provider(event: DshSessionEvent): MappedDshEvent {
  const eventType =
    passiveEvents.has(event.type) ||
    mappedEvents.has(event.type) ||
    [
      'turn/start',
      'turn/end',
      'step/start',
      'step/end',
      'user/message',
      'agent/inbox/spliced',
      'session/end-seed',
    ].includes(event.type)
      ? event.type
      : `unknown-${gatewayFingerprint(event.type).slice(0, 16)}`;
  return {
    type: 'provider',
    data: { eventType },
    providerEventType: eventType,
    raw: redactDshEvent('session.event', { event }),
  };
}

/** Contiguous Session log plus the exact request currently owned by Harapter. */
export class GatewaySessionLog {
  cursor = -1;
  private turn: number | undefined;
  private step: number | undefined;
  private lastTurn = 0;
  private readonly inbox: Record<'next-turn' | 'next-step', QueuedInput[]> = {
    'next-turn': [],
    'next-step': [],
  };
  private requestId: string | undefined;
  private correlated = false;
  private claim: { readonly id: string; readonly turn: number } | undefined;
  private finalResult: RunResult | undefined;
  private finalMessage: string | undefined;
  private usage: UsageSummary | undefined;

  isIdle(): boolean {
    return (
      this.turn === undefined &&
      this.inbox['next-turn'].length === 0 &&
      this.inbox['next-step'].length === 0
    );
  }

  begin(requestId: string): void {
    if (!this.isIdle() || this.requestId !== undefined)
      throw gatewayError('run_conflict', 'session_busy');
    this.requestId = requestId;
    this.correlated = false;
    this.claim = undefined;
    this.finalResult = undefined;
    this.finalMessage = undefined;
    this.usage = undefined;
  }

  terminal(): RunResult | undefined {
    return this.finalResult === undefined
      ? undefined
      : structuredClone(this.finalResult);
  }

  release(): void {
    this.requestId = undefined;
  }

  accept(value: unknown): { readonly events: readonly MappedDshEvent[] } {
    const record = gatewayRecord(value);
    if (
      record?.['surfaceOp'] !== undefined &&
      record['surfaceOp'] !== 'append'
    ) {
      throw gatewayError('provider_api_incompatible', 'surface_replacement');
    }
    const { event } = parseDshSessionEventNotification({
      sessionId: 'gateway',
      event: value,
    });
    if (event.seq !== this.cursor + 1)
      throw gatewayError('provider_api_incompatible', 'event_gap');
    const owned = this.requestId !== undefined;
    if (
      owned &&
      this.finalResult !== undefined &&
      !['session/title', 'session/title-llm-request'].includes(event.type)
    )
      throw gatewayError('run_conflict', 'activity_before_receipt');
    let events: readonly MappedDshEvent[] = [provider(event)];
    if (event.type === 'agent/inbox/spliced') {
      this.splice(event);
    } else if (event.type === 'turn/start') {
      const turn = event.data['turn'];
      if (!integer(turn, 1) || turn <= this.lastTurn || this.turn !== undefined)
        throw gatewayError('provider_api_incompatible', 'turn_conflict');
      this.turn = turn;
      this.lastTurn = turn;
    } else if (event.type === 'step/start' || event.type === 'step/end') {
      if (
        event.data['turn'] !== this.turn ||
        !integer(event.data['step'], 1) ||
        this.turn === undefined
      )
        throw gatewayError('provider_api_incompatible', 'step_conflict');
      if (event.type === 'step/start') {
        if (this.step !== undefined)
          throw gatewayError('provider_api_incompatible', 'step_conflict');
        this.step = event.data['step'];
      } else {
        if (this.step !== event.data['step'])
          throw gatewayError('provider_api_incompatible', 'step_conflict');
        this.step = undefined;
      }
    } else if (event.type === 'user/message') {
      const message = user(event.data);
      const source = gatewayRecord(event.data['source']);
      const context =
        source?.['kind'] === 'plugin' &&
        source['plugin'] === '@deepseek-ai/dsh-system-prompt' &&
        source['rpcId'] === undefined;
      if (owned) {
        if (
          this.claim === undefined ||
          this.claim.turn !== this.turn ||
          this.step === undefined ||
          (!context &&
            (message.requestId !== this.requestId ||
              message.id !== this.claim.id ||
              this.correlated))
        )
          throw gatewayError('run_conflict', 'competing_input');
        if (!context) this.correlated = true;
      }
    } else if (mappedEvents.has(event.type)) {
      if (
        this.turn === undefined ||
        event.data['turn'] !== this.turn ||
        this.step === undefined ||
        event.data['step'] !== this.step ||
        (owned && !this.correlated)
      )
        throw gatewayError('provider_api_incompatible', 'unowned_output');
      if (
        (event.type === 'assistant/message' ||
          event.type === 'assistant/attempt') &&
        !Array.isArray(event.data['stream'])
      )
        throw gatewayError('provider_api_incompatible');
      if (event.type !== 'assistant/attempt') {
        const mapping = mapDshSessionEvent(event);
        if (owned) {
          events = mapping.events;
          for (const mapped of events) {
            if (mapped.finalMessage !== undefined)
              this.finalMessage = mapped.finalMessage;
            if (mapped.usage !== undefined) this.addUsage(mapped.usage);
          }
        }
      }
    } else if (event.type === 'turn/end') {
      if (
        this.turn === undefined ||
        event.data['turn'] !== this.turn ||
        this.step !== undefined
      )
        throw gatewayError('provider_api_incompatible', 'turn_conflict');
      const terminal = mapDshSessionEvent(event).terminal;
      if (terminal?.valid !== true)
        throw gatewayError('provider_api_incompatible', 'terminal_invalid');
      if (owned) {
        if (this.claim?.turn !== this.turn)
          throw gatewayError('run_conflict', 'uncorrelated_terminal');
        this.finalResult = {
          ...terminal.result,
          ...(gatewayRecord(terminal.result.providerResult)?.['reason'] ===
          'error'
            ? { providerResult: { reason: 'error' } }
            : {}),
          ...(this.finalMessage === undefined
            ? {}
            : { finalMessage: this.finalMessage }),
          ...(this.usage === undefined ? {} : { usage: this.usage }),
        };
      }
      this.turn = undefined;
      events = [];
    } else if (event.type === 'session/end-seed') {
      if (this.turn !== undefined || owned)
        throw gatewayError('provider_api_incompatible', 'seed_during_run');
      if (event.data['inherited'] === true) {
        this.inbox['next-turn'].length = 0;
        this.inbox['next-step'].length = 0;
      }
    } else if (!passiveEvents.has(event.type) && event.ignorable !== true) {
      throw gatewayError('provider_api_incompatible', 'unknown_required_event');
    }
    this.cursor = event.seq;
    return { events };
  }

  private splice(event: DshSessionEvent): void {
    const { target, start, inserted, removedCount = 0, outcome } = event.data;
    if (
      (target !== 'next-turn' && target !== 'next-step') ||
      !integer(start) ||
      !integer(removedCount) ||
      !Array.isArray(inserted) ||
      (outcome !== undefined && outcome !== 'canceled')
    )
      throw gatewayError('provider_api_incompatible');
    const queue = this.inbox[target];
    if (start > queue.length || start + removedCount > queue.length)
      throw gatewayError('provider_api_incompatible', 'inbox_gap');
    const inputs = inserted.map(user);
    if (
      this.requestId !== undefined &&
      inputs.some((input) => input.requestId !== this.requestId)
    )
      throw gatewayError('run_conflict', 'competing_input');
    const removed = queue.slice(start, start + removedCount);
    if (
      this.requestId !== undefined &&
      removed.length > 0 &&
      outcome === undefined
    ) {
      const claimed = removed[0];
      if (
        this.turn === undefined ||
        this.claim !== undefined ||
        inputs.length !== 0 ||
        removed.length !== 1 ||
        claimed?.requestId !== this.requestId
      )
        throw gatewayError('run_conflict', 'unowned_claim');
      this.claim = { id: claimed.id, turn: this.turn };
    }
    const next = queue.toSpliced(start, removedCount, ...inputs);
    const all = [
      ...next,
      ...this.inbox[target === 'next-turn' ? 'next-step' : 'next-turn'],
    ];
    if (
      all.length > 256 ||
      new Set(all.map((input) => input.id)).size !== all.length
    )
      throw gatewayError('provider_api_incompatible', 'inbox_capacity');
    queue.splice(start, removedCount, ...inputs);
  }

  private addUsage(usage: UsageSummary): void {
    this.usage ??= {};
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
      const value = usage[key];
      if (value !== undefined) this.usage[key] = (this.usage[key] ?? 0) + value;
    }
  }
}

/** Validate a complete bounded Session v2 opening without treating it as Agent readiness. */
export function parseGatewaySnapshot(
  value: unknown,
  sessionId: string,
): {
  readonly log: GatewaySessionLog;
  readonly headerFingerprint: string;
  readonly parentSession: string | undefined;
} {
  const snapshot = gatewayRecord(value);
  const header = gatewayRecord(snapshot?.['header']);
  const projections = gatewayRecord(snapshot?.['projections']);
  if (
    snapshot?.['type'] !== 'snapshot' ||
    header?.['version'] !== 2 ||
    header['id'] !== sessionId ||
    !integer(header['createdAt']) ||
    typeof header['isSeeded'] !== 'boolean' ||
    !gatewayString(header['cwd']) ||
    (header['parentSession'] !== undefined &&
      !gatewayString(header['parentSession'])) ||
    (header['agentPreset'] !== undefined &&
      !gatewayString(header['agentPreset'])) ||
    !integer(snapshot['cursor'], -1) ||
    !Array.isArray(snapshot['records']) ||
    snapshot['records'].length > 4096 ||
    typeof snapshot['hasMore'] !== 'boolean' ||
    projections?.['asOfSeq'] !== snapshot['cursor'] ||
    gatewayRecord(projections['values']) === undefined
  )
    throw gatewayError('provider_api_incompatible', 'snapshot_invalid');
  if (header['origin'] !== undefined)
    throw gatewayError('session_provider_mismatch', 'subagent_owned');
  if (snapshot['hasMore'])
    throw gatewayError('unsupported_capability', 'history_capacity');
  const log = new GatewaySessionLog();
  for (const record of snapshot['records']) {
    const entry = gatewayRecord(record);
    if (entry?.['type'] !== 'event')
      throw gatewayError('provider_api_incompatible', 'snapshot_invalid');
    log.accept(entry['event']);
  }
  if (log.cursor !== snapshot['cursor'])
    throw gatewayError('provider_api_incompatible', 'snapshot_gap');
  return {
    log,
    parentSession: header['parentSession'],
    headerFingerprint: gatewayFingerprint([
      header['id'],
      header['version'],
      header['createdAt'],
      header['cwd'],
      header['isSeeded'],
      header['parentSession'],
      header['agentPreset'],
    ]),
  };
}

/** Low-side-effect schema probe; none of the catalog content is exposed or retained. */
export function validateGatewayCatalog(value: unknown): void {
  const catalog = gatewayRecord(value);
  const selected = gatewayRecord(catalog?.['default']);
  if (
    !gatewayString(selected?.['provider']) ||
    !gatewayString(selected['model']) ||
    !Array.isArray(catalog?.['routableProviders']) ||
    !catalog['routableProviders'].every(gatewayString) ||
    !Array.isArray(catalog['groups']) ||
    !Array.isArray(catalog['failures'])
  )
    throw gatewayError('provider_api_incompatible', 'catalog_invalid');
}
