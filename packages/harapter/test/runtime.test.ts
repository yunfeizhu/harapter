import { expect, it, vi } from 'vitest';
import { openSession, run, type RuntimeOptions } from 'harapter';
import { sdkFixture } from '../../../providers/pi/test/sdk-fixture.js';
import { gatewayFixture } from '../../../providers/dsh/test/gateway-fixture.js';
import { DSH_GATEWAY_PROTOCOL } from '../../../providers/dsh/src/index.js';
import { createTestProfile } from '../../../providers/openclaw/test/test-profile.js';
import { OPENCLAW_SESSION_EXTENSION } from '../../../providers/openclaw/src/index.js';
import { prepareRun, snapshotRun } from '../src/run-config.js';

it('runs and chats through the same Pi embedded runtime configuration', async () => {
  const sessions: ReturnType<typeof sdkFixture>[] = [];
  const config: RuntimeOptions = {
    harness: 'pi',
    runtime: {
      kind: 'pi-sdk',
      version: '0.85.1',
      createSession() {
        const native = sdkFixture();
        sessions.push(native);
        return Promise.resolve(native);
      },
    },
  };
  expect((await run({ ...config, input: 'one-shot' })).status).toBe(
    'completed',
  );
  const chat = await openSession(config);
  try {
    expect((await chat.send('first')).status).toBe('completed');
    expect((await chat.send('second')).status).toBe('completed');
    expect(sessions[1]?.inputs).toEqual(['first', 'second']);
    expect(chat.ref().providerId).toBe('pi.agent');
  } finally {
    await chat.close();
  }
  expect(sessions.map((native) => native.disposed)).toEqual([1, 1]);
});

it('exposes existing DSH Gateway via run and openSession without launching dsh', async () => {
  const fixture = await gatewayFixture();
  if (fixture.profile.connection.kind !== 'endpoint')
    throw new Error('fixture');
  const config: RuntimeOptions = {
    harness: 'dsh',
    runtime: {
      kind: 'dsh-gateway',
      url: fixture.profile.connection.url,
      protocol: DSH_GATEWAY_PROTOCOL,
      storeId: 'synthetic-store',
      exclusiveSessions: true,
      resolveCookie: () => 'synthetic-cookie',
    },
  };
  try {
    expect((await run({ ...config, input: 'one-shot' })).status).toBe(
      'completed',
    );
    const chat = await openSession(config);
    try {
      const ref = chat.ref();
      expect((await chat.send('first')).status).toBe('completed');
      expect((await chat.send('second')).status).toBe('completed');
      expect(chat.ref()).toEqual(ref);
      expect(chat.client.extensions().list().length).toBeGreaterThan(0);
    } finally {
      await chat.close();
    }
    expect(fixture.methods).toContain('session/prompt');
  } finally {
    await fixture.close();
  }
});

it('forwards an OpenClaw host Gateway binding to its matching ACP profile', async () => {
  const profile = createTestProfile();
  if (profile.connection.kind !== 'process') throw new Error('fixture');
  const options: RuntimeOptions = {
    harness: 'openclaw',
    command: profile.connection.command,
    args: profile.connection.args ?? [],
    runtime: {
      kind: 'openclaw-acp',
      gateway: {
        profileId: profile.profileId,
        methods: ['sessions.list', 'sessions.create'],
        request: () => Promise.resolve({}),
      },
    },
  };
  const chat = await openSession(options);
  try {
    expect(chat.ref().profileId).toBe(profile.profileId);
    expect(chat.client.extensions().has(OPENCLAW_SESSION_EXTENSION)).toBe(true);
    expect((await chat.send('synthetic')).status).toBe('completed');
  } finally {
    await chat.close();
  }
});

it('rejects mismatched or conflicting Runtime settings before invoking a factory', async () => {
  const createSession = vi.fn(() => Promise.resolve(sdkFixture()));
  for (const patch of [
    { harness: 'dsh' },
    { command: 'pi' },
    { cwd: '/synthetic' },
    { url: 'http://fixture.invalid' },
    { headers: {} },
    { model: { id: 'x' } },
  ]) {
    await expect(
      run({
        harness: 'pi',
        input: 'test',
        runtime: { kind: 'pi-sdk', version: '0.85.1', createSession },
        ...patch,
      } as Parameters<typeof run>[0]),
    ).rejects.toBeDefined();
  }
  expect(createSession).not.toHaveBeenCalled();
});

it('snapshots the host binding before imports and preserves method receivers', async () => {
  const binding = {
    version: '0.85.1' as const,
    kind: 'pi-sdk' as const,
    marker: 'original',
    createSession() {
      expect(this.marker).toBe('original');
      return Promise.resolve(sdkFixture());
    },
  };
  // Only contract fields are allowed; the receiver may still have private state via its prototype.
  const runtime = Object.assign(
    Object.create({ marker: 'original' }) as typeof binding,
    {
      kind: binding.kind,
      version: binding.version,
      createSession: binding.createSession.bind(binding),
    },
  );
  const snapshot = snapshotRun({ harness: 'pi', input: 'test', runtime });
  runtime.createSession = () => {
    throw new Error('changed');
  };
  const prepared = await prepareRun(snapshot);
  expect(prepared.profile.connection.kind).toBe('sdk');
  expect((await run(snapshot)).status).toBe('completed');
});

it('rejects invalid Runtime shapes and keeps Gateway cookies bound to their generated profile', async () => {
  for (const runtime of [
    null,
    [],
    { kind: 'unknown' },
    { kind: 'pi-sdk', version: '0.85.0' },
    { kind: 'dsh-gateway' },
    { kind: 'openclaw-acp', gateway: {} },
  ])
    await expect(
      openSession({ harness: 'dsh', runtime } as never),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  const prepared = await prepareRun(
    snapshotRun({
      harness: 'dsh',
      input: 'x',
      runtime: {
        kind: 'dsh-gateway',
        url: 'http://127.0.0.1:9000',
        protocol: DSH_GATEWAY_PROTOCOL,
        storeId: 'synthetic',
        exclusiveSessions: true,
        resolveCookie: () => 'synthetic',
      },
    }),
  );
  expect(() =>
    prepared.sdk.resolveGatewayCookie?.(
      { scheme: 'wrong', id: 'wrong' },
      new AbortController().signal,
    ),
  ).toThrow();
});
