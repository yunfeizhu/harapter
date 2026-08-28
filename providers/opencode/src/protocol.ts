import { fileURLToPath } from 'node:url';
import {
  HarnessError,
  providerId,
  type CreateSessionInput,
  type HarnessEvent,
  type HarnessInput,
  type ProviderSessionId,
  type RunOptions,
  type RunResult,
  type SessionRef,
  type UsageSummary,
} from '@harapter/core';

/** Stable Provider identity owned by the OpenCode Adapter. */
export const OPENCODE_PROVIDER_ID = providerId('opencode');

/** Stable protocol family used to validate resumable Session references. */
export const OPENCODE_SESSION_COMPATIBILITY_REF = `${OPENCODE_PROVIDER_ID};http-openapi=stable`;

/** Provider-native prompt part accepted through the explicit Core escape hatch. */
export const OPENCODE_NATIVE_PART = 'opencode.part';

/** Minimal OpenCode prompt part surface validated by this Adapter. */
export type OpenCodeNativePart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'file';
      readonly mime: string;
      readonly url: string;
      readonly filename?: string;
    }
  | { readonly type: 'agent'; readonly name: string }
  | {
      readonly type: 'subtask';
      readonly prompt: string;
      readonly description: string;
      readonly agent: string;
    };

/** Defaults retained with an OpenCode Session for subsequent prompts. */
export interface OpenCodeSessionDefaults {
  readonly system?: string;
  readonly model?: {
    readonly providerId: string;
    readonly modelId: string;
  };
}

/** Provider state required to address one Session's OpenCode instance. */
export interface OpenCodeSessionState extends OpenCodeSessionDefaults {
  readonly directory: string;
}

/** Validated output used when creating an OpenCode Session. */
export interface PreparedOpenCodeSession {
  readonly body: Readonly<Record<string, string>>;
  readonly directory?: string;
  readonly defaults: OpenCodeSessionDefaults;
}

/** Validated OpenCode Session identity used by the Adapter. */
export interface OpenCodeSessionInfo {
  readonly id: string;
  readonly directory: string;
  readonly version: string;
}

/** Runtime activity state used to prevent unsafe Session resume. */
export type OpenCodeSessionStatus = 'busy' | 'idle' | 'retry';

