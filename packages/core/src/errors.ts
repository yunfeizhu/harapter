import type { ProfileId, ProviderId } from './identifiers.js';

/** Stable portable error categories. */
export type HarnessErrorCode =
  | 'provider_not_found'
  | 'profile_invalid'
  | 'runtime_not_found'
  | 'connection_failed'
  | 'authentication_failed'
  | 'provider_api_incompatible'
  | 'unsupported_capability'
  | 'invalid_request'
  | 'session_not_found'
  | 'session_provider_mismatch'
  | 'run_conflict'
  | 'timeout'
  | 'provider_error'
  | 'connection_aborted';

/** Explicit diagnostics supplied when constructing a portable error. */
export interface HarnessErrorOptions {
  retryable: boolean;
  providerId?: ProviderId;
  profileId?: ProfileId;
  providerCode?: string;
  details?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

/**
 * Portable failure with an explicit stable category and retry decision.
 * Provider causes must be redacted before they are attached.
 */
export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly retryable: boolean;
  readonly providerId: ProviderId | undefined;
  readonly profileId: ProfileId | undefined;
  readonly providerCode: string | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  /**
   * @param code - Stable portable category.
   * @param message - Safe human-readable summary.
   * @param options - Explicit retry and redacted Provider diagnostics.
   */
  constructor(
    code: HarnessErrorCode,
    message: string,
    options: HarnessErrorOptions,
  ) {
    super(message, { cause: options.cause });
    this.name = 'HarnessError';
    this.code = code;
    this.retryable = options.retryable;
    this.providerId = options.providerId;
    this.profileId = options.profileId;
    this.providerCode = options.providerCode;
    this.details = options.details;
  }
}

/**
 * Narrow an unknown failure to {@link HarnessError}.
 * @param error - Unknown thrown value.
 * @returns Whether the value is a portable Harapter error.
 */
export function isHarnessError(error: unknown): error is HarnessError {
  return error instanceof HarnessError;
}
