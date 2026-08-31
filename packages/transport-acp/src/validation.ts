import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { acpError } from './errors.js';
import {
  ACP_PROTOCOL_VERSION,
  type AcpAgentCapabilities,
  type AcpAnnotations,
  type AcpAvailableCommand,
  type AcpClientCapabilities,
  type AcpContentBlock,
  type AcpImplementation,
  type AcpInitializeInput,
  type AcpInitializeResult,
  type AcpListSessionsInput,
  type AcpListSessionsResult,
  type AcpLoadSessionInput,
  type AcpMeta,
  type AcpNewSessionInput,
  type AcpNewSessionResult,
  type AcpPermissionOutcome,
  type AcpPermissionRequest,
  type AcpPlanEntry,
  type AcpPromptInput,
  type AcpPromptResult,
  type AcpRawObservation,
  type AcpResumeSessionInput,
  type AcpSessionConfigOption,
  type AcpSessionConfigSelectGroup,
  type AcpSessionConfigSelectOption,
  type AcpSessionInfo,
  type AcpSessionMode,
  type AcpSessionModeState,
  type AcpSessionState,
  type AcpSessionUpdate,
  type AcpToolCallStatus,
  type AcpToolCallContent,
  type AcpToolCallLocation,
  type AcpToolCallUpdate,
  type AcpToolKind,
} from './types.js';

type JsonRecord = Record<string, unknown>;

const maximumStringLength = 1024 * 1024;
const maximumIdentifierLength = 1024;
const maximumRawDepth = 4;
const maximumRawNodes = 64;
const maximumRawItems = 16;
const knownMethods = new Set(['session/update']);
const structuralStringKeys = new Set([
  'kind',
  'outcome',
  'sessionUpdate',
  'status',
  'type',
]);
const knownStructuralValues = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'available_commands_update',
  'cancelled',
  'completed',
  'config_option_update',
  'content',
  'diff',
  'failed',
  'in_progress',
  'pending',
  'plan',
  'session_info_update',
  'terminal',
  'text',
  'tool_call',
  'tool_call_update',
  'usage_update',
  'user_message_chunk',
]);
const toolKinds = new Set<AcpToolKind>([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]);
const toolStatuses = new Set<AcpToolCallStatus>([
  'pending',
  'in_progress',
  'completed',
  'failed',
]);
const stopReasons = new Set([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
]);

/** Validate and normalize the stable initialize payload sent to the Agent. */
export function prepareInitializeInput(
  input: AcpInitializeInput = {},
): Readonly<Record<string, unknown>> {
  const capabilities = prepareClientCapabilities(input.clientCapabilities);
  const output: JsonRecord = {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: capabilities,
  };
  if (input.clientInfo !== undefined) {
    output['clientInfo'] = validateImplementation(
      input.clientInfo,
      'client implementation',
      'invalid_params',
    );
  }
  attachMeta(output, input._meta, 'invalid_params');
  return output;
}

/** Parse and normalize one stable initialize response. */
export function parseInitializeResult(value: unknown): AcpInitializeResult {
  const response = messageRecord(value, 'initialize response');
  const protocolVersion = response['protocolVersion'];
  if (protocolVersion !== ACP_PROTOCOL_VERSION) {
    if (nonNegativeInteger(protocolVersion) && protocolVersion <= 65_535) {
      throw acpError(
        'unsupported_protocol_version',
        'The ACP peer selected an unsupported protocol version.',
      );
    }
    throw invalidMessage('initialize response');
  }
  const capabilities = parseAgentCapabilities(response['agentCapabilities']);
  const authMethods = response['authMethods'];
  if (authMethods !== undefined && !Array.isArray(authMethods)) {
    throw invalidMessage('initialize response');
  }
  const output: {
    protocolVersion: typeof ACP_PROTOCOL_VERSION;
    capabilities: AcpAgentCapabilities;
    authMethods: readonly unknown[];
    agentInfo?: AcpImplementation;
    _meta?: AcpMeta;
  } = {
    protocolVersion: ACP_PROTOCOL_VERSION,
    capabilities,
    authMethods: authMethods ?? [],
  };
  if (response['agentInfo'] !== undefined && response['agentInfo'] !== null) {
    output.agentInfo = validateImplementation(
      response['agentInfo'],
      'agent implementation',
      'invalid_message',
    );
  }
  attachParsedMeta(output, response, 'initialize response');
  return output;
}

/** Validate a session/new request before it reaches the wire. */
export function prepareNewSessionInput(
  input: AcpNewSessionInput,
  capabilities: AcpAgentCapabilities,
): Readonly<Record<string, unknown>> {
  return prepareSessionConnectionInput(input, capabilities, true);
}

/** Validate a session/load request before it reaches the wire. */
export function prepareLoadSessionInput(
  input: AcpLoadSessionInput,
  capabilities: AcpAgentCapabilities,
): Readonly<Record<string, unknown>> {
  const output = prepareSessionConnectionInput(input, capabilities, true);
  return { ...output, sessionId: identifier(input.sessionId, 'session ID') };
}

/** Validate a session/resume request before it reaches the wire. */
export function prepareResumeSessionInput(
  input: AcpResumeSessionInput,
  capabilities: AcpAgentCapabilities,
): Readonly<Record<string, unknown>> {
  const output = prepareSessionConnectionInput(input, capabilities, false);
  return { ...output, sessionId: identifier(input.sessionId, 'session ID') };
}

/** Parse a session/new response. */
export function parseNewSessionResult(value: unknown): AcpNewSessionResult {
  const response = messageRecord(value, 'session/new response');
  return {
    sessionId: inboundIdentifier(response['sessionId'], 'session/new response'),
    ...parseSessionState(response, 'session/new response'),
  };
}

/** Parse a session/load or session/resume response. */
export function parseSessionStateResult(value: unknown): AcpSessionState {
  return parseSessionState(
    messageRecord(value, 'session setup response'),
    'session setup response',
  );
}