/** Validated event envelope from the documented OpenCode SSE route. */
export interface OpenCodeWireEvent {
  readonly id?: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** Bounded and redacted structural view of an upstream OpenCode event. */
export interface OpenCodeRawEvent {
  readonly type: string;
  readonly properties: unknown;
}

/** Provider-level event before portable identity and sequence are attached. */
export interface MappedOpenCodeEvent {
  readonly type: HarnessEvent['type'];
  readonly data: unknown;
  readonly providerEventType?: string;
  readonly raw?: OpenCodeRawEvent;
  readonly usage?: UsageSummary;
}

/** Approval details extracted from an OpenCode permission event. */
export interface OpenCodePermissionRequest {
  readonly permissionId: string;
  readonly title: string;
  readonly type: string;
  readonly pattern?: string | readonly string[];
}

/** Stateful event mapping outcome for one active Run. */
export interface OpenCodeEventMapping {
  readonly events: readonly MappedOpenCodeEvent[];
  readonly routed: boolean;
  readonly permission?: OpenCodePermissionRequest;
  readonly resolvedPermissionId?: string;
}

/** Per-Run state needed to reject user or foreign message parts. */
export interface OpenCodeEventState {
  readonly assistantMessageIds: Set<string>;
  readonly partTypes: Map<string, string>;
}

/** Validated authoritative terminal mapping from the synchronous prompt route. */
export interface OpenCodeTerminalMapping {
  readonly result: RunResult;
  readonly finalMessage?: string;
  readonly usage: UsageSummary;
  readonly providerResult: Readonly<Record<string, string>>;
}

type JsonRecord = Record<string, unknown>;

const maximumTimerMilliseconds = 2_147_483_647;
const safeRawKeys = new Set([
  'cache',
  'callID',
  'data',
  'delta',
  'error',
  'id',
  'info',
  'input',
  'messageID',
  'name',
  'output',
  'part',
  'partID',
  'patterns',
  'permission',
  'permissionID',
  'properties',
  'read',
  'reasoning',
  'response',
  'requestID',
  'reply',
  'role',
  'sessionID',
  'state',
  'status',
  'time',
  'tokens',
  'tool',
  'type',
  'write',
]);
const maximumRawDepth = 5;
const maximumRawNodes = 128;
const maximumRawArrayItems = 16;
const maximumRawObjectFields = 32;
const maximumTrackedMessages = 64;
const maximumTrackedParts = 256;
const completedFinishReasons = new Set([
  'content-filter',
  'length',
  'other',
  'stop',
]);

/** Validate the OpenCode health response and capture runtime identity. */
export function parseOpenCodeHealth(value: unknown): {
  readonly version: string;
} {
  const response = record(value);
  if (response?.['healthy'] !== true) throw incompatible('health response');
  return { version: nonEmptyString(response['version'], 'runtime version') };
}

/** Validate the stable Session fields used by Harapter. */
export function parseOpenCodeSession(value: unknown): OpenCodeSessionInfo {
  const session = record(value);
  if (
    session === undefined ||
    typeof session['projectID'] !== 'string' ||
    typeof session['title'] !== 'string' ||
    record(session['time']) === undefined
  ) {
    throw incompatible('Session response');
  }
  return {
    id: nonEmptyString(session['id'], 'Session identifier'),
    directory: nonEmptyString(session['directory'], 'Session directory'),
    version: nonEmptyString(session['version'], 'Session runtime version'),
  };
}

/** Validate the directory-scoped status map for one resumable Session. */
export function parseOpenCodeSessionStatus(
  value: unknown,
  sessionId: ProviderSessionId,
): OpenCodeSessionStatus {
  const statuses = record(value);
  if (statuses === undefined) throw incompatible('Session status response');
  const valueForSession = statuses[sessionId];
  if (valueForSession === undefined) return 'idle';
  const status = record(valueForSession)?.['type'];
  if (status === 'busy' || status === 'idle' || status === 'retry')
    return status;
  throw incompatible('Session status response');
}

/** Convert portable Session creation fields into the stable OpenCode request. */
export function prepareOpenCodeSession(
  input: CreateSessionInput = {},
): PreparedOpenCodeSession {
  const options = validatedOptions(input.providerOptions, [
    'parentId',
    'title',
  ]);
  const body: Record<string, string> = {};
  assignNonEmptyString(body, 'title', options['title'], 'Session title');
  assignNonEmptyString(
    body,
    'parentID',
    options['parentId'],
    'parent Session id',
  );

  const defaults: {
    system?: string;
    model?: { providerId: string; modelId: string };
  } = {};
  if (input.systemContext !== undefined) {
    defaults.system = inputString(input.systemContext, 'systemContext');
  }
  if (input.model !== undefined) defaults.model = coreModel(input.model);

  return {
    body,
    ...(input.workspace === undefined
      ? {}
      : { directory: workspacePath(input.workspace.uri) }),
    defaults,
  };
}

/** Convert portable Run input and options into one stable prompt body. */
export function prepareOpenCodePrompt(
  input: HarnessInput,
  options: RunOptions = {},
  defaults: OpenCodeSessionDefaults = {},
): Readonly<Record<string, unknown>> {
  if (input.parts.length === 0) {
    throw invalidRequest('An OpenCode Run requires at least one input part.');
  }
  if (options.timeoutMs !== undefined) {
    positiveTimer(options.timeoutMs, 'timeoutMs');
  }
  const providerOptions = validatedOptions(options.providerOptions, [
    'agent',
    'model',
    'system',
    'tools',
  ]);
  const prompt: Record<string, unknown> = {
    parts: input.parts.map(preparePart),
  };

  const system = providerOptions['system'] ?? defaults.system;
  if (system !== undefined) {
    prompt['system'] = inputString(system, 'Run system');
  }
  const model =
    providerOptions['model'] === undefined
      ? defaults.model
      : nativeModel(providerOptions['model'], 'Run model');
  if (model !== undefined) {
    prompt['model'] = {
      providerID: model.providerId,
      modelID: model.modelId,
    };
  }
  if (providerOptions['agent'] !== undefined) {
    prompt['agent'] = inputString(providerOptions['agent'], 'Run agent');
  }
  if (providerOptions['tools'] !== undefined) {
    prompt['tools'] = booleanMap(providerOptions['tools'], 'Run tools');
  }
  return prompt;
}

/** Decode and validate one SSE event's JSON envelope. */
export function parseOpenCodeEvent(data: string): OpenCodeWireEvent {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw incompatible('SSE event JSON');
  }
  const event = record(value);
  const properties = record(event?.['properties']);
  if (event === undefined || properties === undefined) {
    throw incompatible('SSE event envelope');
  }
  const type = nonEmptyString(event['type'], 'SSE event type');
  const id = event['id'];
  if (id !== undefined && typeof id !== 'string') {
    throw incompatible('SSE event identifier');
  }
  return {
    type,
    properties,
    ...(id === undefined ? {} : { id }),
  };
}

