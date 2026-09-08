import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from '@harapter/core';
import {
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from '@harapter/adapter-openclaw';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createOpenClawProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-openclaw'),
    providerId: OPENCLAW_PROVIDER_ID,
    displayName: 'Application openclaw',
    connection: {
      kind: 'process',
      command: required('HARAPTER_OPENCLAW_COMMAND'),
      args: ['acp', '--no-prefix-cwd'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({
      workspace: { uri: pathToFileURL(workspace).href },
    });
    const run = await session.start(
      {
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
          },
        ],
      },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      if (event.type === 'interaction.requested')
        throw new Error('Configure an explicit host interaction handler.');
      console.log({ type: event.type, sequence: event.sequence });
    }
    const result = await run.result();
    // Use result.finalMessage in your authorized application UI or response.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
    });
    if (result.status !== 'completed') process.exitCode = 1;
    // ACP session/close needs an open connection after the Run has settled.
    await session.close();
  } catch (error) {
    // On failure, abort any active Run and preserve the original error.
    await client.close().catch(() => undefined);
    await session?.close().catch(() => undefined);
    throw error;
  }
  await client.close();
}

await main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
