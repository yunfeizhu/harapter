import {
  HarnessRegistry,
  profileId,
  providerId,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRun,
} from '@harapter/core';
import { validatePortableRunTrace } from '@harapter/conformance';
import { describe, expect, it } from 'vitest';

import {
  createHermesProviderFactory,
  type HermesNativeClient,
} from '../src/adapter.js';
import {
  HERMES_PROVIDER_ID,
  HERMES_SUBAGENT_EXTENSION,
  type HermesSubagentEvent,
  type HermesSubagentExtension,
} from '../src/protocol.js';
import {
  createHermesFixtureFactory,
  createHermesProfile,
  HermesFixtureApi,
  type FixtureScenario,
} from './test-profile.js';

describe('Hermes Agent Adapter', () => {
  it('binds the descriptor and handshake-derived capabilities to the Profile', async () => {
    const client = await connect();
    const clientDescriptor = await client.descriptor();
    expect(clientDescriptor).toMatchObject({
      providerId: HERMES_PROVIDER_ID,
      profileId: profileId('hermes-fixture'),
      connectionKind: 'endpoint',
      compatibility: 'experimental',
      runtime: {
        name: 'Hermes Agent API Server',
        protocol: 'HTTP + SSE',
      },
      warnings: [{ code: 'runtime_compatibility_unnegotiated' }],
    });
    if (clientDescriptor.runtime === undefined) {
      throw new Error('Hermes runtime descriptor missing');
    }
    expect(clientDescriptor.runtime.protocolVersion).toMatch(
      /^capabilities-[a-f0-9]{16}$/u,
    );
    await expect(client.capabilities()).resolves.toMatchObject({
      providerId: HERMES_PROVIDER_ID,
      capabilities: {
        'session.create': { mode: 'native', source: 'handshake' },
        'session.resume': { mode: 'native' },
        'run.stream': { mode: 'native' },
        'run.cancel': { mode: 'native' },
        'interaction.approval': { mode: 'native' },
        'session.workspace': { mode: 'unsupported' },
      },
    });
    await client.close();
  });

  it('creates and resumes an owned Session with retained non-secret defaults', async () => {
    const runtime = new HermesFixtureApi();
    const factory = createHermesFixtureFactory(runtime);
    const profile = createHermesProfile();
    const first = await factory.connect(profile);
    const session = await first.createSession({
      systemContext: 'synthetic system context',
      model: {
        id: 'synthetic-model',
        providerOptions: {
          provider: 'synthetic-provider',
          modelOptions: { reasoning_effort: 'medium' },
        },
      },
      providerOptions: { title: 'Synthetic session' },
    });
    const ref = session.ref();
    expect(ref).toMatchObject({
      providerId: HERMES_PROVIDER_ID,
      profileId: profile.profileId,
      compatibilityRef: 'nous.hermes-agent;api-server=current',
      providerState: {
        model: 'synthetic-model',
        provider: 'synthetic-provider',
        systemContext: 'synthetic system context',
      },
    });
    expect(ref.providerState).not.toHaveProperty('modelOptions');
    await first.close();

    const second = await factory.connect(profile);
    const resumed = await second.resumeSession(ref);
    expect(resumed.ref()).toEqual(ref);
    await expect(
      second.resumeSession({
        ...ref,
        providerId: providerId('other.provider'),
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    await expect(
      second.resumeSession({
        ...ref,
        profileId: profileId('other-profile'),
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    await second.close();
  });

  it('reconciles a completed SSE terminal against authoritative Run status', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'complete' }],
    });
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);

    expect(result).toMatchObject({
      status: 'completed',
      finalMessage: 'synthetic final response',
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    });
    expect(events.map(({ type }) => type)).toEqual([
      'run.started',
      'message.delta',
      'message.completed',
      'usage.updated',
      'run.completed',
    ]);
    expect(() => {
      validatePortableRunTrace(events, result);
    }).not.toThrow();
    await client.close();
  });

  it('uses terminal Run status after SSE EOF instead of treating EOF as success', async () => {
    const { events, result } = await runScenario('eof-completed');
    expect(result.status).toBe('completed');
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it('reports connection abort when SSE ends and status stays non-terminal', async () => {
    const { events, result } = await runScenario('eof-running', {
      reconcilePollIntervalMs: 1,
      reconcileTimeoutMs: 5,
    });
    expect(result.status).toBe('connection_aborted');
    expect(events.at(-1)?.type).toBe('connection.aborted');
  });

  it('maps authoritative provider failure without exposing the failure body', async () => {
    const { events, result } = await runScenario('failed');
    expect(result).toEqual({
      status: 'failed',
      providerResult: { status: 'failed' },
    });
    expect(JSON.stringify(events)).not.toContain('synthetic failure');
    expect(events.at(-1)?.type).toBe('run.failed');
  });

  it('waits for cancelled terminal evidence after a stopping acknowledgement', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'cancel conformance input' }],
    });
    const eventsPromise = collectEvents(run);

    await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
    const result = await run.result();
    const events = await eventsPromise;
    expect(result.status).toBe('cancelled');
    expect(events.at(-1)?.type).toBe('run.cancelled');
    await expect(run.cancel()).resolves.toEqual({ mode: 'already_terminal' });
    await client.close();
  });

  it('maps one approval request and sends the selected Hermes choice', async () => {
    const runtime = new HermesFixtureApi();
    runtime.queueScenario('approval');
    const client = await createHermesFixtureFactory(runtime).connect(
      createHermesProfile(),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'approval' }],
    });
    const iterator = run.events()[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'run.started' },
    });
    const requested = await iterator.next();
    expect(requested).toMatchObject({
      value: {
        type: 'interaction.requested',
        data: {
          kind: 'approval',
          prompt: 'synthetic command',
        },
      },
    });
    if (requested.done) throw new Error('approval event missing');
    const requestData = requested.value.data as { requestId?: unknown };
    expect(requestData.requestId).toBeTypeOf('string');
    if (typeof requestData.requestId !== 'string') {
      throw new Error('approval request identifier missing');
    }
    const requestId = requestData.requestId;
    expect(requestId).toMatch(/^hermes-interaction-/u);
    await session.respond(requestId, {
      kind: 'approval',
      decision: 'approve',
      providerOptions: { scope: 'always' },
    });
    const remaining = await collectIterator(iterator);
    const result = await run.result();
    expect(remaining.map(({ type }) => type)).toContain('interaction.resolved');
    expect(remaining.at(-1)?.type).toBe('run.completed');
    expect(result.status).toBe('completed');
    expect(
      runtime.calls.find(({ path }) => path.endsWith('/approval'))?.body,
    ).toEqual({ choice: 'always' });
    await client.close();
  });

  it('keeps late child-session activity out of the terminated parent trace', async () => {
    const runtime = new HermesFixtureApi();
    runtime.queueScenario('late-child');
    const client = await createHermesFixtureFactory(runtime).connect(
      createHermesProfile({ lateEventDrainTimeoutMs: 10 }),
    );
    const extension = client
      .extensions()
      .get<HermesSubagentExtension>(HERMES_SUBAGENT_EXTENSION);
    expect(extension).toBeDefined();
    const childEvents: HermesSubagentEvent[] = [];
    const dispose = extension?.onEvent((event) => childEvents.push(event));
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'parent' }],
    });
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.status).toBe('completed');
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(
      events.some(
        ({ providerEventType }) => providerEventType === 'subagent.complete',
      ),
    ).toBe(false);
    expect(childEvents).toMatchObject([
      {
        eventType: 'subagent.complete',
        childSessionId: 'session_fixture_child',
      },
    ]);
    dispose?.();
    await client.close();
  });

  it('preserves unknown events through bounded redacted portable and native channels', async () => {
    const runtime = new HermesFixtureApi();
    runtime.queueScenario('unknown');
    const client = await createHermesFixtureFactory(runtime).connect(
      createHermesProfile(),
    );
    const native = client.native<HermesNativeClient>();
    const observed: unknown[] = [];
    const dispose = native?.onUnknownEvent((event) => observed.push(event));
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'unknown' }],
    });
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);

    expect(result.status).toBe('completed');
    const unknownEvent = events.find(({ providerEventType }) =>
      providerEventType?.includes('provider.future.notice'),
    );
    expect(unknownEvent).toMatchObject({ type: 'provider' });
    expect(unknownEvent?.raw).not.toHaveProperty('token');
    expect(observed).toHaveLength(1);
    expect(JSON.stringify({ events, observed })).not.toContain(
      'synthetic-secret-placeholder',
    );
    dispose?.();
    await client.close();
  });

  it.each<FixtureScenario>([
    'contradictory',
    'duplicate-terminal',
    'malformed',
  ])(
    'fails %s terminal or protocol evidence closed and quarantines the Session',
    async (scenario) => {
      const runtime = new HermesFixtureApi();
      runtime.queueScenario(scenario);
      const client = await createHermesFixtureFactory(runtime).connect(
        createHermesProfile(),
      );
      const session = await client.createSession();
      const run = await session.start({
        parts: [{ type: 'text', text: scenario }],
      });
      const result = await run.result();
      expect(result.status).toBe('failed');
      await expect(
        Promise.resolve().then(() =>
          session.start({ parts: [{ type: 'text', text: 'again' }] }),
        ),
      ).rejects.toMatchObject({ code: 'connection_aborted' });
      await client.close();
    },
  );

  it('aborts the connection when a stalled consumer exceeds the event bound', async () => {
    const runtime = new HermesFixtureApi();
    runtime.queueScenario('overflow');
    const client = await createHermesFixtureFactory(runtime).connect(
      createHermesProfile({ maxRunEvents: 3 }),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'overflow' }],
    });
    const result = await run.result();
    const events = await collectEvents(run);
    expect(result.status).toBe('connection_aborted');
    expect(events.at(-1)?.type).toBe('connection.aborted');
    await client.close();
  });

  it('keeps native access endpoint-bound and guardable', async () => {
    const client = await connect();
    const native = client.native<HermesNativeClient>();
    expect(native?.runtimeIdentity).toContain(
      'nous.hermes-agent;api-server=current',
    );
    await expect(native?.request('v1/capabilities')).resolves.toMatchObject({
      status: 200,
      body: { platform: 'hermes-agent' },
    });
    expect(
      client.native(
        (value): value is { missing: true } => 'missing' in (value as object),
      ),
    ).toBeUndefined();
    await expect(
      native?.request('https://outside.invalid/'),
    ).rejects.toMatchObject({
      code: 'provider_error',
    });
    await client.close();
  });

  it('settles active work as connection aborted when Session or Client closes', async () => {
    for (const close of ['client', 'session'] as const) {
      const client = await connect();
      const session = await client.createSession();
      const run = await session.start({
        parts: [{ type: 'text', text: 'connection abort input' }],
      });
      if (close === 'client') await client.close();
      else await session.close();
      expect((await run.result()).status).toBe('connection_aborted');
      await client.close();
    }
  });

  it('uses only host-resolved authentication headers and never exposes their value', async () => {
    const runtime = new HermesFixtureApi();
    runtime.requireAuthorization = true;
    const factory = createHermesProviderFactory({
      fetch: runtime.fetch,
      resolveAuthHeaders: () => ({
        authorization: 'Bearer synthetic-token',
      }),
    });
    const profile: HarnessProfile = {
      ...createHermesProfile(),
      connection: {
        kind: 'endpoint',
        url: 'https://hermes.fixture/',
        transport: 'http',
        ownership: 'external',
        authRef: { scheme: 'fixture', id: 'hermes-auth' },
      },
    };
    const client = await factory.connect(profile);
    expect(runtime.calls[0]?.headers).toMatchObject({
      authorization: 'Bearer synthetic-token',
    });
    expect(JSON.stringify(await client.descriptor())).not.toContain(
      'synthetic-token',
    );
    await client.close();
  });

  it('rejects invalid Profiles, options, and interaction responses before unsafe traffic', async () => {
    await expect(
      createHermesFixtureFactory().connect({
        ...createHermesProfile(),
        providerId: providerId('wrong'),
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      createHermesFixtureFactory().connect({
        ...createHermesProfile(),
        providerOptions: { unknown: true },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      createHermesProviderFactory().connect({
        ...createHermesProfile(),
        connection: {
          kind: 'endpoint',
          url: 'https://hermes.fixture/',
          transport: 'http',
          ownership: 'external',
          authRef: { scheme: 'fixture', id: 'missing-resolver' },
        },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });

    const runtime = new HermesFixtureApi();
    runtime.queueScenario('approval');
    const client = await createHermesFixtureFactory(runtime).connect(
      createHermesProfile(),
    );
    const session = await client.createSession();
    await expect(
      session.respond('missing', { kind: 'approval', decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await client.close();
  });
});

async function connect() {
  const registry = new HarnessRegistry();
  registry.register(createHermesFixtureFactory());
  return registry.connect(createHermesProfile());
}

async function runScenario(
  scenario: FixtureScenario,
  options?: Readonly<Record<string, unknown>>,
): Promise<{
  events: HarnessEvent[];
  result: Awaited<ReturnType<HarnessRun['result']>>;
}> {
  const runtime = new HermesFixtureApi();
  runtime.queueScenario(scenario);
  const client = await createHermesFixtureFactory(runtime).connect(
    createHermesProfile(options),
  );
  const session = await client.createSession();
  const run = await session.start({
    parts: [{ type: 'text', text: scenario }],
  });
  const [events, result] = await Promise.all([
    collectEvents(run),
    run.result(),
  ]);
  await client.close();
  return { events, result };
}

async function collectEvents(run: HarnessRun): Promise<HarnessEvent[]> {
  return collectIterator(run.events()[Symbol.asyncIterator]());
}

async function collectIterator(
  iterator: AsyncIterator<HarnessEvent>,
): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) return events;
    events.push(next.value);
  }
}