/** Create fresh event-routing state for one Run. */
export function createOpenCodeEventState(): OpenCodeEventState {
  return {
    assistantMessageIds: new Set<string>(),
    partTypes: new Map<string, string>(),
  };
}

/** Map one stable or unknown OpenCode event for an owning Session. */
export function mapOpenCodeEvent(
  event: OpenCodeWireEvent,
  sessionId: ProviderSessionId,
  state: OpenCodeEventState,
): OpenCodeEventMapping {
  const routedSessionId = eventSessionId(event);
  if (routedSessionId !== undefined && routedSessionId !== sessionId) {
    return { events: [], routed: false };
  }

  if (event.type === 'server.connected') return { events: [], routed: false };

  if (event.type === 'message.updated') {
    const info = record(event.properties['info']);
    if (
      event.properties['sessionID'] !== sessionId &&
      info?.['sessionID'] !== sessionId
    ) {
      return { events: [], routed: false };
    }
    if (info === undefined) return providerMapping(event);
    if (info['role'] !== 'assistant') return { events: [], routed: true };
    const messageId = info['id'];
    if (typeof messageId !== 'string' || messageId.length === 0) {
      return providerMapping(event);
    }
    boundedSetAdd(state.assistantMessageIds, messageId, maximumTrackedMessages);
    const usage = usageSummary(info['tokens']);
    return usage === undefined
      ? { events: [], routed: true }
      : {
          events: [{ type: 'usage.updated', data: usage, usage }],
          routed: true,
        };
  }

  if (event.type === 'message.part.updated') {
    const part = record(event.properties['part']);
    if (
      event.properties['sessionID'] !== sessionId &&
      part?.['sessionID'] !== sessionId
    ) {
      return { events: [], routed: false };
    }
    if (part === undefined) return providerMapping(event);
    const partId = part['id'];
    const partType = part['type'];
    if (
      typeof partId === 'string' &&
      partId.length > 0 &&
      typeof partType === 'string'
    ) {
      boundedMapSet(state.partTypes, partId, partType, maximumTrackedParts);
    }
    const messageId = part['messageID'];
    if (
      typeof messageId !== 'string' ||
      !state.assistantMessageIds.has(messageId)
    ) {
      return providerMapping(event);
    }
    return mapPartEvent(event, part);
  }

  if (event.type === 'message.part.delta') {
    if (event.properties['sessionID'] !== sessionId) {
      return { events: [], routed: false };
    }
    const messageId = event.properties['messageID'];
    const partId = event.properties['partID'];
    const field = event.properties['field'];
    const delta = event.properties['delta'];
    if (
      typeof messageId !== 'string' ||
      !state.assistantMessageIds.has(messageId) ||
      typeof partId !== 'string' ||
      field !== 'text' ||
      typeof delta !== 'string'
    ) {
      return providerMapping(event);
    }
    const partType = state.partTypes.get(partId);
    if (partType === 'text') {
      return {
        events: [{ type: 'message.delta', data: { delta } }],
        routed: true,
      };
    }
    if (partType === 'reasoning') {
      return {
        events: [{ type: 'reasoning.delta', data: { delta } }],
        routed: true,
      };
    }
    return providerMapping(event);
  }

  if (
    event.type === 'permission.asked' ||
    event.type === 'permission.updated'
  ) {
    if (event.properties['sessionID'] !== sessionId) {
      return { events: [], routed: false };
    }
    const permissionId = event.properties['id'];
    const permissionType =
      event.type === 'permission.asked'
        ? event.properties['permission']
        : event.properties['type'];
    const title =
      event.type === 'permission.asked'
        ? typeof permissionType === 'string'
          ? `OpenCode ${permissionType} permission`
          : undefined
        : event.properties['title'];
    if (
      typeof permissionId !== 'string' ||
      permissionId.length === 0 ||
      typeof permissionType !== 'string' ||
      permissionType.length === 0 ||
      typeof title !== 'string' ||
      title.length === 0
    ) {
      return providerMapping(event);
    }
    const pattern = permissionPattern(
      event.type === 'permission.asked'
        ? event.properties['patterns']
        : event.properties['pattern'],
    );
    return {
      events: [],
      routed: true,
      permission: {
        permissionId,
        title,
        type: permissionType,
        ...(pattern === undefined ? {} : { pattern }),
      },
    };
  }

  if (event.type === 'permission.replied') {
    if (event.properties['sessionID'] !== sessionId) {
      return { events: [], routed: false };
    }
    const permissionId =
      event.properties['requestID'] ?? event.properties['permissionID'];
    return typeof permissionId === 'string' && permissionId.length > 0
      ? { events: [], routed: true, resolvedPermissionId: permissionId }
      : providerMapping(event);
  }

  if (
    event.type === 'session.status' ||
    event.type === 'session.idle' ||
    event.type === 'session.created' ||
    event.type === 'session.updated'
  ) {
    return { events: [], routed: routedSessionId === sessionId };
  }

  return routedSessionId === sessionId
    ? providerMapping(event)
    : { events: [], routed: false };
}

