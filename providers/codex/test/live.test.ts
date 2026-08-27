import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profileId } from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import { CODEX_PROVIDER_ID, createCodexProviderFactory } from '../src/index.js';

const liveEnabled = process.env['HARAPTER_CODEX_LIVE'] === '1';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.runIf(liveEnabled)('Codex App Server live runtime', () => {
  it('completes a synthetic read-only ephemeral turn', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'harapter-codex-live-'));
    temporaryDirectories.push(workspace);
    const client = await createCodexProviderFactory().connect({
      profileId: profileId('codex-live-local'),
      providerId: CODEX_PROVIDER_ID,
      displayName: 'Local Codex App Server',
      connection: {
        kind: 'process',
        command: process.env['HARAPTER_CODEX_COMMAND'] ?? 'codex',
        args: ['app-server', '--stdio'],
        ownership: 'adapter',
      },
    });
    try {
      const descriptor = await client.descriptor();
      expect(descriptor.runtime?.version).toMatch(/^\d+\.\d+\.\d+/u);
      const session = await client.createSession({
        workspace: { uri: pathToFileURL(workspace).href },
        providerOptions: {
          approvalPolicy: 'never',
          ephemeral: true,
          sandbox: 'read-only',
        },
      });
      const run = await session.start({
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_CODEX_LIVE_OK and do not use tools.',
          },
        ],
      });
      for await (const _event of run.events()) {
        // Drain without logging Provider traffic.
      }
      await expect(run.result()).resolves.toMatchObject({
        status: 'completed',
      });
      await session.close();
    } finally {
      await client.close();
    }
  }, 120_000);
});
