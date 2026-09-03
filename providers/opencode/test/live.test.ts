import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  profileId,
  type CancelResult,
  type ClientDescriptor,
  type HarnessProfile,
  type HarnessRun,
  type RunResult,
  type SessionRef,
} from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from '../src/index.js';

const liveEnabled = process.env['HARAPTER_OPENCODE_LIVE'] === '1';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.runIf(liveEnabled)('OpenCode Server live runtime', () => {
  it('completes and cancels Runs through a resumable Session', async () => {
    const endpoint = requiredEnvironment('HARAPTER_OPENCODE_ENDPOINT');
    const providerId = requiredEnvironment('HARAPTER_OPENCODE_MODEL_PROVIDER');
    const modelId = requiredEnvironment('HARAPTER_OPENCODE_MODEL');
    const workspace = await mkdtemp(join(tmpdir(), 'harapter-opencode-live-'));
    temporaryDirectories.push(workspace);
    const factory = createOpenCodeProviderFactory();
    const profile: HarnessProfile = {
      profileId: profileId('opencode-live-local'),
      providerId: OPENCODE_PROVIDER_ID,
      displayName: 'Local OpenCode Server',
      connection: {
        kind: 'endpoint',
        url: endpoint,
        transport: 'http',
        ownership: 'external',
      },
      providerOptions: {
        cancelSettlementTimeoutMs: 30_000,
        runRequestTimeoutMs: 180_000,
      },
    };
    const sessionRef = await (async (): Promise<SessionRef> => {
      const client = await factory.connect(profile);
      let primaryFailure: unknown;
      try {
        assertSupportedDescriptor(await client.descriptor());
        const session = await client.createSession({
          workspace: { uri: pathToFileURL(workspace).href },
          model: {
            id: modelId,
            providerOptions: { providerId },
          },
        });
        const ref = session.ref();
        assertOwnedSessionRef(ref);
        const run = await session.start(
          {
            parts: [
              {
                type: 'text',
                text: 'Reply with exactly HARAPTER_OPENCODE_LIVE_OK and do not use tools.',
              },
            ],
          },
          { timeoutMs: 180_000 },
        );
        const [eventTypes, result] = await Promise.all([
          collectEventTypes(run),
          run.result(),
        ]);
        assertCompletedTextRun(result, 'HARAPTER_OPENCODE_LIVE_OK');
        expect(eventTypes).toContain('run.started');
        expect(eventTypes).toContain('message.completed');
        expect(eventTypes.at(-1)).toBe('run.completed');
        await session.close();
        return ref;
      } catch (error) {
        primaryFailure = error;
        throw error;
      } finally {
        if (primaryFailure === undefined) {
          await client.close();
        } else {
          await client.close().catch(() => undefined);
        }
      }
    })();

    const resumedClient = await factory.connect(profile);
    let primaryFailure: unknown;
    try {
      const resumed = await resumedClient.resumeSession(sessionRef);
      assertResumedSession(sessionRef, resumed.ref());
      const cancelledRun = await resumed.start({
        parts: [
          {
            type: 'text',
            text: 'Write at least 4000 words and begin immediately. Do not use tools.',
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
      expect(cancelledEventTypes).toContain('run.started');
      expect(cancelledEventTypes.at(-1)).toBe('run.cancelled');
      await resumed.close();
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      if (primaryFailure === undefined) {
        await resumedClient.close();
      } else {
        await resumedClient.close().catch(() => undefined);
      }
    }
  }, 240_000);
});

describe('OpenCode live-canary safety guard', () => {
  it('rejects model-facing actions without exposing event data', () => {
    expect(() => {
      assertToolFreeLiveEvent({ type: 'tool.completed' });
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
        'HARAPTER_OPENCODE_LIVE_OK',
      );
    }, 'OpenCode did not return the expected synthetic response.');
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

function assertSupportedDescriptor(descriptor: ClientDescriptor): void {
  if (
    descriptor.compatibility !== 'supported' ||
    descriptor.providerId !== OPENCODE_PROVIDER_ID ||
    descriptor.runtime?.name !== 'OpenCode Server' ||
    descriptor.runtime.protocolVersion !== 'stable' ||
    descriptor.runtime.version === undefined ||
    !/^\d+\.\d+\.\d+/u.test(descriptor.runtime.version)
  ) {
    throw new Error('OpenCode did not expose the supported stable interface.');
  }
}

function assertOwnedSessionRef(ref: SessionRef): void {
  if (
    ref.providerId !== OPENCODE_PROVIDER_ID ||
    ref.profileId !== profileId('opencode-live-local') ||
    ref.providerSessionId.length === 0 ||
    ref.compatibilityRef !== 'opencode;http-openapi=stable'
  ) {
    throw new Error('OpenCode did not create the expected owned Session.');
  }
}

function assertCompletedTextRun(result: RunResult, expected: string): void {
  if (
    result.status !== 'completed' ||
    result.finalMessage?.trim() !== expected
  ) {
    throw new Error('OpenCode did not return the expected synthetic response.');
  }
}

function assertResumedSession(expected: SessionRef, actual: SessionRef): void {
  if (
    actual.providerId !== expected.providerId ||
    actual.profileId !== expected.profileId ||
    actual.providerSessionId !== expected.providerSessionId ||
    actual.compatibilityRef !== expected.compatibilityRef
  ) {
    throw new Error('OpenCode resumed a different native Session.');
  }
}

function assertNativeCancellation(result: CancelResult): void {
  if (result.mode !== 'native') {
    throw new Error('OpenCode did not confirm native cancellation.');
  }
}

function assertCancelledRun(result: RunResult): void {
  if (result.status !== 'cancelled') {
    throw new Error('OpenCode did not produce a cancelled terminal result.');
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
    throw new Error('The OpenCode live safety assertion was not content-free.');
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`The ${name} live-test setting is required.`);
  }
  return value;
}
