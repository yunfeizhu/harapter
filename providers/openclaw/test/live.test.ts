import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { profileId, type HarnessEvent, type HarnessRun } from '@harapter/core';
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
  it('completes a synthetic text Run through an isolated host-supplied Gateway', async () => {
    if (liveCommand === undefined || !isAbsolute(liveCommand)) {
      throw new Error('OpenClaw live testing requires an absolute command.');
    }
    const version = spawnSync(liveCommand, ['--version'], {
      encoding: 'utf8',
      killSignal: 'SIGKILL',
      shell: false,
      timeout: 10_000,
    });
    expect(version.status).toBe(0);

    const workspace = await mkdtemp(join(tmpdir(), 'harapter-openclaw-live-'));
    temporaryDirectories.push(workspace);
    const client = await createOpenClawProviderFactory().connect({
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
    });
    try {
      await expect(client.descriptor()).resolves.toMatchObject({
        compatibility: 'supported',
        providerId: OPENCLAW_PROVIDER_ID,
        runtime: { name: 'openclaw-acp', protocolVersion: '1' },
      });
      const session = await client.createSession();
      try {
        expect(session.ref()).toMatchObject({
          profileId: profileId('openclaw-live'),
          providerId: OPENCLAW_PROVIDER_ID,
        });
        expect(session.ref().providerSessionId.length).toBeGreaterThan(0);
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
        const [events, result] = await Promise.all([
          collectEvents(run),
          run.result(),
        ]);
        expect(result.status).toBe('completed');
        expect(result.finalMessage?.trim()).toBe('HARAPTER_OPENCLAW_LIVE_OK');
        expect(events.map(({ type }) => type)).toContain('run.started');
        expect(events.map(({ type }) => type)).toContain('message.completed');
        expect(events.at(-1)?.type).toBe('run.completed');
      } finally {
        await session.close();
      }
    } finally {
      await client.close();
    }
  }, 210_000);
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
