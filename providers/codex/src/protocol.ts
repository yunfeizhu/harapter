import { fileURLToPath } from 'node:url';
import {
  HarnessError,
  providerId,
  type CreateSessionInput,
  type HarnessEvent,
  type HarnessInput,
  type InteractionRequest,
  type InteractionResponse,
  type RunOptions,
  type RunResult,
  type UsageSummary,
} from '@harapter/core';

/** Stable Provider identity owned by the Codex Adapter. */
export const CODEX_PROVIDER_ID = providerId('openai.codex');

/** Stable protocol family used to validate resumable Session references. */
export const CODEX_SESSION_COMPATIBILITY_REF = `${CODEX_PROVIDER_ID};app-server=stable`;

/** Provider-native input part accepted through the explicit Core escape hatch. */
export const CODEX_USER_INPUT_PART = 'openai.codex.userInput';

/** Minimal stable App Server input surface used by this Adapter. */
export type CodexUserInput =
  | {
      readonly type: 'text';
      readonly text: string;
      readonly text_elements: readonly unknown[];
    }
  | { readonly type: 'image'; readonly url: string }
  | { readonly type: 'localImage'; readonly path: string };

/** Bounded and redacted structural view of an upstream event. */
export interface CodexRawEvent {
  readonly method: string;
  readonly params: unknown;
}

/** Provider-level event before portable identity and sequence are attached. */
export interface MappedCodexEvent {
  readonly type: HarnessEvent['type'];
  readonly data: unknown;
  readonly providerEventType?: string;
  readonly raw?: CodexRawEvent;
  readonly terminalResult?: RunResult;
  readonly finalMessage?: string;
  readonly usage?: UsageSummary;
}

/** One mapped notification plus its best-effort routing context. */
export interface CodexNotificationMapping {
  readonly threadId: string | undefined;
  readonly turnId: string | undefined;
  readonly events: readonly MappedCodexEvent[];
}

type CodexInteractionKind = 'approval' | 'provider';

/** Internal routing and response contract for a server-initiated request. */
export interface MappedCodexServerRequest {
  readonly threadId: string | undefined;
  readonly turnId: string | undefined;
  readonly interaction: InteractionRequest;
  readonly responseKind: CodexInteractionKind;
}

type JsonRecord = Record<string, unknown>;

const approvalPolicies = new Set(['untrusted', 'on-request', 'never']);
const sandboxModes = new Set([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);
const personalities = new Set(['none', 'friendly', 'pragmatic']);
const reasoningSummaries = new Set(['auto', 'concise', 'detailed', 'none']);
const maximumTimerMilliseconds = 2_147_483_647;
const codexErrorCodes = new Set([
  'activeTurnNotSteerable',
  'badRequest',
  'contextWindowExceeded',
  'cyberPolicy',
  'httpConnectionFailed',
  'internalServerError',
  'other',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
  'sandboxError',
  'serverOverloaded',
  'sessionBudgetExceeded',
  'threadRollbackFailed',
  'unauthorized',
  'usageLimitExceeded',
]);
const toolItemTypes = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'subAgentActivity',
  'webSearch',
  'imageView',
  'imageGeneration',
]);
const safeRawKeys = new Set([
  'data',
  'delta',
  'error',
  'id',
  'inputTokens',
  'item',
  'itemId',
  'last',
  'method',
  'outputTokens',
  'params',
  'requestId',
  'result',
  'status',
  'threadId',
  'tokenUsage',
  'total',
  'totalTokens',
  'turn',
  'turnId',
  'type',
  'willRetry',
]);
const identifierRawKeys = new Set([
  'id',
  'itemId',
  'requestId',
  'threadId',
  'turnId',
]);

/** Build the non-sensitive Session compatibility fingerprint. */
export function codexCompatibilityIdentity(runtimeVersion: string): string {
  return `${CODEX_PROVIDER_ID};app-server=stable;runtime=${runtimeVersion}`;
}

/** Validate the stable initialize response and select its evidence level. */
export function parseCodexInitializeResponse(value: unknown): {
  readonly runtimeVersion: string;
} {
  const response = record(value);
  const userAgent = response?.['userAgent'];
  if (typeof userAgent !== 'string') throw incompatible('initialize response');
  const match =
    userAgent.length <= 1024 && !/[\r\n]/u.test(userAgent)
      ? /^[^/\r\n]{1,128}\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=[ (]|$)/u.exec(
          userAgent,
        )
      : null;
  const runtimeVersion = match?.[1];
  if (runtimeVersion === undefined) throw incompatible('runtime version');
  if (
    typeof response?.['codexHome'] !== 'string' ||
    typeof response['platformFamily'] !== 'string' ||
    typeof response['platformOs'] !== 'string'
  ) {
    throw incompatible('initialize response');
  }
  return { runtimeVersion };
}

