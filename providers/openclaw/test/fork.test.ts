import {
  profileId,
  type HarnessSession,
  type SessionRef,
} from '@harapter/core';
import { expect, it } from 'vitest';
import {
  createOpenClawProviderFactory,
  type OpenClawGatewayBinding,
} from '../src/index.js';
import { createTestProfile } from './test-profile.js';

it.each([
  ['send-policy', 'unsupported_capability'],
  ['suffix-route', 'provider_api_incompatible'],
  ['running', 'run_conflict'],
  ['queued', 'run_conflict'],
  ['active-run', 'run_conflict'],
])(
  'rejects %s before writing and releases the source reservation',
  async (mode, code) => {
    const calls: string[] = [];
    const client = await createOpenClawProviderFactory({
      gateway: {
        profileId: profileId('openclaw-synthetic'),
        methods: ['sessions.list', 'sessions.create'],
        request: (method, params) => {
          calls.push(method);
          return Promise.resolve({
            sessions: [
              {
                key:
                  mode === 'suffix-route'
                    ? `agent:main:acp-bridge:harapter-another:${String(params['search'])}`
                    : params['search'],
                sessionId: 'gateway-parent',
                ...(mode === 'send-policy' ? { sendPolicy: 'deny' } : {}),
                ...(mode === 'running' || mode === 'queued'
                  ? { status: mode }
                  : {}),
                ...(mode === 'active-run' ? { hasActiveRun: true } : {}),
              },
            ],
          });
        },
      },
    }).connect(createTestProfile());
    try {
      const parent = await client.createSession();
      const sessions = client.extensions().get<{
        fork(ref: SessionRef): Promise<HarnessSession>;
      }>('openclaw.gateway.sessions');
      if (sessions === undefined) throw new Error('Missing Session extension.');
      await expect(sessions.fork(parent.ref())).rejects.toMatchObject({ code });
      expect(calls).toEqual(['sessions.list']);
      await expect(parent.close()).resolves.toBeUndefined();
      await expect(client.resumeSession(parent.ref())).resolves.toBeDefined();
    } finally {
      await client.close();
    }
  },
);

it('forks Gateway history and attaches a distinct child through ACP', async () => {
  const calls: string[] = [];
  const client = await createOpenClawProviderFactory({
    gateway: {
      profileId: profileId('openclaw-synthetic'),
      methods: ['sessions.list', 'sessions.create'],
      request: async (method, params) => {
        await Promise.resolve();
        calls.push(method);
        if (method === 'sessions.list')
          return {
            sessions: [
              {
                key: params['search'],
                sessionId: 'gateway-parent',
                permissionMode: 'read-only',
              },
            ],
          };
        return {
          ok: true,
          key: params['key'],
          sessionId: 'gateway-child',
          runStarted: false,
          entry: {
            sessionId: 'gateway-child',
            forkSource: {
              sessionKey: params['parentSessionKey'],
              sessionId: 'gateway-parent',
            },
            permissionMode: params['permissionMode'],
          },
        };
      },
    },
  }).connect(createTestProfile());
  try {
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
        'openclaw.gateway.sessions',
      );
    expect(sessions).toBeDefined();
    if (sessions === undefined) throw new Error('Missing Session extension.');
    const child = await sessions.fork(parent.ref());
    expect(child.ref().providerSessionId).not.toBe(
      parent.ref().providerSessionId,
    );
    expect(child.ref().providerState).not.toEqual(parent.ref().providerState);
    const run = await child.start({
      parts: [{ type: 'text', text: 'Synthetic child input.' }],
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    await child.close();
    expect((await client.resumeSession(child.ref())).ref()).toEqual(
      child.ref(),
    );
    expect(calls).toEqual(['sessions.list', 'sessions.create']);
  } finally {
    await client.close();
  }
});

it('requires a matching Profile and observed Gateway methods', async () => {
  const gateway: OpenClawGatewayBinding = {
    profileId: profileId('another'),
    methods: [],
    request: () => Promise.resolve({}),
  };
  await expect(
    createOpenClawProviderFactory({ gateway }).connect(createTestProfile()),
  ).rejects.toMatchObject({ code: 'invalid_request' });
  for (const methods of [[], ['sessions.list']]) {
    const client = await createOpenClawProviderFactory({
      gateway: {
        ...gateway,
        profileId: profileId('openclaw-synthetic'),
        methods,
      },
    }).connect(createTestProfile());
    try {
      expect(
        client.extensions().get('openclaw.gateway.sessions'),
      ).toBeUndefined();
    } finally {
      await client.close();
    }
  }
});

it.each(['invalid-child', 'timeout', 'shutdown'])(
  'contains an uncertain Gateway fork: %s',
  async (mode) => {
    const requested = Promise.withResolvers<undefined>();
    const client = await createOpenClawProviderFactory({
      gateway: {
        profileId: profileId('openclaw-synthetic'),
        methods: ['sessions.list', 'sessions.create'],
        request: (method, params) => {
          if (method === 'sessions.list')
            return Promise.resolve({
              sessions: [{ key: params['search'], sessionId: 'parent' }],
            });
          requested.resolve(undefined);
          return mode === 'invalid-child'
            ? Promise.resolve({})
            : new Promise(() => undefined);
        },
      },
    }).connect(
      createTestProfile(undefined, undefined, { operationTimeoutMs: 300 }),
    );
    try {
      const parent = await client.createSession();
      const sessions = client
        .extensions()
        .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
          'openclaw.gateway.sessions',
        );
      if (sessions === undefined) throw new Error('Missing Session extension.');
      const pending = sessions
        .fork(parent.ref())
        .catch((error: unknown) => error);
      await requested.promise;
      if (mode === 'shutdown') await client.close();
      expect(await pending).toBeInstanceOf(Error);
      await expect(client.createSession()).rejects.toMatchObject({
        code: 'connection_aborted',
      });
    } finally {
      await client.close();
    }
  },
);

it('excludes ACP operations while the Gateway source is reserved', async () => {
  const client = await createOpenClawProviderFactory({
    gateway: {
      profileId: profileId('openclaw-synthetic'),
      methods: ['sessions.list', 'sessions.create'],
      request: () => new Promise(() => undefined),
    },
  }).connect(createTestProfile());
  try {
    const parent = await client.createSession();
    const sessions = client
      .extensions()
      .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
        'openclaw.gateway.sessions',
      );
    if (sessions === undefined) throw new Error('Missing Session extension.');
    const pending = sessions
      .fork(parent.ref())
      .catch((error: unknown) => error);
    await expect(sessions.fork(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(client.resumeSession(parent.ref())).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(parent.close()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(
      parent.start({ parts: [{ type: 'text', text: 'Synthetic conflict.' }] }),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await client.close();
    expect(await pending).toBeInstanceOf(Error);
  } finally {
    await client.close();
  }
});
