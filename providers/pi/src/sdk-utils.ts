import { HarnessError, type HarnessErrorCode } from '@harapter/core';
import { PI_PROVIDER_ID } from './protocol.js';

export function sdkError(code: HarnessErrorCode): HarnessError {
  return new HarnessError(code, `Pi embedded SDK operation failed (${code}).`, {
    retryable: false,
    providerId: PI_PROVIDER_ID,
  });
}

export function sdkInteger(
  value: unknown,
  fallback: number,
  minimum = 1,
  maximum = 2_147_483_647,
): number {
  const number = value ?? fallback;
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > maximum
  )
    throw sdkError('invalid_request');
  return number;
}

export function sdkRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function sdkDeadline<T>(
  work: Promise<T>,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        abort = () => {
          reject(sdkError('connection_aborted'));
        };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted === true) abort();
        timer = setTimeout(() => {
          reject(sdkError('timeout'));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort !== undefined) signal?.removeEventListener('abort', abort);
  }
}
