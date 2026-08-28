import { fileURLToPath } from 'node:url';
import {
  HarnessError,
  providerId,
  type CreateSessionInput,
  type HarnessEvent,
  type HarnessInput,
  type InteractionRequest,
  type RunResult,
  type SessionRef,
  type UsageSummary,
} from '@harapter/core';

export const CLAUDE_PROVIDER_ID = providerId('anthropic.claude-code');
export const CLAUDE_SESSION_COMPATIBILITY_REF =
  'anthropic.claude-code;agent-sdk-query=stable';

const maximumStringLength = 4_096;
const maximumRawKeys = 32;
const maximumRawArrayItems = 32;
const maximumRawDepth = 4;
const maximumTools = 128;
const safeEventType = /^[a-z0-9._:-]{1,80}$/u;
const safeToolName = /^[A-Za-z0-9._:-]{1,128}$/u;

export type ClaudePermissionMode =
  'acceptEdits' | 'auto' | 'default' | 'dontAsk' | 'plan';

/** SDK configuration retained with a portable Claude Session. */
export interface ClaudeSessionState {
  readonly allowedTools?: readonly string[];
  readonly cwd?: string;
  readonly materialized: boolean;
  readonly model?: string;
  readonly permissionMode: ClaudePermissionMode;
  readonly systemPrompt?: string;
}

/** Mutable per-Run state needed to correlate streaming content blocks. */
export interface ClaudeEventState {
  readonly toolByIndex: Map<number, { id: string; name: string }>;
  readonly startedToolIds: Set<string>;
  readonly completedToolIds: Set<string>;
}

/** Portable event data produced before the adapter adds identity and sequence. */
export interface ClaudeMappedEvent {
  readonly data: unknown;
  readonly providerEventType?: string;
  readonly raw?: unknown;
  readonly type: HarnessEvent['type'];
}

/** Validated SDK initialization facts used for ownership and capabilities. */
export interface ClaudeInitObservation {
  readonly capabilities: readonly string[];
  readonly claudeCodeVersion: string;
  readonly cwd: string;
  readonly model: string;
  readonly permissionMode: string;
  readonly sessionId: string;
}

/** Authoritative terminal data from one SDK ResultMessage. */
export interface ClaudeTerminalObservation {
  readonly providerCode: string;
  readonly providerResult: unknown;
  readonly result: RunResult;
  readonly terminalReason?: string;
}

/** One validated interpretation of an SDK output message. */
export type ClaudeMessageObservation =
  | { readonly kind: 'events'; readonly events: readonly ClaudeMappedEvent[] }
  | { readonly init: ClaudeInitObservation; readonly kind: 'init' }
  | {
      readonly kind: 'terminal';
      readonly terminal: ClaudeTerminalObservation;
    };

/** Create fresh correlation state for one SDK query. */
export function createClaudeEventState(): ClaudeEventState {
  return {
    toolByIndex: new Map(),
    startedToolIds: new Set(),
    completedToolIds: new Set(),
  };
}

/** Validate and retain the supported portable Session creation options. */
export function prepareClaudeSession(
  input: CreateSessionInput = {},
): ClaudeSessionState {
  if (input.metadata !== undefined && Object.keys(input.metadata).length > 0) {
    throw invalidRequest('Claude Session metadata is not supported.');
  }
  const providerOptions = input.providerOptions ?? {};
  const knownOptions = new Set(['allowedTools', 'permissionMode']);
  rejectUnknownKeys(providerOptions, knownOptions, 'Claude Session option');

  const cwd = workspacePath(input.workspace?.uri);
  const systemPrompt = optionalBoundedString(
    input.systemContext,
    'Claude Session system context',
    invalidRequest,
  );
  const model = optionalBoundedString(
    input.model?.id,
    'Claude Session model',
    invalidRequest,
  );
  if (
    input.model?.providerOptions !== undefined &&
    Object.keys(input.model.providerOptions).length > 0
  ) {
    throw invalidRequest('Claude model Provider options are not supported.');
  }
  const permissionMode = permissionModeValue(providerOptions['permissionMode']);
  const allowedTools = stringArray(
    providerOptions['allowedTools'],
    'Claude Session allowedTools',
    maximumTools,
    invalidRequest,
  );

  return {
    ...(allowedTools === undefined ? {} : { allowedTools }),
    ...(cwd === undefined ? {} : { cwd }),
    materialized: false,
    ...(model === undefined ? {} : { model }),
    permissionMode,
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
  };
}

