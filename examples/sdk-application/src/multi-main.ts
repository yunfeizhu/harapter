import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError } from 'harapter';
import { connectCodex } from './codex.js';
import { connectOpenCode } from './endpoints.js';
import { runAcrossProviders } from './recipes.js';

try {
  const command = process.env['HARAPTER_CODEX_COMMAND'];
  const workspace = process.env['HARAPTER_WORKSPACE'];
  const url = process.env['HARAPTER_OPENCODE_URL'];
  const remoteWorkspace = process.env['HARAPTER_OPENCODE_WORKSPACE'];
  const password = process.env['OPENCODE_SERVER_PASSWORD'];
  if (
    !command ||
    !workspace ||
    !isAbsolute(workspace) ||
    !url ||
    !remoteWorkspace ||
    !isAbsolute(remoteWorkspace) ||
    !password
  )
    throw new Error('Configuration required.');
  const first = await connectCodex(command, workspace);
  try {
    const username = process.env['OPENCODE_SERVER_USERNAME'] ?? 'opencode';
    const second = await connectOpenCode(url, {
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    });
    try {
      const outcomes = await runAcrossProviders(
        first.client,
        second,
        'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
        { session: first.session },
        {
          session: { workspace: { uri: pathToFileURL(remoteWorkspace).href } },
        },
      );
      // allSettled keeps a failure in one Provider from abandoning the other's cleanup.
      const statuses = outcomes.map((outcome) =>
        outcome.status === 'fulfilled'
          ? outcome.value.result.status
          : 'application_failed',
      );
      process.stdout.write(`${JSON.stringify({ statuses })}\n`);
      if (statuses.some((status) => status !== 'completed'))
        process.exitCode = 1;
    } finally {
      await second.close();
    }
  } finally {
    await first.client.close();
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: isHarnessError(error) ? error.code : 'application_failed' })}\n`,
  );
  process.exitCode = 1;
}