/** Validate a session/list request. */
export function prepareListSessionsInput(
  input: AcpListSessionsInput = {},
): Readonly<Record<string, unknown>> {
  const output: JsonRecord = {};
  if (input.cwd !== undefined && input.cwd !== null) {
    output['cwd'] = absolutePath(input.cwd, 'session/list cwd');
  } else if (input.cwd === null) {
    output['cwd'] = null;
  }
  if (input.cursor !== undefined && input.cursor !== null) {
    output['cursor'] = identifier(input.cursor, 'session/list cursor');
  } else if (input.cursor === null) {
    output['cursor'] = null;
  }
  attachMeta(output, input._meta, 'invalid_params');
  return output;
}

/** Parse a session/list response. */
export function parseListSessionsResult(value: unknown): AcpListSessionsResult {
  const response = messageRecord(value, 'session/list response');
  const sessions = response['sessions'];
  if (!Array.isArray(sessions)) throw invalidMessage('session/list response');
  const output: {
    sessions: AcpSessionInfo[];
    nextCursor?: string | null;
    _meta?: AcpMeta;
  } = { sessions: sessions.map(parseSessionInfo) };
  if (response['nextCursor'] !== undefined) {
    const nextCursor = response['nextCursor'];
    if (nextCursor !== null && typeof nextCursor !== 'string') {
      throw invalidMessage('session/list response');
    }
    output.nextCursor = nextCursor;
  }
  attachParsedMeta(output, response, 'session/list response');
  return output;
}

/** Parse an empty object response while retaining only ACP metadata. */
export function parseEmptyResult(
  value: unknown,
): Readonly<{ _meta?: AcpMeta }> {
  const response = messageRecord(value, 'empty ACP response');
  const output: { _meta?: AcpMeta } = {};
  attachParsedMeta(output, response, 'empty ACP response');
  return output;
}

/** Validate a session/prompt request against negotiated content capabilities. */
export function preparePromptInput(
  input: AcpPromptInput,
  capabilities: AcpAgentCapabilities,
): Readonly<Record<string, unknown>> {
  const sessionId = identifier(input.sessionId, 'session ID');
  if (!Array.isArray(input.prompt) || input.prompt.length === 0) {
    throw invalidParams('ACP prompts must contain at least one content block.');
  }
  for (const block of input.prompt) validateContentBlock(block, capabilities);
  const output: JsonRecord = { sessionId, prompt: input.prompt };
  attachMeta(output, input._meta, 'invalid_params');
  return output;
}

/** Parse the authoritative terminal result for one prompt turn. */
export function parsePromptResult(value: unknown): AcpPromptResult {
  const response = messageRecord(value, 'session/prompt response');
  const reason = response['stopReason'];
  if (typeof reason !== 'string' || !stopReasons.has(reason)) {
    throw invalidMessage('session/prompt response');
  }
  const output: { stopReason: AcpPromptResult['stopReason']; _meta?: AcpMeta } =
    {
      stopReason: reason as AcpPromptResult['stopReason'],
    };
  attachParsedMeta(output, response, 'session/prompt response');
  return output;
}

/** Parse one session/update notification, preserving future variants safely. */
export function parseSessionNotification(value: unknown):
  | {
      readonly kind: 'update';
      readonly sessionId: string;
      readonly update: AcpSessionUpdate;
    }
  | { readonly kind: 'unknown'; readonly observation: AcpRawObservation } {
  const params = messageRecord(value, 'session/update notification');
  const sessionId = inboundIdentifier(
    params['sessionId'],
    'session/update notification',
  );
  const update = messageRecord(params['update'], 'session/update notification');
  const tag = update['sessionUpdate'];
  if (typeof tag !== 'string' || tag.length === 0) {
    throw invalidMessage('session/update notification');
  }
  if (!knownSessionUpdate(tag)) {
    return {
      kind: 'unknown',
      observation: redactAcpObservation(
        'unknown_session_update',
        'session/update',
        params,
      ),
    };
  }
  return { kind: 'update', sessionId, update: parseKnownUpdate(update, tag) };
}

/** Parse one bidirectional permission request. */
export function parsePermissionRequest(value: unknown): AcpPermissionRequest {
  const request = messageRecord(value, 'permission request');
  const sessionId = inboundIdentifier(
    request['sessionId'],
    'permission request',
  );
  const toolCall = parseToolCallUpdate(
    request['toolCall'],
    'permission request',
  );
  const options = request['options'];
  if (!Array.isArray(options) || options.length === 0) {
    throw invalidMessage('permission request');
  }
  const parsedOptions = options.map((option) => {
    const item = messageRecord(option, 'permission option');
    const kind = item['kind'];
    if (
      kind !== 'allow_once' &&
      kind !== 'allow_always' &&
      kind !== 'reject_once' &&
      kind !== 'reject_always'
    ) {
      throw invalidMessage('permission option');
    }
    const output: {
      optionId: string;
      name: string;
      kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
      _meta?: AcpMeta;
    } = {
      optionId: inboundIdentifier(item['optionId'], 'permission option'),
      name: inboundString(item['name'], 'permission option'),
      kind,
    };
    attachParsedMeta(output, item, 'permission option');
    return output;
  });
  const output: {
    sessionId: string;
    toolCall: AcpToolCallUpdate;
    options: typeof parsedOptions;
    _meta?: AcpMeta;
  } = { sessionId, toolCall, options: parsedOptions };
  attachParsedMeta(output, request, 'permission request');
  return output;
}

/** Validate a host decision before replying to a permission request. */
export function preparePermissionOutcome(
  value: AcpPermissionOutcome,
  request: AcpPermissionRequest,
): Readonly<Record<string, unknown>> {
  if (value.outcome === 'cancelled') {
    const outcome: JsonRecord = { outcome: 'cancelled' };
    attachMeta(outcome, value._meta, 'invalid_params');
    return { outcome };
  }
  const optionId = identifier(value.optionId, 'permission option ID');
  if (!request.options.some((option) => option.optionId === optionId)) {
    throw invalidParams('The selected permission option was not advertised.');
  }
  const outcome: JsonRecord = { outcome: 'selected', optionId };
  attachMeta(outcome, value._meta, 'invalid_params');
  return { outcome };
}

