import { createHash } from 'node:crypto';

import {
  HarnessError,
  providerId,
  type HarnessEvent,
  type HarnessInput,
  type UsageSummary,
} from '@harapter/core';

/** Stable Provider identity owned by the Pi Agent Provider Adapter. */
export const PI_PROVIDER_ID = providerId('pi.agent');

/** Provider-owned extension for bounded, redacted RPC observations. */
export const PI_OBSERVATION_EXTENSION = 'pi.agent.rpc.observations';

/** Pi RPC protocol family used for resumable Session references. */
export const PI_SESSION_COMPATIBILITY_REF =
  'pi-agent;rpc-jsonl-current;strategy=isolated-process';

/** Validated non-sensitive state returned by the official `get_state` command. */
export interface PiSessionState {
  readonly sessionId: string;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly thinkingLevel: string;
}

/** Authoritative assistant outcome retained until `agent_settled`. */
export interface PiAssistantOutcome {
  readonly stopReason:
    | 'pending'
    | 'stop'
    | 'length'
    | 'toolUse'
    | 'error'
    | 'aborted'
    | 'deferred';
  readonly text: string;
  readonly reasoning: string;
  readonly usage: UsageSummary;
}

/** Portable mapping produced before Run identity and sequence are attached. */
export interface MappedPiEvent {
  readonly type: HarnessEvent['type'];
  readonly data: unknown;
  readonly providerEventType?: string;
  readonly raw?: unknown;
  readonly messageDelta?: string;
  readonly reasoningDelta?: string;
  readonly usage?: UsageSummary;
}

const maximumObservationDepth = 4;
const maximumObservationEntries = 24;
const maximumObservationString = 128;
const structuralKeys = new Set([
  'command',
  'event',
  'isError',
  'method',
  'role',
  'stopReason',
  'success',
  'type',
  'willRetry',
]);
const safeObservationKeys = new Set([
  ...structuralKeys,
  'assistantMessageEvent',
  'content',
  'data',
  'id',
  'message',
  'usage',
]);
const safePiEventTypes = new Set([
  'agent_end',
  'agent_settled',
  'agent_start',
  'auto_compaction_end',
  'auto_compaction_start',
  'auto_retry_end',
  'auto_retry_start',
  'extension_error',
  'message_end',
  'message_start',
  'message_update',
  'tool_execution_end',
  'tool_execution_start',
  'tool_execution_update',
  'turn_end',
  'turn_start',
]);
const safeStructuralValues = new Set([
  ...safePiEventTypes,
  'abort',
  'aborted',
  'assistant',
  'confirm',
  'deferred',
  'editor',
  'error',
  'extension_ui_request',
  'extension_ui_response',
  'get_available_models',
  'get_available_thinking_levels',
  'get_commands',
  'get_entries',
  'get_last_assistant_text',
  'get_messages',
  'get_session_stats',
  'get_state',
  'get_tree',
  'input',
  'length',
  'notify',
  'pending',
  'prompt',
  'response',
  'select',
  'stop',
  'text',
  'text_delta',
  'thinking',
  'thinking_delta',
  'toolCall',
  'toolResult',
  'toolUse',
  'user',
]);
const stopReasons = new Set<PiAssistantOutcome['stopReason']>([
  'pending',
  'stop',
  'length',
  'toolUse',
  'error',
  'aborted',
  'deferred',
]);

/** Build a non-sensitive compatibility identity for one observed Runtime. */
export function piCompatibilityIdentity(runtimeVersion: string): string {
  return `${PI_SESSION_COMPATIBILITY_REF};runtime=version-${shortHash(runtimeVersion)}`;
}

/** Validate the bounded stdout returned by the official `--version` command. */
export function parsePiVersionOutput(value: string): string {
  const version = value
    .trim()
    .replace(/^pi\s+/iu, '')
    .replace(/^v/u, '');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw incompatible('version response');
  }
  return version;
}

