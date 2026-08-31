import { createHash } from 'node:crypto';

import {
  HarnessError,
  providerId,
  type CreateSessionInput,
  type HarnessEvent,
  type HarnessInput,
  type InteractionRequest,
  type ProviderSessionId,
  type RunOptions,
  type RunResult,
  type SessionRef,
  type UsageSummary,
} from '@harapter/core';

/** Stable Provider identity for the Hermes Agent API Server Adapter. */
export const HERMES_PROVIDER_ID = providerId('nous.hermes-agent');

/** Current public API Server compatibility family. */
export const HERMES_SESSION_COMPATIBILITY_REF = `${HERMES_PROVIDER_ID};api-server=current`;

/** Typed extension name for Hermes background child-session observations. */
export const HERMES_SUBAGENT_EXTENSION = 'nous.hermes-agent.subagents';

type JsonRecord = Record<string, unknown>;

/** Validated subset of the API Server capability document used by Harapter. */
export interface HermesCapabilities {
  readonly authRequired: boolean;
  readonly model: string;
  readonly features: {
    readonly approval: boolean;
    readonly cancel: boolean;
  };
  readonly fingerprintSource: Readonly<Record<string, unknown>>;
}

/** Non-secret Session defaults retained across local handles and resume. */
export interface HermesSessionState {
  readonly model?: string;
  readonly modelOptions?: Readonly<Record<string, unknown>>;
  readonly provider?: string;
  readonly systemContext?: string;
}

/** Validated Session creation payload plus its retained defaults. */
export interface PreparedHermesSession {
  readonly body: Readonly<Record<string, unknown>>;
  readonly state: HermesSessionState;
}

/** Client-safe Hermes Session data required by the Adapter. */
export interface HermesSessionInfo {
  readonly id: string;
  readonly model?: string;
}

/** Acknowledgement returned when Hermes accepts a Run submission. */
export interface HermesRunReceipt {
  readonly runId: string;
  readonly status: 'started';
}

/** Pollable Hermes Run phase and optional authoritative terminal result. */
export interface HermesRunStatus {
  readonly status:
    | 'queued'
    | 'running'
    | 'waiting_for_approval'
    | 'stopping'
    | 'completed'
    | 'failed'
    | 'cancelled';
  readonly terminalEventType?: 'run.completed' | 'run.failed' | 'run.cancelled';
  readonly result?: RunResult;
}

/** Bounded event exposed to native unknown-event observers. */
export interface HermesRawEvent {
  readonly providerEventType: string;
  readonly raw: unknown;
}

/** Bounded Hermes background child-session lifecycle observation. */
export interface HermesSubagentEvent {
  readonly eventType: 'subagent.start' | 'subagent.complete';
  readonly runId: string;
  readonly childSessionId: string;
  readonly subagentId?: string;
  readonly status?: string;
  readonly raw: unknown;
}

/** Public typed observer extension for Hermes child Sessions. */
export interface HermesSubagentExtension {
  onEvent(listener: (event: HermesSubagentEvent) => void): () => void;
}

/** Validated event mapping owned by the Adapter lifecycle. */
export type HermesEventMapping =
  | {
      readonly kind: 'portable';
      readonly event: {
        readonly type: HarnessEvent['type'];
        readonly data: unknown;
      };
    }
  | {
      readonly kind: 'terminal';
      readonly eventType: 'run.completed' | 'run.failed' | 'run.cancelled';
    }
  | {
      readonly kind: 'interaction';
      readonly choices: readonly string[];
      readonly request: Omit<InteractionRequest, 'requestId'>;
    }
  | {
      readonly kind: 'interaction.resolved';
      readonly choice: string;
      readonly resolved: number;
    }
  | { readonly kind: 'subagent'; readonly event: HermesSubagentEvent }
  | { readonly kind: 'provider'; readonly event: HermesRawEvent };

const requiredEndpoints = {
  runs: { method: 'POST', path: '/v1/runs' },
  run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
  run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
  session_create: { method: 'POST', path: '/api/sessions' },
  session: { method: 'GET', path: '/api/sessions/{session_id}' },
} as const;

