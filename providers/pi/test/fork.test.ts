import {
  profileId,
  providerId,
  type HarnessSession,
  type SessionRef,
} from '@harapter/core';
import { expect, it } from 'vitest';
import { createPiProviderFactory } from '../src/index.js';
import { createTestProfile } from './test-profile.js';

it('forks a persisted Pi branch in a separate process without rebinding the parent', async () => {
  const client = await createPiProviderFactory().connect(createTestProfile());
  try {
    const parent = await client.createSession();
    const parentRef = parent.ref();
    const run = await parent.start({
      parts: [{ type: 'text', text: 'Synthetic parent input.' }],
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    const sessions = client
      .extensions()
      .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
        'pi.agent.sessions',
      );
    expect(sessions).toBeDefined();
    if (sessions === undefined) throw new Error('Missing Session extension.');
    const child = await sessions.fork(parentRef);
    expect(parent.ref()).toEqual(parentRef);
    expect(child.ref().providerSessionId).not.toBe(parentRef.providerSessionId);
    const childRun = await child.start({
      parts: [{ type: 'text', text: 'Synthetic child input.' }],
    });
    await expect(childRun.result()).resolves.toMatchObject({
      status: 'completed',
    });
    await child.close();
    const resumed = await client.resumeSession(child.ref());
    expect(resumed.ref()).toEqual(child.ref());
  } finally {
    await client.close();
  }
});

it.each([
  'clone-reject',
  'clone-cancel',
  'clone-malformed',
  'clone-same-id',
  'clone-busy',
])(
  'contains a failed child startup without changing its parent: %s',
  async (mode) => {
    const client = await createPiProviderFactory().connect(
      createTestProfile(undefined, mode),
    );
    try {
      const parent = await client.createSession();
      const ref = parent.ref();
      const sessions = client
        .extensions()
        .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
          'pi.agent.sessions',
        );
      if (sessions === undefined) throw new Error('Missing Session extension.');
      await expect(sessions.fork(ref)).rejects.toBeDefined();
      expect(parent.ref()).toEqual(ref);
      const run = await parent.start({
        parts: [{ type: 'text', text: 'Synthetic retained parent.' }],
      });
      await expect(run.result()).resolves.toMatchObject({
        status: 'completed',
      });
    } finally {
      await client.close();
    }
  },
);

it('excludes concurrent operations and aborts child startup when closing', async () => {
  const client = await createPiProviderFactory().connect(
    createTestProfile(undefined, 'clone-hold'),
  );
  try {
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
        'pi.agent.sessions',
      );
    if (sessions === undefined) throw new Error('Missing Session extension.');
    const pending = sessions.fork(parent.ref());
    const rejected = pending.catch((error: unknown) => error);
    await expect(sessions.fork(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(
      parent.start({ parts: [{ type: 'text', text: 'Synthetic conflict.' }] }),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await expect(parent.close()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(client.resumeSession(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await client.close();
    expect(await rejected).toBeInstanceOf(Error);
  } finally {
    await client.close();
  }
});

it('rejects foreign and non-persistent references before starting a child', async () => {
  const client = await createPiProviderFactory().connect(createTestProfile());
  try {
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
        'pi.agent.sessions',
      );
    if (sessions === undefined) throw new Error('Missing Session extension.');
    for (const ref of [
      { ...parent.ref(), providerId: providerId('another') },
      { ...parent.ref(), profileId: profileId('another') },
      { ...parent.ref(), compatibilityRef: 'another' },
      {
        ...parent.ref(),
        providerState: {
          ...(parent.ref().providerState as Record<string, unknown>),
          persisted: false,
        },
      },
    ])
      await expect(sessions.fork(ref)).rejects.toBeDefined();
  } finally {
    await client.close();
  }
});