/** Validate the minimum RPC state required to own a Pi Session. */
export function parsePiSessionState(value: unknown): PiSessionState {
  const state = record(value);
  if (
    typeof state?.['sessionId'] !== 'string' ||
    state['sessionId'].length === 0 ||
    typeof state['isStreaming'] !== 'boolean' ||
    typeof state['isCompacting'] !== 'boolean' ||
    typeof state['thinkingLevel'] !== 'string' ||
    state['thinkingLevel'].length === 0
  ) {
    throw incompatible('get_state response');
  }
  return {
    sessionId: state['sessionId'],
    isStreaming: state['isStreaming'],
    isCompacting: state['isCompacting'],
    thinkingLevel: state['thinkingLevel'],
  };
}

/** Convert the verified portable text subset to one Pi RPC prompt string. */
export function preparePiPrompt(input: HarnessInput): string {
  if (input.parts.length === 0) {
    throw invalidRequest('A Pi Agent Run requires at least one input part.');
  }
  if (input.metadata !== undefined) {
    throw invalidRequest('Pi Agent Run metadata is not mapped.');
  }
  const text: string[] = [];
  for (const part of input.parts) {
    if (part.type !== 'text') {
      throw unsupported(
        `input.${part.type}`,
        'The Pi Agent RPC Adapter supports non-empty text input only.',
      );
    }
    if (part.text.length === 0) {
      throw invalidRequest('Pi Agent text input cannot be empty.');
    }
    text.push(part.text);
  }
  const prompt = text.join('\n');
  if (prompt.trimStart().startsWith('/')) {
    throw unsupported(
      'input.command',
      'Pi Agent slash commands, prompt templates, and skill commands are not portable Run input.',
    );
  }
  return prompt;
}

/** Parse one authoritative assistant message without retaining Provider errors. */
export function parsePiAssistantOutcome(
  value: unknown,
): PiAssistantOutcome | undefined {
  const message = record(value);
  if (message?.['role'] !== 'assistant') return undefined;
  const stopReason = message['stopReason'];
  if (typeof stopReason !== 'string' || !stopReasons.has(stopReason as never)) {
    throw incompatible('assistant stop reason');
  }
  const content = message['content'];
  if (!Array.isArray(content)) throw incompatible('assistant content');
  const text: string[] = [];
  const reasoning: string[] = [];
  for (const blockValue of content) {
    const block = record(blockValue);
    if (block?.['type'] === 'text' && typeof block['text'] === 'string') {
      text.push(block['text']);
    } else if (
      block?.['type'] === 'thinking' &&
      typeof block['thinking'] === 'string'
    ) {
      reasoning.push(block['thinking']);
    } else if (
      block?.['type'] !== 'toolCall' ||
      typeof block['id'] !== 'string' ||
      typeof block['name'] !== 'string'
    ) {
      throw incompatible('assistant content block');
    }
  }
  return {
    stopReason: stopReason as PiAssistantOutcome['stopReason'],
    text: text.join(''),
    reasoning: reasoning.join(''),
    usage: parsePiUsage(message['usage']),
  };
}

/** Map one Pi RPC event without exposing tool arguments or results. */
export function mapPiRunEvent(value: unknown): readonly MappedPiEvent[] {
  const event = record(value);
  const type = event?.['type'];
  if (event === undefined || typeof type !== 'string') {
    throw incompatible('event envelope');
  }

  if (type === 'message_update') {
    const delta = record(event['assistantMessageEvent']);
    if (
      delta?.['type'] === 'text_delta' &&
      typeof delta['delta'] === 'string'
    ) {
      return [
        {
          type: 'message.delta',
          data: { text: delta['delta'] },
          messageDelta: delta['delta'],
          providerEventType: type,
        },
      ];
    }
    if (
      delta?.['type'] === 'thinking_delta' &&
      typeof delta['delta'] === 'string'
    ) {
      return [
        {
          type: 'reasoning.delta',
          data: { text: delta['delta'] },
          reasoningDelta: delta['delta'],
          providerEventType: type,
        },
      ];
    }
    if (typeof delta?.['type'] !== 'string') {
      throw incompatible('message_update event');
    }
    return [providerObservation(event, type)];
  }

  if (type === 'tool_execution_start') {
    return [toolEvent('tool.started', event, type)];
  }
  if (type === 'tool_execution_update') {
    return [toolEvent('tool.updated', event, type)];
  }
  if (type === 'tool_execution_end') {
    return [toolEvent('tool.completed', event, type)];
  }

  return [providerObservation(event, type)];
}