const optionalEndpoints = {
  run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' },
  run_stop: { method: 'POST', path: '/v1/runs/{run_id}/stop' },
} as const;

const maximumIdentifierLength = 256;
const maximumTextLength = 256 * 1024;
const maximumOptionDepth = 5;
const maximumOptionNodes = 256;
const maximumRawDepth = 5;
const maximumRawNodes = 128;
const maximumRawArrayItems = 16;
const maximumRawObjectFields = 32;
const approvalChoices = new Set(['once', 'session', 'always', 'deny']);
const sensitiveOptionWords = new Set([
  'authorization',
  'cookie',
  'credential',
  'key',
  'passphrase',
  'password',
  'pem',
  'secret',
  'token',
]);
const sensitiveOptionSuffix =
  /(?:authorization|cookie|credential|passphrase|password|pem|secret|token)$/iu;
const sensitiveCompactKeySuffix =
  /(?:api|auth|client|consumer|encryption|private|public|secret|serviceaccount|session|signing)key$/iu;
const safeRawKeys = new Set([
  'api_calls',
  'child_session_id',
  'choice',
  'choices',
  'command',
  'cost_usd',
  'delta',
  'depth',
  'description',
  'duration',
  'duration_seconds',
  'error',
  'event',
  'files_read',
  'files_written',
  'goal',
  'input_tokens',
  'last_event',
  'model',
  'object',
  'output',
  'output_tail',
  'output_tokens',
  'parent_id',
  'preview',
  'reasoning_tokens',
  'resolved',
  'run_id',
  'session_id',
  'status',
  'subagent_id',
  'summary',
  'text',
  'timestamp',
  'tool',
  'tool_count',
  'total_tokens',
  'usage',
]);

/** Validate the capability and route surface needed by the Adapter. */
export function parseHermesCapabilities(value: unknown): HermesCapabilities {
  const document = requiredRecord(value, 'capability document');
  if (
    document['object'] !== 'hermes.api_server.capabilities' ||
    document['platform'] !== 'hermes-agent'
  ) {
    throw incompatible('capability identity');
  }
  const model = boundedString(document['model'], 'capability model');
  const auth = requiredRecord(document['auth'], 'capability authentication');
  if (auth['type'] !== 'bearer' || typeof auth['required'] !== 'boolean') {
    throw incompatible('capability authentication');
  }
  const features = requiredRecord(document['features'], 'capability features');
  const endpoints = requiredRecord(
    document['endpoints'],
    'capability endpoints',
  );
  for (const [name, expected] of Object.entries(requiredEndpoints)) {
    assertEndpoint(endpoints[name], expected.method, expected.path, name);
  }
  for (const name of [
    'run_submission',
    'run_status',
    'run_events_sse',
    'session_resources',
  ]) {
    if (features[name] !== true) throw incompatible(`capability ${name}`);
  }
  const cancel =
    features['run_stop'] === true &&
    endpointMatches(
      endpoints['run_stop'],
      optionalEndpoints.run_stop.method,
      optionalEndpoints.run_stop.path,
    );
  const approval =
    features['run_approval_response'] === true &&
    features['approval_events'] === true &&
    endpointMatches(
      endpoints['run_approval'],
      optionalEndpoints.run_approval.method,
      optionalEndpoints.run_approval.path,
    );
  return {
    authRequired: auth['required'],
    model,
    features: { approval, cancel },
    fingerprintSource: {
      object: document['object'],
      platform: document['platform'],
      auth: { required: auth['required'], type: auth['type'] },
      features: {
        approval,
        cancel,
        run_events_sse: true,
        run_status: true,
        run_submission: true,
        session_resources: true,
      },
      endpoints: {
        ...requiredEndpoints,
        ...(approval ? { run_approval: optionalEndpoints.run_approval } : {}),
        ...(cancel ? { run_stop: optionalEndpoints.run_stop } : {}),
      },
    },
  };
}

