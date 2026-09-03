import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

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
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from '../src/index.js';

const liveEnabled = process.env['HARAPTER_OPENCLAW_LIVE'] === '1';
const liveCommand = process.env['HARAPTER_OPENCLAW_COMMAND'];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.runIf(liveEnabled)('OpenClaw live ACP bridge', () => {
  it('completes and cancels Runs through a resumable isolated Gateway Session', async () => {
    if (liveCommand === undefined || !isAbsolute(liveCommand)) {
      throw new Error('OpenClaw live testing requires an absolute command.');
    }
    const version = spawnSync(liveCommand, ['--version'], {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      shell: false,
      timeout: 10_000,
    });
    assertSuccessfulVersionProbe(version.status);

    const workspace = await mkdtemp(join(tmpdir(), 'harapter-openclaw-live-'));
    temporaryDirectories.push(workspace);
    const factory = createOpenClawProviderFactory();
    const profile: HarnessProfile = {
      profileId: profileId('openclaw-live'),
      providerId: OPENCLAW_PROVIDER_ID,
      displayName: 'OpenClaw live ACP bridge',
      connection: {
        kind: 'process',
        command: liveCommand,
        args: ['acp', '--no-prefix-cwd'],
        cwd: workspace,
        ownership: 'adapter',
      },
    };

    const sessionRef = await (async (): Promise<SessionRef> => {
      const client = await factory.connect(profile);
      try {
        assertSupportedDescriptor(await client.descriptor());
        const session = await client.createSession();
        const ref = session.ref();
        assertOwnedSessionRef(ref);
        const run = await session.start(
          {
            parts: [
              {
                type: 'text',
                text: 'Reply with exactly HARAPTER_OPENCLAW_LIVE_OK and do not use tools.',
              },
            ],
          },
          { timeoutMs: 180_000 },
        );
        const [eventTypes, result] = await Promise.all([
          collectEventTypes(run),
          run.result(),
        ]);
        assertCompletedTextRun(result, 'HARAPTER_OPENCLAW_LIVE_OK');
        expect(eventTypes).toContain('run.started');
        expect(eventTypes).toContain('message.completed');
        expect(eventTypes.at(-1)).toBe('run.completed');
        return ref;
      } finally {
        await client.close();
      }
    })();

    const resumedClient = await factory.connect(profile);
    try {
      const resumed = await resumedClient.resumeSession(sessionRef);
      try {
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
      } finally {
        await resumed.close();
      }
    } finally {
      await resumedClient.close();
    }
  }, 240_000);
});

describe('OpenClaw live-canary safety guard', () => {
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
        'HARAPTER_OPENCLAW_LIVE_OK',
      );
    }, 'OpenClaw did not return the expected synthetic response.');
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

function assertSuccessfulVersionProbe(status: number | null): void {
  if (status !== 0) {
    throw new Error('The OpenClaw version probe failed.');
  }
}

function assertSupportedDescriptor(descriptor: ClientDescriptor): void {
  if (
    descriptor.compatibility !== 'supported' ||
    descriptor.providerId !== OPENCLAW_PROVIDER_ID ||
    descriptor.runtime?.name !== 'openclaw-acp' ||
    descriptor.runtime.protocolVersion !== '1'
  ) {
    throw new Error('OpenClaw did not negotiate the supported ACP v1 profile.');
  }
}

function assertOwnedSessionRef(ref: SessionRef): void {
  if (
    ref.providerId !== OPENCLAW_PROVIDER_ID ||
    ref.profileId !== profileId('openclaw-live') ||
    ref.providerSessionId.length === 0
  ) {
    throw new Error('OpenClaw did not create the expected owned Session.');
  }
}

function assertCompletedTextRun(result: RunResult, expected: string): void {
  if (
    result.status !== 'completed' ||
    result.finalMessage?.trim() !== expected
  ) {
    throw new Error('OpenClaw did not return the expected synthetic response.');
  }
}

function assertResumedSession(expected: SessionRef, actual: SessionRef): void {
  if (
    actual.providerId !== expected.providerId ||
    actual.profileId !== expected.profileId ||
    actual.providerSessionId !== expected.providerSessionId ||
    actual.compatibilityRef !== expected.compatibilityRef
  ) {
    throw new Error('OpenClaw resumed a different native Session.');
  }
}

function assertNativeCancellation(result: CancelResult): void {
  if (result.mode !== 'native') {
    throw new Error('OpenClaw did not confirm native cancellation.');
  }
}

function assertCancelledRun(result: RunResult): void {
  if (result.status !== 'cancelled') {
    throw new Error('OpenClaw did not produce a cancelled terminal result.');
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
    throw new Error('The OpenClaw live safety assertion was not content-free.');
  }
}
