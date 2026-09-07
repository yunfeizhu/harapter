import type { HarnessClient, HarnessEvent, HarnessRun } from '@harapter/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDshProviderFactory } from '../src/adapter.js';
import {
  DSH_NOTIFICATION_EXTENSION,
  type DshNotificationObserver,
} from '../src/index.js';
import {
  DSH_GATEWAY_SESSION_EXTENSION,
  type DshGatewaySessions,
} from '../src/gateway-types.js';
import { gatewayFixture } from './gateway-fixture.js';

let fixture: Awaited<ReturnType<typeof gatewayFixture>>;
const clients: HarnessClient[] = [];
beforeEach(async () => {
  fixture = await gatewayFixture();
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
  await fixture.close();
});
async function connect(
  options: Record<string, unknown> = {},
): Promise<HarnessClient> {
  const client = await createDshProviderFactory({
    resolveGatewayCookie: () => 'synthetic=session',
  }).connect({
    ...fixture.profile,
    providerOptions: { ...fixture.profile.providerOptions, ...options },
  });
  clients.push(client);
  return client;
}
async function trace(run: HarnessRun): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of run.events()) events.push(event);
  return events;
}
const input = { parts: [{ type: 'text' as const, text: 'synthetic' }] };

describe('DSH Gateway portable Sessions and native controls', () => {
  it('accepts the official dynamic runtime context within its owned step', async () => {
    fixture.setMode('runtime-context');
    const client = await connect();
    const run = await (await client.createSession()).start(input);
    expect((await run.result()).status).toBe('completed');
    expect(JSON.stringify(await trace(run))).not.toContain(
      'synthetic runtime context',
    );
  });

  it('observes cancellation after claim but before a user message exists', async () => {
    fixture.setMode('hold-pre-step');
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start(input);
    await client
      .extensions()
      .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION)
      ?.cancelSession(session.ref());
    expect((await run.result()).status).toBe('cancelled');
    expect(
      fixture.sessions
        .get(session.ref().providerSessionId)
        ?.events.some((event) => event.type === 'user/message'),
    ).toBe(false);
    fixture.setMode('normal');
    expect((await (await session.start(input)).result()).status).toBe(
      'completed',
    );
  });

  it('does not turn Session cancel acceptance into a terminal for still queued input', async () => {
    fixture.setMode('hold-before-turn');
    const client = await connect({ runTimeoutMs: 30 });
    const session = await client.createSession();
    const run = await session.start(input);
    await expect(
      client
        .extensions()
        .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION)
        ?.cancelSession(session.ref()),
    ).resolves.toEqual({ accepted: true });
    expect(await run.result()).toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'run_timeout' },
    });
    expect(
      fixture.sessions.get(session.ref().providerSessionId)?.events,
    ).toHaveLength(1);
    expect(
      (await trace(run)).some((event) => event.type === 'run.cancelled'),
    ).toBe(false);
  });

  it('keeps a locally oversized request and a definite prompt rejection recoverable', async () => {
    const client = await connect();
    const session = await client.createSession();
    await expect(
      session.start({ parts: [{ type: 'text', text: 'x'.repeat(262144) }] }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
      providerCode: 'request_capacity',
    });
    expect(fixture.methods).not.toContain('session/prompt');
    fixture.setMode('reject-prompt');
    await expect(session.start(input)).rejects.toMatchObject({
      code: 'run_conflict',
    });
    fixture.setMode('normal');
    expect((await (await session.start(input)).result()).status).toBe(
      'completed',
    );
  });

  it('retains a validated terminal when a passive title arrives before admission', async () => {
    const client = await connect();
    const session = await client.createSession();
    fixture.setResponse((method, value) => {
      if (method === 'session/prompt')
        fixture.emit(session.ref().providerSessionId, 'session/title', {
          title: 'synthetic title',
        });
      return value;
    });
    const run = await session.start(input);
    expect((await run.result()).status).toBe('completed');
    expect((await trace(run)).at(-1)?.type).toBe('run.completed');
  });
  it('completes a text Run and resumes the same native Session after reconnect', async () => {
    const client = await connect();
    expect(
      (await client.capabilities()).capabilities['session.resume']?.mode,
    ).toBe('native');
    const session = await client.createSession();
    const run = await session.start(input);
    const events = await trace(run);
    expect(await run.result()).toMatchObject({
      status: 'completed',
      finalMessage: 'synthetic answer',
    });
    expect(events.at(-1)?.type).toBe('run.completed');
    const reference = session.ref();
    await client.close();
    const second = await connect();
    const resumed = await second.resumeSession(reference);
    expect(resumed.ref()).toEqual(reference);
    const next = await resumed.start(input);
    expect((await next.result()).status).toBe('completed');
    expect(
      (await trace(next)).filter((event) => event.type === 'message.completed'),
    ).toHaveLength(1);
  });

  it('forks native history into a distinct independently runnable child', async () => {
    const client = await connect();
    const parent = await client.createSession();
    await (await parent.start(input)).result();
    const extension = client
      .extensions()
      .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION);
    if (extension === undefined)
      throw new Error('Missing Gateway Session extension.');
    const child = await extension.fork(parent.ref());
    expect(child.ref().providerSessionId).not.toBe(
      parent.ref().providerSessionId,
    );
    expect(fixture.sessions.get(child.ref().providerSessionId)?.parent).toBe(
      parent.ref().providerSessionId,
    );
    expect((await (await child.start(input)).result()).status).toBe(
      'completed',
    );
    expect(fixture.sessions.get(parent.ref().providerSessionId)?.turn).toBe(1);
  });

  it('keeps Session cancellation separate from portable Run cancellation', async () => {
    fixture.setMode('hold');
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start(input);
    await expect(run.cancel()).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    const extension = client
      .extensions()
      .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION);
    await expect(extension?.cancelSession(session.ref())).resolves.toEqual({
      accepted: true,
    });
    expect((await run.result()).status).toBe('cancelled');
    expect((await trace(run)).at(-1)?.type).toBe('run.cancelled');
  });

  it('rejects a missing resume without creating a replacement Session', async () => {
    const client = await connect();
    const session = await client.createSession();
    const reference = session.ref();
    await session.close();
    fixture.sessions.delete(reference.providerSessionId);
    await expect(client.resumeSession(reference)).rejects.toMatchObject({
      code: 'session_not_found',
    });
    expect(
      fixture.methods.filter((method) => method === 'session/create'),
    ).toHaveLength(1);
  });

  it('settles physical loss as connection abort and leaves native state intact', async () => {
    fixture.setMode('hold');
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start(input);
    fixture.disconnect();
    expect((await run.result()).status).toBe('connection_aborted');
    expect(fixture.sessions.has(session.ref().providerSessionId)).toBe(true);
    expect(fixture.methods).not.toContain('session/cancel');
  });

  it('keeps the replacement attachment when a stale handle closes again', async () => {
    const client = await connect();
    const original = await client.createSession();
    const ref = original.ref();
    await original.close();
    const resumed = await client.resumeSession(ref);
    await original.close();
    expect(await client.resumeSession(ref)).toBe(resumed);
  });

  it('blocks new work until a Session cancellation receipt settles', async () => {
    fixture.setMode('hold');
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start(input);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture.setResponse(async (method, value) => {
      if (method === 'session/cancel') await pending;
      return value;
    });
    const cancel = client
      .extensions()
      .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION)
      ?.cancelSession(session.ref());
    expect((await run.result()).status).toBe('cancelled');
    await expect(session.start(input)).rejects.toMatchObject({
      code: 'run_conflict',
    });
    release();
    await cancel;
  });

  it.each(['session/create', 'session/fork', 'session/cancel'])(
    'quarantines uncertain %s mutations',
    async (method) => {
      const client = await connect();
      const session = await client.createSession();
      await (await session.start(input)).result();
      fixture.setResponse((name, value) => (name === method ? {} : value));
      const controls = client
        .extensions()
        .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION);
      const operation =
        method === 'session/create'
          ? client.createSession()
          : method === 'session/fork'
            ? controls?.fork(session.ref())
            : controls?.cancelSession(session.ref());
      await expect(operation).rejects.toMatchObject({
        code: 'provider_api_incompatible',
      });
      await expect(client.createSession()).rejects.toMatchObject({
        code: 'connection_aborted',
      });
    },
  );

  it('rejects conflicting Runs and unsupported public operations before submitting', async () => {
    fixture.setMode('hold');
    const client = await connect();
    const session = await client.createSession();
    expect(await client.descriptor()).toMatchObject({
      connectionKind: 'endpoint',
      compatibility: 'experimental',
    });
    expect(await session.capabilities()).toMatchObject({
      providerId: 'deepseek.harness',
    });
    expect(client.native()).toBeDefined();
    expect(client.native((_value): _value is unknown => false)).toBeUndefined();
    await expect(
      client.createSession({ systemContext: 'synthetic' }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(
      session.respond('synthetic', { kind: 'provider', value: {} }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(session.start(input, { timeoutMs: 0 })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    const run = await session.start(input);
    await expect(session.start(input)).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(session.close()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    const events = trace(run);
    await client.close();
    expect((await events).at(-1)?.type).toBe('connection.aborted');
    expect(await run.cancel()).toEqual({ mode: 'already_terminal' });
    await expect(session.start(input)).rejects.toMatchObject({
      code: 'session_not_found',
    });
    await expect(trace(run)).rejects.toMatchObject({ code: 'run_conflict' });
  });

  it('enforces attachment capacity without damaging existing Sessions', async () => {
    const client = await connect({ maxSessions: 1 });
    const session = await client.createSession();
    expect(await client.resumeSession(session.ref())).toBe(session);
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(
      client
        .extensions()
        .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION)
        ?.fork(session.ref()),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    expect((await (await session.start(input)).result()).status).toBe(
      'completed',
    );
  });

  it('preserves the client after a definite native fork rejection', async () => {
    const client = await connect();
    const session = await client.createSession();
    await expect(
      client
        .extensions()
        .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION)
        ?.fork(session.ref()),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    expect((await (await session.start(input)).result()).status).toBe(
      'completed',
    );
  });

  it.each(['profile', 'compatibility', 'header'])(
    'refuses a foreign %s reference without replaying history',
    async (binding) => {
      const client = await connect();
      const session = await client.createSession();
      const ref = session.ref();
      const foreign = {
        ...ref,
        ...(binding === 'profile'
          ? { profileId: 'foreign' as typeof ref.profileId }
          : binding === 'compatibility'
            ? { compatibilityRef: 'foreign' }
            : { providerState: { headerFingerprint: 'foreign' } }),
      };
      await expect(client.resumeSession(foreign)).rejects.toMatchObject({
        code: 'session_provider_mismatch',
      });
      await session.close();
      await expect(
        client
          .extensions()
          .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION)
          ?.fork(ref),
      ).rejects.toMatchObject({ code: 'session_not_found' });
      await expect(client.resumeSession(foreign)).rejects.toMatchObject({
        code: 'session_provider_mismatch',
      });
    },
  );

  it.each(['run_timeout', 'run_event_capacity', 'unknown_required_event'])(
    'fails closed on %s with exactly one terminal',
    async (reason) => {
      fixture.setMode('hold');
      const client = await connect(
        reason === 'run_event_capacity'
          ? { maxRunEvents: 16 }
          : { runTimeoutMs: 30 },
      );
      const session = await client.createSession();
      const run = await session.start(input);
      if (reason === 'run_event_capacity')
        for (let count = 0; count < 16; count++)
          fixture.emit(session.ref().providerSessionId, 'session/title', {});
      if (reason === 'unknown_required_event')
        fixture.emit(
          session.ref().providerSessionId,
          'synthetic-private-unknown',
        );
      expect(await run.result()).toMatchObject({
        status: 'connection_aborted',
        providerResult: { reason },
      });
      const events = await trace(run);
      expect(
        events.filter((event) => event.type === 'connection.aborted'),
      ).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain('synthetic-private-unknown');
      expect(fixture.methods).not.toContain('session/cancel');
    },
  );

  it('does not report success when later activity precedes the admission receipt', async () => {
    const client = await connect();
    const session = await client.createSession();
    fixture.setResponse((method, value) => {
      if (method === 'session/prompt')
        fixture.emit(session.ref().providerSessionId, 'turn/start', {
          turn: 2,
        });
      return value;
    });
    await expect(session.start(input)).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('rejects a malformed probe before exposing a client', async () => {
    fixture.setResponse(() => ({}));
    await expect(connect()).rejects.toMatchObject({
      code: 'provider_api_incompatible',
      providerCode: 'catalog_invalid',
    });
  });

  it('bounds Session attachment even when no snapshot arrives', async () => {
    const client = await connect({ requestTimeoutMs: 30 });
    fixture.setFrame(() => ({ type: 'unexpected' }));
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
  });

  it('observes redacted idle activity and contains synchronous and asynchronous observer failures', async () => {
    const client = await connect();
    const observer = client
      .extensions()
      .get<DshNotificationObserver>(DSH_NOTIFICATION_EXTENSION);
    if (observer === undefined) throw new Error('Missing observer.');
    const seen: unknown[] = [];
    const off = observer.onNotification((value) => {
      seen.push(value);
    });
    observer.onNotification(() => {
      throw new Error('synthetic listener failure');
    });
    const rejectingListener: () => unknown = () =>
      Promise.reject(new Error('synthetic listener rejection'));
    observer.onNotification(rejectingListener);
    const session = await client.createSession();
    expect(seen).toHaveLength(1);
    for (let count = 0; count < 13; count++)
      observer.onNotification(() => undefined);
    expect(() => observer.onNotification(() => undefined)).toThrow();
    off();
    observer.onNotification((value) => {
      seen.push(value);
    });
    fixture.emit(session.ref().providerSessionId, 'synthetic-private-unknown', {
      secret: 'synthetic secret',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen)).not.toContain('synthetic secret');
    expect(JSON.stringify(seen)).not.toContain('synthetic-private-unknown');
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });
});