/** Produce a non-secret deterministic protocol identity from capabilities. */
export function compatibilityFingerprint(
  capabilities: HermesCapabilities,
): string {
  const digest = createHash('sha256')
    .update(stableJson(capabilities.fingerprintSource))
    .digest('hex')
    .slice(0, 16);
  return `capabilities-${digest}`;
}

/** Validate and prepare one Hermes Session creation request. */
export function prepareHermesSession(
  input: CreateSessionInput,
): PreparedHermesSession {
  assertEmptyMetadata(input.metadata, 'Session metadata');
  if (input.workspace !== undefined) {
    throw unsupported(
      'session.workspace',
      'Hermes API Server workspace selection is not supported.',
    );
  }
  const providerOptions = knownOptions(
    input.providerOptions,
    ['source', 'title'],
    'Session providerOptions',
  );
  const modelOptions = knownOptions(
    input.model?.providerOptions,
    ['modelOptions', 'provider'],
    'model providerOptions',
  );
  const body: Record<string, unknown> = {};
  const state: {
    model?: string;
    modelOptions?: Readonly<Record<string, unknown>>;
    provider?: string;
    systemContext?: string;
  } = {};
  if (input.systemContext !== undefined) {
    const systemContext = inputString(
      input.systemContext,
      'Session system context',
      true,
    );
    body['system_prompt'] = systemContext;
    state.systemContext = systemContext;
  }
  if (input.model !== undefined) {
    const model = inputSelection(input.model.id, 'model identifier');
    body['model'] = model;
    state.model = model;
    const provider = optionalInputSelection(
      modelOptions['provider'],
      'model Provider identifier',
    );
    if (provider !== undefined) {
      body['provider'] = provider;
      state.provider = provider;
    }
    if (modelOptions['modelOptions'] !== undefined) {
      const nativeOptions = safeOptions(
        modelOptions['modelOptions'],
        'modelOptions',
      );
      body['model_options'] = nativeOptions;
      state.modelOptions = nativeOptions;
    }
  }
  const source = optionalInputSelection(
    providerOptions['source'],
    'Session source',
  );
  if (source !== undefined) body['source'] = source;
  const title = optionalInputText(providerOptions['title'], 'Session title');
  if (title !== undefined) body['title'] = title;
  return { body, state };
}

/** Convert portable text and retained Session defaults to a Runs API body. */
export function prepareHermesRun(
  input: HarnessInput,
  sessionId: ProviderSessionId,
  state: HermesSessionState,
  options: RunOptions = {},
): Readonly<Record<string, unknown>> {
  assertEmptyMetadata(input.metadata, 'Run input metadata');
  assertEmptyMetadata(options.metadata, 'Run metadata');
  const text: string[] = [];
  for (const part of input.parts) {
    if (part.type !== 'text') {
      throw unsupported(
        `input.${part.type}`,
        'Hermes API Server portable Runs accept text input only.',
      );
    }
    text.push(inputString(part.text, 'Run text', true));
  }
  if (text.length === 0) throw invalidRequest('Hermes Run text is required.');
  const runOptions = knownOptions(
    options.providerOptions,
    [],
    'Run providerOptions',
  );
  if (Object.keys(runOptions).length > 0) {
    throw invalidRequest('Hermes Run providerOptions are not supported.');
  }
  return {
    input: text.join('\n'),
    session_id: sessionId,
    ...(state.systemContext === undefined
      ? {}
      : { instructions: state.systemContext }),
    ...(state.model === undefined ? {} : { model: state.model }),
    ...(state.provider === undefined ? {} : { provider: state.provider }),
    ...(state.modelOptions === undefined
      ? {}
      : { model_options: snapshotRecord(state.modelOptions) }),
  };
}

/** Parse one client-safe Session response. */
export function parseHermesSession(value: unknown): HermesSessionInfo {
  const response = requiredRecord(value, 'Session response');
  if (response['object'] !== 'hermes.session') {
    throw incompatible('Session response');
  }
  const session = requiredRecord(response['session'], 'Session resource');
  const id = nativeIdentifier(session['id'], 'Session identifier');
  const model = optionalSelection(session['model'], 'Session model');
  return { id, ...(model === undefined ? {} : { model }) };
}

