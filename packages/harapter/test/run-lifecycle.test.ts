import { afterEach, expect, it, vi } from 'vitest';
import {
  ExtensionRegistry,
  profileId,
  providerId,
  providerSessionId,
  runId,
  type HarnessClient,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRun,
  type HarnessSession,
  type RunResult,
} from '@harapter/core';

const owner = providerId('opencode');
const local = profileId('fixture');
const sessionId = providerSessionId('fixture-session');
const executionId = runId('fixture-run');
const manifest = {
  providerId: owner,
  profileId: local,
  observedAt: '2026-09-09T00:00:00Z',
  capabilities: {},
};
const event: HarnessEvent = {
  id: 'event',
  type: 'run.completed',
  providerId: owner,
  profileId: local,
  sessionId,
  runId: executionId,
  sequence: 1,
  timestamp: '2026-09-09T00:00:00Z',
  data: {},
};

afterEach(() => {
  vi.doUnmock('@harapter/adapter-opencode');
  vi.resetModules();
});

async function fixture() {
  vi.resetModules();
  const order: string[] = [];
  let profile: HarnessProfile | undefined;
  const task = {
    ref: () => ({
      providerId: owner,
      profileId: local,
      sessionId,
      runId: executionId,
    }),
    events: () =>
      (async function* () {
        await Promise.resolve();
        yield event;
      })(),
    result: vi.fn<() => Promise<RunResult>>(async () => {
      await Promise.resolve();
      return { status: 'completed' as const };
    }),
    cancel: () => Promise.resolve({ mode: 'native' }),
  } satisfies HarnessRun;
  const session = {
    ref: () => ({
      providerId: owner,
      profileId: local,
      providerSessionId: sessionId,
    }),
    capabilities: () => Promise.resolve(manifest),
    start: vi.fn<HarnessSession['start']>(() => Promise.resolve(task)),
    respond: () => Promise.resolve(),
    close: vi.fn(() => {
      order.push('session');
      return Promise.resolve();
    }),
  } satisfies HarnessSession;
  const client = {
    descriptor: () =>
      Promise.resolve({
        providerId: owner,
        profileId: profile?.profileId ?? local,
        displayName: 'Fixture',
        connectionKind: 'endpoint',
        compatibility: 'supported',
      }),
    capabilities: () =>
      Promise.resolve({ ...manifest, profileId: profile?.profileId ?? local }),
    createSession: vi.fn<HarnessClient['createSession']>(() =>
      Promise.resolve(session),
    ),
    resumeSession: () => Promise.resolve(session),
    close: vi.fn(() => {
      order.push('client');
      return Promise.resolve();
    }),
    extensions: () => new ExtensionRegistry(owner),
    native: () => undefined,
  } satisfies HarnessClient;
  const connect = vi.fn<() => Promise<HarnessClient>>(() =>
    Promise.resolve(client),
  );
  vi.doMock('@harapter/adapter-opencode', () => ({
    createOpenCodeProviderFactory: () => ({
      descriptor: () => ({
        providerId: owner,
        displayName: 'Fixture',
        connectionKinds: ['endpoint'],
      }),
      connect: (value: HarnessProfile) => {
        profile = value;
        return connect();
      },
    }),
  }));
  const { run, openSession } = await import('harapter');
  return { run, openSession, client, session, task, connect, order };
}

it('retains advanced Session controls and releases an idle chat in native order', async () => {
  const value = await fixture();
  const chat = await value.openSession({ harness: 'opencode' });
  expect(chat.client).toBe(value.client);
  expect(await chat.capabilities()).toEqual(manifest);
  await chat.respond('synthetic', { kind: 'approval', decision: 'deny' });
  const task = await chat.start({
    parts: [{ type: 'text', text: 'synthetic' }],
  });
  expect(await task.result()).toEqual({ status: 'completed' });
  await chat.close();
  await chat.close();
  expect(value.order).toEqual(['session', 'client']);
  await expect(chat.send('late')).rejects.toMatchObject({
    code: 'connection_aborted',
  });
});

