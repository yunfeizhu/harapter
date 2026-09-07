import { profileId, providerId, type HarnessClient } from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEX_SESSION_EXTENSION,
  createCodexProviderFactory,
  type CodexSessions,
} from '../src/index.js';
import { createTestProfile } from './test-profile.js';

const clients: HarnessClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('Codex native Session fork', () => {
  it('forks long stored history without transferring it or aborting the Client', async () => {
    const client = await connect('fork-large-history');
    const parent = await client.createSession();
    const child = await nativeSessions(client).fork(parent.ref());
    expect(child.ref().providerSessionId).not.toBe(
      parent.ref().providerSessionId,
    );
    const run = await parent.start({
      parts: [{ type: 'text', text: 'Synthetic continued parent.' }],
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
  });

  it('returns a distinct owned child that can run and resume independently', async () => {
    const client =
      await createCodexProviderFactory().connect(createTestProfile());
    clients.push(client);
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<CodexSessions>(CODEX_SESSION_EXTENSION);
    expect(sessions).toBeDefined();
    if (sessions === undefined) throw new Error('Missing Session extension.');
    const child = await sessions.fork(parent.ref());
    expect(child.ref().providerSessionId).not.toBe(
      parent.ref().providerSessionId,
    );
    expect(child.ref()).toMatchObject({
      providerId: parent.ref().providerId,
      profileId: parent.ref().profileId,
      compatibilityRef: parent.ref().compatibilityRef,
    });
    const run = await child.start({
      parts: [{ type: 'text', text: 'Synthetic child turn.' }],
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    await child.close();
    const resumed = await client.resumeSession(child.ref());
    expect(resumed.ref()).toEqual(child.ref());
    const parentRun = await parent.start({
      parts: [{ type: 'text', text: 'Synthetic parent turn.' }],
    });
    await expect(parentRun.result()).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it.each(['fork-same-id', 'fork-wrong-parent'])(
    'quarantines an invalid fork response: %s',
    async (mode) => {
      const client = await connect(mode);
      const parent = await client.createSession();
      await expect(
        nativeSessions(client).fork(parent.ref()),
      ).rejects.toMatchObject({ code: 'provider_api_incompatible' });
      await expect(client.createSession()).rejects.toMatchObject({
        code: 'connection_aborted',
      });
    },
  );

  it('keeps a definitely rejected fork and an observed busy source recoverable', async () => {
    for (const mode of ['fork-reject', 'fork-busy']) {
      const client = await connect(mode);
      const parent = await client.createSession();
      await expect(
        nativeSessions(client).fork(parent.ref()),
      ).rejects.toMatchObject({
        code: mode === 'fork-busy' ? 'run_conflict' : 'provider_error',
      });
      const run = await parent.start({
        parts: [{ type: 'text', text: 'Synthetic continued parent.' }],
      });
      await expect(run.result()).resolves.toMatchObject({
        status: 'completed',
      });
    }
  });

  it('rejects foreign ownership, incompatible references and ephemeral sources', async () => {
    const client = await connect();
    const parent = await client.createSession();
    for (const ref of [
      { ...parent.ref(), providerId: providerId('another') },
      { ...parent.ref(), profileId: profileId('another') },
      { ...parent.ref(), compatibilityRef: 'another' },
    ])
      await expect(nativeSessions(client).fork(ref)).rejects.toBeDefined();
    const ephemeral = await client.createSession({
      providerOptions: { ephemeral: true },
    });
    await expect(
      nativeSessions(client).fork(ephemeral.ref()),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
  });

  it('excludes Run start, resume, close, and a second fork while a fork is pending', async () => {
    const client = await connect('fork-delay');
    const parent = await client.createSession();
    const pending = nativeSessions(client).fork(parent.ref());
    await expect(
      parent.start({
        parts: [{ type: 'text', text: 'Synthetic conflicting input.' }],
      }),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await expect(client.resumeSession(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(parent.close()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(
      nativeSessions(client).fork(parent.ref()),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await expect(pending).resolves.toBeDefined();
  });

  it('does not return a child handle after Client close', async () => {
    const client = await connect('fork-delay');
    const parent = await client.createSession();
    const pending = nativeSessions(client).fork(parent.ref());
    const rejected = pending.catch((error: unknown) => error);
    await client.close();
    expect(await rejected).toBeInstanceOf(Error);
  });
});

async function connect(mode?: string): Promise<HarnessClient> {
  const client = await createCodexProviderFactory().connect(
    createTestProfile(undefined, mode),
  );
  clients.push(client);
  return client;
}

function nativeSessions(client: HarnessClient): CodexSessions {
  const value = client.extensions().get<CodexSessions>(CODEX_SESSION_EXTENSION);
  expect(value).toBeDefined();
  if (value === undefined) throw new Error('Missing Session extension.');
  return value;
}