/** Parse one accepted Run receipt. */
export function parseHermesRunReceipt(value: unknown): HermesRunReceipt {
  const response = requiredRecord(value, 'Run receipt');
  if (response['status'] !== 'started') throw incompatible('Run receipt');
  return {
    runId: nativeIdentifier(response['run_id'], 'Run identifier'),
    status: 'started',
  };
}

/** Parse and validate one pollable Run status against its owner. */
export function parseHermesRunStatus(
  value: unknown,
  expectedRunId: string,
  expectedSessionId: string,
): HermesRunStatus {
  const response = requiredRecord(value, 'Run status');
  if (
    response['object'] !== 'hermes.run' ||
    nativeIdentifier(response['run_id'], 'Run status identifier') !==
      expectedRunId ||
    nativeIdentifier(response['session_id'], 'Run Session identifier') !==
      expectedSessionId
  ) {
    throw incompatible('Run status ownership');
  }
  const status = response['status'];
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'waiting_for_approval' ||
    status === 'stopping'
  ) {
    return { status };
  }
  if (status === 'completed') {
    assertLastEvent(response, 'run.completed');
    const finalMessage = boundedString(response['output'], 'Run output', true);
    const usage = usageSummary(response['usage']);
    return {
      status,
      terminalEventType: 'run.completed',
      result: {
        status: 'completed',
        finalMessage,
        ...(usage === undefined ? {} : { usage }),
        providerResult: { status },
      },
    };
  }
  if (status === 'failed') {
    assertLastEvent(response, 'run.failed');
    boundedString(response['error'], 'Run failure', true);
    return {
      status,
      terminalEventType: 'run.failed',
      result: { status: 'failed', providerResult: { status } },
    };
  }
  if (status === 'cancelled') {
    assertLastEvent(response, 'run.cancelled');
    return {
      status,
      terminalEventType: 'run.cancelled',
      result: { status: 'cancelled', providerResult: { status } },
    };
  }
  throw incompatible('Run status value');
}

/** Parse one Runs API SSE payload into a lifecycle-owned mapping. */
export function mapHermesEvent(
  value: unknown,
  expectedRunId: string,
): HermesEventMapping {
  const event = requiredRecord(value, 'Run event');
  const eventType = safeEventType(event['event']);
  if (
    nativeIdentifier(event['run_id'], 'Run event identifier') !== expectedRunId
  ) {
    throw incompatible('Run event ownership');
  }
  if (event['timestamp'] !== undefined)
    finiteNumber(event['timestamp'], 'timestamp');
  if (eventType === 'message.delta') {
    return {
      kind: 'portable',
      event: {
        type: 'message.delta',
        data: { delta: boundedString(event['delta'], 'message delta', true) },
      },
    };
  }
  if (eventType === 'tool.started') {
    return {
      kind: 'portable',
      event: {
        type: 'tool.started',
        data: { tool: boundedString(event['tool'], 'tool name') },
      },
    };
  }
  if (eventType === 'tool.completed') {
    const error = event['error'];
    if (typeof error !== 'boolean') throw incompatible('tool completion');
    return {
      kind: 'portable',
      event: {
        type: 'tool.completed',
        data: {
          tool: boundedString(event['tool'], 'tool name'),
          duration: finiteNumber(event['duration'], 'tool duration'),
          error,
        },
      },
    };
  }
  if (eventType === 'reasoning.available') {
    return {
      kind: 'portable',
      event: {
        type: 'reasoning.completed',
        data: { text: boundedString(event['text'], 'reasoning text', true) },
      },
    };
  }
  if (
    eventType === 'run.completed' ||
    eventType === 'run.failed' ||
    eventType === 'run.cancelled'
  ) {
    return { kind: 'terminal', eventType };
  }
  if (eventType === 'approval.request') {
    const choices = stringArray(event['choices'], 'approval choices');
    if (
      choices.length === 0 ||
      choices.some((choice) => !approvalChoices.has(choice))
    ) {
      throw incompatible('approval choices');
    }
    const title = optionalText(event['description'], 'approval description');
    const prompt = optionalText(event['command'], 'approval command');
    return {
      kind: 'interaction',
      choices,
      request: {
        kind: 'approval',
        ...(title === undefined ? {} : { title }),
        ...(prompt === undefined ? {} : { prompt }),
        providerState: { choices },
      },
    };
  }
  if (eventType === 'approval.responded') {
    const choice = boundedSelection(event['choice'], 'approval choice');
    const resolved = nonnegativeInteger(
      event['resolved'],
      'approval resolved count',
    );
    if (!approvalChoices.has(choice) || resolved < 1) {
      throw incompatible('approval resolution');
    }
    return {
      kind: 'interaction.resolved',
      choice,
      resolved,
    };
  }
  if (eventType === 'subagent.start' || eventType === 'subagent.complete') {
    const childSessionId = optionalNativeIdentifier(event['child_session_id']);
    if (childSessionId !== undefined) {
      const subagentId = optionalNativeIdentifier(event['subagent_id']);
      const status = optionalSelection(event['status'], 'subagent status');
      return {
        kind: 'subagent',
        event: {
          eventType,
          runId: expectedRunId,
          childSessionId,
          ...(subagentId === undefined ? {} : { subagentId }),
          ...(status === undefined ? {} : { status }),
          raw: redactHermesEvent(event),
        },
      };
    }
  }
  return {
    kind: 'provider',
    event: {
      providerEventType: eventType,
      raw: redactHermesEvent(event),
    },
  };
}

