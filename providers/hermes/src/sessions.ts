import {
  HarnessError,
  type HarnessSession,
  type SessionRef,
} from '@harapter/core';
import { HERMES_PROVIDER_ID, parseHermesSession } from './protocol.js';

/** Hermes native branching ends the source Session as branched. */
export const HERMES_SESSION_EXTENSION = 'nous.hermes-agent.sessions';

/** Native branching replaces the writable parent with an owned child. */
export interface HermesSessions {
  branch(ref: SessionRef): Promise<HarnessSession>;
}

/** Hermes fork copies model name and history, but not stored model configuration. */
export function assertHermesBranchSource(value: unknown): void {
  parseHermesSession(value);
  const source = (value as { session: Record<string, unknown> }).session;
  if (source['has_model_config'] !== false) {
    throw new HarnessError(
      'unsupported_capability',
      'Hermes branch cannot verify preservation of the Session model configuration.',
      { retryable: false, providerId: HERMES_PROVIDER_ID },
    );
  }
}

/** Require the correlated response to identify a distinct child of the source. */
export function parseHermesBranch(value: unknown, sourceId: string): string {
  const child = parseHermesSession(value);
  const wrapper = value as Record<string, unknown>;
  const session = wrapper['session'] as Record<string, unknown>;
  if (
    child.id === sourceId ||
    session['parent_session_id'] !== sourceId ||
    child.branched === true
  ) {
    throw new HarnessError(
      'provider_api_incompatible',
      'Hermes branch identity or lineage could not be verified.',
      {
        retryable: false,
        providerId: HERMES_PROVIDER_ID,
      },
    );
  }
  return child.id;
}
