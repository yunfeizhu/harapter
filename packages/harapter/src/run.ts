import {
  HarnessError,
  isHarnessError,
  type HarnessClient,
  type HarnessSession,
  type RunResult,
} from '@harapter/core';
import { createHarapter } from './sdk.js';
import { prepareRun, snapshotRun } from './run-config.js';
import type { RunRequest } from './run-types.js';

/**
 * Execute one task on a built-in harness, consume its events and release owned handles.
 * @param request - Harness, text and optional connection, model and event settings.
 * @returns The authoritative Provider terminal result, including non-completed statuses.
 * @throws Safe HarnessError for setup, deadline, observer, interaction or cleanup failures.
 */
export async function run(request: RunRequest): Promise<RunResult> {
  let options: ReturnType<typeof snapshotRun>;
  try {
    options = snapshotRun(request);
  } catch (error) {
    if (isHarnessError(error)) throw error;
    throw new HarnessError(
      'invalid_request',
      'The run configuration could not be read.',
      { retryable: false },
    );
  }
  let client: HarnessClient | undefined;
  let session: HarnessSession | undefined;
  let stopped = false;
  const isStopped = (): boolean => stopped;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = () =>
    new HarnessError('timeout', 'The Harapter run deadline expired.', {
      retryable: false,
    });
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      stopped = true;
      reject(timeout());
    }, options.timeoutMs);
  });

  async function execute(): Promise<RunResult> {
    const config = await prepareRun(options);
    if (isStopped()) throw timeout();
    const sdk = await createHarapter(config.sdk);
    if (isStopped()) throw timeout();
    const connected = await sdk.connect(config.profile);
    if (isStopped()) {
      await connected.close().catch(() => undefined);
      throw timeout();
    }
    client = connected;
    const created = await connected.createSession(config.session);
    if (isStopped()) {
      await created.close().catch(() => undefined);
      throw timeout();
    }
    session = created;
    const task = await created.start({
      parts: [{ type: 'text', text: options.input }],
    });
    if (isStopped()) throw timeout();
    for await (const event of task.events()) {
      if (isStopped()) throw timeout();
      if (event.type === 'interaction.requested')
        throw new HarnessError(
          'unsupported_capability',
          'run() cannot handle approvals or user input; use the Session API for interactive tasks.',
          { retryable: false },
        );
      if (options.onEvent !== undefined) {
        try {
          await options.onEvent(event);
        } catch {
          throw new HarnessError(
            'provider_error',
            'The run event handler failed.',
            { retryable: false },
          );
        }
      }
    }
    if (isStopped()) throw timeout();
    const result = await task.result();
    if (isStopped()) throw timeout();
    // Normal completion releases remote Session handles while their Client is still usable.
    await created.close();
    session = undefined;
    return result;
  }

  let outcome:
    { ok: true; result: RunResult } | { ok: false; error: HarnessError };
  let cleanupFailed = false;
  try {
    outcome = { ok: true, result: await Promise.race([execute(), deadline]) };
  } catch (error) {
    outcome = {
      ok: false,
      error: isHarnessError(error)
        ? error
        : new HarnessError('provider_error', 'The Harapter run failed.', {
            retryable: false,
          }),
    };
  } finally {
    stopped = true;
    clearTimeout(timer);
    // On failure, Client first: a Session may refuse to close while a Run is active.
    try {
      await client?.close();
    } catch {
      cleanupFailed = true;
    }
    try {
      await session?.close();
    } catch {
      cleanupFailed = true;
    }
  }
  if (!outcome.ok) throw outcome.error;
  if (cleanupFailed)
    throw new HarnessError(
      'connection_failed',
      'The Harapter run could not release its resources.',
      { retryable: false },
    );
  return outcome.result;
}