/** Validate the synchronous prompt response as the authoritative Run result. */
export function parseOpenCodePromptResponse(
  value: unknown,
  sessionId: ProviderSessionId,
): OpenCodeTerminalMapping {
  const response = record(value);
  const info = record(response?.['info']);
  const parts = response?.['parts'];
  if (
    info?.['role'] !== 'assistant' ||
    info['sessionID'] !== sessionId ||
    !Array.isArray(parts)
  ) {
    throw incompatible('prompt response');
  }
  const messageId = nonEmptyString(info['id'], 'assistant message identifier');
  const usage = usageSummary(info['tokens']);
  if (usage === undefined) throw incompatible('assistant message usage');
  const error = record(info['error']);
  if (error !== undefined) {
    const errorName = safeProviderCode(error['name']);
    const providerResult = { error: errorName, messageId };
    return {
      result: {
        status: errorName === 'MessageAbortedError' ? 'cancelled' : 'failed',
        usage,
        providerResult,
      },
      usage,
      providerResult,
    };
  }

  const finish = info['finish'];
  if (typeof finish !== 'string' || finish.length === 0) {
    throw incompatible('assistant message finish reason');
  }
  const providerResult = { finish, messageId };
  if (finish === 'error') {
    return {
      result: {
        status: 'failed',
        usage,
        providerResult,
      },
      usage,
      providerResult,
    };
  }
  if (
    !completedFinishReasons.has(finish) &&
    !(
      finish === 'tool-calls' &&
      settledToolResponse(parts, sessionId, messageId)
    )
  ) {
    throw incompatible('assistant message finish reason');
  }
  const finalMessage = finalText(parts, sessionId, messageId);
  return {
    result: {
      status: 'completed',
      ...(finalMessage.length === 0 ? {} : { finalMessage }),
      usage,
      providerResult,
    },
    ...(finalMessage.length === 0 ? {} : { finalMessage }),
    usage,
    providerResult,
  };
}

