import { HarnessRegistry } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance/fake';
import { runTask } from './service.js';

const registry = new HarnessRegistry();
registry.register(createFakeProviderFactory());
const client = await registry.connect(createFakeProfile());
try {
  const { result } = await runTask(client, 'Fictional application test.');
  if (
    result.status !== 'completed' ||
    result.finalMessage !== 'Fictional application test.'
  )
    throw new Error('Offline application check failed.');
  process.stdout.write('offline application passed\n');
} finally {
  await client.close();
}
