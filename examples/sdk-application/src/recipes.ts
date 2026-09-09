import { HarnessError, type HarnessClient, type SessionRef } from 'harapter';
import { CODEX_SESSION_EXTENSION, type CodexSessions } from 'harapter/codex';
import { runTask, runSessionTask, type TaskOptions } from './service.js';

/** A saved reference is loaded only for its authenticated owner and original Profile. */
export function continueConversation(
  client: HarnessClient,
  reference: SessionRef,
  text: string,
) {
  return runTask(client, text, { resume: reference });
}

/** Fork is a typed Codex operation, not a portable Session method. */
export async function forkCodexConversation(
  client: HarnessClient,
  reference: SessionRef,
  text: string,
) {
  const sessions = client
    .extensions()
    .get<CodexSessions>(CODEX_SESSION_EXTENSION);
  if (!sessions)
    throw new HarnessError(
      'unsupported_capability',
      'Codex Session history is unavailable.',
      { retryable: false },
    );
  const child = await sessions.fork(reference);
  try {
    const outcome = await runSessionTask(child, text);
    await child.close();
    return outcome;
  } catch (error) {
    await client.close().catch(() => undefined);
    await child.close().catch(() => undefined);
    throw error;
  }
}

/** Wait for every independent task before the caller disposes either Client. */
export function runAcrossProviders(
  first: HarnessClient,
  second: HarnessClient,
  text: string,
  firstOptions: TaskOptions = {},
  secondOptions: TaskOptions = {},
) {
  return Promise.allSettled([
    runTask(first, text, firstOptions),
    runTask(second, text, secondOptions),
  ]);
}
