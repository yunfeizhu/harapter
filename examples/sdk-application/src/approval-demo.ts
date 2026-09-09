import { HarnessRegistry, isHarnessError } from 'harapter';
import { createFakeProfile, createFakeProviderFactory } from 'harapter/testing';
import { terminalApproval } from './approval.js';
import { runTask } from './service.js';

// This isolated Fake has one known fictional action and performs no external work.
const registry = new HarnessRegistry();
registry.register(
  createFakeProviderFactory({ interaction: { kind: 'approval' } }),
);
const client = await registry.connect(createFakeProfile());
try {
  const outcome = await runTask(client, 'Fictional approval demonstration.', {
    onInteraction: terminalApproval(
      () => 'Allow the offline Fake to finish this fictional task?',
    ),
  });
  process.stdout.write(
    `${JSON.stringify({ status: outcome.result.status })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: isHarnessError(error) ? error.code : 'application_failed' })}\n`,
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