/** Bound and redact an untrusted Pi RPC observation. */
export function redactPiObservation(value: unknown): unknown {
  return redactValue(value, 0);
}

function toolEvent(
  type: Extract<
    HarnessEvent['type'],
    'tool.started' | 'tool.updated' | 'tool.completed'
  >,
  event: Record<string, unknown>,
  providerEventType: string,
): MappedPiEvent {
  if (
    typeof event['toolCallId'] !== 'string' ||
    typeof event['toolName'] !== 'string'
  ) {
    throw incompatible(`${providerEventType} event`);
  }
  return {
    type,
    data: {
      toolCallId: `id-${shortHash(event['toolCallId'])}`,
      toolName: bounded(event['toolName']),
      ...(providerEventType === 'tool_execution_end'
        ? { isError: event['isError'] === true }
        : {}),
    },
    providerEventType,
  };
}

function providerObservation(
  event: Record<string, unknown>,
  providerEventType: string,
): MappedPiEvent {
  const observableType = safePiEventTypes.has(providerEventType)
    ? bounded(providerEventType)
    : `event-${shortHash(providerEventType)}`;
  return {
    type: 'provider',
    data: { event: observableType },
    providerEventType: observableType,
    raw: redactPiObservation(event),
  };
}

function parsePiUsage(value: unknown): UsageSummary {
  const usage = record(value);
  if (
    typeof usage?.['input'] !== 'number' ||
    !Number.isFinite(usage['input']) ||
    usage['input'] < 0 ||
    typeof usage['output'] !== 'number' ||
    !Number.isFinite(usage['output']) ||
    usage['output'] < 0 ||
    typeof usage['totalTokens'] !== 'number' ||
    !Number.isFinite(usage['totalTokens']) ||
    usage['totalTokens'] < 0
  ) {
    throw incompatible('assistant usage');
  }
  return {
    inputTokens: usage['input'],
    outputTokens: usage['output'],
    totalTokens: usage['totalTokens'],
  };
}

function redactValue(value: unknown, depth: number, key?: string): unknown {
  if (depth >= maximumObservationDepth) return '[bounded]';
  if (value === null) return null;
  if (typeof value === 'string') {
    if (
      key !== undefined &&
      structuralKeys.has(key) &&
      safeStructuralValues.has(value)
    ) {
      return bounded(value);
    }
    return `value-${shortHash(value)}`;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? `number-${shortHash(String(value))}`
      : '[redacted]';
  }
  if (typeof value === 'boolean') {
    return key !== undefined && structuralKeys.has(key) ? value : '[redacted]';
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, maximumObservationEntries)
      .map((entry) => redactValue(entry, depth + 1));
  }
  if (typeof value !== 'object') return '[redacted]';
  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(
    0,
    maximumObservationEntries,
  )) {
    const observableKey = safeObservationKeys.has(entryKey)
      ? bounded(entryKey)
      : `field-${shortHash(entryKey)}`;
    result[observableKey] = redactValue(entryValue, depth + 1, entryKey);
  }
  return result;
}

function bounded(value: string): string {
  return value.slice(0, maximumObservationString);
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function incompatible(surface: string): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    `Pi Agent emitted an incompatible RPC ${surface}.`,
    { retryable: false, providerId: PI_PROVIDER_ID },
  );
}

function invalidRequest(message: string): HarnessError {
  return new HarnessError('invalid_request', message, {
    retryable: false,
    providerId: PI_PROVIDER_ID,
  });
}

function unsupported(capability: string, message: string): HarnessError {
  return new HarnessError('unsupported_capability', message, {
    retryable: false,
    providerId: PI_PROVIDER_ID,
    details: { capability },
  });
}
