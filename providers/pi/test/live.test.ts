import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { profileId } from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';

import { PI_PROVIDER_ID, createPiProviderFactory } from '../src/index.js';

const liveEnabled = process.env['HARAPTER_PI_LIVE'] === '1';
const liveCommand = process.env['HARAPTER_PI_COMMAND'];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.runIf(liveEnabled)('Pi Agent live RPC', () => {
  it('probes and opens an isolated host-supplied RPC Session', async () => {
    if (liveCommand === undefined) throw new Error('Missing Pi command.');
    const sessionDirectory = requiredAbsoluteDirectory(
      'PI_CODING_AGENT_SESSION_DIR',
    );
    await mkdir(sessionDirectory, { recursive: true });
    await expect(
      readdir(sessionDirectory, { recursive: true }),
    ).resolves.toEqual([]);
    const workspace = await mkdtemp(join(tmpdir(), 'harapter-pi-live-'));
    temporaryDirectories.push(workspace);
    const client = await createPiProviderFactory().connect({
      profileId: profileId('pi-live'),
      providerId: PI_PROVIDER_ID,
      displayName: 'Pi Agent live runtime',
      connection: {
        kind: 'process',
        command: liveCommand,
        cwd: workspace,
        ownership: 'adapter',
      },
      providerOptions: { persistSessions: false },
    });
    try {
      await expect(client.descriptor()).resolves.toMatchObject({
        providerId: PI_PROVIDER_ID,
        compatibility: 'experimental',
        runtime: { name: 'pi' },
      });
      const session = await client.createSession();
      expect(session.ref()).toMatchObject({
        providerState: { persisted: false },
      });
      expect(session.ref().providerSessionId.length).toBeGreaterThan(0);
      await session.close();
    } finally {
      await client.close();
    }
    await expect(
      readdir(sessionDirectory, { recursive: true }),
    ).resolves.toEqual([]);
  });
});

function requiredAbsoluteDirectory(name: string): string {
  const value = process.env[name];
  if (value === undefined || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path for Pi live testing.`);
  }
  return value;
}