/** Recover and validate opaque Claude Session state from a portable reference. */
export function claudeSessionStateFromRef(ref: SessionRef): ClaudeSessionState {
  if (ref.compatibilityRef !== CLAUDE_SESSION_COMPATIBILITY_REF) {
    throw sessionMismatch('Claude Session compatibility does not match.');
  }
  const state = record(ref.providerState);
  if (state === undefined) {
    throw sessionMismatch('Claude Session state is missing.');
  }
  const known = new Set([
    'allowedTools',
    'cwd',
    'materialized',
    'model',
    'permissionMode',
    'systemPrompt',
  ]);
  if ([...Object.keys(state)].some((key) => !known.has(key))) {
    throw sessionMismatch('Claude Session state is not compatible.');
  }
  if (typeof state['materialized'] !== 'boolean') {
    throw sessionMismatch('Claude Session materialization state is invalid.');
  }

  try {
    const allowedTools = stringArray(
      state['allowedTools'],
      'Claude Session allowedTools',
      maximumTools,
    );
    const cwd = optionalBoundedString(state['cwd'], 'Claude Session cwd');
    const model = optionalBoundedString(state['model'], 'Claude Session model');
    const systemPrompt = optionalBoundedString(
      state['systemPrompt'],
      'Claude Session system context',
    );
    return {
      ...(allowedTools === undefined ? {} : { allowedTools }),
      ...(cwd === undefined ? {} : { cwd }),
      materialized: state['materialized'],
      ...(model === undefined ? {} : { model }),
      permissionMode: permissionModeValue(state['permissionMode']),
      ...(systemPrompt === undefined ? {} : { systemPrompt }),
    };
  } catch {
    throw sessionMismatch('Claude Session state is not compatible.');
  }
}

/** Return a persistable snapshot without leaking mutable collections. */
export function snapshotClaudeSessionState(
  state: ClaudeSessionState,
): Readonly<Record<string, unknown>> {
  return {
    ...(state.allowedTools === undefined
      ? {}
      : { allowedTools: [...state.allowedTools] }),
    ...(state.cwd === undefined ? {} : { cwd: state.cwd }),
    materialized: state.materialized,
    ...(state.model === undefined ? {} : { model: state.model }),
    permissionMode: state.permissionMode,
    ...(state.systemPrompt === undefined
      ? {}
      : { systemPrompt: state.systemPrompt }),
  };
}

/** Convert portable text input into one official streaming-input user message. */
export function prepareClaudeUserMessage(
  input: HarnessInput,
  messageUuid: string,
): Readonly<Record<string, unknown>> {
  if (input.metadata !== undefined && Object.keys(input.metadata).length > 0) {
    throw invalidRequest('Claude Run input metadata is not supported.');
  }
  if (input.parts.length === 0) {
    throw invalidRequest('Claude Run input must contain at least one part.');
  }
  const text: string[] = [];
  for (const part of input.parts) {
    if (part.type !== 'text') {
      throw invalidRequest(
        `Claude Run input part ${part.type} is not supported by this adapter.`,
      );
    }
    if (part.text.length === 0 || part.text.length > maximumStringLength) {
      throw invalidRequest('Claude Run text must be non-empty and bounded.');
    }
    text.push(part.text);
  }

  return {
    type: 'user',
    message: { role: 'user', content: text.join('\n') },
    parent_tool_use_id: null,
    uuid: messageUuid,
  };
}