/** Parse a stopping acknowledgement without treating it as a terminal. */
export function parseHermesStopResponse(
  value: unknown,
  expectedRunId: string,
): { readonly status: 'stopping' } {
  const response = requiredRecord(value, 'Run stop response');
  if (
    nativeIdentifier(response['run_id'], 'Run stop identifier') !==
      expectedRunId ||
    response['status'] !== 'stopping'
  ) {
    throw incompatible('Run stop response');
  }
  return { status: 'stopping' };
}

/** Parse one acknowledgement for a Run-scoped approval response. */
export function parseHermesApprovalResponse(
  value: unknown,
  expectedRunId: string,
  expectedChoice: string,
): { readonly choice: string; readonly resolved: number } {
  const response = requiredRecord(value, 'approval response');
  const choice = boundedSelection(response['choice'], 'approval choice');
  const resolved = nonnegativeInteger(
    response['resolved'],
    'approval resolved count',
  );
  if (
    response['object'] !== 'hermes.run.approval_response' ||
    nativeIdentifier(response['run_id'], 'approval Run identifier') !==
      expectedRunId ||
    choice !== expectedChoice ||
    resolved < 1
  ) {
    throw incompatible('approval response');
  }
  return { choice, resolved };
}

/** Restore only the bounded non-secret Session defaults owned by this Adapter. */
export function sessionStateFromRef(ref: SessionRef): HermesSessionState {
  const value = requiredRecordOrMismatch(ref.providerState);
  try {
    const model = optionalSelection(value['model'], 'persisted model');
    const provider = optionalSelection(value['provider'], 'persisted Provider');
    const systemContext = optionalText(
      value['systemContext'],
      'persisted system context',
    );
    const known = new Set(['model', 'provider', 'systemContext']);
    if (Object.keys(value).some((key) => !known.has(key))) {
      throw sessionStateMismatch();
    }
    return {
      ...(model === undefined ? {} : { model }),
      ...(provider === undefined ? {} : { provider }),
      ...(systemContext === undefined ? {} : { systemContext }),
    };
  } catch {
    throw sessionStateMismatch();
  }
}

/** Snapshot Session defaults without retaining caller-owned objects. */
export function snapshotHermesSessionState(
  state: HermesSessionState,
): Readonly<Record<string, unknown>> {
  return {
    ...(state.model === undefined ? {} : { model: state.model }),
    ...(state.provider === undefined ? {} : { provider: state.provider }),
    ...(state.systemContext === undefined
      ? {}
      : { systemContext: state.systemContext }),
  };
}

