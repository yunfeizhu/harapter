import { createHash } from 'node:crypto';
import {
  HarnessError,
  providerId,
  type CreateSessionInput,
  type HarnessEvent,
  type HarnessInput,
  type RunOptions,
  type RunResult,
  type UsageSummary,
} from '@harapter/core';

/** Stable Provider identity owned by the DeepSeek Harness Provider Adapter. */
export const DSH_PROVIDER_ID = providerId('deepseek.harness');

/** Provider-owned extension for bounded, redacted notification observation. */
export const DSH_NOTIFICATION_EXTENSION = 'deepseek.harness.notifications';

/** Structural protocol family used for new Session references. */
export const DSH_SESSION_COMPATIBILITY_REF = `${DSH_PROVIDER_ID};sdk-jsonrpc-stdio=current`;

/** Bounded and redacted structural view of one upstream notification. */
export interface DshRawEvent {
  readonly method: string;
  readonly params: unknown;
}

/** Validated process-wide handshake configuration. */
export interface DshInitializeParams {
  readonly cwd: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: string;
  readonly maxTokens?: number;
}

/** Runtime identity returned by the official initialize method. */
export interface DshRuntimeIdentity {
  readonly name: 'deepseek-harness-sdk-runtime';
  readonly version: string;
}

/** Validated session-log event envelope used by the Adapter. */
export interface DshSessionEvent {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly ignorable?: true;
}

/** Portable mapping produced before Run identity and sequence are attached. */
export interface MappedDshEvent {
  readonly type: HarnessEvent['type'];
  readonly data: unknown;
  readonly providerEventType?: string;
  readonly raw?: DshRawEvent;
  readonly finalMessage?: string;
  readonly usage?: UsageSummary;
}

/** Fail-closed terminal observation retained until the whole agent is idle. */
export interface DshTerminalObservation {
  readonly result: RunResult;
  readonly eventType: 'run.completed' | 'run.cancelled' | 'run.failed';
  readonly valid: boolean;
}

/** One mapped session event plus terminal and inbox-correlation facts. */
export interface DshSessionEventMapping {
  readonly events: readonly MappedDshEvent[];
  readonly insertedMessageIds: readonly string[];
  readonly terminal?: DshTerminalObservation;
}

type JsonRecord = Record<string, unknown>;

const knownPassthroughEvents = new Set([
  'agent/inbox/spliced',
  'request/context',
  'request/header',
  'session/end-seed',
  'step/end',
  'step/start',
  'turn/start',
  'user/message',
]);
const knownSessionEvents = new Set([
  ...knownPassthroughEvents,
  'assistant/chunk',
  'assistant/message',
  'tool/call',
  'tool/result',
  'turn/end',
]);
const knownMethods = new Set([
  'initialize',
  'session.event',
  'session.status',
  'session/prompt',
  'shutdown',
  'subagent.finished',
  'subagent.started',
]);
const knownStructuralValues = new Set([
  ...knownSessionEvents,
  ...knownMethods,
  'aborted',
  'assistant',
  'block-end',
  'block-start',
  'blocked',
  'canceled',
  'completed',
  'disposed',
  'error',
  'finish',
  'hook',
  'idle',
  'image',
  'interrupted',
  'legacy',
  'max-tokens',
  'model',
  'next-step',
  'next-turn',
  'ok',
  'parent',
  'plugin',
  'reasoning',
  'reasoning-delta',
  'running',
  'system',
  'text',
  'text-delta',
  'tool',
  'tool-call',
  'tool-call-delta',
  'tool-result',
  'usage',
  'user',
]);
const structuralStringKeys = new Set([
  'blockType',
  'kind',
  'method',
  'outcome',
  'status',
  'target',
  'type',
]);
const safeRawKeys = new Set([
  'block',
  'blockType',
  'cacheReadTokens',
  'cacheWriteTokens',
  'childSessionId',
  'code',
  'data',
  'error',
  'event',
  'id',
  'ignorable',
  'index',
  'inputTokens',
  'inserted',
  'kind',
  'message',
  'messageId',
  'method',
  'name',
  'outcome',
  'outputTokens',
  'params',
  'parentSessionId',
  'reason',
  'reasoningTokens',
  'removedCount',
  'seq',
  'serverInfo',
  'sessionId',
  'status',
  'step',
  'target',
  'time',
  'totalTokens',
  'turn',
  'type',
  'usage',
  'version',
]);
const identifierRawKeys = new Set([
  'childSessionId',
  'id',
  'messageId',
  'parentSessionId',
  'sessionId',
]);
const numericRawKeys = new Set([
  'cacheReadTokens',
  'cacheWriteTokens',
  'index',
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'removedCount',
  'seq',
  'step',
  'totalTokens',
  'turn',
]);