/** Parse and conservatively map one unknown SDK message. */
export function mapClaudeSdkMessage(
  value: unknown,
  state: ClaudeEventState,
  expectedSessionId: string,
  nativeInterruptAcknowledged: boolean,
): ClaudeMessageObservation {
  const message = record(value);
  if (message === undefined || typeof message['type'] !== 'string') {
    throw incompatible('Claude SDK message envelope');
  }
  const type = boundedEventType(message['type']);

  if (type === 'result') {
    return {
      kind: 'terminal',
      terminal: parseResult(
        message,
        expectedSessionId,
        nativeInterruptAcknowledged,
      ),
    };
  }
  if (type === 'system' && message['subtype'] === 'init') {
    return { kind: 'init', init: parseInit(message, expectedSessionId) };
  }

  assertOptionalSessionIdentity(message, expectedSessionId);
  if (type === 'stream_event') {
    return { kind: 'events', events: mapStreamEvent(message, state) };
  }
  if (type === 'assistant') {
    return { kind: 'events', events: mapAssistantMessage(message, state) };
  }
  if (type === 'user') {
    return { kind: 'events', events: mapUserMessage(message, state) };
  }

  return {
    kind: 'events',
    events: [providerEvent(unknownMessageType(type, message), message)],
  };
}

/** Convert a permission callback into a bounded portable interaction request. */
export function claudeInteractionRequest(
  toolNameValue: unknown,
  inputValue: unknown,
  optionsValue: unknown,
): {
  readonly input: Readonly<Record<string, unknown>>;
  readonly request: InteractionRequest;
  readonly toolName: string;
} {
  if (typeof toolNameValue !== 'string' || !safeToolName.test(toolNameValue)) {
    throw incompatible('Claude permission tool name');
  }
  const input = record(inputValue);
  const options = record(optionsValue);
  if (input === undefined || options === undefined) {
    throw incompatible('Claude permission callback');
  }
  const requestId = requiredBoundedString(
    options['requestId'],
    'Claude permission request ID',
  );
  const toolUseId = requiredBoundedString(
    options['toolUseID'],
    'Claude permission tool-use ID',
  );

  if (toolNameValue === 'AskUserQuestion') {
    return {
      input,
      request: {
        requestId,
        kind: 'user_input',
        title: 'Claude Agent question',
        prompt: 'Claude Agent requested additional input.',
        schema: questionSchema(input['questions']),
        providerState: {
          toolName: toolNameValue,
          toolUseId,
        },
      },
      toolName: toolNameValue,
    };
  }

  return {
    input,
    request: {
      requestId,
      kind: 'approval',
      title: `Claude Agent ${toolNameValue} approval`,
      prompt: `Claude Agent requested permission to use ${toolNameValue}.`,
      providerState: {
        toolName: toolNameValue,
        toolUseId,
      },
    },
    toolName: toolNameValue,
  };
}

/** Bound and structurally redact an SDK value before raw observation. */
export function redactClaudeSdkValue(value: unknown): unknown {
  return redact(value, 0);
}

function mapStreamEvent(
  message: Readonly<Record<string, unknown>>,
  state: ClaudeEventState,
): readonly ClaudeMappedEvent[] {
  const event = record(message['event']);
  if (event === undefined || typeof event['type'] !== 'string') {
    throw incompatible('Claude stream event');
  }
  const eventType = boundedEventType(event['type']);
  const raw = redactClaudeSdkValue(event);

  if (eventType === 'content_block_start') {
    const index = nonnegativeInteger(event['index']);
    const block = record(event['content_block']);
    if (index === undefined || block === undefined) {
      throw incompatible('Claude content block start');
    }
    if (block['type'] !== 'tool_use') {
      return [providerEvent(`stream_event.${eventType}`, event)];
    }
    const id = requiredBoundedString(block['id'], 'Claude tool-use ID');
    const name = requiredToolName(block['name']);
    state.toolByIndex.set(index, { id, name });
    if (state.startedToolIds.has(id)) return [];
    state.startedToolIds.add(id);
    return [
      {
        type: 'tool.started',
        data: { toolCallId: id, name },
        providerEventType: `stream_event.${eventType}`,
        raw,
      },
    ];
  }

  if (eventType === 'content_block_delta') {
    const delta = record(event['delta']);
    if (delta === undefined || typeof delta['type'] !== 'string') {
      throw incompatible('Claude content block delta');
    }
    if (delta['type'] === 'text_delta') {
      return [
        {
          type: 'message.delta',
          data: {
            text: requiredBoundedString(delta['text'], 'Claude text delta'),
          },
          providerEventType: 'stream_event.content_block_delta.text_delta',
          raw,
        },
      ];
    }
    if (delta['type'] === 'thinking_delta') {
      return [
        {
          type: 'reasoning.delta',
          data: {
            text: requiredBoundedString(
              delta['thinking'],
              'Claude reasoning delta',
            ),
          },
          providerEventType: 'stream_event.content_block_delta.thinking_delta',
          raw,
        },
      ];
    }
    if (delta['type'] === 'input_json_delta') {
      const index = nonnegativeInteger(event['index']);
      const tool =
        index === undefined ? undefined : state.toolByIndex.get(index);
      if (tool === undefined) {
        return [providerEvent('stream_event.tool_input_delta', event)];
      }
      return [
        {
          type: 'tool.updated',
          data: {
            toolCallId: tool.id,
            name: tool.name,
            state: 'input_streaming',
          },
          providerEventType: 'stream_event.tool_input_delta',
          raw,
        },
      ];
    }
    return [providerEvent(`stream_event.${eventType}.${delta['type']}`, event)];
  }

  if (eventType === 'message_delta') {
    const usage = usageSummary(record(event['usage']));
    return usage === undefined
      ? [providerEvent(`stream_event.${eventType}`, event)]
      : [
          {
            type: 'usage.updated',
            data: usage,
            providerEventType: `stream_event.${eventType}`,
            raw,
          },
        ];
  }

  return [providerEvent(`stream_event.${eventType}`, event)];
}

