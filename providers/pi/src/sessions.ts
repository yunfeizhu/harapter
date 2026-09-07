import {
  HarnessError,
  type HarnessSession,
  type SessionRef,
} from '@harapter/core';
import { PI_PROVIDER_ID } from './protocol.js';

/** Native active-branch cloning in a separate owned RPC process. */
export const PI_SESSION_EXTENSION = 'pi.agent.sessions';

/** A fork gets its own native identity; the parent's process never changes Session. */
export interface PiSessions {
  fork(ref: SessionRef): Promise<HarnessSession>;
}

/** Clone receipts do not identify the child; get_state must still verify it. */
export function assertPiCloneAccepted(value: unknown): void {
  const data =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  if (typeof data?.['cancelled'] !== 'boolean') {
    throw new HarnessError(
      'provider_api_incompatible',
      'Pi clone returned an invalid receipt.',
      {
        retryable: false,
        providerId: PI_PROVIDER_ID,
      },
    );
  }
  if (data['cancelled']) {
    throw new HarnessError(
      'provider_error',
      'Pi declined the native Session clone.',
      {
        retryable: false,
        providerId: PI_PROVIDER_ID,
      },
    );
  }
}