/** Build a non-sensitive identity for the observed protocol runtime. */
export function dshCompatibilityIdentity(runtimeVersion: string): string {
  return `${DSH_SESSION_COMPATIBILITY_REF};runtime=${runtimeDiagnostic(runtimeVersion)}`;
}

/** Validate the official initialize response without accepting lookalikes. */
export function parseDshInitializeResponse(value: unknown): DshRuntimeIdentity {
  const serverInfo = record(record(value)?.['serverInfo']);
  if (
    serverInfo?.['name'] !== 'deepseek-harness-sdk-runtime' ||
    typeof serverInfo['version'] !== 'string' ||
    serverInfo['version'].length === 0
  ) {
    throw incompatible('initialize response');
  }
  return {
    name: 'deepseek-harness-sdk-runtime',
    version: runtimeDiagnostic(serverInfo['version']),
  };
}

/** Validate the durable enqueue receipt returned by `session/prompt`. */
export function parseDshPromptResponse(value: unknown): string {
  const messageId = record(value)?.['messageId'];
  if (typeof messageId !== 'string' || messageId.length === 0) {
    throw incompatible('session/prompt response');
  }
  return messageId;
}

/** Convert portable input to the initial verified DSH prompt subset. */
export function prepareDshPrompt(
  input: HarnessInput,
  options: RunOptions = {},
): readonly Readonly<{ type: 'text'; text: string }>[] {
  if (input.parts.length === 0) {
    throw invalidRequest('A DeepSeek Harness Run requires text input.');
  }
  if (
    options.providerOptions !== undefined ||
    options.metadata !== undefined ||
    input.metadata !== undefined
  ) {
    throw invalidRequest(
      'DeepSeek Harness Run metadata and Provider options are not mapped.',
    );
  }
  return input.parts.map((part) => {
    if (part.type !== 'text' || part.text.length === 0) {
      throw unsupported(
        `input.${part.type}`,
        'The initial DeepSeek Harness Provider Adapter supports non-empty text parts only.',
      );
    }
    return { type: 'text', text: part.text };
  });
}

/** Reject Session settings the process-wide DSH handshake cannot represent. */
export function validateDshSessionInput(
  input: CreateSessionInput,
  initializedWorkspaceUri: string,
): void {
  if (
    input.systemContext !== undefined ||
    input.model !== undefined ||
    input.providerOptions !== undefined ||
    input.metadata !== undefined
  ) {
    throw unsupported(
      'session.options',
      'DeepSeek Harness Session settings are fixed by the process-wide Profile.',
    );
  }
  if (
    input.workspace !== undefined &&
    input.workspace.uri !== initializedWorkspaceUri
  ) {
    throw unsupported(
      'session.workspace',
      'DeepSeek Harness cannot change workspace after process initialization.',
    );
  }
}

/** Parse one `session.event` notification envelope. */
export function parseDshSessionEventNotification(value: unknown): {
  readonly sessionId: string;
  readonly event: DshSessionEvent;
} {
  const params = record(value);
  const sessionId = params?.['sessionId'];
  const event = record(params?.['event']);
  const type = event?.['type'];
  const seq = event?.['seq'];
  const time = event?.['time'];
  const data = record(event?.['data']);
  if (
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    typeof type !== 'string' ||
    type.length === 0 ||
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 0 ||
    typeof time !== 'number' ||
    !Number.isFinite(time) ||
    data === undefined ||
    (event?.['ignorable'] !== undefined && event['ignorable'] !== true)
  ) {
    throw incompatible('session.event notification');
  }
  return {
    sessionId,
    event: {
      type,
      seq,
      time,
      data,
      ...(event?.['ignorable'] === true ? { ignorable: true } : {}),
    },
  };
}

/** Parse one whole-agent status notification. */
export function parseDshStatusNotification(value: unknown): {
  readonly sessionId: string;
  readonly status: 'idle' | 'running';
} {
  const params = record(value);
  const sessionId = params?.['sessionId'];
  const status = params?.['status'];
  if (
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    (status !== 'idle' && status !== 'running')
  ) {
    throw incompatible('session.status notification');
  }
  return { sessionId, status };
}

/** Extract and validate one parent/child relationship notification. */
export function parseDshSubagentStarted(value: unknown): {
  readonly parentSessionId: string;
  readonly childSessionId: string;
} {
  const params = record(value);
  const parentSessionId = params?.['parentSessionId'];
  const childSessionId = params?.['childSessionId'];
  if (
    typeof parentSessionId !== 'string' ||
    parentSessionId.length === 0 ||
    typeof childSessionId !== 'string' ||
    childSessionId.length === 0
  ) {
    throw incompatible('subagent.started notification');
  }
  return { parentSessionId, childSessionId };
}