/** Produce a bounded structural view of unknown ACP traffic. */
export function redactAcpObservation(
  kind: AcpRawObservation['kind'],
  method: string,
  params: unknown,
): AcpRawObservation {
  return {
    kind,
    method: publicMethod(method),
    params: redact(params, 0, { nodes: 0 }),
  };
}

/** Require a valid extension method name reserved by ACP. */
export function extensionMethod(method: string): string {
  if (
    typeof method !== 'string' ||
    !/^_[\u0021-\u007e]{0,255}$/u.test(method)
  ) {
    throw invalidParams('ACP extension methods must start with an underscore.');
  }
  return method;
}

/** Validate a public Session identifier for an outbound method. */
export function sessionIdentifier(value: string): string {
  return identifier(value, 'session ID');
}

function prepareClientCapabilities(
  value: AcpClientCapabilities | undefined,
): Readonly<Record<string, unknown>> {
  const fs = value?.fs;
  const auth = value?.auth;
  if (
    fs?.readTextFile === true ||
    fs?.writeTextFile === true ||
    value?.terminal === true ||
    auth?.terminal === true
  ) {
    throw acpError(
      'invalid_configuration',
      'This ACP client profile cannot advertise unimplemented client services.',
    );
  }
  assertOptionalBoolean(fs?.readTextFile, 'client fs capability');
  assertOptionalBoolean(fs?.writeTextFile, 'client fs capability');
  assertOptionalBoolean(value?.terminal, 'client terminal capability');
  assertOptionalBoolean(auth?.terminal, 'client auth capability');
  const fsOutput: JsonRecord = {
    readTextFile: false,
    writeTextFile: false,
  };
  attachMeta(fsOutput, fs?._meta, 'invalid_params');
  const authOutput: JsonRecord = { terminal: false };
  attachMeta(authOutput, auth?._meta, 'invalid_params');
  const output: JsonRecord = {
    fs: fsOutput,
    terminal: false,
    auth: authOutput,
  };
  attachMeta(output, value?._meta, 'invalid_params');
  return output;
}

function parseAgentCapabilities(value: unknown): AcpAgentCapabilities {
  const capabilities =
    value === undefined ? {} : messageRecord(value, 'agent capabilities');
  const prompt = optionalRecord(
    capabilities,
    'promptCapabilities',
    'agent capabilities',
  );
  const mcp = optionalRecord(
    capabilities,
    'mcpCapabilities',
    'agent capabilities',
  );
  const session = optionalRecord(
    capabilities,
    'sessionCapabilities',
    'agent capabilities',
  );
  const output: AcpAgentCapabilities = {
    loadSession: optionalBoolean(
      capabilities,
      'loadSession',
      'agent capabilities',
    ),
    prompt: {
      image: optionalBoolean(prompt, 'image', 'prompt capabilities'),
      audio: optionalBoolean(prompt, 'audio', 'prompt capabilities'),
      embeddedContext: optionalBoolean(
        prompt,
        'embeddedContext',
        'prompt capabilities',
      ),
    },
    mcp: {
      http: optionalBoolean(mcp, 'http', 'MCP capabilities'),
      sse: optionalBoolean(mcp, 'sse', 'MCP capabilities'),
    },
    session: {
      list: optionalMarker(session, 'list', 'session capabilities'),
      delete: optionalMarker(session, 'delete', 'session capabilities'),
      additionalDirectories: optionalMarker(
        session,
        'additionalDirectories',
        'session capabilities',
      ),
      resume: optionalMarker(session, 'resume', 'session capabilities'),
      close: optionalMarker(session, 'close', 'session capabilities'),
    },
    ...metaProperty(capabilities, 'agent capabilities'),
  };
  return output;
}

function prepareSessionConnectionInput(
  input: AcpNewSessionInput | AcpLoadSessionInput | AcpResumeSessionInput,
  capabilities: AcpAgentCapabilities,
  requireMcpServers: boolean,
): Readonly<Record<string, unknown>> {
  const cwd = absolutePath(input.cwd, 'session cwd');
  const mcpServers = input.mcpServers;
  if (requireMcpServers && !Array.isArray(mcpServers)) {
    throw invalidParams('ACP session setup requires an MCP server array.');
  }
  if (mcpServers !== undefined) {
    if (!Array.isArray(mcpServers)) {
      throw invalidParams('ACP MCP servers must be an array.');
    }
    for (const server of mcpServers) validateMcpServer(server, capabilities);
  }
  const additionalDirectories = input.additionalDirectories;
  if (additionalDirectories !== undefined) {
    if (!Array.isArray(additionalDirectories)) {
      throw invalidParams('ACP additional directories must be an array.');
    }
    if (
      additionalDirectories.length > 0 &&
      !capabilities.session.additionalDirectories
    ) {
      throw acpError(
        'capability_not_advertised',
        'The ACP Agent did not advertise additional directory support.',
      );
    }
    for (const directory of additionalDirectories) {
      absolutePath(directory, 'additional directory');
    }
  }
  const output: JsonRecord = { cwd };
  if (mcpServers !== undefined) output['mcpServers'] = mcpServers;
  if (additionalDirectories !== undefined) {
    output['additionalDirectories'] = additionalDirectories;
  }
  attachMeta(output, input._meta, 'invalid_params');
  return output;
}

function validateMcpServer(
  value: unknown,
  capabilities: AcpAgentCapabilities,
): void {
  const server = localRecord(value, 'MCP server');
  identifier(server['name'], 'MCP server name');
  if (server['type'] === 'http' || server['type'] === 'sse') {
    if (!capabilities.mcp[server['type']]) {
      throw acpError(
        'capability_not_advertised',
        `The ACP Agent did not advertise ${server['type'].toUpperCase()} MCP support.`,
      );
    }
    httpUrl(server['url'], 'MCP server URL');
    validateNameValueArray(server['headers'], 'MCP headers');
  } else {
    absolutePath(server['command'], 'MCP command');
    stringArray(server['args'], 'MCP arguments', false);
    validateNameValueArray(server['env'], 'MCP environment');
  }
  validateMeta(server['_meta'], 'invalid_params');
}