/** Produce a bounded content-free representation for raw observation. */
export function redactHermesEvent(value: unknown): unknown {
  return redact(value, 0, { nodes: 0 });
}

function endpointMatches(
  value: unknown,
  method: string,
  path: string,
): boolean {
  const endpoint = record(value);
  return endpoint?.['method'] === method && endpoint['path'] === path;
}

function assertEndpoint(
  value: unknown,
  method: string,
  path: string,
  name: string,
): void {
  if (!endpointMatches(value, method, path)) {
    throw incompatible(`endpoint ${name}`);
  }
}

function assertLastEvent(response: JsonRecord, expected: string): void {
  if (response['last_event'] !== expected) {
    throw incompatible('Run terminal evidence');
  }
}

function usageSummary(value: unknown): UsageSummary | undefined {
  if (value === undefined) return undefined;
  const usage = requiredRecord(value, 'Run usage');
  const inputTokens = optionalNonnegativeInteger(
    usage['input_tokens'],
    'input_tokens',
  );
  const outputTokens = optionalNonnegativeInteger(
    usage['output_tokens'],
    'output_tokens',
  );
  const totalTokens = optionalNonnegativeInteger(
    usage['total_tokens'],
    'total_tokens',
  );
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function knownOptions(
  value: Readonly<Record<string, unknown>> | undefined,
  allowed: readonly string[],
  label: string,
): JsonRecord {
  if (value === undefined) return {};
  const options = record(value);
  if (options === undefined)
    throw invalidRequest(`Hermes ${label} must be an object.`);
  const known = new Set(allowed);
  const unknown = Object.keys(options).find((name) => !known.has(name));
  if (unknown !== undefined) {
    throw invalidRequest(`Hermes ${label} field ${unknown} is unknown.`);
  }
  return options;
}

function assertEmptyMetadata(
  value: Readonly<Record<string, string>> | undefined,
  label: string,
): void {
  if (
    value !== undefined &&
    (record(value) === undefined || Object.keys(value).length > 0)
  ) {
    throw invalidRequest(`Hermes ${label} are not supported.`);
  }
}

function safeOptions(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  const options = record(value);
  if (options === undefined)
    throw invalidRequest(`Hermes ${label} must be an object.`);
  const state = { nodes: 0 };
  const copied = safeOptionValue(options, 0, state, '') as JsonRecord;
  return copied;
}

function safeOptionValue(
  value: unknown,
  depth: number,
  state: { nodes: number },
  key: string,
): unknown {
  state.nodes += 1;
  if (state.nodes > maximumOptionNodes || depth > maximumOptionDepth) {
    throw invalidRequest('Hermes modelOptions exceed the supported bound.');
  }
  if (credentialShapedOptionKey(key)) {
    throw invalidRequest(
      'Hermes modelOptions cannot contain credential fields.',
    );
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw invalidRequest('Hermes modelOptions contain a non-finite number.');
    return value;
  }
  if (typeof value === 'string')
    return inputString(value, 'model option', true);
  if (Array.isArray(value)) {
    if (value.length > maximumRawArrayItems) {
      throw invalidRequest(
        'Hermes modelOptions array exceeds the supported bound.',
      );
    }
    return value.map((item) => safeOptionValue(item, depth + 1, state, key));
  }
  const object = record(value);
  if (
    object === undefined ||
    Object.keys(object).length > maximumRawObjectFields
  ) {
    throw invalidRequest('Hermes modelOptions contain an unsupported value.');
  }
  return Object.fromEntries(
    Object.entries(object).map(([name, child]) => [
      name,
      safeOptionValue(child, depth + 1, state, name),
    ]),
  );
}

function credentialShapedOptionKey(key: string): boolean {
  if (sensitiveOptionSuffix.test(key) || sensitiveCompactKeySuffix.test(key)) {
    return true;
  }
  const words = key
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u);
  return words.some((word) => sensitiveOptionWords.has(word.toLowerCase()));
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumRawArrayItems) {
    throw incompatible(label);
  }
  return value.map((item) => boundedSelection(item, label));
}

