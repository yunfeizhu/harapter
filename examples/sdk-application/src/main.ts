import { isAbsolute } from 'node:path';
import { isHarnessError } from '@harapter/core';
import { connectCodex } from './codex.js';
import { runTask } from './service.js';

try {
  const command = process.env['HARAPTER_CODEX_COMMAND'];
  const workspace = process.env['HARAPTER_WORKSPACE'];
  if (!command || !workspace || !isAbsolute(workspace))
    throw new Error('Configuration required.');
  const { client, session } = await connectCodex(command, workspace);
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
  };
  process.once('SIGINT', cancel);
  try {
    const { result } = await runTask(
      client,
      'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
      {
        session,
        signal: controller.signal,
        onEvent: (event) => process.stdout.write(`${event.type}\n`),
      },
    );
    // result.finalMessage belongs in an authorized application response, not general logs.
    process.stdout.write(
      `${JSON.stringify({ status: result.status, hasText: result.finalMessage !== undefined })}\n`,
    );
    if (result.status !== 'completed') process.exitCode = 1;
  } finally {
    process.off('SIGINT', cancel);
    await client.close();
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: isHarnessError(error) ? error.code : 'application_failed' })}\n`,
  );
  process.exitCode = 1;
}