function parseSessionState(
  response: JsonRecord,
  surface: string,
): AcpSessionState {
  const output: {
    modes?: AcpSessionModeState | null;
    configOptions?: readonly AcpSessionConfigOption[] | null;
    _meta?: AcpMeta;
  } = {};
  if (response['modes'] !== undefined) {
    const modes = response['modes'];
    output.modes =
      modes === null ? null : parseSessionModeState(modes, surface);
  }
  if (response['configOptions'] !== undefined) {
    const options = response['configOptions'];
    output.configOptions =
      options === null ? null : parseSessionConfigOptions(options, surface);
  }
  attachParsedMeta(output, response, surface);
  return output;
}

function parseSessionInfo(value: unknown): AcpSessionInfo {
  const session = messageRecord(value, 'session/list entry');
  const output: {
    sessionId: string;
    cwd: string;
    additionalDirectories?: readonly string[];
    title?: string | null;
    updatedAt?: string | null;
    _meta?: AcpMeta;
  } = {
    sessionId: inboundIdentifier(session['sessionId'], 'session/list entry'),
    cwd: inboundAbsolutePath(session['cwd'], 'session/list entry'),
  };
  if (session['additionalDirectories'] !== undefined) {
    output.additionalDirectories = inboundStringArray(
      session['additionalDirectories'],
      'session/list entry',
    ).map((directory) => inboundAbsolutePath(directory, 'session/list entry'));
  }
  optionalNullableString(output, session, 'title', 'session/list entry');
  optionalNullableString(output, session, 'updatedAt', 'session/list entry');
  attachParsedMeta(output, session, 'session/list entry');
  return output;
}

function validateContentBlock(
  value: unknown,
  capabilities: AcpAgentCapabilities,
): void {
  const block = localRecord(value, 'content block');
  validateLocalAnnotations(block['annotations'], 'content annotations');
  validateMeta(block['_meta'], 'invalid_params');
  switch (block['type']) {
    case 'text':
      boundedString(block['text'], 'text content');
      break;
    case 'image':
      if (!capabilities.prompt.image) capabilityContent('image');
      boundedString(block['data'], 'image data');
      boundedString(block['mimeType'], 'image MIME type');
      validateOptionalLocalString(block, 'uri', 'image URI');
      break;
    case 'audio':
      if (!capabilities.prompt.audio) capabilityContent('audio');
      boundedString(block['data'], 'audio data');
      boundedString(block['mimeType'], 'audio MIME type');
      break;
    case 'resource_link': {
      boundedString(block['name'], 'resource name');
      boundedString(block['uri'], 'resource URI');
      validateOptionalLocalString(block, 'title', 'resource title');
      validateOptionalLocalString(block, 'description', 'resource description');
      validateOptionalLocalString(block, 'mimeType', 'resource MIME type');
      const size = block['size'];
      if (
        size !== undefined &&
        size !== null &&
        (!Number.isSafeInteger(size) || Number(size) < 0)
      ) {
        throw invalidParams('The ACP resource size is invalid.');
      }
      break;
    }
    case 'resource': {
      if (!capabilities.prompt.embeddedContext)
        capabilityContent('embedded context');
      const resource = localRecord(block['resource'], 'embedded resource');
      boundedString(resource['uri'], 'embedded resource URI');
      const hasText = typeof resource['text'] === 'string';
      const hasBlob = typeof resource['blob'] === 'string';
      if (hasText === hasBlob) {
        throw invalidParams('Embedded resources require exactly one payload.');
      }
      boundedString(
        hasText ? resource['text'] : resource['blob'],
        'embedded resource payload',
      );
      validateOptionalLocalString(
        resource,
        'mimeType',
        'embedded resource MIME type',
      );
      validateMeta(resource['_meta'], 'invalid_params');
      break;
    }
    default:
      throw invalidParams('The ACP content block type is invalid.');
  }
}

function parseKnownUpdate(
  update: JsonRecord,
  tag: AcpSessionUpdate['sessionUpdate'],
): AcpSessionUpdate {
  switch (tag) {
    case 'user_message_chunk':
    case 'agent_message_chunk':
    case 'agent_thought_chunk': {
      const content = parseInboundContentBlock(update['content']);
      const output: {
        sessionUpdate: typeof tag;
        content: AcpContentBlock;
        messageId?: string | null;
        _meta?: AcpMeta;
      } = { sessionUpdate: tag, content };
      optionalNullableString(output, update, 'messageId', 'content chunk');
      attachParsedMeta(output, update, 'content chunk');
      return output;
    }
    case 'tool_call': {
      const toolCall = parseToolCallUpdate(update, 'tool call');
      const title = inboundString(update['title'], 'tool call');
      return { ...toolCall, sessionUpdate: tag, title };
    }
    case 'tool_call_update':
      return {
        ...parseToolCallUpdate(update, 'tool call update'),
        sessionUpdate: tag,
      };
    case 'plan':
      return {
        sessionUpdate: tag,
        entries: parsePlanEntries(update['entries']),
        ...metaProperty(update, 'plan update'),
      };
    case 'available_commands_update':
      return {
        sessionUpdate: tag,
        availableCommands: parseAvailableCommands(update['availableCommands']),
        ...metaProperty(update, 'available commands update'),
      };
    case 'current_mode_update':
      return {
        sessionUpdate: tag,
        currentModeId: inboundIdentifier(
          update['currentModeId'],
          'mode update',
        ),
        ...metaProperty(update, 'mode update'),
      };
    case 'config_option_update':
      return {
        sessionUpdate: tag,
        configOptions: parseSessionConfigOptions(
          update['configOptions'],
          'config option update',
        ),
        ...metaProperty(update, 'config option update'),
      };
    case 'session_info_update': {
      const output: {
        sessionUpdate: typeof tag;
        title?: string | null;
        updatedAt?: string | null;
        _meta?: AcpMeta;
      } = { sessionUpdate: tag };
      optionalNullableString(output, update, 'title', 'session info update');
      optionalNullableString(
        output,
        update,
        'updatedAt',
        'session info update',
      );
      attachParsedMeta(output, update, 'session info update');
      return output;
    }
    case 'usage_update': {
      const used = nonNegativeSafeInteger(update['used'], 'usage update');
      const size = nonNegativeSafeInteger(update['size'], 'usage update');
      const output: {
        sessionUpdate: typeof tag;
        used: number;
        size: number;
        cost?: { amount: number; currency: string; _meta?: AcpMeta } | null;
        _meta?: AcpMeta;
      } = { sessionUpdate: tag, used, size };
      if (update['cost'] !== undefined) {
        const cost = update['cost'];
        if (cost === null) output.cost = null;
        else {
          const costRecord = messageRecord(cost, 'usage cost');
          const amount = costRecord['amount'];
          if (typeof amount !== 'number' || !Number.isFinite(amount)) {
            throw invalidMessage('usage cost');
          }
          output.cost = {
            amount,
            currency: inboundString(costRecord['currency'], 'usage cost'),
            ...metaProperty(costRecord, 'usage cost'),
          };
        }
      }
      attachParsedMeta(output, update, 'usage update');
      return output;
    }
  }
}