it('keeps a chat usable after local validation failure but prevents overlapping sends', async () => {
  const value = await fixture();
  const chat = await value.openSession({ harness: 'opencode' });
  for (const invalid of [
    null,
    [],
    { bad: true },
    { onEvent: 1 },
    { timeoutMs: 0 },
    { timeoutMs: 2_147_483_648 },
  ])
    await expect(
      chat.send('synthetic', invalid as never),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(chat.send('')).rejects.toMatchObject({
    code: 'invalid_request',
  });
  const pending = chat.send('first');
  await expect(chat.send('second')).rejects.toMatchObject({
    code: 'run_conflict',
  });
  await expect(
    chat.start({ parts: [{ type: 'text', text: 'third' }] }),
  ).rejects.toMatchObject({ code: 'run_conflict' });
  await pending;
  await chat.close();
});

it('redacts chat observers, preserves their primary error and attempts both cleanup operations', async () => {
  const value = await fixture();
  const chat = await value.openSession({ harness: 'opencode' });
  value.client.close.mockRejectedValue(new Error('private cleanup'));
  value.session.close.mockRejectedValue(new Error('private cleanup'));
  await expect(
    chat.send('synthetic', {
      onEvent() {
        throw new Error('private observer');
      },
    }),
  ).rejects.toMatchObject({ code: 'provider_error', cause: undefined });
  expect(value.client.close).toHaveBeenCalledOnce();
  expect(value.session.close).toHaveBeenCalledOnce();
});

it('closes a chat on interactions without silently approving them', async () => {
  const value = await fixture();
  value.task.events = () =>
    (async function* () {
      await Promise.resolve();
      yield { ...event, type: 'interaction.requested' as const };
    })();
  const chat = await value.openSession({ harness: 'opencode' });
  await expect(chat.send('synthetic')).rejects.toMatchObject({
    code: 'unsupported_capability',
  });
  expect(value.order).toEqual(['client', 'session']);
});

it('bounds a stalled chat observer and stops forwarding subsequent events', async () => {
  const value = await fixture();
  value.task.events = () =>
    (async function* () {
      await Promise.resolve();
      yield event;
      yield event;
    })();
  const chat = await value.openSession({ harness: 'opencode' });
  let release!: () => void;
  const onEvent = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await expect(
    chat.send('synthetic', { timeoutMs: 10, onEvent }),
  ).rejects.toMatchObject({ code: 'timeout' });
  release();
  await Promise.resolve();
  await Promise.resolve();
  expect(onEvent).toHaveBeenCalledOnce();
});

it('closes an active low-level chat Run through its Client', async () => {
  const value = await fixture();
  const result = Promise.withResolvers<RunResult>();
  value.task.result.mockImplementation(() => result.promise);
  const chat = await value.openSession({ harness: 'opencode' });
  await chat.start({ parts: [{ type: 'text', text: 'synthetic' }] });
  await chat.close();
  expect(value.order).toEqual(['client', 'session']);
  result.resolve({ status: 'connection_aborted' });
});

it('redacts native start errors without breaking the Session wrapper', async () => {
  const value = await fixture();
  value.session.start.mockRejectedValueOnce(
    new Error('private native failure'),
  );
  const chat = await value.openSession({ harness: 'opencode' });
  await expect(
    chat.start({ parts: [{ type: 'text', text: 'synthetic' }] }),
  ).rejects.toMatchObject({ code: 'provider_error', cause: undefined });
  await chat.send('retry');
  await chat.close();
});

it('cleans up a rejected Session creation without masking the failure', async () => {
  const value = await fixture();
  value.client.createSession.mockRejectedValue(new Error('private setup'));
  value.client.close.mockRejectedValue(new Error('private close'));
  await expect(
    value.openSession({ harness: 'opencode' }),
  ).rejects.toMatchObject({ code: 'provider_error' });
});

it('disposes a late connection without opening a chat Session', async () => {
  const value = await fixture();
  const connected = Promise.withResolvers<HarnessClient>();
  value.connect.mockImplementation(() => connected.promise);
  await expect(
    value.openSession({ harness: 'opencode', timeoutMs: 10 }),
  ).rejects.toMatchObject({ code: 'timeout' });
  connected.resolve(value.client);
  await vi.waitFor(() => {
    expect(value.client.close).toHaveBeenCalledOnce();
  });
  expect(value.client.createSession).not.toHaveBeenCalled();
});

it('disposes a late chat Session without starting a Run', async () => {
  const value = await fixture();
  const created = Promise.withResolvers<HarnessSession>();
  value.client.createSession.mockImplementation(() => created.promise);
  await expect(
    value.openSession({ harness: 'opencode', timeoutMs: 10 }),
  ).rejects.toMatchObject({ code: 'timeout' });
  created.resolve(value.session);
  await vi.waitFor(() => {
    expect(value.session.close).toHaveBeenCalledOnce();
  });
  expect(value.session.start).not.toHaveBeenCalled();
});

it('rejects unreadable connection options safely', async () => {
  const value = await fixture();
  for (const input of [
    null,
    { harness: 'pi', input: 'not an openSession option' },
    {
      get harness() {
        throw new Error('private');
      },
    },
  ])
    await expect(value.openSession(input as never)).rejects.toMatchObject({
      code: 'invalid_request',
    });
});

it('contains late connection cleanup errors after openSession has timed out', async () => {
  const value = await fixture();
  const connected = Promise.withResolvers<HarnessClient>();
  value.connect.mockImplementation(() => connected.promise);
  value.client.close.mockRejectedValue(new Error('private close'));
  await expect(
    value.openSession({ harness: 'opencode', timeoutMs: 10 }),
  ).rejects.toMatchObject({ code: 'timeout' });
  connected.resolve(value.client);
  await vi.waitFor(() => {
    expect(value.client.close).toHaveBeenCalledOnce();
  });
});

it('contains late Session cleanup errors after openSession has timed out', async () => {
  const value = await fixture();
  const created = Promise.withResolvers<HarnessSession>();
  value.client.createSession.mockImplementation(() => created.promise);
  value.session.close.mockRejectedValue(new Error('private close'));
  await expect(
    value.openSession({ harness: 'opencode', timeoutMs: 10 }),
  ).rejects.toMatchObject({ code: 'timeout' });
  created.resolve(value.session);
  await vi.waitFor(() => {
    expect(value.session.close).toHaveBeenCalledOnce();
  });
});

it('clears the busy flag when an advanced Run result rejects', async () => {
  const value = await fixture();
  value.task.result.mockRejectedValue(new Error('private result'));
  const chat = await value.openSession({ harness: 'opencode' });
  const task = await chat.start({ parts: [{ type: 'text', text: 'x' }] });
  await expect(task.result()).rejects.toBeDefined();
  await chat.close();
  expect(value.order).toEqual(['session', 'client']);
});

it('releases a successful Session before closing the Client', async () => {
  const value = await fixture();
  await expect(
    value.run({ harness: 'opencode', input: 'Fictional task.' }),
  ).resolves.toEqual({ status: 'completed' });
  expect(value.order).toEqual(['session', 'client']);
});

it('returns a safe cleanup failure instead of claiming successful resource release', async () => {
  const value = await fixture();
  vi.mocked(value.client.close).mockRejectedValue(
    new Error('private cleanup detail'),
  );
  const result = value.run({ harness: 'opencode', input: 'Fictional task.' });
  await expect(result).rejects.toMatchObject({
    code: 'connection_failed',
    cause: undefined,
  });
  await expect(result).rejects.not.toThrow('private cleanup detail');
});

it('preserves a primary failure when both cleanup operations also fail', async () => {
  const value = await fixture();
  const { HarnessError: PublicError } = await import('harapter');
  vi.mocked(value.session.start).mockRejectedValue(
    new PublicError('run_conflict', 'Synthetic conflict.', {
      retryable: false,
    }),
  );
  vi.mocked(value.client.close).mockRejectedValue(new Error('private close'));
  vi.mocked(value.session.close).mockRejectedValue(new Error('private close'));
  await expect(
    value.run({ harness: 'opencode', input: 'Fictional task.' }),
  ).rejects.toMatchObject({ code: 'run_conflict' });
  expect(value.client.close).toHaveBeenCalledOnce();
  expect(value.session.close).toHaveBeenCalledOnce();
});

it('redacts unexpected task errors and closes both handles', async () => {
  const value = await fixture();
  vi.mocked(value.session.start).mockRejectedValue(
    new Error('private task detail'),
  );
  await expect(
    value.run({ harness: 'opencode', input: 'Fictional task.' }),
  ).rejects.toMatchObject({ code: 'provider_error', cause: undefined });
  expect(value.order).toEqual(['client', 'session']);
});

it.each([false, true])(
  'disposes a connection returned after timeout (cleanup failure: %s)',
  async (closeFails) => {
    const value = await fixture();
    const pending = Promise.withResolvers<HarnessClient>();
    value.connect.mockReturnValue(pending.promise);
    if (closeFails)
      value.client.close.mockRejectedValue(new Error('private late cleanup'));
    await expect(
      value.run({
        harness: 'opencode',
        input: 'Fictional task.',
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
    pending.resolve(value.client);
    await vi.waitFor(() => {
      expect(value.client.close).toHaveBeenCalledOnce();
    });
    expect(value.client.createSession).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  'disposes a Session returned after timeout (cleanup failure: %s)',
  async (closeFails) => {
    const value = await fixture();
    const pending = Promise.withResolvers<HarnessSession>();
    vi.mocked(value.client.createSession).mockReturnValue(pending.promise);
    if (closeFails)
      value.session.close.mockRejectedValue(new Error('private late cleanup'));
    await expect(
      value.run({
        harness: 'opencode',
        input: 'Fictional task.',
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(value.client.close).toHaveBeenCalledOnce();
    pending.resolve(value.session);
    await vi.waitFor(() => {
      expect(value.session.close).toHaveBeenCalledOnce();
    });
    expect(value.session.start).not.toHaveBeenCalled();
  },
);

it('does not consume a Run returned after timeout', async () => {
  const value = await fixture();
  const pending = Promise.withResolvers<HarnessRun>();
  vi.mocked(value.session.start).mockReturnValue(pending.promise);
  const events = vi.spyOn(value.task, 'events');
  await expect(
    value.run({ harness: 'opencode', input: 'Fictional task.', timeoutMs: 20 }),
  ).rejects.toMatchObject({ code: 'timeout' });
  pending.resolve(value.task);
  await Promise.resolve();
  expect(events).not.toHaveBeenCalled();
  expect(value.order).toEqual(['client', 'session']);
});

it('stops forwarding events when an asynchronous observer returns after timeout', async () => {
  const value = await fixture();
  const pending = Promise.withResolvers<undefined>();
  const onEvent = vi.fn(() => pending.promise);
  value.task.events = () =>
    (async function* () {
      await Promise.resolve();
      yield event;
      yield event;
    })();
  await expect(
    value.run({
      harness: 'opencode',
      input: 'Fictional task.',
      timeoutMs: 20,
      onEvent,
    }),
  ).rejects.toMatchObject({ code: 'timeout' });
  pending.resolve(undefined);
  await Promise.resolve();
  await Promise.resolve();
  expect(onEvent).toHaveBeenCalledOnce();
  expect(value.order).toEqual(['client', 'session']);
});

it('can handle a native non-success outcome without changing its meaning', async () => {
  const value = await fixture();
  vi.mocked(value.task.result).mockResolvedValue({
    status: 'connection_aborted',
  });
  await expect(
    value.run({ harness: 'opencode', input: 'Fictional task.' }),
  ).resolves.toEqual({ status: 'connection_aborted' });
});

it('does not treat a late terminal result as successful completion after the deadline', async () => {
  const value = await fixture();
  const pending = Promise.withResolvers<RunResult>();
  value.task.result.mockReturnValue(pending.promise);
  await expect(
    value.run({ harness: 'opencode', input: 'Fictional task.', timeoutMs: 20 }),
  ).rejects.toMatchObject({ code: 'timeout' });
  pending.resolve({ status: 'completed' });
  await Promise.resolve();
  await Promise.resolve();
  expect(value.order).toEqual(['client', 'session']);
});
