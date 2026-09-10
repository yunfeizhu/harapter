import { HarnessError } from '@harapter/core';
import type { SendOptions } from './run-types.js';

/** Validate and snapshot a text message without selecting or changing its Session's harness. */
export function snapshotSend(
  input: string,
  value: SendOptions,
  fallback: number,
): SendOptions & { input: string; timeoutMs: number } {
  if (
    typeof input !== 'string' ||
    !input.trim() ||
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => key !== 'timeoutMs' && key !== 'onEvent',
    ) ||
    (value.onEvent !== undefined && typeof value.onEvent !== 'function')
  )
    throw invalid();
  const timeoutMs = value.timeoutMs ?? fallback;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647
  )
    throw invalid();
  return {
    input,
    timeoutMs,
    ...(value.onEvent === undefined ? {} : { onEvent: value.onEvent }),
  };
}

function invalid(): HarnessError {
  return new HarnessError(
    'invalid_request',
    'Send non-empty text with a bounded timeout and an optional event handler.',
    { retryable: false },
  );
}

function isRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
