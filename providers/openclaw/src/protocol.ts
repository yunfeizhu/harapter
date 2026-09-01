import { createHash } from 'node:crypto';
import { basename } from 'node:path';

import {
  HarnessError,
  providerId,
  type HarnessEvent,
  type HarnessInput,
  type UsageSummary,
} from '@harapter/core';
import type {
  AcpAgentCapabilities,
  AcpContentBlock,
  AcpInitializeResult,
  AcpSessionUpdate,
} from '@harapter/transport-acp';

/** Stable Provider identity owned by the OpenClaw Provider Adapter. */
export const OPENCLAW_PROVIDER_ID = providerId('openclaw');

/** Provider-owned extension for bounded, redacted ACP observations. */
export const OPENCLAW_OBSERVATION_EXTENSION = 'openclaw.acp.observations';

/** ACP and routing family used for resumable OpenClaw Session references. */
export const OPENCLAW_SESSION_COMPATIBILITY_REF =
  'openclaw;acp-v1;strategy=isolated';

/** Validated identity and capabilities from the official OpenClaw ACP bridge. */
export interface OpenClawRuntime {
  readonly name: 'openclaw-acp';
  readonly version: string;
  readonly capabilities: AcpAgentCapabilities;
}

/** Portable mapping produced before Run identity and sequence are attached. */
export interface MappedOpenClawEvent {
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
  'kind',
  'method',
  'outcome',
  'sessionUpdate',
  'status',
  'type',
]);

/** Build a non-sensitive identity for the observed OpenClaw runtime. */
export function openClawCompatibilityIdentity(runtimeVersion: string): string {
  return `${OPENCLAW_SESSION_COMPATIBILITY_REF};runtime=${runtimeDiagnostic(runtimeVersion)}`;
}

/** Validate the official OpenClaw ACP identity and stable protocol version. */
export function parseOpenClawRuntime(
  result: AcpInitializeResult,
): OpenClawRuntime {
  if (
    result.agentInfo?.name !== 'openclaw-acp' ||
    typeof result.agentInfo.version !== 'string' ||
    result.agentInfo.version.length === 0
  ) {
    throw incompatible('initialize response');
  }
  return {
    name: 'openclaw-acp',
    version: result.agentInfo.version,
    capabilities: result.capabilities,
  };
}

/** Convert the verified portable input subset to ACP v1 content blocks. */
export function prepareOpenClawPrompt(
  input: HarnessInput,
  capabilities: Readonly<{ image: boolean }>,
): readonly AcpContentBlock[] {
  if (input.parts.length === 0) {
    throw invalidRequest('An OpenClaw Run requires at least one input part.');
  }
  if (input.metadata !== undefined) {
    throw invalidRequest('OpenClaw Run metadata is not mapped.');
  }
  return input.parts.map((part): AcpContentBlock => {
    if (part.type === 'text') {
      if (part.text.length === 0) {
        throw invalidRequest('OpenClaw text input cannot be empty.');
      }
      return { type: 'text', text: part.text };
    }
    if (part.type === 'image_ref') {
      if (!capabilities.image) {
        throw unsupported(
          'input.image',
          'The connected OpenClaw ACP bridge did not advertise image input.',
        );
      }
      let name: string;
      try {
        name = basename(decodeURIComponent(new URL(part.uri).pathname));
      } catch {
        throw invalidRequest('OpenClaw image references require a valid URI.');
      }
      if (name.length === 0) name = 'image';
      return {
        type: 'resource_link',
        uri: part.uri,
        name,
        ...(part.mediaType === undefined ? {} : { mimeType: part.mediaType }),
      };
    }
    throw unsupported(
      `input.${part.type}`,
      'The OpenClaw ACP Adapter supports non-empty text and advertised image references only.',
    );
  });
}

/** Map one validated ACP Session update without exposing tool input or output. */
export function mapOpenClawSessionUpdate(
  update: AcpSessionUpdate,
): readonly MappedOpenClawEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = textContent(update.content);
      return text === undefined
        ? []
        : [{ type: 'message.delta', data: { text }, messageDelta: text }];
    }
    case 'agent_thought_chunk': {
      const text = textContent(update.content);
      return text === undefined
        ? []
        : [{ type: 'reasoning.delta', data: { text }, reasoningDelta: text }];
    }
    case 'tool_call': {
      return [
        {
          type: 'tool.started',
          data: safeToolData(update),
          providerEventType: update.sessionUpdate,
        },
      ];
    }
    case 'tool_call_update': {
      const terminal =
        update.status === 'completed' || update.status === 'failed';
      return [
        {
          type: terminal ? 'tool.completed' : 'tool.updated',
          data: safeToolData(update),
          providerEventType: update.sessionUpdate,
        },
      ];
    }
    case 'usage_update': {
      const usage = { totalTokens: update.used } satisfies UsageSummary;
      return [
        {
          type: 'usage.updated',
          data: usage,
          usage,
          providerEventType: update.sessionUpdate,
        },
      ];
    }
    case 'user_message_chunk':
      return [];
    case 'plan':
    case 'available_commands_update':
    case 'current_mode_update':
    case 'config_option_update':
    case 'session_info_update': {
      const raw = redactOpenClawObservation(update);
      return [
        {
          type: 'provider',
          data: { update: update.sessionUpdate },
          providerEventType: update.sessionUpdate,
          raw,
        },
      ];
    }
  }
}

/** Bound and redact an untrusted ACP observation for explicit visibility. */
export function redactOpenClawObservation(value: unknown): unknown {
  return redactValue(value, 0);
}

function textContent(content: AcpContentBlock): string | undefined {
  return content.type === 'text' && content.text.length > 0
    ? content.text
    : undefined;
}

function safeToolData(update: {
  readonly toolCallId: string;
  readonly title?: string | null;
  readonly kind?: string | null;
  readonly status?: string | null;
}): Readonly<Record<string, unknown>> {
  return {
    toolCallId: identifierDiagnostic(update.toolCallId),
    ...(update.title === undefined || update.title === null
      ? {}
      : { title: bounded(update.title) }),
    ...(update.kind === undefined || update.kind === null
      ? {}
      : { kind: update.kind }),
    ...(update.status === undefined || update.status === null
      ? {}
      : { status: update.status }),
  };
}

function redactValue(value: unknown, depth: number, key?: string): unknown {
  if (depth >= maximumObservationDepth) return '[bounded]';
  if (value === null) return null;
  if (typeof value === 'string') {
    if (key !== undefined && structuralKeys.has(key)) return bounded(value);
    return `value-${shortHash(value)}`;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '[redacted]';
  }
  if (typeof value === 'boolean' || typeof value === 'bigint') {
    return '[redacted]';
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
    result[bounded(entryKey)] = redactValue(entryValue, depth + 1, entryKey);
  }
  return result;
}

function bounded(value: string): string {
  return value.slice(0, maximumObservationString);
}

function runtimeDiagnostic(value: string): string {
  return `version-${shortHash(value)}`;
}

function identifierDiagnostic(value: string): string {
  return `id-${shortHash(value)}`;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function incompatible(surface: string): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    `OpenClaw emitted an incompatible ACP ${surface}.`,
    { retryable: false, providerId: OPENCLAW_PROVIDER_ID },
  );
}

function invalidRequest(message: string): HarnessError {
  return new HarnessError('invalid_request', message, {
    retryable: false,
    providerId: OPENCLAW_PROVIDER_ID,
  });
}

function unsupported(capability: string, message: string): HarnessError {
  return new HarnessError('unsupported_capability', message, {
    retryable: false,
    providerId: OPENCLAW_PROVIDER_ID,
    details: { capability },
  });
}