/** Validate the ownership fields of one completed in-process subagent. */
export function parseDshSubagentFinished(value: unknown): {
  readonly parentSessionId: string;
  readonly childSessionId: string;
} {
  const params = record(value);
  const provider = params?.['provider'];
  const agentId = params?.['agentId'];
  const parentSessionId = params?.['parentSessionId'];
  const childSessionId = params?.['childSessionId'];
  const status = params?.['status'];
  const stopReason = record(params?.['stopReason']);
  if (
    !nonEmptyString(provider) ||
    !nonEmptyString(agentId) ||
    !nonEmptyString(parentSessionId) ||
    !nonEmptyString(childSessionId) ||
    (status !== 'ok' && status !== 'error') ||
    !nonEmptyString(stopReason?.['kind']) ||
    (params?.['lastAssistantMessage'] !== undefined &&
      !contentBlocks(params['lastAssistantMessage']))
  ) {
    throw incompatible('subagent.finished notification');
  }
  return { parentSessionId, childSessionId };
}

/** Map one validated DSH session-log event to portable observations. */
export function mapDshSessionEvent(
  event: DshSessionEvent,
): DshSessionEventMapping {
  const raw = redactDshEvent('session.event', { event });
  const provider = (): MappedDshEvent => {
    const eventType = publicEventType(event.type);
    return {
      type: 'provider',
      data: { eventType },
      providerEventType: eventType,
      raw,
    };
  };

  if (event.type === 'agent/inbox/spliced') {
    const target = event.data['target'];
    const start = event.data['start'];
    const removedCount = event.data['removedCount'];
    const outcome = event.data['outcome'];
    const inserted = event.data['inserted'];
    if (
      (target !== 'next-turn' && target !== 'next-step') ||
      !nonNegativeInteger(start) ||
      (removedCount !== undefined && !nonNegativeInteger(removedCount)) ||
      (outcome !== undefined && outcome !== 'canceled') ||
      !Array.isArray(inserted)
    ) {
      throw incompatible('agent/inbox/spliced event');
    }
    const messages = inserted.map(parseUserMessage);
    const insertedMessageIds =
      target === 'next-turn' &&
      (removedCount ?? 0) === 0 &&
      outcome === undefined
        ? messages
            .filter(
              ({ content, sourceKind }) =>
                sourceKind === 'user' && content.length > 0,
            )
            .map(({ id }) => id)
        : [];
    return { events: [provider()], insertedMessageIds };
  }

  if (event.type === 'assistant/chunk') {
    requireTurnStep(event.data, event.type);
    const chunk = record(event.data['chunk']);
    const type = chunk?.['type'];
    if (type === 'text-delta' || type === 'reasoning-delta') {
      const text = chunk?.['text'];
      if (!nonNegativeInteger(chunk?.['index']) || typeof text !== 'string') {
        throw incompatible(event.type);
      }
      return {
        events: [
          {
            type: type === 'text-delta' ? 'message.delta' : 'reasoning.delta',
            data: { delta: text },
          },
        ],
        insertedMessageIds: [],
      };
    }
    if (type === 'usage') {
      const usage = parseUsage(chunk?.['usage']);
      return {
        events: [{ type: 'usage.updated', data: usage, usage }],
        insertedMessageIds: [],
      };
    }
    if (typeof type !== 'string') throw incompatible(event.type);
    return { events: [provider()], insertedMessageIds: [] };
  }

  if (event.type === 'assistant/message') {
    requireTurnStep(event.data, event.type);
    const { content } = parseAssistantMessage(event.data['message']);
    const text: string[] = [];
    for (const blockValue of content) {
      const block = record(blockValue);
      if (typeof block?.['type'] !== 'string') throw incompatible(event.type);
      if (block['type'] === 'text') {
        if (typeof block['text'] !== 'string') throw incompatible(event.type);
        text.push(block['text']);
      }
    }
    const finalMessage = text.join('');
    const usage =
      event.data['usage'] === undefined
        ? undefined
        : parseUsage(event.data['usage']);
    return {
      events: [
        {
          type: 'message.completed',
          data: { message: finalMessage },
          finalMessage,
        },
        ...(usage === undefined
          ? []
          : [{ type: 'usage.updated' as const, data: usage, usage }]),
      ],
      insertedMessageIds: [],
    };
  }

  if (event.type === 'tool/call') {
    requireTurnStep(event.data, event.type);
    const callId = event.data['callId'];
    const name = event.data['name'];
    const argumentsValue = event.data['arguments'];
    if (
      !nonEmptyString(callId) ||
      !nonEmptyString(name) ||
      typeof argumentsValue !== 'string'
    ) {
      throw incompatible(event.type);
    }
    return {
      events: [{ type: 'tool.started', data: { callId, name } }],
      insertedMessageIds: [],
    };
  }

  if (event.type === 'tool/result') {
    requireTurnStep(event.data, event.type);
    const callId = parseToolResultMessage(event.data['message']);
    const error = event.data['error'];
    if (error !== undefined) {
      const parsedError = record(error);
      const errorName = parsedError?.['name'];
      const errorCode = parsedError?.['code'];
      if (!nonEmptyString(errorName) || !nonEmptyString(errorCode)) {
        throw incompatible(event.type);
      }
    }
    return {
      events: [
        {
          type: 'tool.completed',
          data: {
            callId,
            failed: event.data['error'] !== undefined,
          },
        },
      ],
      insertedMessageIds: [],
    };
  }

  if (event.type === 'turn/end') {
    if (!positiveInteger(event.data['turn'])) throw incompatible(event.type);
    return {
      events: [],
      insertedMessageIds: [],
      terminal: terminalObservation(event.data['reason']),
    };
  }

  if (knownPassthroughEvents.has(event.type) || event.ignorable === true) {
    return { events: [provider()], insertedMessageIds: [] };
  }
  throw incompatible('required session event');
}

