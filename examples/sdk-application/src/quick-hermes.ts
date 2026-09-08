import { isHarnessError, profileId, type HarnessSession } from '@harapter/core';
import {
  HERMES_PROVIDER_ID,
  createHermesProviderFactory,
} from '@harapter/adapter-hermes';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const factory = createHermesProviderFactory({
    resolveAuthHeaders: () =>
      Promise.resolve({
        authorization: 'Bearer ' + required('HARAPTER_HERMES_API_KEY'),
      }),
  });
  const client = await factory.connect({
    profileId: profileId('my-hermes'),
    providerId: HERMES_PROVIDER_ID,
    displayName: 'Application hermes',
    connection: {
      kind: 'endpoint',
      url: required('HARAPTER_HERMES_URL'),
      transport: 'http',
      ownership: 'external',
      authRef: { scheme: 'env', id: 'hermes' },
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({});
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
