import {
  profileId,
  providerId,
  type HarnessSession,
  type SessionRef,
} from '@harapter/core';
import { expect, it } from 'vitest';
import { createOpenCodeProviderFactory } from '../src/index.js';
import {
  startOpenCodeFixtureServer,
  type OpenCodeFixtureServerOptions,
} from './fixture-server.js';

it('forks an idle OpenCode Session while retaining its directory and model defaults', async () => {
  const server = await startOpenCodeFixtureServer();
  const client = await createOpenCodeProviderFactory().connect({
    providerId: providerId('opencode'),
    profileId: profileId('fork-fixture'),
    displayName: 'Synthetic OpenCode',
    connection: { kind: 'endpoint', url: server.url, ownership: 'external' },
  });
  try {
    const parent = await client.createSession({
      workspace: { uri: 'file:///synthetic-workspace' },
      model: {
        id: 'synthetic-model',
        providerOptions: { providerId: 'synthetic-provider' },
      },
    });
    const sessions = client
      .extensions()
      .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
        'opencode.sessions',
      );
    expect(sessions).toBeDefined();
    if (sessions === undefined) throw new Error('Missing Session extension.');
    const child = await sessions.fork(parent.ref());
    expect(child.ref().providerSessionId).not.toBe(
      parent.ref().providerSessionId,
    );
    expect(child.ref().providerState).toEqual(parent.ref().providerState);
    const run = await child.start({
      parts: [{ type: 'text', text: 'Synthetic child input.' }],
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    await child.close();
    const resumed = await client.resumeSession(child.ref());
    expect(resumed.ref()).toEqual(child.ref());
  } finally {
    await client.close();
    await server.close();
  }
});

it.each<OpenCodeFixtureServerOptions>([
  {
    sourcePatch: {
      permission: [{ permission: '*', pattern: '*', action: 'deny' }],
    },
  },
  { sourcePatch: { revert: {} } },
  { resumeMismatch: true },
  { sessionStatus: 'busy' },
  { forkBody: {} },
  { forkStatus: 403 },
  { forkStatus: 500 },
])('fails closed for an unsafe source or fork receipt %j', async (options) => {
  const server = await startOpenCodeFixtureServer(options);
  const client = await createOpenCodeProviderFactory().connect({
    providerId: providerId('opencode'),
    profileId: profileId('fork-fixture'),
    displayName: 'Synthetic',
    connection: { kind: 'endpoint', url: server.url, ownership: 'external' },
  });
  try {
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
        'opencode.sessions',
      );
    if (sessions === undefined) throw new Error('Missing Session extension.');
    await expect(sessions.fork(parent.ref())).rejects.toBeDefined();
    const outcome = await client.resumeSession(parent.ref()).then(
      () => 'resumed',
      (error: unknown) =>
        error instanceof Error && 'code' in error ? error.code : 'unknown',
    );
    const expected =
      options.forkBody !== undefined || options.forkStatus === 500
        ? 'connection_aborted'
        : options.resumeMismatch === true
          ? 'session_provider_mismatch'
          : options.sessionStatus === 'busy'
            ? 'connection_aborted'
            : 'resumed';
    expect(outcome).toBe(expected);
  } finally {
    await client.close();
    await server.close();
  }
});

it('holds the source reservation throughout a fork and disposes pending requests', async () => {
  const server = await startOpenCodeFixtureServer({ forkDelayMs: 100 });
  const client = await createOpenCodeProviderFactory().connect({
    providerId: providerId('opencode'),
    profileId: profileId('fork-fixture'),
    displayName: 'Synthetic',
    connection: { kind: 'endpoint', url: server.url, ownership: 'external' },
  });
  try {
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
        'opencode.sessions',
      );
    if (sessions === undefined) throw new Error('Missing Session extension.');
    for (const ref of [
      { ...parent.ref(), profileId: profileId('another') },
      { ...parent.ref(), providerId: providerId('another') },
      { ...parent.ref(), compatibilityRef: 'another' },
    ])
      await expect(sessions.fork(ref)).rejects.toBeDefined();
    const pending = sessions.fork(parent.ref());
    const rejected = pending.catch((error: unknown) => error);
    await expect(sessions.fork(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(client.resumeSession(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(
      parent.start({ parts: [{ type: 'text', text: 'Synthetic conflict.' }] }),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await client.close();
    expect(await rejected).toBeInstanceOf(Error);
  } finally {
    await client.close();
    await server.close();
  }
});
