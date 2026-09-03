import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profileId } from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import { DSH_PROVIDER_ID, createDshProviderFactory } from '../src/index.js';

const liveEnabled = process.env['HARAPTER_DSH_LIVE'] === '1';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.runIf(liveEnabled)(
  'DeepSeek Harness SDK Runtime live protocol',
  () => {
    it('completes one isolated synthetic text interval', async () => {
      const provider = requiredEnvironment('HARAPTER_DSH_PROVIDER');
      const model = requiredEnvironment('HARAPTER_DSH_MODEL');
      const workspace = await mkdtemp(join(tmpdir(), 'harapter-dsh-live-'));
      temporaryDirectories.push(workspace);
      const client = await createDshProviderFactory().connect({
        profileId: profileId('dsh-live-local'),
        providerId: DSH_PROVIDER_ID,
        displayName: 'Local DeepSeek Harness SDK Runtime',
        connection: {
          kind: 'process',
          command: process.env['HARAPTER_DSH_COMMAND'] ?? 'dsh',
          args: liveArguments(),
          cwd: workspace,
          ownership: 'adapter',
        },
        providerOptions: { provider, model },
      });
      try {
        const descriptor = await client.descriptor();
        expect(descriptor.runtime).toMatchObject({
          name: 'deepseek-harness-sdk-runtime',
        });
        expect(descriptor.runtime?.version).toBeTruthy();
        const session = await client.createSession({
          workspace: { uri: pathToFileURL(workspace).href },
        });
        const run = await session.start(
          {
            parts: [
              {
                type: 'text',
                text: 'Reply with exactly HARAPTER_DSH_LIVE_OK.',
              },
            ],
          },
          { timeoutMs: 120_000 },
        );
        for await (const event of run.events()) {
          assertToolFreeLiveEvent(event);
        }
        await expect(run.result()).resolves.toMatchObject({
          status: 'completed',
        });
        await session.close();
      } finally {
        await client.close();
      }
    }, 150_000);
  },
);

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required when the DSH live test is enabled.`);
  }
  return value;
}

function liveArguments(): readonly string[] {
  const encoded = process.env['HARAPTER_DSH_ARGS_JSON'];
  if (encoded === undefined) return ['--profile', 'sdk'];
  const value: unknown = JSON.parse(encoded);
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Error('HARAPTER_DSH_ARGS_JSON must encode a string array.');
  }
  return value;
}

describe('DSH live-canary safety guard', () => {
  it('rejects model-facing actions without exposing event data', () => {
    expect(() => {
      assertToolFreeLiveEvent({ type: 'tool.updated' });
    }).toThrow('The live canary observed a model-facing action.');
    expect(() => {
      assertToolFreeLiveEvent({ type: 'interaction.requested' });
    }).toThrow('The live canary observed a model-facing action.');
    expect(() => {
      assertToolFreeLiveEvent({ type: 'message.delta' });
    }).not.toThrow();
  });
});

function assertToolFreeLiveEvent(event: { readonly type: string }): void {
  if (
    event.type.startsWith('tool.') ||
    event.type === 'interaction.requested'
  ) {
    throw new Error('The live canary observed a model-facing action.');
  }
}
