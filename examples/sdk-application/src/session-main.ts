import { isAbsolute } from 'node:path';
import { isHarnessError } from '@harapter/core';
import { connectCodex } from './codex.js';
import { runTask } from './service.js';
import { continueConversation, forkCodexConversation } from './recipes.js';

try {
  const command = process.env['HARAPTER_CODEX_COMMAND'];
  const workspace = process.env['HARAPTER_WORKSPACE'];
  if (!command || !workspace || !isAbsolute(workspace))
    throw new Error('Configuration required.');
  const text =
    'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.';
  const first = await connectCodex(command, workspace);
  const saved = await (async () => {
    try {
      const outcome = await runTask(first.client, text, {
        session: first.session,
      });
      if (outcome.result.status !== 'completed')
        throw new Error('Initial Run failed.');
      return outcome.sessionRef;
    } finally {
      await first.client.close();
    }
  })();
  // Persist this reference only in owner-scoped storage. Never print native state.
  const second = await connectCodex(command, workspace);
  try {
    const resumed = await continueConversation(second.client, saved, text);
    if (resumed.result.status !== 'completed')
      throw new Error('Resumed Run failed.');
    const forked = await forkCodexConversation(second.client, saved, text);
    process.stdout.write(
      `${JSON.stringify({ resumed: resumed.result.status, forked: forked.result.status })}\n`,
    );
    if (forked.result.status !== 'completed') process.exitCode = 1;
  } finally {
    await second.client.close();
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: isHarnessError(error) ? error.code : 'application_failed' })}\n`,
  );
  process.exitCode = 1;
}
