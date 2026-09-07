import {
  profileId,
  providerId,
  type HarnessSession,
  type SessionRef,
} from '@harapter/core';
import { expect, it } from 'vitest';
import {
  HermesFixtureApi,
  createHermesFixtureFactory,
  createHermesProfile,
} from './test-profile.js';

it('branches a Hermes Session into an owned child and retires the local parent', async () => {
  const api = new HermesFixtureApi();
  const client = await createHermesFixtureFactory(api).connect(
    createHermesProfile(),
  );
  try {
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<{ branch(ref: SessionRef): Promise<HarnessSession> }>(
        'nous.hermes-agent.sessions',
      );
    expect(sessions).toBeDefined();
    if (sessions === undefined) throw new Error('Missing Session extension.');
    const child = await sessions.branch(parent.ref());
    expect(child.ref().providerSessionId).not.toBe(
      parent.ref().providerSessionId,
    );
    const run = await child.start({
      parts: [{ type: 'text', text: 'Synthetic child input.' }],
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    await expect(client.resumeSession(parent.ref())).rejects.toBeDefined();
    await child.close();
    const resumed = await client.resumeSession(child.ref());
    expect(resumed.ref()).toEqual(child.ref());
  } finally {
    await client.close();
  }
});

it.each([
  { parent_session_id: 'other' },
  { id: 'session_fixture_1' },
  { end_reason: 'branched' },
])(
  'quarantines the source after an ambiguous native branch %j',
  async (patch) => {
    const api = new HermesFixtureApi();
    api.forkPatch = patch;
    const client = await createHermesFixtureFactory(api).connect(
      createHermesProfile(),
    );
    try {
      const parent = await client.createSession();
      const sessions = client
        .extensions()
        .get<{ branch(ref: SessionRef): Promise<HarnessSession> }>(
          'nous.hermes-agent.sessions',
        );
      if (sessions === undefined) throw new Error('Missing Session extension.');
      await expect(sessions.branch(parent.ref())).rejects.toBeDefined();
      await expect(client.resumeSession(parent.ref())).rejects.toMatchObject({
        code: 'connection_aborted',
      });
    } finally {
      await client.close();
    }
  },
);

it('prevents reuse of a retired parent after reconnecting and excludes pending work', async () => {
  const api = new HermesFixtureApi();
  api.forkDelayMs = 30;
  const factory = createHermesFixtureFactory(api);
  const client = await factory.connect(createHermesProfile());
  try {
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<{ branch(ref: SessionRef): Promise<HarnessSession> }>(
        'nous.hermes-agent.sessions',
      );
    if (sessions === undefined) throw new Error('Missing Session extension.');
    for (const ref of [
      { ...parent.ref(), profileId: profileId('another') },
      { ...parent.ref(), providerId: providerId('another') },
      { ...parent.ref(), compatibilityRef: 'another' },
    ])
      await expect(sessions.branch(ref)).rejects.toBeDefined();
    const pending = sessions.branch(parent.ref());
    await expect(sessions.branch(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(client.resumeSession(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(
      parent.start({ parts: [{ type: 'text', text: 'Synthetic conflict.' }] }),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    const child = await pending;
    await expect(
      parent.start({
        parts: [{ type: 'text', text: 'Synthetic retired parent.' }],
      }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    const fresh = await factory.connect(createHermesProfile());
    try {
      await expect(fresh.resumeSession(parent.ref())).rejects.toMatchObject({
        code: 'session_not_found',
      });
      expect((await fresh.resumeSession(child.ref())).ref()).toEqual(
        child.ref(),
      );
    } finally {
      await fresh.close();
    }
  } finally {
    await client.close();
  }
});

it('omits the branch extension without observed endpoint support', async () => {
  const api = new HermesFixtureApi();
  const capability = structuredClone(api.capabilityDocument) as {
    features: { session_fork: boolean };
  };
  capability.features.session_fork = false;
  api.capabilityDocument = capability;
  const client = await createHermesFixtureFactory(api).connect(
    createHermesProfile(),
  );
  try {
    expect(
      client.extensions().get('nous.hermes-agent.sessions'),
    ).toBeUndefined();
  } finally {
    await client.close();
  }
});

it.each([
  'parent-model',
  'child-model',
  'parent-branched',
  'failure-after-retirement',
])('rejects unpreserved native branch state: %s', async (mode) => {
  const api = new HermesFixtureApi();
  if (mode === 'parent-model') api.sourcePatch = { model: 'other-model' };
  if (mode === 'child-model') api.forkPatch = { model: 'other-model' };
  if (mode === 'parent-branched') api.sourcePatch = { end_reason: 'branched' };
  if (mode === 'failure-after-retirement') api.forkStatus = 500;
  const client = await createHermesFixtureFactory(api).connect(
    createHermesProfile(),
  );
  try {
    const parent = await client.createSession({
      model: { id: 'synthetic-model' },
    });
    const sessions = client
      .extensions()
      .get<{ branch(ref: SessionRef): Promise<HarnessSession> }>(
        'nous.hermes-agent.sessions',
      );
    if (sessions === undefined) throw new Error('Missing Session extension.');
    await expect(sessions.branch(parent.ref())).rejects.toBeDefined();
  } finally {
    await client.close();
  }
});

it('aborts a pending branch on Client close and rejects branching an active Run', async () => {
  const api = new HermesFixtureApi();
  api.forkDelayMs = 30;
  const client = await createHermesFixtureFactory(api).connect(
    createHermesProfile(),
  );
  try {
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<{ branch(ref: SessionRef): Promise<HarnessSession> }>(
        'nous.hermes-agent.sessions',
      );
    if (sessions === undefined) throw new Error('Missing Session extension.');
    api.runStartDelayMs = 30;
    const starting = parent.start({
      parts: [{ type: 'text', text: 'Synthetic input.' }],
    });
    await expect(sessions.branch(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await (await starting).result();
    const pending = sessions
      .branch(parent.ref())
      .catch((error: unknown) => error);
    await client.close();
    expect(await pending).toBeInstanceOf(Error);
  } finally {
    await client.close();
  }
});