function parseInboundContentBlock(value: unknown): AcpContentBlock {
  const block = messageRecord(value, 'content block');
  const type = block['type'];
  switch (type) {
    case 'text':
      return {
        type,
        text: inboundString(block['text'], 'content block'),
        ...annotationsProperty(block, 'content block'),
        ...metaProperty(block, 'content block'),
      };
    case 'image':
      return {
        type,
        data: inboundString(block['data'], 'content block'),
        mimeType: inboundString(block['mimeType'], 'content block'),
        ...nullableStringProperty(block, 'uri', 'content block'),
        ...annotationsProperty(block, 'content block'),
        ...metaProperty(block, 'content block'),
      };
    case 'audio':
      return {
        type,
        data: inboundString(block['data'], 'content block'),
        mimeType: inboundString(block['mimeType'], 'content block'),
        ...annotationsProperty(block, 'content block'),
        ...metaProperty(block, 'content block'),
      };
    case 'resource_link': {
      const size = block['size'];
      if (
        size !== undefined &&
        size !== null &&
        (!Number.isSafeInteger(size) || Number(size) < 0)
      ) {
        throw invalidMessage('content block');
      }
      return {
        type,
        name: inboundString(block['name'], 'content block'),
        uri: inboundString(block['uri'], 'content block'),
        ...nullableStringProperty(block, 'title', 'content block'),
        ...nullableStringProperty(block, 'description', 'content block'),
        ...nullableStringProperty(block, 'mimeType', 'content block'),
        ...(size === undefined ? {} : { size: size as number | null }),
        ...annotationsProperty(block, 'content block'),
        ...metaProperty(block, 'content block'),
      };
    }
    case 'resource': {
      const resource = messageRecord(block['resource'], 'embedded resource');
      const uri = inboundString(resource['uri'], 'embedded resource');
      const hasText = typeof resource['text'] === 'string';
      const hasBlob = typeof resource['blob'] === 'string';
      if (hasText === hasBlob) throw invalidMessage('embedded resource');
      const shared = {
        uri,
        ...nullableStringProperty(resource, 'mimeType', 'embedded resource'),
        ...metaProperty(resource, 'embedded resource'),
      };
      return {
        type,
        resource: hasText
          ? {
              ...shared,
              text: inboundString(resource['text'], 'embedded resource'),
            }
          : {
              ...shared,
              blob: inboundString(resource['blob'], 'embedded resource'),
            },
        ...annotationsProperty(block, 'content block'),
        ...metaProperty(block, 'content block'),
      };
    }
    default:
      throw invalidMessage('content block');
  }
}

function parseToolCallUpdate(
  value: unknown,
  surface: string,
): AcpToolCallUpdate {
  const tool = messageRecord(value, surface);
  const output: {
    toolCallId: string;
    title?: string | null;
    kind?: AcpToolKind | null;
    status?: AcpToolCallStatus | null;
    content?: readonly AcpToolCallContent[] | null;
    locations?: readonly AcpToolCallLocation[] | null;
    rawInput?: unknown;
    rawOutput?: unknown;
    _meta?: AcpMeta;
  } = { toolCallId: inboundIdentifier(tool['toolCallId'], surface) };
  optionalNullableString(output, tool, 'title', surface);
  if (tool['kind'] !== undefined) {
    const kind = tool['kind'];
    if (
      kind !== null &&
      (typeof kind !== 'string' || !toolKinds.has(kind as AcpToolKind))
    ) {
      throw invalidMessage(surface);
    }
    output.kind = kind as AcpToolKind | null;
  }
  if (tool['status'] !== undefined) {
    const status = tool['status'];
    if (
      status !== null &&
      (typeof status !== 'string' ||
        !toolStatuses.has(status as AcpToolCallStatus))
    ) {
      throw invalidMessage(surface);
    }
    output.status = status as AcpToolCallStatus | null;
  }
  if (tool['content'] !== undefined) {
    const content = tool['content'];
    if (content !== null && !Array.isArray(content))
      throw invalidMessage(surface);
    output.content =
      content === null
        ? null
        : content.map((item) => parseToolCallContent(item, surface));
  }
  if (tool['locations'] !== undefined) {
    const locations = tool['locations'];
    if (locations !== null && !Array.isArray(locations))
      throw invalidMessage(surface);
    output.locations =
      locations === null
        ? null
        : locations.map((item) => parseToolCallLocation(item, surface));
  }
  if (Object.hasOwn(tool, 'rawInput')) output.rawInput = tool['rawInput'];
  if (Object.hasOwn(tool, 'rawOutput')) output.rawOutput = tool['rawOutput'];
  attachParsedMeta(output, tool, surface);
  return output;
}

