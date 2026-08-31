import type {
  HarnessEvent,
  HarnessProfile,
  HarnessRun,
  HarnessSession,
  ProviderAdapterFactory,
} from '@harapter/core';
import { describe, expect, it } from 'vitest';

import {
  createHermesProviderFactory,
  type HermesNativeClient,
} from '../src/adapter.js';
import {
  HERMES_SUBAGENT_EXTENSION,
  type HermesSubagentExtension,
} from '../src/protocol.js';
import {
  createHermesFixtureFactory,
  createHermesProfile,
  HermesFixtureApi,
} from './test-profile.js';

const textInput = {
  parts: [{ type: 'text', text: 'synthetic input' }],
} as const;

describe('Hermes Adapter failure and lifecycle boundaries', () => {
  it('rejects malformed endpoints and bounded connection options', async () => {
    const invalidProfiles: HarnessProfile[] = [
      {
        ...createHermesProfile(),
        connection: {
          kind: 'endpoint',
          url: 'relative',
          ownership: 'external',
        },
      },
      {
        ...createHermesProfile(),
        connection: {
          kind: 'endpoint',
          url: 'ftp://hermes.fixture/',
          ownership: 'external',
        },
      },
      {
        ...createHermesProfile(),
        providerOptions: [] as unknown as Record<string, unknown>,
      },
      createHermesProfile({ maxRunEvents: 1 }),
      createHermesProfile({ reconcileTimeoutMs: 0 }),
      createHermesProfile({ requestTimeoutMs: 2_147_483_648 }),
    ];
    for (const profile of invalidProfiles) {
      await expect(
        createHermesFixtureFactory().connect(profile),
      ).rejects.toMatchObject({
        code: 'profile_invalid',
      });
    }
    const configured = await createHermesFixtureFactory().connect(
      createHermesProfile({
        requestTimeoutMs: 50,
        sseConnectTimeoutMs: 50,
      }),
    );
    await configured.close();
  });

  it('maps capability probe HTTP, content, encoding, JSON, and network failures', async () => {
    const cases: {
      expected: string;
      response: () => Promise<Response> | Response;
    }[] = [
      {
        expected: 'authentication_failed',
        response: () => jsonResponse({}, 401),
      },
      {
        expected: 'provider_api_incompatible',
        response: () => jsonResponse({}, 404),
      },
      { expected: 'provider_error', response: () => jsonResponse({}, 500) },
      {
        expected: 'provider_api_incompatible',
        response: () =>
          new Response('{}', { headers: { 'content-type': 'text/plain' } }),
      },
      {
        expected: 'provider_api_incompatible',
        response: () =>
          new Response(new Uint8Array([0xff]), {
            headers: { 'content-type': 'application/json' },
          }),
      },
      {
        expected: 'provider_api_incompatible',
        response: () =>
          new Response('{bad', {
            headers: { 'content-type': 'application/json' },
          }),
      },
      {
        expected: 'connection_failed',
        response: () =>
          Promise.reject(new TypeError('synthetic network failure')),
      },
    ];
    for (const testCase of cases) {
      const factory = createHermesProviderFactory({
        fetch: async () => testCase.response(),
      });
      await expect(
        factory.connect(createHermesProfile()),
      ).rejects.toMatchObject({
        code: testCase.expected,
      });
    }
  });

  it('fails closed when host authentication-header resolution fails', async () => {
    const profile: HarnessProfile = {
      ...createHermesProfile(),
      connection: {
        kind: 'endpoint',
        url: 'https://hermes.fixture/',
        ownership: 'external',
        authRef: { scheme: 'fixture', id: 'auth' },
      },
    };
    for (const resolveAuthHeaders of [
      () => Promise.reject(new Error('synthetic')),
      () => ({ authorization: 1 }) as unknown as Record<string, string>,
    ]) {
      await expect(
        createHermesProviderFactory({ resolveAuthHeaders }).connect(profile),
      ).rejects.toMatchObject({ code: 'authentication_failed' });
    }
  });

  it('validates create and resume responses against the owned Session', async () => {
    const createMismatch = interceptFactory(
      new HermesFixtureApi(),
      ({ method, url }) =>
        method === 'POST' && url.pathname === '/api/sessions'
          ? jsonResponse({
              object: 'hermes.session',
              session: { id: 'session_other', model: 'other-model' },
            })
          : undefined,
    );
    const createClient = await createMismatch.connect(createHermesProfile());
    await expect(
      createClient.createSession({ model: { id: 'synthetic-model' } }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    await createClient.close();

    const runtime = new HermesFixtureApi();
    const client = await createHermesFixtureFactory(runtime).connect(
      createHermesProfile(),
    );
    const session = await client.createSession({
      model: { id: 'synthetic-model' },
    });
    await expect(
      client.resumeSession({
        ...session.ref(),
        providerSessionId: 'missing' as ReturnType<
          HarnessSession['ref']
        >['providerSessionId'],
      }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    await client.close();

    const resumeRuntime = new HermesFixtureApi();
    const resumeFactory = interceptFactory(resumeRuntime, ({ method, url }) =>
      method === 'GET' && url.pathname.startsWith('/api/sessions/')
        ? jsonResponse({
            object: 'hermes.session',
            session: {
              id: decodeURIComponent(url.pathname.split('/').at(-1) ?? ''),
              model: 'other-model',
            },
          })
        : undefined,
    );
    const owner = await resumeFactory.connect(createHermesProfile());
    await expect(owner.resumeSession(session.ref())).rejects.toMatchObject({
      code: 'session_provider_mismatch',
    });
    await owner.close();
  });

  it('rejects invalid Run timeouts and concurrent Runs before extra submission', async () => {
    const runtime = new HermesFixtureApi();
    runtime.runStartDelayMs = 10;
    const client = await createHermesFixtureFactory(runtime).connect(
      createHermesProfile(),
    );
    const session = await client.createSession();
    await expect(
      session.start(textInput, { timeoutMs: 0 }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    const starting = session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await expect(session.start(textInput)).rejects.toMatchObject({
      code: 'run_conflict',
    });
    const active = await starting;
    expect(
      runtime.calls.filter(({ path }) => path === '/v1/runs'),
    ).toHaveLength(1);
    await session.close();
    expect((await active.result()).status).toBe('connection_aborted');
    await expect(
      Promise.resolve().then(() => session.capabilities()),
    ).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await expect(
      Promise.resolve().then(() => session.start(textInput)),
    ).rejects.toMatchObject({ code: 'connection_aborted' });
    await session.close();
    await client.close();

    const closingRuntime = new HermesFixtureApi();
    closingRuntime.runStartDelayMs = 10;
    const closingClient = await createHermesFixtureFactory(
      closingRuntime,
    ).connect(createHermesProfile());
    const closingSession = await closingClient.createSession();
    const closingStart = closingSession.start(textInput);
    await closingSession.close();
    await expect(closingStart).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await closingClient.close();
  });

  it('maps Run submission status failures and quarantines uncertain submissions', async () => {
    for (const [status, code] of [
      [400, 'invalid_request'],
      [409, 'run_conflict'],
      [429, 'provider_error'],
    ] as const) {
      const runtime = new HermesFixtureApi();
      const client = await interceptFactory(runtime, ({ method, url }) =>
        method === 'POST' && url.pathname === '/v1/runs'
          ? jsonResponse({}, status)
          : undefined,
      ).connect(createHermesProfile());
      const session = await client.createSession();
      await expect(session.start(textInput)).rejects.toMatchObject({ code });
      await client.close();
    }

    const runtime = new HermesFixtureApi();
    const client = await interceptFactory(runtime, ({ method, url }) =>
      method === 'POST' && url.pathname === '/v1/runs'
        ? Promise.reject(new TypeError('uncertain submission'))
        : undefined,
    ).connect(createHermesProfile());
    const session = await client.createSession();
    await expect(session.start(textInput)).rejects.toMatchObject({
      code: 'provider_error',
    });
    await expect(
      Promise.resolve().then(() => session.start(textInput)),
    ).rejects.toMatchObject({ code: 'connection_aborted' });
    await client.close();

    const serverRuntime = new HermesFixtureApi();
    const serverClient = await interceptFactory(
      serverRuntime,
      ({ method, url }) =>
        method === 'POST' && url.pathname === '/v1/runs'
          ? jsonResponse({}, 500)
          : undefined,
    ).connect(createHermesProfile());
    const serverSession = await serverClient.createSession();
    await expect(serverSession.start(textInput)).rejects.toMatchObject({
      code: 'provider_error',
    });
    await expect(
      Promise.resolve().then(() => serverSession.start(textInput)),
    ).rejects.toMatchObject({ code: 'connection_aborted' });
    await serverClient.close();
  });

  it('validates accepted Run ownership before opening its event stream', async () => {
    for (const mode of ['malformed-receipt', 'foreign-owner'] as const) {
      const runtime = new HermesFixtureApi();
      const client = await interceptFactory(runtime, ({ method, url }) => {
        if (method === 'POST' && url.pathname === '/v1/runs') {
          return mode === 'malformed-receipt'
            ? jsonResponse({ status: 'started' }, 202)
            : jsonResponse({ run_id: 'run_foreign', status: 'started' }, 202);
        }
        if (
          mode === 'foreign-owner' &&
          method === 'GET' &&
          url.pathname === '/v1/runs/run_foreign'
        ) {
          return jsonResponse({
            object: 'hermes.run',
            run_id: 'run_foreign',
            session_id: 'session_foreign',
            status: 'running',
          });
        }
        return undefined;
      }).connect(createHermesProfile());
      const session = await client.createSession();
      await expect(session.start(textInput)).rejects.toMatchObject({
        code: 'provider_api_incompatible',
      });
      await expect(
        Promise.resolve().then(() => session.start(textInput)),
      ).rejects.toMatchObject({ code: 'connection_aborted' });
      expect(runtime.calls.some(({ path }) => path.endsWith('/events'))).toBe(
        false,
      );
      await client.close();
    }
  });

  it('reports unsupported stop and distinguishes timeout abort from native cancellation', async () => {
    const unsupportedRuntime = new HermesFixtureApi();
    disableCapability(unsupportedRuntime, 'run_stop', 'run_stop');
    const unsupportedClient = await createHermesFixtureFactory(
      unsupportedRuntime,
    ).connect(createHermesProfile());
    const unsupportedSession = await unsupportedClient.createSession();
    const unsupportedRun = await unsupportedSession.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await expect(unsupportedRun.cancel()).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    await unsupportedClient.close();

    const abortRuntime = new HermesFixtureApi();
    disableCapability(abortRuntime, 'run_stop', 'run_stop');
    const abortClient = await createHermesFixtureFactory(abortRuntime).connect(
      createHermesProfile(),
    );
    const abortSession = await abortClient.createSession();
    const aborted = await abortSession.start(
      { parts: [{ type: 'text', text: 'connection abort input' }] },
      { timeoutMs: 2 },
    );
    expect((await aborted.result()).status).toBe('connection_aborted');
    await abortClient.close();

    const nativeClient = await createHermesFixtureFactory().connect(
      createHermesProfile(),
    );
    const nativeSession = await nativeClient.createSession();
    const cancelled = await nativeSession.start(
      { parts: [{ type: 'text', text: 'connection abort input' }] },
      { timeoutMs: 2 },
    );
    expect((await cancelled.result()).status).toBe('cancelled');
    await nativeClient.close();
  });

  it('returns connection uncertainty when stop acknowledgement never settles', async () => {
    const runtime = new HermesFixtureApi();
    const client = await interceptFactory(runtime, ({ method, url }) =>
      method === 'POST' && url.pathname.endsWith('/stop')
        ? jsonResponse({ run_id: 'run_fixture_1', status: 'stopping' })
        : undefined,
    ).connect(createHermesProfile({ cancelSettlementTimeoutMs: 2 }));
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await expect(run.cancel()).resolves.toEqual({ mode: 'connection_aborted' });
    expect((await run.result()).status).toBe('connection_aborted');
    await client.close();
  });

  it('maps stop failures without inventing cancellation', async () => {
    const runtime = new HermesFixtureApi();
    const client = await interceptFactory(runtime, ({ method, url }) =>
      method === 'POST' && url.pathname.endsWith('/stop')
        ? jsonResponse({}, 500)
        : undefined,
    ).connect(createHermesProfile());
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await expect(run.cancel()).rejects.toMatchObject({
      code: 'provider_error',
    });
    await client.close();
    expect((await run.result()).status).toBe('connection_aborted');
  });

  it('supports every documented approval choice and retries a rejected response', async () => {
    for (const response of [
      { kind: 'approval', decision: 'deny' },
      { kind: 'approval', decision: 'approve' },
      { kind: 'provider', value: { choice: 'session' } },
      { kind: 'provider', value: { choice: 'always' } },
      { kind: 'provider', value: { choice: 'deny' } },
    ] as const) {
      const runtime = new HermesFixtureApi();
      runtime.queueScenario('approval');
      const client = await createHermesFixtureFactory(runtime).connect(
        createHermesProfile(),
      );
      const session = await client.createSession();
      const run = await session.start(textInput);
      const { iterator, requestId } = await approvalRequest(run);
      await session.respond(requestId, response);
      await drain(iterator);
      expect((await run.result()).status).toBe('completed');
      await client.close();
    }

    const runtime = new HermesFixtureApi();
    runtime.queueScenario('approval');
    let failures = 1;
    const client = await interceptFactory(runtime, ({ method, url }) => {
      if (
        method === 'POST' &&
        url.pathname.endsWith('/approval') &&
        failures > 0
      ) {
        failures -= 1;
        return jsonResponse({}, 400);
      }
      return undefined;
    }).connect(createHermesProfile());
    const session = await client.createSession();
    const run = await session.start(textInput);
    const { iterator, requestId } = await approvalRequest(run);
    await expect(
      session.respond(requestId, { kind: 'approval', decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await session.respond(requestId, { kind: 'approval', decision: 'approve' });
    await drain(iterator);
    expect((await run.result()).status).toBe('completed');
    await client.close();

    const limitedRuntime = new HermesFixtureApi();
    limitedRuntime.queueScenario('approval-limited');
    const limitedClient = await createHermesFixtureFactory(
      limitedRuntime,
    ).connect(createHermesProfile());
    const limitedSession = await limitedClient.createSession();
    const limitedRun = await limitedSession.start(textInput);
    const limited = await approvalRequest(limitedRun);
    await expect(
      limitedSession.respond(limited.requestId, {
        kind: 'approval',
        decision: 'approve',
        providerOptions: { scope: 'always' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(
      limitedRuntime.calls.some(({ path }) => path.endsWith('/approval')),
    ).toBe(false);
    await limitedSession.respond(limited.requestId, {
      kind: 'approval',
      decision: 'approve',
    });
    await drain(limited.iterator);
    expect((await limitedRun.result()).status).toBe('completed');
    await limitedClient.close();
  });

  it('quarantines an approval whose response delivery is uncertain', async () => {
    for (const mode of ['response-loss', 'server-error'] as const) {
      const runtime = new HermesFixtureApi();
      runtime.queueScenario('approval');
      let interceptResponse = true;
      const client = await interceptFactory(
        runtime,
        async ({ init, input, method, url }) => {
          if (
            interceptResponse &&
            method === 'POST' &&
            url.pathname.endsWith('/approval')
          ) {
            interceptResponse = false;
            await runtime.fetch(input, init);
            if (mode === 'response-loss') {
              throw new TypeError('synthetic response loss');
            }
            return jsonResponse({}, 500);
          }
          return undefined;
        },
      ).connect(createHermesProfile());
      const session = await client.createSession();
      const run = await session.start(textInput);
      const { requestId } = await approvalRequest(run);
      await expect(
        session.respond(requestId, { kind: 'approval', decision: 'approve' }),
      ).rejects.toMatchObject({ code: 'provider_error' });
      await expect(
        Promise.resolve().then(() =>
          session.respond(requestId, {
            kind: 'approval',
            decision: 'approve',
          }),
        ),
      ).rejects.toMatchObject({ code: 'connection_aborted' });
      await run.result();
      await client.close();
    }
  });

  it('accepts matching approval HTTP and SSE evidence in either arrival order', async () => {
    for (const order of ['http-first', 'sse-first'] as const) {
      const runtime = new HermesFixtureApi();
      runtime.queueScenario('approval');
      if (order === 'http-first') runtime.approvalEventDelayMs = 5;
      else runtime.approvalResponseDelayMs = 5;
      const client = await createHermesFixtureFactory(runtime).connect(
        createHermesProfile(),
      );
      const session = await client.createSession();
      const run = await session.start(textInput);
      const { iterator, requestId } = await approvalRequest(run);
      await session.respond(requestId, {
        kind: 'approval',
        decision: 'approve',
      });
      const events = await drain(iterator);
      expect((await run.result()).status).toBe('completed');
      expect(events.at(-1)?.type).toBe('run.completed');
      await client.close();
    }
  });

  it('fails closed when an SSE-first approval contradicts the HTTP acknowledgement', async () => {
    const runtime = new HermesFixtureApi();
    runtime.queueScenario('approval');
    runtime.approvalEventChoice = 'session';
    runtime.approvalResponseDelayMs = 5;
    const client = await createHermesFixtureFactory(runtime).connect(
      createHermesProfile(),
    );
    const session = await client.createSession();
    const run = await session.start(textInput);
    const { requestId } = await approvalRequest(run);
    await expect(
      session.respond(requestId, {
        kind: 'approval',
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'provider_api_incompatible' });
    expect((await run.result()).status).toBe('failed');
    await expect(
      Promise.resolve().then(() => session.start(textInput)),
    ).rejects.toMatchObject({ code: 'connection_aborted' });
    await client.close();
  });

  it('waits for an approval started during terminal drain before settling', async () => {
    const runtime = new HermesFixtureApi();
    let closeEventStream!: () => void;
    let releaseApproval!: () => void;
    let signalTerminalDrain!: () => void;
    const approvalReleased = new Promise<void>((resolve) => {
      releaseApproval = resolve;
    });
    const terminalDrain = new Promise<void>((resolve) => {
      signalTerminalDrain = resolve;
    });
    let statusReads = 0;
    const client = await interceptFactory(
      runtime,
      async ({ init, input, method, url }) => {
        if (method === 'GET' && url.pathname === '/v1/runs/run_fixture_1') {
          statusReads += 1;
          const response = await runtime.fetch(input, init);
          if (statusReads === 2) setTimeout(signalTerminalDrain, 0);
          return response;
        }
        if (method === 'GET' && url.pathname.endsWith('/events')) {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              closeEventStream = () => {
                controller.close();
              };
              for (const event of [
                {
                  event: 'approval.request',
                  run_id: 'run_fixture_1',
                  timestamp: 1,
                  command: 'synthetic command',
                  choices: ['once', 'session'],
                },
                {
                  event: 'run.completed',
                  run_id: 'run_fixture_1',
                  timestamp: 2,
                },
              ]) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify(event)}\n\n`,
                  ),
                );
              }
            },
          });
          return new Response(stream, {
            headers: { 'content-type': 'text/event-stream' },
          });
        }
        if (method === 'POST' && url.pathname.endsWith('/approval')) {
          await approvalReleased;
          return jsonResponse({
            object: 'hermes.run.approval_response',
            run_id: 'run_fixture_1',
            choice: 'session',
            resolved: 1,
          });
        }
        return undefined;
      },
    ).connect(createHermesProfile({ lateEventDrainTimeoutMs: 500 }));
    const session = await client.createSession();
    const run = await session.start(textInput);
    const { requestId } = await approvalRequest(run);
    await terminalDrain;
    const responding = session.respond(requestId, {
      kind: 'approval',
      decision: 'approve',
    });
    closeEventStream();
    await Promise.resolve();
    releaseApproval();
    await expect(responding).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
    expect((await run.result()).status).toBe('connection_aborted');
    await expect(
      Promise.resolve().then(() => session.start(textInput)),
    ).rejects.toMatchObject({ code: 'connection_aborted' });
    await client.close();
  });

  it('fails overlapping or unadvertised approvals and accepts provider resolution', async () => {
    for (const scenario of ['approval-overlap', 'after-terminal'] as const) {
      const runtime = new HermesFixtureApi();
      runtime.queueScenario(scenario);
      const client = await createHermesFixtureFactory(runtime).connect(
        createHermesProfile({ lateEventDrainTimeoutMs: 2 }),
      );
      const session = await client.createSession();
      const run = await session.start(textInput);
      expect((await run.result()).status).toBe('failed');
      await client.close();
    }

    const unsupportedRuntime = new HermesFixtureApi();
    disableCapability(
      unsupportedRuntime,
      'run_approval_response',
      'run_approval',
    );
    unsupportedRuntime.queueScenario('approval');
    const unsupportedClient = await createHermesFixtureFactory(
      unsupportedRuntime,
    ).connect(createHermesProfile());
    const unsupportedSession = await unsupportedClient.createSession();
    const unsupportedRun = await unsupportedSession.start(textInput);
    expect((await unsupportedRun.result()).status).toBe('failed');
    await unsupportedClient.close();

    const resolvedRuntime = new HermesFixtureApi();
    resolvedRuntime.queueScenario('provider-resolved');
    const resolvedClient = await createHermesFixtureFactory(
      resolvedRuntime,
    ).connect(createHermesProfile());
    const resolvedSession = await resolvedClient.createSession();
    const resolvedRun = await resolvedSession.start(textInput);
    const events = await collect(resolvedRun);
    expect(events.map(({ type }) => type)).toContain('interaction.resolved');
    expect((await resolvedRun.result()).status).toBe('completed');
    await resolvedClient.close();
  });

  it('keeps child and unknown observers isolated from parent settlement', async () => {
    let sawSubagent = false;
    for (const scenario of ['subagent', 'unknown'] as const) {
      const runtime = new HermesFixtureApi();
      runtime.queueScenario(scenario);
      const client = await createHermesFixtureFactory(runtime).connect(
        createHermesProfile(),
      );
      client
        .extensions()
        .get<HermesSubagentExtension>(HERMES_SUBAGENT_EXTENSION)
        ?.onEvent(() => {
          throw new Error('ignored observer error');
        });
      client.native<HermesNativeClient>()?.onUnknownEvent(() => {
        throw new Error('ignored observer error');
      });
      const session = await client.createSession();
      const run = await session.start(textInput);
      const events = await collect(run);
      expect((await run.result()).status).toBe('completed');
      if (scenario === 'subagent') {
        sawSubagent = events.some(
          ({ providerEventType }) => providerEventType === 'subagent.start',
        );
      }
      await client.close();
    }
    expect(sawSubagent).toBe(true);
  });

  it('fails unsupported SSE dispatch types closed', async () => {
    const runtime = new HermesFixtureApi();
    const client = await interceptFactory(runtime, ({ method, url }) =>
      method === 'GET' && url.pathname.endsWith('/events')
        ? new Response(
            `event: future\ndata: ${JSON.stringify({
              event: 'message.delta',
              run_id: 'run_fixture_1',
              delta: 'synthetic',
            })}\n\n`,
            { headers: { 'content-type': 'text/event-stream' } },
          )
        : undefined,
    ).connect(createHermesProfile());
    const session = await client.createSession();
    const run = await session.start(textInput);
    expect((await run.result()).status).toBe('failed');
    await client.close();
  });

  it('disposes an open SSE stream after contradictory terminal evidence', async () => {
    const runtime = new HermesFixtureApi();
    runtime.queueScenario('contradictory');
    let streamCancelled = false;
    const client = await interceptFactory(runtime, ({ method, url }) => {
      if (method !== 'GET' || !url.pathname.endsWith('/events')) {
        return undefined;
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                event: 'run.completed',
                run_id: 'run_fixture_1',
                timestamp: 1,
              })}\n\n`,
            ),
          );
        },
        cancel() {
          streamCancelled = true;
        },
      });
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }).connect(createHermesProfile());
    const session = await client.createSession();
    const run = await session.start(textInput);
    expect((await run.result()).status).toBe('failed');
    await expect.poll(() => streamCancelled).toBe(true);
    await expect(
      Promise.resolve().then(() => session.start(textInput)),
    ).rejects.toMatchObject({ code: 'connection_aborted' });
    await client.close();
  });

  it('enforces one event consumer and one pending read', async () => {
    const client = await createHermesFixtureFactory().connect(
      createHermesProfile(),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    const first = run.events()[Symbol.asyncIterator]();
    const second = run.events()[Symbol.asyncIterator]();
    await expect(second.next()).rejects.toMatchObject({ code: 'run_conflict' });
    await first.next();
    await first.next();
    const pending = first.next();
    await expect(first.next()).rejects.toMatchObject({ code: 'run_conflict' });
    await client.close();
    await pending;
  });

  it('bounds the native escape hatch and rejects use after close', async () => {
    const runtime = new HermesFixtureApi();
    const client = await createHermesFixtureFactory(runtime).connect(
      createHermesProfile(),
    );
    const native = client.native<HermesNativeClient>();
    await expect(
      native?.request('v1/capabilities', {
        method: 'POST',
        timeoutMs: 20,
        body: { synthetic: true },
      }),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      native?.request('v1/capabilities', { body: Symbol('not-json') }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await client.close();
    await client.close();
    await expect(native?.request('v1/capabilities')).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });
});

type Intercept = (request: {
  readonly init: RequestInit | undefined;
  readonly input: Parameters<typeof fetch>[0];
  readonly method: string;
  readonly url: URL;
}) => Promise<Response | undefined> | Response | undefined;

function interceptFactory(
  runtime: HermesFixtureApi,
  intercept: Intercept,
): ProviderAdapterFactory {
  const interceptedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method =
      init?.method ?? (input instanceof Request ? input.method : 'GET');
    const response = await intercept({ init, input, method, url });
    return response ?? runtime.fetch(input, init);
  };
  return createHermesProviderFactory({ fetch: interceptedFetch });
}

function disableCapability(
  runtime: HermesFixtureApi,
  feature: string,
  endpoint: string,
): void {
  const document = runtime.capabilityDocument as Record<string, unknown>;
  const features = document['features'] as Record<string, unknown>;
  const endpoints = document['endpoints'] as Record<string, unknown>;
  features[feature] = false;
  Reflect.deleteProperty(endpoints, endpoint);
}

async function approvalRequest(run: HarnessRun): Promise<{
  iterator: AsyncIterator<HarnessEvent>;
  requestId: string;
}> {
  const iterator = run.events()[Symbol.asyncIterator]();
  await iterator.next();
  const requested = await iterator.next();
  if (requested.done) throw new Error('approval request missing');
  const data = requested.value.data as { requestId?: unknown };
  if (typeof data.requestId !== 'string')
    throw new Error('approval request id missing');
  return { iterator, requestId: data.requestId };
}

async function collect(run: HarnessRun): Promise<HarnessEvent[]> {
  return drain(run.events()[Symbol.asyncIterator]());
}

async function drain(
  iterator: AsyncIterator<HarnessEvent>,
): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) return events;
    events.push(next.value);
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
