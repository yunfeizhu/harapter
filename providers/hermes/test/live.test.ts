import {
  profileId,
  type CancelResult,
  type HarnessRun,
  type RunResult,
  type SessionRef,
} from '@harapter/core';
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
      const sessionRef = session.ref();
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
        const [eventTypes, result] = await Promise.all([
          collectEventTypes(run),
          run.result(),
        ]);
        assertCompletedTextRun(result, 'HARAPTER_HERMES_LIVE_OK');
        expect(eventTypes).toContain('run.started');
        expect(eventTypes).toContain('message.completed');
        expect(eventTypes.at(-1)).toBe('run.completed');
      } finally {
        await session.close();
      }

      const resumed = await client.resumeSession(sessionRef);
      try {
        assertResumedSession(sessionRef, resumed.ref());
        const cancelledRun = await resumed.start({
          parts: [
            {
              type: 'text',
              text: 'Write at least 4000 words and begin immediately.',
            },
          ],
        });
        const cancelledEventTypesPromise = collectEventTypes(cancelledRun);
        const cancelledResultPromise = cancelledRun.result();
        assertNativeCancellation(await cancelledRun.cancel());
        const [cancelledEventTypes, cancelledResult] = await Promise.all([
          cancelledEventTypesPromise,
          cancelledResultPromise,
        ]);
        assertCancelledRun(cancelledResult);
        expect(cancelledEventTypes.at(-1)).toBe('run.cancelled');
      } finally {
        await resumed.close();
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
    assertThrowsExactMessage(() => {
      assertCompletedTextRun(
        { status: 'completed', finalMessage: 'sensitive-provider-output' },
        'HARAPTER_HERMES_LIVE_OK',
      );
    }, 'Hermes Agent did not return the expected synthetic response.');
  });
});

async function collectEventTypes(run: HarnessRun): Promise<string[]> {
  const eventTypes: string[] = [];
  for await (const event of run.events()) {
    assertToolFreeLiveEvent(event);
    eventTypes.push(event.type);
  }
  return eventTypes;
}

function assertToolFreeLiveEvent(event: { readonly type: string }): void {
  if (
    event.type.startsWith('tool.') ||
    event.type === 'interaction.requested'
  ) {
    throw new Error('The live canary observed a model-facing action.');
  }
}

function assertCompletedTextRun(result: RunResult, expected: string): void {
  if (
    result.status !== 'completed' ||
    result.finalMessage?.trim() !== expected
  ) {
    throw new Error(
      'Hermes Agent did not return the expected synthetic response.',
    );
  }
}

function assertResumedSession(expected: SessionRef, actual: SessionRef): void {
  if (actual.providerSessionId !== expected.providerSessionId) {
    throw new Error('Hermes Agent resumed a different native Session.');
  }
}

function assertNativeCancellation(result: CancelResult): void {
  if (result.mode !== 'native') {
    throw new Error('Hermes Agent did not confirm native cancellation.');
  }
}

function assertCancelledRun(result: RunResult): void {
  if (result.status !== 'cancelled') {
    throw new Error(
      'Hermes Agent did not produce a cancelled terminal result.',
    );
  }
}

function assertThrowsExactMessage(action: () => void, expected: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof Error) || thrown.message !== expected) {
    throw new Error(
      'The Hermes Agent live safety assertion was not content-free.',
    );
  }
}