/** Extract one required Thread identifier from start or resume. */
export function parseCodexThreadResponse(value: unknown): string {
  const id = record(record(value)?.['thread'])?.['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw incompatible('thread response');
  }
  return id;
}

/** Extract one required in-progress Turn identifier from turn/start. */
export function parseCodexTurnStartResponse(value: unknown): string {
  const turn = record(record(value)?.['turn']);
  const id = turn?.['id'];
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    turn?.['status'] !== 'inProgress'
  ) {
    throw incompatible('turn/start response');
  }
  return id;
}

/** Convert portable input into the verified stable App Server input union. */
export function prepareCodexInput(
  input: HarnessInput,
): readonly CodexUserInput[] {
  if (input.parts.length === 0) {
    throw invalidRequest('A Codex Turn requires at least one input part.');
  }
  return input.parts.map((part) => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text, text_elements: [] };
      case 'image_ref':
        return imageInput(part.uri);
      case 'file_ref':
        throw unsupported('input.file', 'Codex file input is not mapped.');
      case 'provider':
        if (
          part.name !== CODEX_USER_INPUT_PART ||
          !isCodexUserInput(part.value)
        ) {
          throw unsupported(
            'input.provider',
            'The Provider input part is not a supported Codex user input.',
          );
        }
        return part.value;
    }
  });
}

/** Prepare stable thread/start fields without silently ignoring native options. */
export function prepareCodexSessionParams(
  input: CreateSessionInput = {},
): Readonly<JsonRecord> {
  const options = validatedOptions(input.providerOptions, [
    'approvalPolicy',
    'config',
    'ephemeral',
    'modelProvider',
    'personality',
    'sandbox',
    'serviceTier',
  ]);
  if (input.model?.providerOptions !== undefined) {
    throw invalidRequest('Codex model providerOptions are not mapped.');
  }
  const output: JsonRecord = {};
  if (input.workspace) output['cwd'] = workspacePath(input.workspace.uri);
  if (input.systemContext !== undefined) {
    output['developerInstructions'] = input.systemContext;
  }
  if (input.model) output['model'] = nonEmpty(input.model.id, 'model id');
  assignStringOption(output, options, 'modelProvider');
  assignStringOption(output, options, 'serviceTier');
  assignEnumOption(output, options, 'approvalPolicy', approvalPolicies);
  assignEnumOption(output, options, 'sandbox', sandboxModes);
  assignEnumOption(output, options, 'personality', personalities);
  if (options['ephemeral'] !== undefined) {
    if (typeof options['ephemeral'] !== 'boolean') {
      throw invalidRequest('Codex ephemeral must be a boolean.');
    }
    output['ephemeral'] = options['ephemeral'];
  }
  if (options['config'] !== undefined) {
    assertJsonValue(options['config'], 'Codex config');
    if (record(options['config']) === undefined) {
      throw invalidRequest('Codex config must be an object.');
    }
    output['config'] = options['config'];
  }
  return output;
}

/** Prepare stable turn/start overrides without silently ignoring native options. */
export function prepareCodexTurnParams(
  options: RunOptions = {},
): Readonly<JsonRecord> {
  if (options.timeoutMs !== undefined)
    positiveTimer(options.timeoutMs, 'timeoutMs');
  const providerOptions = validatedOptions(options.providerOptions, [
    'approvalPolicy',
    'effort',
    'model',
    'outputSchema',
    'personality',
    'sandboxPolicy',
    'serviceTier',
    'summary',
  ]);
  const output: JsonRecord = {};
  assignEnumOption(output, providerOptions, 'approvalPolicy', approvalPolicies);
  assignEnumOption(output, providerOptions, 'personality', personalities);
  assignEnumOption(output, providerOptions, 'summary', reasoningSummaries);
  for (const name of ['effort', 'model', 'serviceTier'] as const) {
    assignStringOption(output, providerOptions, name);
  }
  for (const name of ['outputSchema', 'sandboxPolicy'] as const) {
    if (providerOptions[name] === undefined) continue;
    assertJsonValue(providerOptions[name], `Codex ${name}`);
    output[name] = providerOptions[name];
  }
  return output;
}

