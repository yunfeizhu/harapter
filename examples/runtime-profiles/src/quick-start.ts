import {
  createHarapter,
  HarnessError,
  isHarnessError,
  type HarnessSession,
} from 'harapter';
import { readRuntimeConfig } from './runtime-config.js';

try {
  const { options, profile, sessionOptions } = readRuntimeConfig();
  const harapter = await createHarapter(options);
  const client = await harapter.connect(profile);
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession(sessionOptions);
    const run = await session.start(
      { parts: [{ type: 'text', text: 'Hello!' }] },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      if (event.type === 'interaction.requested')
        throw new HarnessError(
          'unsupported_capability',
          'Configure a host interaction handler.',
          { retryable: false },
        );
      console.log({ type: event.type });
    }
    const result = await run.result();
    // Use result.finalMessage as the answer in your application.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
    });
    if (result.status !== 'completed') process.exitCode = 1;
  } finally {
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
