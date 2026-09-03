import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  profileId,
  type CancelResult,
  type ClientDescriptor,
  type HarnessRun,
  type RunResult,
  type SessionRef,
} from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CODEX_PROVIDER_ID, createCodexProviderFactory } from '../src/index.js';

const liveEnabled = process.env['HARAPTER_CODEX_LIVE'] === '1';
const liveCommand = process.env['HARAPTER_CODEX_COMMAND'];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.runIf(liveEnabled)('Codex App Server live runtime', () => {
  it('completes and cancels Turns through a resumable read-only Thread', async () => {
    if (liveCommand === undefined || !isAbsolute(liveCommand)) {
      throw new Error('Codex live testing requires an absolute command.');
    }
    const workspace = await mkdtemp(join(tmpdir(), 'harapter-codex-live-'));
    temporaryDirectories.push(workspace);
    const client = await createCodexProviderFactory().connect({
      profileId: profileId('codex-live-local'),
      providerId: CODEX_PROVIDER_ID,
      displayName: 'Local Codex App Server',
      connection: {
        kind: 'process',
        command: liveCommand,
        args: ['app-server', '--stdio'],
        ownership: 'adapter',
      },
    });
    let primaryFailure: unknown;
    try {
      assertSupportedDescriptor(await client.descriptor());
      const session = await client.createSession({
        workspace: { uri: pathToFileURL(workspace).href },
        providerOptions: {
          approvalPolicy: 'never',
          ephemeral: false,
          sandbox: 'read-only',
        },
      });
      const sessionRef = session.ref();
      assertOwnedSessionRef(sessionRef);
      const run = await session.start({
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_CODEX_LIVE_OK and do not use tools.',
          },
        ],
      });
      const [eventTypes, result] = await Promise.all([
        collectEventTypes(run),
        run.result(),
      ]);
      assertCompletedTextRun(result, 'HARAPTER_CODEX_LIVE_OK');
      expect(eventTypes).toContain('run.started');
      expect(eventTypes).toContain('message.completed');
      expect(eventTypes.at(-1)).toBe('run.completed');
      await session.close();

      const resumed = await client.resumeSession(sessionRef);
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
        await client.close();
      } else {
        await client.close().catch(() => undefined);
      }
    }
  }, 240_000);
});

describe('Codex live-canary safety guard', () => {
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
        'HARAPTER_CODEX_LIVE_OK',
      );
    }, 'Codex did not return the expected synthetic response.');
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
    descriptor.providerId !== CODEX_PROVIDER_ID ||
    descriptor.runtime?.name !== 'Codex App Server' ||
    descriptor.runtime.protocolVersion !== 'stable' ||
    descriptor.runtime.version === undefined ||
    !/^\d+\.\d+\.\d+/u.test(descriptor.runtime.version)
  ) {
    throw new Error('Codex did not negotiate the supported stable App Server.');
  }
}

function assertOwnedSessionRef(ref: SessionRef): void {
  if (
    ref.providerId !== CODEX_PROVIDER_ID ||
    ref.profileId !== profileId('codex-live-local') ||
    ref.providerSessionId.length === 0 ||
    (ref.providerState as { readonly ephemeral?: unknown } | undefined)
      ?.ephemeral === true
  ) {
    throw new Error('Codex did not create the expected resumable Thread.');
  }
}

function assertCompletedTextRun(result: RunResult, expected: string): void {
  if (
    result.status !== 'completed' ||
    result.finalMessage?.trim() !== expected
  ) {
    throw new Error('Codex did not return the expected synthetic response.');
  }
}

function assertResumedSession(expected: SessionRef, actual: SessionRef): void {
  if (
    actual.providerId !== expected.providerId ||
    actual.profileId !== expected.profileId ||
    actual.providerSessionId !== expected.providerSessionId ||
    actual.compatibilityRef !== expected.compatibilityRef
  ) {
    throw new Error('Codex resumed a different native Thread.');
  }
}

function assertNativeCancellation(result: CancelResult): void {
  if (result.mode !== 'native') {
    throw new Error('Codex did not confirm native cancellation.');
  }
}

function assertCancelledRun(result: RunResult): void {
  if (result.status !== 'cancelled') {
    throw new Error('Codex did not produce a cancelled terminal result.');
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
    throw new Error('The Codex live safety assertion was not content-free.');
  }
}
