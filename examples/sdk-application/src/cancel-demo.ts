import { HarnessRegistry } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance/fake';
import { runTask } from './service.js';

const registry = new HarnessRegistry();
registry.register(
  createFakeProviderFactory({ interaction: { kind: 'approval' } }),
);
const client = await registry.connect(createFakeProfile());
try {
  const controller = new AbortController();
  const cancelled = await runTask(
    client,
    'Fictional cancellation demonstration.',
    {
      signal: controller.signal,
      onInteraction: () => {
        controller.abort();
        return new Promise(() => undefined);
      },
    },
  );
  const timedOut = await runTask(client, 'Fictional timeout demonstration.', {
    timeoutMs: 20,
    onInteraction: () => new Promise(() => undefined),
  });
  if (
    cancelled.result.status !== 'cancelled' ||
    timedOut.result.status !== 'connection_aborted'
  )
    throw new Error('Unexpected Fake lifecycle.');
  process.stdout.write(
    `${JSON.stringify({ cancellation: cancelled.result.status, timeout: timedOut.result.status })}\n`,
  );
} finally {
  await client.close();
}
