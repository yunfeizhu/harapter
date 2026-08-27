import type { SessionRef } from './contracts.js';
import { HarnessError } from './errors.js';
import type { ProfileId, ProviderId } from './identifiers.js';

/**
 * Refuse a Session reference that is not owned by the active Provider/Profile.
 * Adapters call this before sending any resume traffic.
 * @param ref - Opaque Session reference supplied by a host.
 * @param expectedProviderId - Active Adapter identity.
 * @param expectedProfileId - Active Profile identity.
 */
export function assertSessionOwnership(
  ref: SessionRef,
  expectedProviderId: ProviderId,
  expectedProfileId: ProfileId,
): void {
  if (
    ref.providerId !== expectedProviderId ||
    ref.profileId !== expectedProfileId
  ) {
    throw new HarnessError(
      'session_provider_mismatch',
      'Session reference is not owned by the active Provider and Profile.',
      {
        retryable: false,
        providerId: expectedProviderId,
        profileId: expectedProfileId,
      },
    );
  }
}

/**
 * Refuse a Session reference created under another runtime compatibility
 * identity. Adapters call this when they emit a compatibility reference.
 * @param ref - Opaque Session reference supplied by a host.
 * @param expectedCompatibilityRef - Active runtime or protocol fingerprint.
 */
export function assertSessionCompatibility(
  ref: SessionRef,
  expectedCompatibilityRef: string,
): void {
  if (ref.compatibilityRef !== expectedCompatibilityRef) {
    throw new HarnessError(
      'session_provider_mismatch',
      'Session reference is not compatible with the active runtime.',
      {
        retryable: false,
        providerId: ref.providerId,
        profileId: ref.profileId,
      },
    );
  }
}