function mapAssistantMessage(
  message: Readonly<Record<string, unknown>>,
  state: ClaudeEventState,
): readonly ClaudeMappedEvent[] {
  const assistant = record(message['message']);
  if (assistant === undefined || !Array.isArray(assistant['content'])) {
    throw incompatible('Claude assistant message');
  }
  const events: ClaudeMappedEvent[] = [];
  for (const value of assistant['content']) {
    const block = record(value);
    if (block === undefined || typeof block['type'] !== 'string') {
      throw incompatible('Claude assistant content block');
    }
    if (block['type'] !== 'tool_use') {
      events.push(
        providerEvent(`assistant.${boundedEventType(block['type'])}`, block),
      );
      continue;
    }
    const id = requiredBoundedString(block['id'], 'Claude tool-use ID');
    const name = requiredToolName(block['name']);
    if (!state.startedToolIds.has(id)) {
      state.startedToolIds.add(id);
      events.push({
        type: 'tool.started',
        data: { toolCallId: id, name },
        providerEventType: 'assistant.tool_use',
        raw: redactClaudeSdkValue(block),
      });
    }
    events.push({
      type: 'tool.updated',
      data: { toolCallId: id, name, state: 'ready' },
      providerEventType: 'assistant.tool_use',
      raw: redactClaudeSdkValue(block),
    });
  }
  if (events.length === 0) {
    events.push(providerEvent('assistant', message));
  }
  return events;
}

function mapUserMessage(
  message: Readonly<Record<string, unknown>>,
  state: ClaudeEventState,
): readonly ClaudeMappedEvent[] {
  const user = record(message['message']);
  const content = user?.['content'];
  if (!Array.isArray(content)) return [providerEvent('user', message)];
  const events: ClaudeMappedEvent[] = [];
  for (const value of content) {
    const block = record(value);
    if (block === undefined || typeof block['type'] !== 'string') {
      throw incompatible('Claude user content block');
    }
    if (block['type'] !== 'tool_result') {
      events.push(
        providerEvent(`user.${boundedEventType(block['type'])}`, block),
      );
      continue;
    }
    const id = requiredBoundedString(
      block['tool_use_id'],
      'Claude tool-result ID',
    );
    if (state.completedToolIds.has(id)) continue;
    state.completedToolIds.add(id);
    events.push({
      type: 'tool.completed',
      data: {
        toolCallId: id,
        isError: block['is_error'] === true,
      },
      providerEventType: 'user.tool_result',
      raw: redactClaudeSdkValue(block),
    });
  }
  return events.length === 0 ? [providerEvent('user', message)] : events;
}

