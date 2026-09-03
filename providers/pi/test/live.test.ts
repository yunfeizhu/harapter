import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  profileId,
  type HarnessEvent,
  type HarnessRun,
  type SessionRef,
} from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';

import { PI_PROVIDER_ID, createPiProviderFactory } from '../src/index.js';

const liveEnabled = process.env['HARAPTER_PI_LIVE'] === '1';
const liveCommand = process.env['HARAPTER_PI_COMMAND'];
const liveModel = process.env['HARAPTER_PI_MODEL'];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.runIf(liveEnabled)('Pi Agent live RPC', () => {
  it('completes and cancels Runs through a resumable isolated RPC Session', async () => {
    if (liveCommand === undefined || !isAbsolute(liveCommand)) {
      throw new Error('Pi live testing requires an absolute command.');
    }
    if (
      liveModel === undefined ||
      liveModel.length === 0 ||
      liveModel.length > 512 ||
      /\p{Cc}/u.test(liveModel)
    ) {
      throw new Error('Pi live testing requires a valid model identifier.');
    }
    const sessionRoot = requiredAbsoluteDirectory(
      'PI_CODING_AGENT_SESSION_DIR',
    );
    await mkdir(sessionRoot, { recursive: true });
    await assertDirectoryEmpty(sessionRoot);
    const sessionDirectory = await mkdtemp(
      join(sessionRoot, 'harapter-pi-live-'),
    );
    const workspace = await mkdtemp(join(tmpdir(), 'harapter-pi-live-'));
    temporaryDirectories.push(sessionDirectory, workspace);
    const previousSessionDirectory = process.env['PI_CODING_AGENT_SESSION_DIR'];
    process.env['PI_CODING_AGENT_SESSION_DIR'] = sessionDirectory;
    try {
      const client = await createPiProviderFactory().connect({
        profileId: profileId('pi-live'),
        providerId: PI_PROVIDER_ID,
        displayName: 'Pi Agent live runtime',
        connection: {
          kind: 'process',
          command: liveCommand,
          args: [
            '--provider',
            'harapter-live',
            '--model',
            liveModel,
            '--thinking',
            'off',
            '--no-tools',
            '--no-context-files',
          ],
          cwd: workspace,
          ownership: 'adapter',
        },
      });
      try {
        await expect(client.descriptor()).resolves.toMatchObject({
          providerId: PI_PROVIDER_ID,
          compatibility: 'experimental',
          runtime: { name: 'pi' },
        });
        const session = await client.createSession();
        const sessionRef = session.ref();
        assertPersistentSessionRef(sessionRef);
        try {
          const run = await session.start(
            {
              parts: [
                {
                  type: 'text',
                  text: 'Reply with exactly HARAPTER_PI_LIVE_OK and do not use tools.',
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
          assertExactFinalMessage(result.finalMessage, 'HARAPTER_PI_LIVE_OK');
          expect(events.map(({ type }) => type)).toContain('run.started');
          expect(events.map(({ type }) => type)).toContain('message.completed');
          expect(events.at(-1)?.type).toBe('run.completed');
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
          const cancelledEventsPromise = collectEvents(cancelledRun);
          const cancelledResultPromise = cancelledRun.result();
          await expect(cancelledRun.cancel()).resolves.toEqual({
            mode: 'native',
          });
          const [cancelledEvents, cancelledResult] = await Promise.all([
            cancelledEventsPromise,
            cancelledResultPromise,
          ]);
          expect(cancelledResult.status).toBe('cancelled');
          expect(cancelledEvents.at(-1)?.type).toBe('run.cancelled');
        } finally {
          await resumed.close();
        }
      } finally {
        await client.close();
      }
    } finally {
      if (previousSessionDirectory === undefined) {
        delete process.env['PI_CODING_AGENT_SESSION_DIR'];
      } else {
        process.env['PI_CODING_AGENT_SESSION_DIR'] = previousSessionDirectory;
      }
      await rm(sessionDirectory, { force: true, recursive: true });
      temporaryDirectories.splice(
        temporaryDirectories.indexOf(sessionDirectory),
        1,
      );
    }
    await assertDirectoryEmpty(sessionRoot);
  }, 240_000);
});

describe('Pi Agent live-canary safety guard', () => {
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

function assertToolFreeLiveEvent(event: Pick<HarnessEvent, 'type'>): void {
  if (
    event.type.startsWith('tool.') ||
    event.type === 'interaction.requested'
  ) {
    throw new Error('The live canary observed a model-facing action.');
  }
}

async function assertDirectoryEmpty(directory: string): Promise<void> {
  const entries = await readdir(directory, { recursive: true });
  if (entries.length !== 0) {
    throw new Error('The Pi live test left isolated Session state behind.');
  }
}

function assertPersistentSessionRef(ref: SessionRef): void {
  const state = ref.providerState as { readonly persisted?: unknown };
  if (state.persisted !== true || ref.providerSessionId.length === 0) {
    throw new Error('Pi did not create the expected persistent Session.');
  }
}

function assertResumedSession(expected: SessionRef, actual: SessionRef): void {
  if (actual.providerSessionId !== expected.providerSessionId) {
    throw new Error('Pi resumed a different native Session.');
  }
}

function assertExactFinalMessage(
  actual: string | undefined,
  expected: string,
): void {
  if (actual?.trim() !== expected) {
    throw new Error('Pi did not return the expected synthetic response.');
  }
}

function requiredAbsoluteDirectory(name: string): string {
  const value = process.env[name];
  if (value === undefined || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path for Pi live testing.`);
  }
  return value;
}
