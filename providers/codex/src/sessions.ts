import {
  HarnessError,
  type HarnessSession,
  type SessionRef,
} from '@harapter/core';
import { CODEX_PROVIDER_ID, parseCodexThreadResponse } from './protocol.js';

/** Native persisted-Thread operations; no portable checkpoint semantics. */
export const CODEX_SESSION_EXTENSION = 'openai.codex.sessions';

/** Forks stored history into a distinct Thread without submitting a Turn. */
export interface CodexSessions {
  fork(ref: SessionRef): Promise<HarnessSession>;
}

/** Require an idle, persisted source before requesting a native fork. */
export function assertCodexForkSource(value: unknown, sourceId: string): void {
  const thread = record(record(value)?.['thread']);
  if (parseCodexThreadResponse(value) !== sourceId) throw incompatible();
  if (thread?.['ephemeral'] !== false) throw incompatible();
  const status = record(thread['status'])?.['type'];
  if (status === 'active') {
    throw new HarnessError(
      'run_conflict',
      'The source Codex Thread is active.',
      {
        retryable: false,
        providerId: CODEX_PROVIDER_ID,
      },
    );
  }
  if (status !== 'idle' && status !== 'notLoaded') throw incompatible();
}

/** Validate distinct child identity and the upstream persisted lineage. */
export function parseCodexFork(value: unknown, sourceId: string): string {
  const thread = record(record(value)?.['thread']);
  const id = parseCodexThreadResponse(value);
  if (
    id === sourceId ||
    thread?.['forkedFromId'] !== sourceId ||
    thread['ephemeral'] !== false
  ) {
    throw incompatible();
  }
  return id;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function incompatible(): HarnessError {
  return new HarnessError(
    'provider_api_incompatible',
    'Codex fork identity or lifecycle could not be verified.',
    {
      retryable: false,
      providerId: CODEX_PROVIDER_ID,
    },
  );
}
