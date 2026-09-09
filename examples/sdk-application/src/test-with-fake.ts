import { HarnessRegistry } from 'harapter';
import { createFakeProfile, createFakeProviderFactory } from 'harapter/testing';

// Replace the application's real Adapter at its composition boundary.
const registry = new HarnessRegistry();
registry.register(createFakeProviderFactory());
const client = await registry.connect(createFakeProfile());
try {
  const session = await client.createSession();
  try {
    const run = await session.start({
      parts: [{ type: 'text', text: 'Fictional test input.' }],
    });
    for await (const _event of run.events()) {
      /* Drain even when the test has no renderer. */
    }
    const result = await run.result();
    if (
      result.status !== 'completed' ||
      result.finalMessage !== 'Fictional test input.'
    )
      throw new Error('Application test failed.');
    console.log({ applicationTestPassed: true });
  } finally {
    await session.close();
  }
} finally {
  await client.close();
}
