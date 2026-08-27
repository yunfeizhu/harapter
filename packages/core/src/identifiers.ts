import { HarnessError } from './errors.js';

declare const opaqueIdentifier: unique symbol;

type OpaqueIdentifier<Name extends string> = string & {
  readonly [opaqueIdentifier]: Name;
};

/** Stable identifier for a dynamically registered Provider Adapter. */
export type ProviderId = OpaqueIdentifier<'ProviderId'>;

/** Stable host-scoped identifier for one connection profile. */
export type ProfileId = OpaqueIdentifier<'ProfileId'>;

/** Opaque Provider-owned session identifier. */
export type ProviderSessionId = OpaqueIdentifier<'ProviderSessionId'>;

/** Client-scoped identifier for one portable run. */
export type RunId = OpaqueIdentifier<'RunId'>;

function validateIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new HarnessError('invalid_request', `${label} is invalid.`, {
      retryable: false,
    });
  }
}

/**
 * Validate and brand a Provider identifier without assigning meaning to it.
 * @param value - Dynamic Provider identifier.
 * @returns The unchanged opaque identifier.
 */
export function providerId(value: string): ProviderId {
  validateIdentifier(value, 'providerId');
  return value as ProviderId;
}

/**
 * Validate and brand a Profile identifier.
 * @param value - Host-scoped Profile identifier.
 * @returns The unchanged opaque identifier.
 */
export function profileId(value: string): ProfileId {
  validateIdentifier(value, 'profileId');
  return value as ProfileId;
}

/**
 * Validate and brand an opaque Provider session identifier.
 * @param value - Provider-native identifier.
 * @returns The unchanged opaque identifier.
 */
export function providerSessionId(value: string): ProviderSessionId {
  validateIdentifier(value, 'providerSessionId');
  return value as ProviderSessionId;
}

/**
 * Validate and brand a client-scoped run identifier.
 * @param value - Run identifier.
 * @returns The unchanged opaque identifier.
 */
export function runId(value: string): RunId {
  validateIdentifier(value, 'runId');
  return value as RunId;
}
