import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from 'harapter';
import { CODEX_PROVIDER_ID, createCodexProviderFactory } from 'harapter/codex';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createCodexProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-codex'),
    providerId: CODEX_PROVIDER_ID,
    displayName: 'Application codex',
    connection: {
      kind: 'process',
      command: required('HARAPTER_CODEX_COMMAND'),
      args: ['app-server', '--stdio'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({
      workspace: { uri: pathToFileURL(workspace).href },
      providerOptions: {
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
      },
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
  } finally {
    // Client shutdown also releases an active Run if application event handling fails.
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

void main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