function parseToolCallContent(
  value: unknown,
  surface: string,
): AcpToolCallContent {
  const content = messageRecord(value, surface);
  switch (content['type']) {
    case 'content':
      return {
        type: 'content',
        content: parseInboundContentBlock(content['content']),
        ...metaProperty(content, surface),
      };
    case 'diff': {
      const output: {
        type: 'diff';
        path: string;
        newText: string;
        oldText?: string | null;
        _meta?: AcpMeta;
      } = {
        type: 'diff',
        path: inboundAbsolutePath(content['path'], surface),
        newText: inboundString(content['newText'], surface),
      };
      optionalNullableString(output, content, 'oldText', surface);
      attachParsedMeta(output, content, surface);
      return output;
    }
    case 'terminal':
      return {
        type: 'terminal',
        terminalId: inboundIdentifier(content['terminalId'], surface),
        ...metaProperty(content, surface),
      };
    default:
      throw invalidMessage(surface);
  }
}

function parseToolCallLocation(
  value: unknown,
  surface: string,
): AcpToolCallLocation {
  const location = messageRecord(value, surface);
  const output: {
    path: string;
    line?: number | null;
    _meta?: AcpMeta;
  } = { path: inboundAbsolutePath(location['path'], surface) };
  if (location['line'] !== undefined) {
    const line = location['line'];
    if (line !== null && !unsigned32BitInteger(line)) {
      throw invalidMessage(surface);
    }
    output.line = line;
  }
  attachParsedMeta(output, location, surface);
  return output;
}

function parsePlanEntries(value: unknown): readonly AcpPlanEntry[] {
  if (!Array.isArray(value)) throw invalidMessage('plan update');
  return value.map((entry) => {
    const item = messageRecord(entry, 'plan entry');
    const priority = item['priority'];
    const status = item['status'];
    if (priority !== 'high' && priority !== 'medium' && priority !== 'low') {
      throw invalidMessage('plan entry');
    }
    if (
      status !== 'pending' &&
      status !== 'in_progress' &&
      status !== 'completed'
    ) {
      throw invalidMessage('plan entry');
    }
    return {
      content: inboundString(item['content'], 'plan entry'),
      priority,
      status,
      ...metaProperty(item, 'plan entry'),
    };
  });
}

function parseAvailableCommands(
  value: unknown,
): readonly AcpAvailableCommand[] {
  if (!Array.isArray(value)) {
    throw invalidMessage('available commands update');
  }
  return value.map((command) => {
    const item = messageRecord(command, 'available command');
    const output: {
      name: string;
      description: string;
      input?: { hint: string; _meta?: AcpMeta } | null;
      _meta?: AcpMeta;
    } = {
      name: inboundString(item['name'], 'available command'),
      description: inboundString(item['description'], 'available command'),
    };
    if (item['input'] !== undefined) {
      const input = item['input'];
      if (input === null) output.input = null;
      else {
        const inputRecord = messageRecord(input, 'available command input');
        output.input = {
          hint: inboundString(inputRecord['hint'], 'available command input'),
          ...metaProperty(inputRecord, 'available command input'),
        };
      }
    }
    attachParsedMeta(output, item, 'available command');
    return output;
  });
}

function parseSessionModeState(
  value: unknown,
  surface: string,
): AcpSessionModeState {
  const state = messageRecord(value, surface);
  const availableModes = state['availableModes'];
  if (!Array.isArray(availableModes)) throw invalidMessage(surface);
  return {
    currentModeId: inboundIdentifier(state['currentModeId'], surface),
    availableModes: availableModes.map((mode) =>
      parseSessionMode(mode, surface),
    ),
    ...metaProperty(state, surface),
  };
}

function parseSessionMode(value: unknown, surface: string): AcpSessionMode {
  const mode = messageRecord(value, surface);
  const output: {
    id: string;
    name: string;
    description?: string | null;
    _meta?: AcpMeta;
  } = {
    id: inboundIdentifier(mode['id'], surface),
    name: inboundString(mode['name'], surface),
  };
  optionalNullableString(output, mode, 'description', surface);
  attachParsedMeta(output, mode, surface);
  return output;
}

function parseSessionConfigOptions(
  value: unknown,
  surface: string,
): readonly AcpSessionConfigOption[] {
  if (!Array.isArray(value)) throw invalidMessage(surface);
  return value.map((option) => parseSessionConfigOption(option, surface));
}

function parseSessionConfigOption(
  value: unknown,
  surface: string,
): AcpSessionConfigOption {
  const option = messageRecord(value, surface);
  const shared: {
    id: string;
    name: string;
    description?: string | null;
    category?: string | null;
    _meta?: AcpMeta;
  } = {
    id: inboundIdentifier(option['id'], surface),
    name: inboundString(option['name'], surface),
  };
  optionalNullableString(shared, option, 'description', surface);
  optionalNullableString(shared, option, 'category', surface);
  attachParsedMeta(shared, option, surface);

  if (option['type'] === 'boolean') {
    if (typeof option['currentValue'] !== 'boolean') {
      throw invalidMessage(surface);
    }
    return { ...shared, type: 'boolean', currentValue: option['currentValue'] };
  }
  if (option['type'] !== 'select') throw invalidMessage(surface);
  return {
    ...shared,
    type: 'select',
    currentValue: inboundIdentifier(option['currentValue'], surface),
    options: parseSessionConfigSelectOptions(option['options'], surface),
  };
}

function parseSessionConfigSelectOptions(
  value: unknown,
  surface: string,
):
  | readonly AcpSessionConfigSelectOption[]
  | readonly AcpSessionConfigSelectGroup[] {
  if (!Array.isArray(value)) throw invalidMessage(surface);
  if (value.length === 0) return [];
  const grouped = value.every(
    (item) => isRecord(item) && Object.hasOwn(item, 'group'),
  );
  const ungrouped = value.every(
    (item) => isRecord(item) && !Object.hasOwn(item, 'group'),
  );
  if (!grouped && !ungrouped) throw invalidMessage(surface);
  return grouped
    ? value.map((group) => parseSessionConfigSelectGroup(group, surface))
    : value.map((option) => parseSessionConfigSelectOption(option, surface));
}