/** Produce a bounded structural event without prompt, content, path, or secret values. */
export function redactDshEvent(method: string, params: unknown): DshRawEvent {
  return {
    method: publicMethod(method),
    params: redact(params, 0, { nodes: 0 }),
  };
}

function terminalObservation(reasonValue: unknown): DshTerminalObservation {
  const reason = record(reasonValue);
  const kind = reason?.['kind'];
  if (kind === 'completed') {
    return {
      eventType: 'run.completed',
      result: { status: 'completed', providerResult: { reason: kind } },
      valid: true,
    };
  }
  if (kind === 'aborted') {
    const cause = record(reason?.['reason']);
    const causeKind = cause?.['kind'];
    const known = ['disposed', 'legacy', 'parent', 'user'].includes(
      String(causeKind),
    );
    const hook = causeKind === 'hook' && typeof cause?.['reason'] === 'string';
    if (!known && !hook) return invalidTerminal('malformed_aborted_reason');
    return {
      eventType: 'run.cancelled',
      result: {
        status: 'cancelled',
        providerResult: { reason: kind, cause: causeKind },
      },
      valid: true,
    };
  }
  if (kind === 'blocked' || kind === 'max-tokens' || kind === 'interrupted') {
    return {
      eventType: 'run.failed',
      result: { status: 'failed', providerResult: { reason: kind } },
      valid: true,
    };
  }
  if (kind === 'error') {
    const error = record(reason?.['error']);
    const code = error?.['code'];
    if (typeof code !== 'string') return invalidTerminal('malformed_error');
    return {
      eventType: 'run.failed',
      result: {
        status: 'failed',
        providerResult: {
          reason: kind,
          providerCode: safeToken(code) ? code : 'UNKNOWN',
        },
      },
      valid: true,
    };
  }
  return invalidTerminal(
    typeof kind === 'string' ? 'unknown_terminal_reason' : 'malformed_terminal',
  );
}

function parseUserMessage(value: unknown): {
  readonly content: readonly unknown[];
  readonly id: string;
  readonly sourceKind: string;
} {
  const message = record(value);
  const id = message?.['id'];
  const source = record(message?.['source']);
  const sourceKind = source?.['kind'];
  const content = message?.['content'];
  if (
    !nonEmptyString(id) ||
    message?.['role'] !== 'user' ||
    !contentBlocks(content) ||
    !nonEmptyString(sourceKind)
  ) {
    throw incompatible('agent/inbox/spliced event');
  }
  return { content, id, sourceKind };
}

function parseAssistantMessage(value: unknown): {
  readonly content: readonly unknown[];
} {
  const message = record(value);
  const source = record(message?.['source']);
  const content = message?.['content'];
  const role = message?.['role'];
  if (
    !nonEmptyString(message?.['id']) ||
    role !== 'assistant' ||
    !contentBlocks(content) ||
    source?.['kind'] !== 'model' ||
    !nonEmptyString(source['provider']) ||
    !nonEmptyString(source['model'])
  ) {
    throw incompatible('assistant/message event');
  }
  return { content };
}