/** Map one stable or unknown App Server notification. */
export function mapCodexNotification(
  method: string,
  params: unknown,
): CodexNotificationMapping {
  const context = notificationContext(params);
  const mapped = (
    events: readonly MappedCodexEvent[],
  ): CodexNotificationMapping => ({ ...context, events });

  if (method === 'turn/started' || method === 'thread/started')
    return mapped([]);

  if (method === 'item/agentMessage/delta') {
    const value = stringField(params, 'delta');
    return value === undefined
      ? mapped([providerEvent(method, params)])
      : mapped([{ type: 'message.delta', data: { delta: value } }]);
  }
  if (
    method === 'item/reasoning/summaryTextDelta' ||
    method === 'item/reasoning/textDelta'
  ) {
    const value = stringField(params, 'delta');
    return value === undefined
      ? mapped([providerEvent(method, params)])
      : mapped([{ type: 'reasoning.delta', data: { delta: value } }]);
  }
  if (method === 'item/started' || method === 'item/completed') {
    const item = record(record(params)?.['item']);
    const itemType = item?.['type'];
    if (item === undefined || typeof itemType !== 'string') {
      return mapped([providerEvent(method, params)]);
    }
    if (itemType === 'agentMessage' && method === 'item/completed') {
      const text = item['text'];
      return typeof text === 'string'
        ? mapped([
            {
              type: 'message.completed',
              data: { message: text },
              finalMessage: text,
            },
          ])
        : mapped([providerEvent(method, params)]);
    }
    if (itemType === 'reasoning' && method === 'item/completed') {
      return mapped([
        {
          type: 'reasoning.completed',
          data: { item },
        },
      ]);
    }
    if (toolItemTypes.has(itemType)) {
      return mapped([
        {
          type: method === 'item/started' ? 'tool.started' : 'tool.completed',
          data: { item },
        },
      ]);
    }
    return mapped([providerEvent(method, params)]);
  }
  if (
    method === 'item/commandExecution/outputDelta' ||
    method === 'item/fileChange/patchUpdated' ||
    method === 'item/mcpToolCall/progress'
  ) {
    return mapped([{ type: 'tool.updated', data: params }]);
  }
  if (method === 'thread/tokenUsage/updated') {
    const usage = usageSummary(params);
    return usage === undefined
      ? mapped([providerEvent(method, params)])
      : mapped([{ type: 'usage.updated', data: usage, usage }]);
  }
  if (method === 'error') {
    return mapped([
      {
        type: 'provider',
        providerEventType: method,
        data: {
          providerCode: codexErrorCode(
            record(record(params)?.['error'])?.['codexErrorInfo'],
          ),
          willRetry: record(params)?.['willRetry'] === true,
        },
      },
    ]);
  }
  if (method === 'turn/completed') return mapTerminal(params, mapped);
  return mapped([providerEvent(method, params)]);
}

/** Map an in-run App Server request to a portable interaction. */
export function mapCodexServerRequest(
  method: string,
  params: unknown,
  requestId: string,
): MappedCodexServerRequest {
  const context = notificationContext(params);
  if (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval'
  ) {
    const recordParams = record(params);
    const prompt = firstString(
      recordParams?.['reason'],
      recordParams?.['command'],
      'Codex requests approval.',
    );
    return {
      ...context,
      responseKind: 'approval',
      interaction: {
        requestId,
        kind: 'approval',
        title:
          method === 'item/commandExecution/requestApproval'
            ? 'Codex command approval'
            : 'Codex file-change approval',
        prompt,
      },
    };
  }
  return providerRequest(method, params, requestId, context);
}

/** Encode a portable or explicit Provider-native interaction response. */
export function encodeCodexInteractionResponse(
  request: MappedCodexServerRequest,
  response: InteractionResponse,
): unknown {
  if (response.kind === 'provider') {
    if (response.value === undefined) {
      throw invalidRequest(
        'A Provider interaction response cannot be undefined.',
      );
    }
    assertJsonValue(response.value, 'Codex Provider interaction response');
    return response.value;
  }
  if (request.responseKind === 'approval') {
    if (response.kind !== 'approval') {
      throw invalidRequest(
        'This Codex interaction requires an approval response.',
      );
    }
    if (response.providerOptions !== undefined) {
      throw invalidRequest(
        'Use a Provider response for Codex-native approval decisions.',
      );
    }
    return { decision: response.decision === 'approve' ? 'accept' : 'decline' };
  }
  throw invalidRequest('This Codex request requires a Provider response.');
}