/** Validate Provider state required to resume the same OpenCode Session. */
export function sessionStateFromRef(ref: SessionRef): OpenCodeSessionState {
  if (
    ref.providerId !== OPENCODE_PROVIDER_ID ||
    ref.compatibilityRef !== OPENCODE_SESSION_COMPATIBILITY_REF
  ) {
    throw sessionStateMismatch();
  }
  const state = record(ref.providerState);
  if (state === undefined) throw sessionStateMismatch();
  const directory = state['directory'];
  if (typeof directory !== 'string' || directory.length === 0) {
    throw sessionStateMismatch();
  }
  const system = state['system'];
  if (system !== undefined && typeof system !== 'string') {
    throw sessionStateMismatch();
  }
  const model = state['model'];
  let parsedModel: OpenCodeSessionDefaults['model'];
  if (model !== undefined) {
    try {
      parsedModel = nativeModel(model, 'Session model state');
    } catch {
      throw sessionStateMismatch();
    }
  }
  return {
    directory,
    ...(system === undefined ? {} : { system }),
    ...(parsedModel === undefined ? {} : { model: parsedModel }),
  };
}

/** Produce a bounded structural summary that never retains string values. */
export function redactOpenCodeEvent(event: {
  readonly type: string;
  readonly properties: unknown;
}): OpenCodeRawEvent {
  const state = { nodes: 0 };
  return {
    type: safeEventType(event.type),
    properties: redact(event.properties, 0, state),
  };
}

function preparePart(part: HarnessInput['parts'][number]): OpenCodeNativePart {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'file_ref':
      return filePart(part.uri, part.mediaType, false);
    case 'image_ref':
      return filePart(part.uri, part.mediaType, true);
    case 'provider':
      if (
        part.name !== OPENCODE_NATIVE_PART ||
        !isOpenCodeNativePart(part.value)
      ) {
        throw unsupported(
          'input.provider',
          'The Provider input part is not a supported OpenCode prompt part.',
        );
      }
      return part.value;
  }
}

function filePart(
  uri: string,
  mediaType: string | undefined,
  image: boolean,
): OpenCodeNativePart {
  if (mediaType === undefined || mediaType.length === 0) {
    throw invalidRequest('OpenCode file and image input requires mediaType.');
  }
  if (image && !mediaType.startsWith('image/')) {
    throw invalidRequest(
      'OpenCode image input mediaType must be an image type.',
    );
  }
  absoluteUri(uri, 'input URI');
  return { type: 'file', mime: mediaType, url: uri };
}

function isOpenCodeNativePart(value: unknown): value is OpenCodeNativePart {
  const part = record(value);
  if (part?.['type'] === 'text') return typeof part['text'] === 'string';
  if (part?.['type'] === 'file') {
    if (
      typeof part['mime'] !== 'string' ||
      part['mime'].length === 0 ||
      typeof part['url'] !== 'string'
    ) {
      return false;
    }
    try {
      absoluteUri(part['url'], 'native file URL');
    } catch {
      return false;
    }
    return (
      part['filename'] === undefined || typeof part['filename'] === 'string'
    );
  }
  if (part?.['type'] === 'agent') {
    return typeof part['name'] === 'string' && part['name'].length > 0;
  }
  if (part?.['type'] === 'subtask') {
    return (
      typeof part['prompt'] === 'string' &&
      typeof part['description'] === 'string' &&
      typeof part['agent'] === 'string' &&
      part['agent'].length > 0
    );
  }
  return false;
}