function parseSessionConfigSelectOption(
  value: unknown,
  surface: string,
): AcpSessionConfigSelectOption {
  const option = messageRecord(value, surface);
  const output: {
    value: string;
    name: string;
    description?: string | null;
    _meta?: AcpMeta;
  } = {
    value: inboundIdentifier(option['value'], surface),
    name: inboundString(option['name'], surface),
  };
  optionalNullableString(output, option, 'description', surface);
  attachParsedMeta(output, option, surface);
  return output;
}

function parseSessionConfigSelectGroup(
  value: unknown,
  surface: string,
): AcpSessionConfigSelectGroup {
  const group = messageRecord(value, surface);
  const options = group['options'];
  if (!Array.isArray(options)) throw invalidMessage(surface);
  return {
    group: inboundIdentifier(group['group'], surface),
    name: inboundString(group['name'], surface),
    options: options.map((option) =>
      parseSessionConfigSelectOption(option, surface),
    ),
    ...metaProperty(group, surface),
  };
}

function knownSessionUpdate(
  value: string,
): value is AcpSessionUpdate['sessionUpdate'] {
  return [
    'user_message_chunk',
    'agent_message_chunk',
    'agent_thought_chunk',
    'tool_call',
    'tool_call_update',
    'plan',
    'available_commands_update',
    'current_mode_update',
    'config_option_update',
    'session_info_update',
    'usage_update',
  ].includes(value);
}

function validateImplementation(
  value: unknown,
  surface: string,
  code: 'invalid_message' | 'invalid_params',
): AcpImplementation {
  const input =
    code === 'invalid_message'
      ? messageRecord(value, surface)
      : localRecord(value, surface);
  const output: {
    name: string;
    version: string;
    title?: string | null;
    _meta?: AcpMeta;
  } = {
    name:
      code === 'invalid_message'
        ? inboundString(input['name'], surface)
        : boundedString(input['name'], surface),
    version:
      code === 'invalid_message'
        ? inboundString(input['version'], surface)
        : boundedString(input['version'], surface),
  };
  optionalNullableString(output, input, 'title', surface, code);
  if (code === 'invalid_message') attachParsedMeta(output, input, surface);
  else attachMeta(output, input['_meta'] as AcpMeta | undefined, code);
  return output;
}

function optionalBoolean(
  record: JsonRecord,
  key: string,
  surface: string,
): boolean {
  const value = record[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw invalidMessage(surface);
  return value;
}

function optionalMarker(
  record: JsonRecord,
  key: string,
  surface: string,
): boolean {
  const value = record[key];
  if (value === undefined || value === null) return false;
  if (!isRecord(value)) throw invalidMessage(surface);
  return true;
}

function optionalRecord(
  record: JsonRecord,
  key: string,
  surface: string,
): JsonRecord {
  const value = record[key];
  if (value === undefined) return {};
  if (!isRecord(value)) throw invalidMessage(surface);
  return value;
}

function annotationsProperty(
  source: JsonRecord,
  surface: string,
): { annotations?: AcpAnnotations | null } {
  if (!Object.hasOwn(source, 'annotations')) return {};
  const value = source['annotations'];
  return {
    annotations: value === null ? null : parseAnnotations(value, surface),
  };
}

function parseAnnotations(value: unknown, surface: string): AcpAnnotations {
  const annotations = messageRecord(value, surface);
  const output: {
    audience?: readonly ('assistant' | 'user')[] | null;
    priority?: number | null;
    lastModified?: string | null;
    _meta?: AcpMeta;
  } = {};
  if (annotations['audience'] !== undefined) {
    const audience = annotations['audience'];
    if (
      audience !== null &&
      (!Array.isArray(audience) ||
        !audience.every((role) => role === 'assistant' || role === 'user'))
    ) {
      throw invalidMessage(surface);
    }
    output.audience = audience;
  }
  if (annotations['priority'] !== undefined) {
    const priority = annotations['priority'];
    if (
      priority !== null &&
      (typeof priority !== 'number' || !Number.isFinite(priority))
    ) {
      throw invalidMessage(surface);
    }
    output.priority = priority;
  }
  optionalNullableString(output, annotations, 'lastModified', surface);
  attachParsedMeta(output, annotations, surface);
  return output;
}

function validateLocalAnnotations(value: unknown, surface: string): void {
  if (value === undefined || value === null) return;
  const annotations = localRecord(value, surface);
  const audience = annotations['audience'];
  if (
    audience !== undefined &&
    audience !== null &&
    (!Array.isArray(audience) ||
      !audience.every((role) => role === 'assistant' || role === 'user'))
  ) {
    throw invalidParams(`The ACP ${surface} is invalid.`);
  }
  const priority = annotations['priority'];
  if (
    priority !== undefined &&
    priority !== null &&
    (typeof priority !== 'number' || !Number.isFinite(priority))
  ) {
    throw invalidParams(`The ACP ${surface} is invalid.`);
  }
  validateOptionalLocalString(
    annotations,
    'lastModified',
    `${surface} last-modified value`,
  );
  validateMeta(annotations['_meta'], 'invalid_params');
}

function validateOptionalLocalString(
  source: JsonRecord,
  key: string,
  surface: string,
): void {
  const value = source[key];
  if (value !== undefined && value !== null) boundedString(value, surface);
}

function optionalNullableString(
  output: JsonRecord,
  source: JsonRecord,
  key: string,
  surface: string,
  code: 'invalid_message' | 'invalid_params' = 'invalid_message',
): void {
  if (!Object.hasOwn(source, key)) return;
  const value = source[key];
  if (value !== null && typeof value !== 'string') {
    if (code === 'invalid_message') throw invalidMessage(surface);
    throw invalidParams(`The ACP ${surface} is invalid.`);
  }
  output[key] = value;
}

function nullableStringProperty(
  source: JsonRecord,
  key: string,
  surface: string,
): JsonRecord {
  const output: JsonRecord = {};
  optionalNullableString(output, source, key, surface);
  return output;
}

function metaProperty(
  source: JsonRecord,
  surface: string,
): { _meta?: AcpMeta } {
  const output: { _meta?: AcpMeta } = {};
  attachParsedMeta(output, source, surface);
  return output;
}

function attachParsedMeta(
  output: { _meta?: AcpMeta },
  source: JsonRecord,
  surface: string,
): void {
  if (!Object.hasOwn(source, '_meta')) return;
  const value = source['_meta'];
  if (value !== null && !isRecord(value)) throw invalidMessage(surface);
  output._meta = value;
}

function attachMeta(
  output: JsonRecord,
  value: AcpMeta | undefined,
  code: 'invalid_message' | 'invalid_params',
): void {
  if (value === undefined) return;
  validateMeta(value, code);
  output['_meta'] = value;
}

function validateMeta(
  value: unknown,
  code: 'invalid_message' | 'invalid_params',
): void {
  if (value === undefined) return;
  if (value !== null && !isRecord(value)) {
    if (code === 'invalid_message') throw invalidMessage('ACP metadata');
    throw invalidParams('ACP metadata must be an object or null.');
  }
}

function assertOptionalBoolean(value: unknown, surface: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw invalidParams(`The ACP ${surface} is invalid.`);
  }
}

