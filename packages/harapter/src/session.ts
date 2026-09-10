import {
  HarnessError,
  isHarnessError,
  type HarnessClient,
  type HarnessSession,
  type RunResult,
} from '@harapter/core';
import { createHarapter } from './sdk.js';
import { prepareRun, snapshotRuntimeOptions } from './run-config.js';
import { snapshotSend } from './send-options.js';
import type { RuntimeOptions, SendOptions } from './run-types.js';

/** An owned connection and persistent Session, with a text-message helper. */
export interface ChatSession extends HarnessSession {
  /** Advanced capability, native extension and Session controls on the same connection. */
  readonly client: HarnessClient;
  /** Send one message to this Session, consume its events and return its terminal result. */
  send(input: string, options?: SendOptions): Promise<RunResult>;
}

/**
 * Open a persistent Session with the same Runtime options as run().
 * @param request - A maintained harness and optional Runtime overrides.
 * @returns A Session whose close() also releases its owned Client.
 * @throws HarnessError for invalid configuration, setup, deadline or cleanup failures.
 */
export async function openSession(
  request: RuntimeOptions,
): Promise<ChatSession> {
  let options: ReturnType<typeof snapshotRuntimeOptions>;
  try {
    options = snapshotRuntimeOptions(request);
  } catch (error) {
    throw safe(error, 'invalid_request');
  }
  let client: HarnessClient | undefined;
  let session: HarnessSession | undefined;
  let stopped = false;
  const isStopped = () => stopped;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = () =>
    new HarnessError(
      'timeout',
      'The Harapter Session connection deadline expired.',
      { retryable: false },
    );
  const work = async () => {
    const config = await prepareRun(options);
    if (isStopped()) throw expired();
    const registry = await createHarapter(config.sdk);
    if (isStopped()) throw expired();
    const connected = await registry.connect(config.profile);
    if (isStopped()) {
      await connected.close().catch(() => undefined);
      throw expired();
    }
    client = connected;
    const created = await connected.createSession(config.session);
    if (isStopped()) {
      await created.close().catch(() => undefined);
      throw expired();
    }
    session = created;
    return managedSession(connected, created, options.timeoutMs);
  };
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stopped = true;
          reject(expired());
        }, options.timeoutMs);
      }),
    ]);
  } catch (error) {
    stopped = true;
    await client?.close().catch(() => undefined);
    await session?.close().catch(() => undefined);
    throw safe(error, 'provider_error');
  } finally {
    clearTimeout(timer);
  }
}

function managedSession(
  client: HarnessClient,
  session: HarnessSession,
  timeoutMs: number,
): ChatSession {
  let closed = false;
  let busy = false;
  let closePromise: Promise<void> | undefined;
  const assertOpen = () => {
    if (closed) throw safe(undefined, 'connection_aborted');
  };
  const close = (abort: boolean): Promise<void> => {
    closed = true;
    closePromise ??= (async () => {
      let failed = false;
      for (const cleanup of abort
        ? [() => client.close(), () => session.close()]
        : [() => session.close(), () => client.close()]) {
        try {
          await cleanup();
        } catch {
          failed = true;
        }
      }
      if (failed) throw safe(undefined, 'connection_failed');
    })();
    return closePromise;
  };
  return {
    client,
    ref: () => session.ref(),
    capabilities: () => session.capabilities(),
    async start(input, options) {
      assertOpen();
      if (busy) throw safe(undefined, 'run_conflict');
      busy = true;
      try {
        const task = await session.start(input, options);
        void task.result().then(
          () => {
            busy = false;
          },
          () => {
            busy = false;
          },
        );
        return task;
      } catch (error) {
        busy = false;
        throw safe(error, 'provider_error');
      }
    },
    async respond(id, response) {
      assertOpen();
      return session.respond(id, response);
    },
    close: () => close(busy),
    async send(input, settings = {}) {
      assertOpen();
      if (busy) throw safe(undefined, 'run_conflict');
      let send: ReturnType<typeof snapshotSend>;
      try {
        send = snapshotSend(input, settings, timeoutMs);
      } catch (error) {
        throw safe(error, 'invalid_request');
      }
      busy = true;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const consume = async () => {
        const task = await session.start({
          parts: [{ type: 'text', text: send.input }],
        });
        for await (const event of task.events()) {
          if (stopped) throw safe(undefined, 'timeout');
          if (event.type === 'interaction.requested')
            throw new HarnessError(
              'unsupported_capability',
              'send() cannot handle interactions; use Session.start() and respond().',
              { retryable: false },
            );
          try {
            await send.onEvent?.(event);
          } catch {
            throw safe(undefined, 'provider_error');
          }
        }
        if (stopped) throw safe(undefined, 'timeout');
        return task.result();
      };
      try {
        return await Promise.race([
          consume(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              stopped = true;
              reject(safe(undefined, 'timeout'));
            }, send.timeoutMs);
          }),
        ]);
      } catch (error) {
        stopped = true;
        await close(true).catch(() => undefined);
        throw safe(error, 'provider_error');
      } finally {
        stopped = true;
        busy = false;
        clearTimeout(timer);
      }
    },
  };
}

function safe(
  error: unknown,
  fallback: ConstructorParameters<typeof HarnessError>[0],
): HarnessError {
  return isHarnessError(error)
    ? error
    : new HarnessError(
        fallback,
        `The Harapter Session operation failed (${fallback}).`,
        { retryable: false },
      );
}
