import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profileId } from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from '../src/index.js';

const liveEnabled = process.env['HARAPTER_OPENCODE_LIVE'] === '1';
const liveControlEnabled =
  liveEnabled && process.env['HARAPTER_OPENCODE_LIVE_CONTROL'] === '1';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe.runIf(liveEnabled)('OpenCode Server live runtime', () => {
  it('completes a synthetic prompt through a host-operated endpoint', async () => {
    const endpoint = requiredEnvironment('HARAPTER_OPENCODE_ENDPOINT');
    const providerId = requiredEnvironment('HARAPTER_OPENCODE_MODEL_PROVIDER');
    const modelId = requiredEnvironment('HARAPTER_OPENCODE_MODEL');
    const workspace = await mkdtemp(join(tmpdir(), 'harapter-opencode-live-'));
    temporaryDirectories.push(workspace);
    const client = await createOpenCodeProviderFactory().connect({
      profileId: profileId('opencode-live-local'),
      providerId: OPENCODE_PROVIDER_ID,
      displayName: 'Local OpenCode Server',
      connection: {
        kind: 'endpoint',
        url: endpoint,
        transport: 'http',
        ownership: 'external',
      },
      providerOptions: { runRequestTimeoutMs: 120_000 },
    });
    try {
      const descriptor = await client.descriptor();
      expect(descriptor.runtime?.version).toMatch(/^\d+\.\d+\.\d+/u);
      const session = await client.createSession({
        workspace: { uri: pathToFileURL(workspace).href },
        model: {
          id: modelId,
          providerOptions: { providerId },
        },
      });
      const run = await session.start({
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_OPENCODE_LIVE_OK and do not use tools.',
          },
        ],
      });
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
});

describe.runIf(liveControlEnabled)('OpenCode Server live control plane', () => {
  it('proves native abort with an authoritative cancelled result', async () => {
    const workspace = await liveWorkspace();
    const client = await liveClient();
    try {
      const session = await liveSession(client, workspace);
      const run = await session.start({
        parts: [
          {
            type: 'text',
            text: 'HARAPTER_OPENCODE_WAIT_FOR_ABORT',
          },
        ],
      });
      await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
      await expect(run.result()).resolves.toMatchObject({
        status: 'cancelled',
      });
      await session.close();
    } finally {
      await client.close();
    }
  }, 150_000);

  it('proves a documented permission request and denial round trip', async () => {
    const workspace = await liveWorkspace();
    const client = await liveClient();
    try {
      const session = await liveSession(client, workspace);
      const run = await session.start({
        parts: [
          {
            type: 'text',
            text: 'HARAPTER_OPENCODE_REQUEST_PERMISSION',
          },
        ],
      });
      let interactionObserved = false;
      const observedTypes: string[] = [];
      for await (const event of run.events()) {
        observedTypes.push(
          event.providerEventType === undefined
            ? event.type
            : `${event.type}:${event.providerEventType}`,
        );
        if (event.type !== 'interaction.requested') continue;
        const requestId = interactionRequestId(event.data);
        interactionObserved = true;
        await session.respond(requestId, {
          kind: 'approval',
          decision: 'deny',
        });
      }
      expect(observedTypes).toContain('interaction.requested');
      expect(interactionObserved).toBe(true);
      await expect(run.result()).resolves.toMatchObject({
        status: 'completed',
      });
      await session.close();
    } finally {
      await client.close();
    }
  }, 150_000);
});

async function liveWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'harapter-opencode-live-'));
  temporaryDirectories.push(workspace);
  return workspace;
}

async function liveClient() {
  return createOpenCodeProviderFactory().connect({
    profileId: profileId('opencode-live-control'),
    providerId: OPENCODE_PROVIDER_ID,
    displayName: 'Local OpenCode Server',
    connection: {
      kind: 'endpoint',
      url: requiredEnvironment('HARAPTER_OPENCODE_ENDPOINT'),
      transport: 'http',
      ownership: 'external',
    },
    providerOptions: { runRequestTimeoutMs: 120_000 },
  });
}

async function liveSession(
  client: Awaited<ReturnType<typeof liveClient>>,
  workspace: string,
) {
  return client.createSession({
    workspace: { uri: pathToFileURL(workspace).href },
    model: {
      id: requiredEnvironment('HARAPTER_OPENCODE_MODEL'),
      providerOptions: {
        providerId: requiredEnvironment('HARAPTER_OPENCODE_MODEL_PROVIDER'),
      },
    },
  });
}

function interactionRequestId(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('OpenCode interaction data is invalid.');
  }
  const requestId = (value as Record<string, unknown>)['requestId'];
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new Error('OpenCode interaction requestId is missing.');
  }
  return requestId;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`The ${name} live-test setting is required.`);
  }
  return value;
}

describe('OpenCode live-canary safety guard', () => {
  it('rejects model-facing actions without exposing event data', () => {
    expect(() => {
      assertToolFreeLiveEvent({ type: 'tool.completed' });
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
