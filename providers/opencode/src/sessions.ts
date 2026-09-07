import {
  HarnessError,
  type HarnessSession,
  type SessionRef,
} from '@harapter/core';
import { OPENCODE_PROVIDER_ID } from './protocol.js';

/** Provider-native Session history operations. */
export const OPENCODE_SESSION_EXTENSION = 'opencode.sessions';

/** Copies the idle source's stored history without submitting new input. */
export interface OpenCodeSessions {
  fork(ref: SessionRef): Promise<HarnessSession>;
}

/** Native fork does not preserve per-Session permission rules or revert state. */
export function assertOpenCodeForkSource(value: unknown): void {
  const source = value as Record<string, unknown>;
  const permissions = source['permission'];
  if (
    (permissions !== undefined &&
      (!Array.isArray(permissions) || permissions.length !== 0)) ||
    source['revert'] !== undefined
  ) {
    throw new HarnessError(
      'unsupported_capability',
      'OpenCode fork cannot preserve this Session permission or revert state.',
      {
        retryable: false,
        providerId: OPENCODE_PROVIDER_ID,
      },
    );
  }
}
