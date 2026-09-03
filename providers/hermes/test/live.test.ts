import { profileId, type HarnessEvent, type HarnessRun } from '@harapter/core';
import { describe, expect, it } from 'vitest';

import { createHermesProviderFactory } from '../src/adapter.js';
import { HERMES_PROVIDER_ID } from '../src/protocol.js';

const liveEnabled = process.env['HARAPTER_HERMES_LIVE'] === '1';

describe.runIf(liveEnabled)('Hermes Agent live API Server', () => {
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
      providerOptions: {
        requestTimeoutMs: 150_000,
        sseConnectTimeoutMs: 150_000,
      },
    });
    try {
      const session = await client.createSession();
      try {
        const run = await session.start(
          {
            parts: [
              {
                type: 'text',
                text: 'Reply with exactly HARAPTER_HERMES_LIVE_OK and do not use tools.',
              },
            ],
          },
          { timeoutMs: 180_000 },
        );
        const [events, result] = await Promise.all([
          collectEvents(run),
          run.result(),
        ]);
        expect(result.status).toBe('completed');
        expect(events.at(-1)?.type).toBe('run.completed');
      } finally {
        await session.close();
      }
    } finally {
      await client.close();
    }
  }, 240_000);
});

describe('Hermes Agent live-canary safety guard', () => {
  it('rejects model-facing actions without exposing event data', () => {
    expect(() => {
      assertToolFreeLiveEvent({ type: 'tool.started' });
    }).toThrow('The live canary observed a model-facing action.');
    expect(() => {
      assertToolFreeLiveEvent({ type: 'interaction.requested' });
    }).toThrow('The live canary observed a model-facing action.');
    expect(() => {
      assertToolFreeLiveEvent({ type: 'message.delta' });
    }).not.toThrow();
  });
});

async function collectEvents(run: HarnessRun): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of run.events()) {
    assertToolFreeLiveEvent(event);
    events.push(event);
  }
  return events;
}

function assertToolFreeLiveEvent(event: { readonly type: string }): void {
  if (
    event.type.startsWith('tool.') ||
    event.type === 'interaction.requested'
  ) {
    throw new Error('The live canary observed a model-facing action.');
  }
}