function parseInit(
  message: Readonly<Record<string, unknown>>,
  expectedSessionId: string,
): ClaudeInitObservation {
  const sessionId = requiredBoundedString(
    message['session_id'],
    'Claude init Session ID',
  );
  if (sessionId !== expectedSessionId) {
    throw incompatible('Claude init Session ownership');
  }
  const capabilities = stringArray(
    message['capabilities'],
    'Claude init capabilities',
    256,
  );
  return {
    capabilities: capabilities ?? [],
    claudeCodeVersion: requiredBoundedString(
      message['claude_code_version'],
      'Claude Code runtime version',
    ),
    cwd: requiredBoundedString(message['cwd'], 'Claude init cwd'),
    model: requiredBoundedString(message['model'], 'Claude init model'),
    permissionMode: requiredBoundedString(
      message['permissionMode'],
      'Claude init permission mode',
    ),
    sessionId,
  };
}

function parseResult(
  message: Readonly<Record<string, unknown>>,
  expectedSessionId: string,
  nativeInterruptAcknowledged: boolean,
): ClaudeTerminalObservation {
  const sessionId = requiredBoundedString(
    message['session_id'],
    'Claude result Session ID',
  );
  if (sessionId !== expectedSessionId) {
    throw incompatible('Claude result Session ownership');
  }
  const subtype = requiredBoundedString(
    message['subtype'],
    'Claude result subtype',
  );
  const isError = message['is_error'];
  if (typeof isError !== 'boolean') {
    throw incompatible('Claude result error state');
  }
  const usage = usageSummary(record(message['usage']));
  const terminalReason = optionalBoundedString(
    message['terminal_reason'],
    'Claude result terminal reason',
  );
  const providerResult = redactClaudeSdkValue(message);

  if (subtype === 'success' && !isError) {
    const finalMessage = requiredString(
      message['result'],
      'Claude result text',
    );
    return {
      providerCode: subtype,
      providerResult,
      result: {
        status: 'completed',
        finalMessage,
        ...(usage === undefined ? {} : { usage }),
        providerResult,
      },
      ...(terminalReason === undefined ? {} : { terminalReason }),
    };
  }

  const knownErrors = new Set([
    'error_during_execution',
    'error_max_budget_usd',
    'error_max_structured_output_retries',
    'error_max_turns',
    'success',
  ]);
  if (!knownErrors.has(subtype)) {
    throw incompatible('Claude result subtype');
  }
  const cancelled =
    nativeInterruptAcknowledged &&
    (terminalReason === 'aborted_streaming' ||
      terminalReason === 'aborted_tools');
  return {
    providerCode: subtype,
    providerResult,
    result: {
      status: cancelled ? 'cancelled' : 'failed',
      ...(usage === undefined ? {} : { usage }),
      providerResult,
    },
    ...(terminalReason === undefined ? {} : { terminalReason }),
  };
}

function usageSummary(
  usage: Readonly<Record<string, unknown>> | undefined,
): UsageSummary | undefined {
  if (usage === undefined) return undefined;
  const inputTokens = nonnegativeInteger(usage['input_tokens']);
  const outputTokens = nonnegativeInteger(usage['output_tokens']);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(inputTokens === undefined || outputTokens === undefined
      ? {}
      : { totalTokens: inputTokens + outputTokens }),
  };
}

function providerEvent(eventType: string, value: unknown): ClaudeMappedEvent {
  return {
    type: 'provider',
    data: { observed: true },
    providerEventType: boundedEventType(eventType),
    raw: redactClaudeSdkValue(value),
  };
}

function unknownMessageType(
  type: string,
  message: Readonly<Record<string, unknown>>,
): string {
  return type === 'system' && typeof message['subtype'] === 'string'
    ? `${type}.${boundedEventType(message['subtype'])}`
    : type;
}

function questionSchema(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw incompatible('Claude user question schema');
  }
  return {
    questions: value.map((item) => {
      const question = record(item);
      if (question === undefined || !Array.isArray(question['options'])) {
        throw incompatible('Claude user question');
      }
      const options = question['options'];
      if (options.length === 0 || options.length > 32) {
        throw incompatible('Claude user question options');
      }
      return {
        question: requiredBoundedString(
          question['question'],
          'Claude user question text',
        ),
        header: requiredBoundedString(
          question['header'],
          'Claude user question header',
        ),
        multiSelect: question['multiSelect'] === true,
        options: options.map((optionValue) => {
          const option = record(optionValue);
          if (option === undefined) {
            throw incompatible('Claude user question option');
          }
          return {
            label: requiredBoundedString(
              option['label'],
              'Claude user question option label',
            ),
            description: requiredBoundedString(
              option['description'],
              'Claude user question option description',
            ),
          };
        }),
      };
    }),
  };
}

