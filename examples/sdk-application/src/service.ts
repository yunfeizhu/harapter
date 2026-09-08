import {
  HarnessError,
  type CreateSessionInput,
  type HarnessClient,
  type HarnessEvent,
  type HarnessSession,
  type RunResult,
  type SessionRef,
} from '@harapter/core';
import {
  observeInteractiveRun,
  type HostInteractionHandler,
} from './interactions.js';

export interface TaskOptions {
  readonly session?: CreateSessionInput;
  readonly resume?: SessionRef;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Application callback: event payloads may contain private user content. */
  readonly onEvent?: (event: HarnessEvent) => void;
  readonly onInteraction?: HostInteractionHandler;
}

/** Application service. Errors close the Client; callers also close it in a finally block. */
export async function runTask(
  client: HarnessClient,
  text: string,
  options: TaskOptions = {},
): Promise<{ result: RunResult; sessionRef: SessionRef }> {
  if (options.signal?.aborted)
    throw new HarnessError(
      'invalid_request',
      'Task was aborted before starting.',
      { retryable: false },
    );
  if (options.resume !== undefined && options.session !== undefined)
    throw new HarnessError(
      'invalid_request',
      'Choose creation settings or a saved Session reference.',
      { retryable: false },
    );
  const session =
    options.resume === undefined
      ? await client.createSession(options.session)
      : await client.resumeSession(options.resume);
  try {
    const outcome = await runSessionTask(session, text, options);
    await session.close();
    return outcome;
  } catch (error) {
    // Stop a still-active Run before releasing its handle; preserve the primary error.
    await client.close().catch(() => undefined);
    await session.close().catch(() => undefined);
    throw error;
  }
}

/** Use an already-created Session, including a Provider-native fork. The caller owns it. */
export async function runSessionTask(
  session: HarnessSession,
  text: string,
  options: Omit<TaskOptions, 'session' | 'resume'> = {},
): Promise<{ result: RunResult; sessionRef: SessionRef }> {
  if (options.signal?.aborted)
    throw new HarnessError(
      'invalid_request',
      'Task was aborted before starting.',
      { retryable: false },
    );
  if (
    options.signal !== undefined &&
    (await session.capabilities()).capabilities['run.cancel']?.mode !== 'native'
  )
    throw new HarnessError(
      'unsupported_capability',
      'This application requires native cancellation for an AbortSignal.',
      { retryable: false },
    );
  const run = await session.start(
    { parts: [{ type: 'text', text }] },
    { timeoutMs: options.timeoutMs ?? 60_000 },
  );
  const cancellationFailure = Promise.withResolvers<never>();
  void cancellationFailure.promise.catch(() => undefined);
  let cancelling = false;
  const cancel = () => {
    if (cancelling) return;
    cancelling = true;
    void run.cancel().catch(() => {
      cancellationFailure.reject(
        new HarnessError('provider_error', 'Cancellation failed.', {
          retryable: false,
        }),
      );
    });
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  try {
    const result = await Promise.race([
      observeInteractiveRun({
        session,
        run,
        onEvent: (event) => options.onEvent?.(event),
        ...(options.onInteraction === undefined
          ? {}
          : { onInteraction: options.onInteraction }),
      }),
      cancellationFailure.promise,
    ]);
    return { result, sessionRef: session.ref() };
  } finally {
    options.signal?.removeEventListener('abort', cancel);
  }
}