function boundedSelection(value: unknown, label: string): string {
  const selected = boundedString(value, label);
  if (/\p{Cc}/u.test(selected)) throw incompatible(label);
  return selected;
}

function optionalSelection(value: unknown, label: string): string | undefined {
  return value === undefined || value === null
    ? undefined
    : boundedSelection(value, label);
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined || value === null
    ? undefined
    : boundedString(value, label, true);
}

function inputSelection(value: unknown, label: string): string {
  const selected = inputString(value, label);
  if (/\p{Cc}/u.test(selected)) {
    throw invalidRequest(`Hermes ${label} contains control characters.`);
  }
  return selected;
}

function optionalInputSelection(
  value: unknown,
  label: string,
): string | undefined {
  return value === undefined || value === null
    ? undefined
    : inputSelection(value, label);
}

function optionalInputText(value: unknown, label: string): string | undefined {
  return value === undefined || value === null
    ? undefined
    : inputString(value, label, true);
}

function inputString(
  value: unknown,
  label: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximumTextLength
  ) {
    throw invalidRequest(`Hermes ${label} is invalid.`);
  }
  return value;
}

function boundedString(
  value: unknown,
  label: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximumTextLength
  ) {
    throw incompatible(label);
  }
  return value;
}

function nativeIdentifier(value: unknown, label: string): string {
  const id = boundedString(value, label);
  if (
    id.length > maximumIdentifierLength ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)
  ) {
    throw incompatible(label);
  }
  return id;
}

function optionalNativeIdentifier(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return nativeIdentifier(value, 'native identifier');
  } catch {
    return undefined;
  }
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw incompatible(label);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw incompatible(label);
  }
  return value as number;
}

function optionalNonnegativeInteger(
  value: unknown,
  label: string,
): number | undefined {
  return value === undefined ? undefined : nonnegativeInteger(value, label);
}

function requiredRecord(value: unknown, label: string): JsonRecord {
  const object = record(value);
  if (object === undefined) throw incompatible(label);
  return object;
}

function requiredRecordOrMismatch(value: unknown): JsonRecord {
  const object = record(value);
  if (object === undefined) throw sessionStateMismatch();
  return object;
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function safeEventType(value: unknown): string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(value)
    ? value
    : 'unknown';
}

function redact(
  value: unknown,
  depth: number,
  state: { nodes: number },
): unknown {
  state.nodes += 1;
  if (state.nodes > maximumRawNodes || depth > maximumRawDepth) {
    return '<truncated>';
  }
  if (value === null) return null;
  if (typeof value === 'string') return '<string>';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? '<number>' : '<non-finite>';
  }
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, maximumRawArrayItems)
      .map((item) => redact(item, depth + 1, state));
  }
  const object = record(value);
  if (object === undefined) return `<${typeof value}>`;
  const output: Record<string, unknown> = {};
  let included = 0;
  let omitted = 0;
  for (const [key, child] of Object.entries(object)) {
    if (!safeRawKeys.has(key) || included >= maximumRawObjectFields) {
      omitted += 1;
      continue;
    }
    output[key] = redact(child, depth + 1, state);
    included += 1;
  }
  if (omitted > 0) output['omittedFields'] = omitted;
  return output;
}

function snapshotRecord(value: Readonly<Record<string, unknown>>): JsonRecord {
  return structuredClone(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}

function incompatible(surface: string): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    `Hermes Agent returned an incompatible ${surface}.`,
    { retryable: false, providerId: HERMES_PROVIDER_ID },
  );
}

function invalidRequest(message: string): HarnessError {
  return new HarnessError('invalid_request', message, {
    retryable: false,
    providerId: HERMES_PROVIDER_ID,
  });
}

function unsupported(capability: string, message: string): HarnessError {
  return new HarnessError('unsupported_capability', message, {
    retryable: false,
    providerId: HERMES_PROVIDER_ID,
    details: { capability },
  });
}

function sessionStateMismatch(): HarnessError {
  return new HarnessError(
    'session_provider_mismatch',
    'Hermes Agent Session state is missing or incompatible.',
    { retryable: false, providerId: HERMES_PROVIDER_ID },
  );
}