/** Produce a bounded structural summary that never retains string values. */
export function redactCodexRaw(value: unknown): unknown {
  const state = { nodes: 0 };
  return redact(value, 0, state);
}

/** Build a bounded redacted raw event for orphan or unknown traffic. */
export function redactCodexEvent(
  method: string,
  params: unknown,
): CodexRawEvent {
  return { method: safeMethod(method), params: redactCodexRaw(params) };
}

function imageInput(uri: string): CodexUserInput {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw invalidRequest('Codex image_ref must be an absolute URI.');
  }
  if (parsed.protocol !== 'file:') return { type: 'image', url: uri };
  try {
    return { type: 'localImage', path: fileURLToPath(parsed) };
  } catch {
    throw invalidRequest('Codex image_ref file URI is invalid.');
  }
}

function isCodexUserInput(value: unknown): value is CodexUserInput {
  const input = record(value);
  if (input?.['type'] === 'text') {
    return (
      typeof input['text'] === 'string' && Array.isArray(input['text_elements'])
    );
  }
  if (input?.['type'] === 'image') return typeof input['url'] === 'string';
  if (input?.['type'] === 'localImage')
    return typeof input['path'] === 'string';
  return false;
}

function workspacePath(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw invalidRequest('Codex workspace must be an absolute file URI.');
  }
  if (parsed.protocol !== 'file:') {
    throw unsupported('workspace.file', 'Codex workspace must be a file URI.');
  }
  try {
    return fileURLToPath(parsed);
  } catch {
    throw invalidRequest('Codex workspace file URI is invalid.');
  }
}

function validatedOptions(
  value: Readonly<Record<string, unknown>> | undefined,
  allowed: readonly string[],
): JsonRecord {
  if (value === undefined) return {};
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    throw invalidRequest('Unsupported Codex option.');
  }
  return { ...value };
}

function assignStringOption(
  output: JsonRecord,
  options: JsonRecord,
  name: string,
): void {
  if (options[name] === undefined) return;
  output[name] = nonEmpty(options[name], `Codex ${name}`);
}

function assignEnumOption(
  output: JsonRecord,
  options: JsonRecord,
  name: string,
  allowed: ReadonlySet<string>,
): void {
  const value = options[name];
  if (value === undefined) return;
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw invalidRequest(`Codex ${name} is invalid.`);
  }
  output[name] = value;
}

function notificationContext(params: unknown): {
  readonly threadId: string | undefined;
  readonly turnId: string | undefined;
} {
  const direct = record(params);
  const turn = record(direct?.['turn']);
  return {
    threadId:
      typeof direct?.['threadId'] === 'string' ? direct['threadId'] : undefined,
    turnId:
      typeof direct?.['turnId'] === 'string'
        ? direct['turnId']
        : typeof turn?.['id'] === 'string'
          ? turn['id']
          : undefined,
  };
}

function mapTerminal(
  params: unknown,
  mapped: (events: readonly MappedCodexEvent[]) => CodexNotificationMapping,
): CodexNotificationMapping {
  const turn = record(record(params)?.['turn']);
  if (!isCompleteCodexTurn(turn)) {
    return mapped([providerEvent('turn/completed', params)]);
  }
  const status = turn?.['status'];
  if (status === 'completed') {
    return mapped([
      {
        type: 'run.completed',
        data: { status: 'completed' },
        terminalResult: { status: 'completed' },
      },
    ]);
  }
  if (status === 'interrupted') {
    return mapped([
      {
        type: 'run.cancelled',
        data: { status: 'cancelled' },
        terminalResult: { status: 'cancelled' },
      },
    ]);
  }
  if (status === 'failed') {
    const providerCode = codexErrorCode(
      record(turn?.['error'])?.['codexErrorInfo'],
    );
    const result: RunResult = {
      status: 'failed',
      ...(providerCode === undefined
        ? {}
        : { providerResult: { providerCode } }),
    };
    return mapped([
      {
        type: 'run.failed',
        data: result,
        terminalResult: result,
      },
    ]);
  }
  const failure: RunResult = {
    status: 'failed',
    providerResult: { reason: 'unknown_terminal_status' },
  };
  return mapped([
    providerEvent('turn/completed', params),
    { type: 'run.failed', data: failure, terminalResult: failure },
  ]);
}