function validateNameValueArray(value: unknown, surface: string): void {
  if (!Array.isArray(value))
    throw invalidParams(`ACP ${surface} must be an array.`);
  for (const item of value) {
    const entry = localRecord(item, surface);
    identifier(entry['name'], `${surface} name`);
    boundedString(entry['value'], `${surface} value`);
    validateMeta(entry['_meta'], 'invalid_params');
  }
}

function stringArray(
  value: unknown,
  surface: string,
  requireNonEmpty: boolean,
): readonly string[] {
  if (!Array.isArray(value) || (requireNonEmpty && value.length === 0)) {
    throw invalidParams(`ACP ${surface} must be an array.`);
  }
  for (const item of value) boundedString(item, surface);
  return value as readonly string[];
}

function inboundStringArray(value: unknown, surface: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw invalidMessage(surface);
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, surface: string): number {
  if (!nonNegativeInteger(value)) throw invalidMessage(surface);
  return value;
}

function identifier(value: unknown, surface: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumIdentifierLength
  ) {
    throw invalidParams(`The ACP ${surface} is invalid.`);
  }
  return value;
}

function inboundIdentifier(value: unknown, surface: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumIdentifierLength
  ) {
    throw invalidMessage(surface);
  }
  return value;
}

function boundedString(value: unknown, surface: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumStringLength
  ) {
    throw invalidParams(`The ACP ${surface} is invalid.`);
  }
  return value;
}

function inboundString(value: unknown, surface: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumStringLength
  ) {
    throw invalidMessage(surface);
  }
  return value;
}

function absolutePath(value: unknown, surface: string): string {
  const path = boundedString(value, surface);
  if (!isAbsolute(path))
    throw invalidParams(`The ACP ${surface} must be absolute.`);
  return path;
}

function inboundAbsolutePath(value: unknown, surface: string): string {
  const path = inboundString(value, surface);
  if (!isAbsolute(path)) throw invalidMessage(surface);
  return path;
}

function httpUrl(value: unknown, surface: string): string {
  const encoded = boundedString(value, surface);
  let parsed: URL;
  try {
    parsed = new URL(encoded);
  } catch {
    throw invalidParams(`The ACP ${surface} is invalid.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalidParams(`The ACP ${surface} must use HTTP or HTTPS.`);
  }
  return encoded;
}

function capabilityContent(name: string): never {
  throw acpError(
    'capability_not_advertised',
    `The ACP Agent did not advertise ${name} prompt support.`,
  );
}

function messageRecord(value: unknown, surface: string): JsonRecord {
  if (!isRecord(value)) throw invalidMessage(surface);
  return value;
}

function localRecord(value: unknown, surface: string): JsonRecord {
  if (!isRecord(value)) throw invalidParams(`The ACP ${surface} is invalid.`);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function unsigned32BitInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value <= 4_294_967_295;
}

function invalidMessage(surface: string) {
  return acpError(
    'invalid_message',
    `The ACP peer sent an invalid ${surface}.`,
  );
}

function invalidParams(message: string) {
  return acpError('invalid_params', message);
}

function publicMethod(value: string): string {
  if (knownMethods.has(value) || /^_[\u0021-\u007e]{0,255}$/u.test(value)) {
    return value;
  }
  return stableDiagnostic('method', value);
}

function redact(
  value: unknown,
  depth: number,
  state: { nodes: number },
  key?: string,
): unknown {
  state.nodes += 1;
  if (state.nodes > maximumRawNodes || depth >= maximumRawDepth) {
    return '[truncated]';
  }
  if (value === null) return value;
  if (typeof value === 'boolean' || typeof value === 'number') {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    return key !== undefined && structuralStringKeys.has(key)
      ? publicStructuralValue(value)
      : '[redacted]';
  }
  if (Array.isArray(value)) {
    const output = value
      .slice(0, maximumRawItems)
      .map((item) => redact(item, depth + 1, state));
    if (value.length > maximumRawItems) output.push('[truncated]');
    return output;
  }
  if (!isRecord(value)) return '[redacted]';
  const output: JsonRecord = {};
  const entries = Object.entries(value);
  for (const [index, [entryKey, item]] of entries
    .slice(0, maximumRawItems)
    .entries()) {
    const safeKey = structuralStringKeys.has(entryKey)
      ? entryKey
      : `[redacted-key-${String(index)}]`;
    output[safeKey] = redact(item, depth + 1, state, entryKey);
  }
  if (entries.length > maximumRawItems || state.nodes > maximumRawNodes) {
    output['__truncated__'] = '[truncated]';
  }
  return output;
}

function publicStructuralValue(value: string): string {
  return knownStructuralValues.has(value)
    ? value
    : stableDiagnostic('value', value);
}

function stableDiagnostic(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 16);
  return `${prefix}-${digest}`;
}
