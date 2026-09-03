import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { profileId } from '@harapter/core';
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
  it('probes and opens an isolated host-supplied Gateway Session', async () => {
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
        args: ['acp'],
        cwd: workspace,
        ownership: 'adapter',
      },
    });
    try {
      await expect(client.descriptor()).resolves.toMatchObject({
        compatibility: 'experimental',
        providerId: OPENCLAW_PROVIDER_ID,
        runtime: { name: 'openclaw-acp', protocolVersion: '1' },
      });
      const session = await client.createSession();
      expect(session.ref()).toMatchObject({
        profileId: profileId('openclaw-live'),
        providerId: OPENCLAW_PROVIDER_ID,
      });
      expect(session.ref().providerSessionId.length).toBeGreaterThan(0);
      await session.close();
    } finally {
      await client.close();
    }
  });
});