function parseToolResultMessage(value: unknown): string {
  const message = record(value);
  const source = record(message?.['source']);
  const callId = source?.['callId'];
  const content = message?.['content'];
  const role = message?.['role'];
  const block =
    Array.isArray(content) && content.length === 1
      ? record(content[0])
      : undefined;
  if (
    !nonEmptyString(message?.['id']) ||
    role !== 'user' ||
    source?.['kind'] !== 'tool' ||
    !nonEmptyString(callId) ||
    block?.['type'] !== 'tool-result' ||
    block['toolCallId'] !== callId ||
    !contentBlocks(block['content'])
  ) {
    throw incompatible('tool/result event');
  }
  return callId;
}

function contentBlocks(value: unknown): value is readonly unknown[] {
  return (
    Array.isArray(value) &&
    value.every((item) => nonEmptyString(record(item)?.['type']))
  );
}

function requireTurnStep(data: Readonly<JsonRecord>, eventType: string): void {
  if (!positiveInteger(data['turn']) || !positiveInteger(data['step'])) {
    throw incompatible(eventType);
  }
}

function invalidTerminal(reason: string): DshTerminalObservation {
  return {
    eventType: 'run.failed',
    result: { status: 'failed', providerResult: { reason } },
    valid: false,
  };
}

function parseUsage(value: unknown): UsageSummary {
  const usage = record(value);
  const inputTokens = usage?.['inputTokens'];
  const outputTokens = usage?.['outputTokens'];
  const totalTokens = usage?.['totalTokens'];
  if (
    !nonNegativeInteger(inputTokens) ||
    !nonNegativeInteger(outputTokens) ||
    (totalTokens !== undefined && !nonNegativeInteger(totalTokens))
  ) {
    throw incompatible('usage');
  }
  return {
    inputTokens,
    outputTokens,
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function redact(
  value: unknown,
  depth: number,
  state: { nodes: number },
  key?: string,
): unknown {
  state.nodes += 1;
  if (state.nodes > 64 || depth >= 4) return '[truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return key !== undefined && numericRawKeys.has(key) ? value : '[redacted]';
  }
  if (typeof value === 'string') {
    return key !== undefined && structuralStringKeys.has(key)
      ? publicStructuralValue(value)
      : '[redacted]';
  }
  if (Array.isArray(value)) {
    const result = value
      .slice(0, 16)
      .map((item) => redact(item, depth + 1, state));
    if (value.length > 16) result.push('[truncated]');
    return result;
  }
  const object = record(value);
  if (object === undefined) return '[redacted]';
  const result: JsonRecord = {};
  const entries = Object.entries(object);
  for (const [index, [entryKey, item]] of entries.slice(0, 16).entries()) {
    const safeKey =
      entryKey.length <= 64 && safeRawKeys.has(entryKey)
        ? entryKey
        : `[redacted-key-${String(index)}]`;
    result[safeKey] = identifierRawKeys.has(entryKey)
      ? '[redacted]'
      : redact(item, depth + 1, state, entryKey);
  }
  if (entries.length > 16 || state.nodes > 64) {
    result['__truncated__'] = '[truncated]';
  }
  return result;
}

function safeToken(value: string): boolean {
  return /^[A-Za-z0-9][0-9A-Za-z._+-]{0,127}$/u.test(value);
}

function publicMethod(value: string): string {
  return knownMethods.has(value) ? value : stableDiagnostic('method', value);
}

function publicEventType(value: string): string {
  return knownSessionEvents.has(value)
    ? value
    : stableDiagnostic('unknown', value);
}

function publicStructuralValue(value: string): string {
  return knownStructuralValues.has(value)
    ? value
    : stableDiagnostic('value', value);
}

function runtimeDiagnostic(value: string): string {
  return /^version-[0-9a-f]{16}$/u.test(value)
    ? value
    : stableDiagnostic('version', value);
}

function stableDiagnostic(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 16);
  return `${prefix}-${digest}`;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function incompatible(surface: string): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    `DeepSeek Harness ${surface} is not compatible with the verified SDK JSON-RPC protocol.`,
    { retryable: false, providerId: DSH_PROVIDER_ID },
  );
}

function invalidRequest(message: string): HarnessError {
  return new HarnessError('invalid_request', message, {
    retryable: false,
    providerId: DSH_PROVIDER_ID,
  });
}

function unsupported(capability: string, message: string): HarnessError {
  return new HarnessError('unsupported_capability', message, {
    retryable: false,
    providerId: DSH_PROVIDER_ID,
    details: { capability },
  });
}
