import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { createOpenClawProviderFactory } from '../src/index.js';
import { createTestProfile } from './test-profile.js';

const liveEnabled = process.env['HARAPTER_OPENCLAW_LIVE'] === '1';

describe.skipIf(!liveEnabled)('OpenClaw live ACP bridge', () => {
  it('connects to a host-installed authenticated isolated bridge', async () => {
    const command = process.env['HARAPTER_OPENCLAW_COMMAND'] ?? 'openclaw';
    const version = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      shell: false,
    });
    expect(version.status).toBe(0);

    const profile = createTestProfile();
    const client = await createOpenClawProviderFactory().connect({
      ...profile,
      connection: {
        kind: 'process',
        command,
        args: ['acp'],
        ownership: 'adapter',
      },
    });
    try {
      await expect(client.descriptor()).resolves.toMatchObject({
        runtime: { name: 'openclaw-acp', protocolVersion: '1' },
      });
      const session = await client.createSession();
      await session.close();
    } finally {
      await client.close();
    }
  });
});