function mapPartEvent(
  event: OpenCodeWireEvent,
  part: Readonly<JsonRecord>,
): OpenCodeEventMapping {
  const partType = part['type'];
  const delta = event.properties['delta'];
  if (partType === 'text' && typeof delta === 'string') {
    return {
      events: [{ type: 'message.delta', data: { delta } }],
      routed: true,
    };
  }
  if (partType === 'reasoning' && typeof delta === 'string') {
    return {
      events: [{ type: 'reasoning.delta', data: { delta } }],
      routed: true,
    };
  }
  if (partType === 'reasoning' && record(part['time'])?.['end'] !== undefined) {
    const raw = redactOpenCodeEvent(event);
    return {
      events: [
        {
          type: 'reasoning.completed',
          data: {},
          providerEventType: raw.type,
          raw,
        },
      ],
      routed: true,
    };
  }
  if (partType === 'tool') {
    const state = record(part['state']);
    const status = state?.['status'];
    const type =
      status === 'pending'
        ? 'tool.started'
        : status === 'completed' || status === 'error'
          ? 'tool.completed'
          : status === 'running'
            ? 'tool.updated'
            : undefined;
    if (type === undefined) return providerMapping(event);
    const raw = redactOpenCodeEvent(event);
    return {
      events: [
        {
          type,
          data: {
            status,
            tool:
              typeof part['tool'] === 'string'
                ? safeProviderCode(part['tool'])
                : 'unknown',
          },
          providerEventType: raw.type,
          raw,
        },
      ],
      routed: true,
    };
  }
  if (partType === 'file') {
    const mime = part['mime'];
    const uri = part['url'];
    if (typeof mime !== 'string' || typeof uri !== 'string') {
      return providerMapping(event);
    }
    return {
      events: [
        {
          type: 'artifact.created',
          data: {
            mediaType: mime,
            uri,
            ...(typeof part['filename'] === 'string'
              ? { filename: part['filename'] }
              : {}),
          },
        },
      ],
      routed: true,
    };
  }
  if (partType === 'step-finish') {
    const usage = usageSummary(part['tokens']);
    return usage === undefined
      ? providerMapping(event)
      : {
          events: [{ type: 'usage.updated', data: usage, usage }],
          routed: true,
        };
  }
  return { events: [], routed: true };
}

function providerMapping(event: OpenCodeWireEvent): OpenCodeEventMapping {
  const raw = redactOpenCodeEvent(event);
  return {
    events: [
      {
        type: 'provider',
        data: { providerEventType: raw.type },
        providerEventType: raw.type,
        raw,
      },
    ],
    routed: true,
  };
}

function eventSessionId(event: OpenCodeWireEvent): string | undefined {
  const direct = event.properties['sessionID'];
  if (typeof direct === 'string') return direct;
  const info = record(event.properties['info']);
  if (typeof info?.['sessionID'] === 'string') return info['sessionID'];
  const part = record(event.properties['part']);
  return typeof part?.['sessionID'] === 'string'
    ? part['sessionID']
    : undefined;
}

function usageSummary(value: unknown): UsageSummary | undefined {
  const tokens = record(value);
  const input = tokens?.['input'];
  const output = tokens?.['output'];
  if (
    typeof input !== 'number' ||
    !Number.isSafeInteger(input) ||
    input < 0 ||
    typeof output !== 'number' ||
    !Number.isSafeInteger(output) ||
    output < 0
  ) {
    return undefined;
  }
  return { inputTokens: input, outputTokens: output };
}

function finalText(
  parts: readonly unknown[],
  sessionId: ProviderSessionId,
  messageId: string,
): string {
  const text: string[] = [];
  for (const value of parts) {
    const part = record(value);
    if (
      part?.['type'] !== 'text' ||
      part['sessionID'] !== sessionId ||
      part['messageID'] !== messageId ||
      part['ignored'] === true ||
      part['synthetic'] === true
    ) {
      continue;
    }
    if (typeof part['text'] !== 'string')
      throw incompatible('text result part');
    text.push(part['text']);
  }
  return text.join('\n');
}

function settledToolResponse(
  parts: readonly unknown[],
  sessionId: ProviderSessionId,
  messageId: string,
): boolean {
  let observed = false;
  for (const value of parts) {
    const part = record(value);
    if (
      part?.['type'] !== 'tool' ||
      part['sessionID'] !== sessionId ||
      part['messageID'] !== messageId
    ) {
      continue;
    }
    observed = true;
    const status = record(part['state'])?.['status'];
    if (status !== 'completed' && status !== 'error') return false;
  }
  return observed;
}

function coreModel(model: NonNullable<CreateSessionInput['model']>): {
  providerId: string;
  modelId: string;
} {
  const options = validatedOptions(model.providerOptions, ['providerId']);
  return {
    providerId: inputString(options['providerId'], 'model providerId'),
    modelId: inputString(model.id, 'model id'),
  };
}

function nativeModel(
  value: unknown,
  label: string,
): { providerId: string; modelId: string } {
  const model = record(value);
  if (model === undefined) throw invalidRequest(`${label} must be an object.`);
  assertKnownKeys(model, ['modelId', 'providerId']);
  return {
    providerId: inputString(model['providerId'], `${label} providerId`),
    modelId: inputString(model['modelId'], `${label} modelId`),
  };
}

