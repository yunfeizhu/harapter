import { profileId, type HarnessEvent, type HarnessRun } from '@harapter/core';
import { describe, expect, it } from 'vitest';

import { createHermesProviderFactory } from '../src/adapter.js';
import { HERMES_PROVIDER_ID } from '../src/protocol.js';

const liveEnabled = process.env['HARAPTER_HERMES_LIVE'] === '1';

describe.skipIf(!liveEnabled)('Hermes Agent live API Server', () => {
  it('creates a Session and completes a text Run against a host-operated endpoint', async () => {
    const endpoint = process.env['HARAPTER_HERMES_ENDPOINT'];
    if (endpoint === undefined) {
      throw new Error(
        'HARAPTER_HERMES_ENDPOINT is required for the live test.',
      );
    }
    const apiKey = process.env['HARAPTER_HERMES_API_KEY'];
    const factory = createHermesProviderFactory({
      ...(apiKey === undefined
        ? {}
        : {
            resolveAuthHeaders: () => ({
              authorization: `Bearer ${apiKey}`,
            }),
          }),
    });
    const client = await factory.connect({
      profileId: profileId('hermes-live'),
      providerId: HERMES_PROVIDER_ID,
      displayName: 'Hermes Agent live',
      connection: {
        kind: 'endpoint',
        url: endpoint,
        transport: 'http',
        ownership: 'external',
        ...(apiKey === undefined
          ? {}
          : { authRef: { scheme: 'live-environment', id: 'hermes-api-key' } }),
      },
    });
    try {
      const session = await client.createSession();
      const run = await session.start({
        parts: [{ type: 'text', text: 'Reply with the single word OK.' }],
      });
      const [events, result] = await Promise.all([
        collectEvents(run),
        run.result(),
      ]);
      expect(result.status).toBe('completed');
      expect(events.at(-1)?.type).toBe('run.completed');
    } finally {
      await client.close();
    }
  });
});

async function collectEvents(run: HarnessRun): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of run.events()) events.push(event);
  return events;
}