function workspacePath(uri: unknown): string | undefined {
  if (uri === undefined) return undefined;
  if (typeof uri !== 'string' || uri.length > maximumStringLength) {
    throw invalidRequest('Claude workspace URI must be a bounded file URL.');
  }
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') {
      throw new Error('not-file');
    }
    return fileURLToPath(url);
  } catch {
    throw invalidRequest('Claude workspace URI must be a valid file URL.');
  }
}

function permissionModeValue(value: unknown): ClaudePermissionMode {
  if (value === undefined) return 'default';
  if (
    value === 'acceptEdits' ||
    value === 'auto' ||
    value === 'default' ||
    value === 'dontAsk' ||
    value === 'plan'
  ) {
    return value;
  }
  throw invalidRequest('Claude permissionMode is not supported.');
}

function assertOptionalSessionIdentity(
  message: Readonly<Record<string, unknown>>,
  expectedSessionId: string,
): void {
  if (message['session_id'] === undefined) return;
  if (message['session_id'] !== expectedSessionId) {
    throw incompatible('Claude SDK message Session ownership');
  }
}

function rejectUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== undefined) {
    throw invalidRequest(`${label} ${unknown} is not supported.`);
  }
}

function stringArray(
  value: unknown,
  label: string,
  limit: number,
  error: (label: string) => HarnessError = incompatible,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > limit) {
    throw error(`${label} must be a bounded string array.`);
  }
  const output = value.map((item) => requiredBoundedString(item, label, error));
  if (new Set(output).size !== output.length) {
    throw error(`${label} must not contain duplicates.`);
  }
  return output;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  error: (label: string) => HarnessError = incompatible,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredBoundedString(value, label, error);
}

function requiredBoundedString(
  value: unknown,
  label: string,
  error: (label: string) => HarnessError = incompatible,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumStringLength
  ) {
    throw error(label);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw incompatible(label);
  return value;
}

function requiredToolName(value: unknown): string {
  if (typeof value !== 'string' || !safeToolName.test(value)) {
    throw incompatible('Claude tool name');
  }
  return value;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function boundedEventType(value: string): string {
  return safeEventType.test(value) ? value : 'unknown';
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function redact(value: unknown, depth: number): unknown {
  if (depth >= maximumRawDepth) return { type: valueType(value) };
  if (value === null) return { type: 'null' };
  if (typeof value === 'boolean' || typeof value === 'number') {
    return { type: typeof value };
  }
  if (typeof value === 'string')
    return { type: 'string', length: value.length };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      items: value
        .slice(0, maximumRawArrayItems)
        .map((item) => redact(item, depth + 1)),
      truncated: value.length > maximumRawArrayItems,
    };
  }
  const object = record(value);
  if (object !== undefined) {
    const fields: unknown[] = [];
    let inspected = 0;
    let truncated = false;
    for (const key in object) {
      if (inspected >= maximumRawKeys) {
        truncated = true;
        break;
      }
      inspected += 1;
      if (!Object.prototype.hasOwnProperty.call(object, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      fields.push({
        key: { type: 'string', length: key.length },
        value:
          descriptor !== undefined && 'value' in descriptor
            ? redact(descriptor.value, depth + 1)
            : { type: 'accessor' },
      });
    }
    return {
      type: 'object',
      fields,
      truncated,
    };
  }
  return { type: valueType(value) };
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function invalidRequest(message: string): HarnessError {
  return new HarnessError('invalid_request', message, {
    retryable: false,
    providerId: CLAUDE_PROVIDER_ID,
  });
}

function incompatible(surface: string): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    `${surface} is incompatible with the supported Agent SDK interface.`,
    {
      retryable: false,
      providerId: CLAUDE_PROVIDER_ID,
      providerCode: 'agent_sdk_shape',
    },
  );
}

function sessionMismatch(message: string): HarnessError {
  return new HarnessError('session_provider_mismatch', message, {
    retryable: false,
    providerId: CLAUDE_PROVIDER_ID,
  });
}