function booleanMap(
  value: unknown,
  label: string,
): Readonly<Record<string, boolean>> {
  const input = record(value);
  if (input === undefined) throw invalidRequest(`${label} must be an object.`);
  const output: Record<string, boolean> = {};
  for (const [name, enabled] of Object.entries(input)) {
    if (name.length === 0 || typeof enabled !== 'boolean') {
      throw invalidRequest(`${label} values must be booleans.`);
    }
    output[name] = enabled;
  }
  return output;
}

function permissionPattern(
  value: unknown,
): string | readonly string[] | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  return undefined;
}

function workspacePath(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw invalidRequest('OpenCode workspace must be an absolute file URI.');
  }
  if (parsed.protocol !== 'file:') {
    throw invalidRequest('OpenCode workspace must use the file URI scheme.');
  }
  try {
    return fileURLToPath(parsed);
  } catch {
    throw invalidRequest('OpenCode workspace file URI is invalid.');
  }
}

function absoluteUri(value: string, label: string): void {
  try {
    new URL(value);
  } catch {
    throw invalidRequest(`OpenCode ${label} must be an absolute URI.`);
  }
}

function validatedOptions(
  value: Readonly<Record<string, unknown>> | undefined,
  allowed: readonly string[],
): JsonRecord {
  if (value === undefined) return {};
  const options = record(value);
  if (options === undefined)
    throw invalidRequest('OpenCode options must be an object.');
  assertKnownKeys(options, allowed);
  return options;
}

function assertKnownKeys(
  value: Readonly<JsonRecord>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown !== undefined) {
    throw invalidRequest(`OpenCode option ${unknown} is unknown.`);
  }
}

function assignNonEmptyString(
  output: Record<string, string>,
  name: string,
  value: unknown,
  label: string,
): void {
  if (value !== undefined) output[name] = inputString(value, label);
}

function inputString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidRequest(`OpenCode ${label} must be a non-empty string.`);
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw incompatible(label);
  }
  return value;
}

function safeProviderCode(value: unknown): string {
  return typeof value === 'string' &&
    /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(value)
    ? value
    : 'UnknownUpstreamError';
}

function safeEventType(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(value) ? value : 'unknown';
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
  if (typeof value === 'number')
    return Number.isFinite(value) ? '<number>' : '<non-finite>';
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

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function boundedSetAdd(
  values: Set<string>,
  value: string,
  capacity: number,
): void {
  if (!values.has(value) && values.size >= capacity) {
    const oldest = values.values().next().value;
    if (typeof oldest === 'string') values.delete(oldest);
  }
  values.add(value);
}

function boundedMapSet(
  values: Map<string, string>,
  key: string,
  value: string,
  capacity: number,
): void {
  if (!values.has(key) && values.size >= capacity) {
    const oldest = values.keys().next().value;
    if (typeof oldest === 'string') values.delete(oldest);
  }
  values.set(key, value);
}

function positiveTimer(value: number, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximumTimerMilliseconds
  ) {
    throw invalidRequest(
      `OpenCode ${label} must be a positive supported timer.`,
    );
  }
  return value;
}

function incompatible(surface: string): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    `OpenCode returned an incompatible ${surface}.`,
    {
      retryable: false,
      providerId: OPENCODE_PROVIDER_ID,
    },
  );
}

function invalidRequest(message: string): HarnessError {
  return new HarnessError('invalid_request', message, {
    retryable: false,
    providerId: OPENCODE_PROVIDER_ID,
  });
}

function unsupported(capability: string, message: string): HarnessError {
  return new HarnessError('unsupported_capability', message, {
    retryable: false,
    providerId: OPENCODE_PROVIDER_ID,
    details: { capability },
  });
}

function sessionStateMismatch(): HarnessError {
  return new HarnessError(
    'session_provider_mismatch',
    'OpenCode Session state is missing or incompatible.',
    {
      retryable: false,
      providerId: OPENCODE_PROVIDER_ID,
    },
  );
}