function isCompleteCodexTurn(turn: JsonRecord | undefined): boolean {
  return (
    typeof turn?.['id'] === 'string' &&
    turn['id'].length > 0 &&
    Array.isArray(turn['items']) &&
    typeof turn['itemsView'] === 'string' &&
    typeof turn['status'] === 'string' &&
    typeof turn['startedAt'] === 'number' &&
    (turn['completedAt'] === null || typeof turn['completedAt'] === 'number') &&
    (turn['durationMs'] === null || typeof turn['durationMs'] === 'number') &&
    (turn['error'] === null || record(turn['error']) !== undefined)
  );
}

function usageSummary(params: unknown): UsageSummary | undefined {
  const last = record(record(record(params)?.['tokenUsage'])?.['last']);
  const inputTokens = last?.['inputTokens'];
  const outputTokens = last?.['outputTokens'];
  const totalTokens = last?.['totalTokens'];
  if (
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number' ||
    typeof totalTokens !== 'number'
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
}

function providerEvent(method: string, params: unknown): MappedCodexEvent {
  const raw = redactCodexEvent(method, params);
  return {
    type: 'provider',
    data: { method: raw.method },
    providerEventType: raw.method,
    raw,
  };
}

function providerRequest(
  method: string,
  params: unknown,
  requestId: string,
  context: {
    readonly threadId: string | undefined;
    readonly turnId: string | undefined;
  },
): MappedCodexServerRequest {
  return {
    ...context,
    responseKind: 'provider',
    interaction: {
      requestId,
      kind: 'provider',
      title: safeMethod(method),
      schema: redactCodexRaw(params),
    },
  };
}

function codexErrorCode(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return codexErrorCodes.has(value) ? value : undefined;
  }
  const error = record(value);
  if (error === undefined) return undefined;
  const keys = Object.keys(error);
  const key = keys.length === 1 ? keys[0] : undefined;
  return key !== undefined && codexErrorCodes.has(key) ? key : undefined;
}

function stringField(value: unknown, name: string): string | undefined {
  const field = record(value)?.[name];
  return typeof field === 'string' ? field : undefined;
}

function firstString(...values: readonly unknown[]): string {
  return (
    values.find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ) ?? 'Codex interaction.'
  );
}

function redact(
  value: unknown,
  depth: number,
  state: { nodes: number },
): unknown {
  state.nodes += 1;
  if (state.nodes > 64 || depth >= 4) return '[truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return '[redacted]';
  if (typeof value === 'string') return '[redacted]';
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
  for (const [index, [key, item]] of entries.slice(0, 16).entries()) {
    const safeKey =
      key.length <= 64 && safeRawKeys.has(key)
        ? key
        : `[redacted-key-${String(index)}]`;
    result[safeKey] = identifierRawKeys.has(key)
      ? '[redacted]'
      : redact(item, depth + 1, state);
  }
  if (entries.length > 16 || state.nodes > 64)
    result['__truncated__'] = '[truncated]';
  return result;
}

function assertJsonValue(value: unknown, label: string): void {
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    throw invalidRequest(`${label} must be JSON serializable.`);
  }
  try {
    JSON.stringify(value);
  } catch {
    throw invalidRequest(`${label} must be JSON serializable.`);
  }
}

function safeMethod(value: string): string {
  return /^[A-Za-z][0-9A-Za-z._/-]{0,127}$/u.test(value)
    ? value
    : '[redacted-method]';
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidRequest(`${label} must be a non-empty string.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidRequest(`${label} must be a positive integer.`);
  }
  return value;
}

function positiveTimer(value: number, label: string): number {
  const timeout = positiveInteger(value, label);
  if (timeout > maximumTimerMilliseconds) {
    throw invalidRequest(`${label} exceeds the supported timer range.`);
  }
  return timeout;
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function incompatible(surface: string): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    `Codex App Server ${surface} is not compatible with the verified stable protocol.`,
    { retryable: false, providerId: CODEX_PROVIDER_ID },
  );
}

function invalidRequest(message: string): HarnessError {
  return new HarnessError('invalid_request', message, {
    retryable: false,
    providerId: CODEX_PROVIDER_ID,
  });
}

function unsupported(capability: string, message: string): HarnessError {
  return new HarnessError('unsupported_capability', message, {
    retryable: false,
    providerId: CODEX_PROVIDER_ID,
    details: { capability },
  });
}
