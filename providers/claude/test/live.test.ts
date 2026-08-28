import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profileId } from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_PROVIDER_ID,
  createClaudeProviderFactory,
} from '../src/index.js';

const liveEnabled =
  process.env['HARAPTER_CLAUDE_LIVE'] === '1' &&
  process.env['ANTHROPIC_API_KEY'] !== undefined;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.runIf(liveEnabled)('Claude Agent SDK live runtime', () => {
  it('completes a synthetic no-tool turn with API-key authentication', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'harapter-claude-live-'));
    temporaryDirectories.push(workspace);
    const client = await createClaudeProviderFactory().connect({
      profileId: profileId('claude-live-local'),
      providerId: CLAUDE_PROVIDER_ID,
      displayName: 'Local Claude Agent SDK',
      connection: { kind: 'sdk', ownership: 'adapter' },
    });
    try {
      const session = await client.createSession({
        workspace: { uri: pathToFileURL(workspace).href },
        providerOptions: { allowedTools: [], permissionMode: 'dontAsk' },
      });
      const run = await session.start({
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_CLAUDE_LIVE_OK and do not use tools.',
          },
        ],
      });
      for await (const _event of run.events()) {
        // Drain without logging Provider traffic.
      }
      await expect(run.result()).resolves.toMatchObject({
        status: 'completed',
      });
      await expect(client.descriptor()).resolves.not.toHaveProperty('warnings');
      await session.close();
    } finally {
      await client.close();
    }
  }, 120_000);
});
