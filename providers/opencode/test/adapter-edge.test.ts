import {
  profileId,
  providerId,
  providerSessionId,
  type HarnessClient,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRun,
  type InteractionResponse,
  type SecretRef,
  type SessionRef,
} from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
  type OpenCodeNativeClient,
} from '../src/index.js';
import { OPENCODE_SESSION_COMPATIBILITY_REF } from '../src/protocol.js';
import {
  startOpenCodeFixtureServer,
  type OpenCodeFixtureServer,
  type OpenCodeFixtureServerOptions,
} from './fixture-server.js';

const servers: OpenCodeFixtureServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('OpenCode adapter edge behavior', () => {
  it('returns isolated Provider descriptors and rejects invalid connection shapes', async () => {
    const factory = createOpenCodeProviderFactory();
    const first = factory.descriptor();
    const second = factory.descriptor();
    expect(first).not.toBe(second);
    expect(first.connectionKinds).not.toBe(second.connectionKinds);

    const invalidProfiles: HarnessProfile[] = [
      { ...profile('http://127.0.0.1:1/'), providerId: providerId('other') },
      {
        ...profile('http://127.0.0.1:1/'),
        connection: { kind: 'process', command: 'opencode', ownership: 'host' },
      },
      {
        ...profile('http://127.0.0.1:1/'),
        connection: {
          kind: 'endpoint',
          url: '',
          transport: 'http',
          ownership: 'external',
        },
      },
      {
        ...profile('http://127.0.0.1:1/'),
        connection: {
          kind: 'endpoint',
          url: 'http://127.0.0.1:1/',
          transport: 'sse',
          ownership: 'external',
        },
      },
    ];
    for (const invalid of invalidProfiles) {
      await expect(factory.connect(invalid)).rejects.toMatchObject({
        code: 'profile_invalid',
      });
    }
    await expect(factory.connect(profile('not a URL'))).rejects.toMatchObject({
      code: 'profile_invalid',
    });
    await expect(
      factory.connect(profile('http://127.0.0.1:1/', { requestTimeoutMs: 20 })),
    ).rejects.toMatchObject({ code: 'connection_failed' });
  });

  it('validates every bounded Profile option before opening a connection', async () => {
    const invalidOptions: unknown[] = [
      [],
      { unknown: true },
      { maxRunEvents: 0 },
      { maxRunEvents: 1 },
      { maxRunEvents: 1.5 },
      { maxRunEvents: 4097 },
      { cancelSettlementTimeoutMs: 0 },
      { cancelSettlementTimeoutMs: 2_147_483_648 },
      { eventDrainTimeoutMs: 'fast' },
      { requestTimeoutMs: -1 },
      { runRequestTimeoutMs: Number.NaN },
      { sseConnectTimeoutMs: 2_147_483_648 },
    ];
    for (const providerOptions of invalidOptions) {
      await expect(
        createOpenCodeProviderFactory().connect({
          ...profile('http://127.0.0.1:1/'),
          providerOptions: providerOptions as Readonly<Record<string, unknown>>,
        }),
      ).rejects.toMatchObject({ code: 'profile_invalid' });
    }
  });

  it('fails closed when host authentication resolution is absent or malformed', async () => {
    const authRef = { scheme: 'fixture', id: 'opencode' } as const;
    await expect(
      createOpenCodeProviderFactory().connect(
        profile('http://127.0.0.1:1/', {}, authRef),
      ),
    ).rejects.toMatchObject({ code: 'profile_invalid' });

    const resolvers: ((
      reference: SecretRef,
    ) => Readonly<Record<string, string>>)[] = [
      (() => undefined) as never,
      (() => ({ authorization: 1 })) as never,
      () => {
        throw new Error('secret resolution failed');
      },
    ];
    for (const resolver of resolvers) {
      await expect(
        createOpenCodeProviderFactory({ resolveAuthHeaders: resolver }).connect(
          profile('http://127.0.0.1:1/', {}, authRef),
        ),
      ).rejects.toMatchObject({ code: 'authentication_failed' });
    }
  });

  it('maps health status, content, encoding, JSON, and timeout failures', async () => {
    const cases: readonly [OpenCodeFixtureServerOptions, string][] = [
      [{ healthStatus: 401 }, 'authentication_failed'],
      [{ healthStatus: 403 }, 'authentication_failed'],
      [{ healthStatus: 404 }, 'provider_api_incompatible'],
      [{ healthStatus: 500 }, 'provider_error'],
      [{ healthContentType: 'text/plain' }, 'provider_api_incompatible'],
      [{ healthRawBody: '{' }, 'provider_api_incompatible'],
      [{ healthRawBody: new Uint8Array([0xff]) }, 'provider_api_incompatible'],
      [
        { healthBody: { healthy: true, version: '' } },
        'provider_api_incompatible',
      ],
    ];
    for (const [options, code] of cases) {
      const server = await fixture(options);
      await expect(
        createOpenCodeProviderFactory().connect(profile(server.url)),
      ).rejects.toMatchObject({ code });
    }

    const slow = await fixture({ healthDelayMs: 30 });
    await expect(
      createOpenCodeProviderFactory().connect(
        profile(slow.url, { requestTimeoutMs: 5 }),
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('exposes capabilities and bounded native access while preserving host ownership', async () => {
    const { client, server } = await connected({
      profileOptions: {
        cancelSettlementTimeoutMs: 20,
        eventDrainTimeoutMs: 5,
        maxRunEvents: 64,
        requestTimeoutMs: 1_000,
        runRequestTimeoutMs: 1_000,
        sseConnectTimeoutMs: 1_000,
      },
    });
    await expect(client.capabilities()).resolves.toMatchObject({
      capabilities: {
        'input.file': { mode: 'native' },
        'interaction.approval': { mode: 'native' },
        'run.concurrent': { limits: { perSession: 1 }, mode: 'unsupported' },
        'run.timeout': { mode: 'emulated' },
        'session.close': { mode: 'adapter_controlled' },
      },
      providerId: OPENCODE_PROVIDER_ID,
    });
    expect(
      client.native(
        (value): value is { missing: true } =>
          typeof value === 'object' && value !== null && 'missing' in value,
      ),
    ).toBe(undefined);
    const native = requiredNative(client);
    const controller = new AbortController();
    await expect(
      native.request('instance/dispose', {
        method: 'POST',
        body: { reason: 'fixture' },
        signal: controller.signal,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({ body: true, status: 200 });
    expect(server.disposeRequests()).toBe(1);
    await expect(native.request('missing')).resolves.toMatchObject({
      status: 404,
    });

    const session = await client.createSession();
    await expect(session.capabilities()).resolves.toMatchObject({
      providerId: OPENCODE_PROVIDER_ID,
    });
    await client.close();
    await client.close();
    await expect(native.request('global/health')).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('surfaces unrouteable events only through the redacted native listener', async () => {
    const { client } = await connected();
    const native = requiredNative(client);
    const observed: unknown[] = [];
    native.onUnknownEvent((event) => {
      (event as { type: string }).type = 'mutated';
      throw new Error('observer failure');
    });
    const unsubscribe = native.onUnknownEvent((event) => observed.push(event));
    const session = await client.createSession();
    const run = await session.start(textInput('orphan input'));
    await run.result();
    expect(observed).toMatchObject([{ type: 'future.orphan' }]);
    expect(JSON.stringify(observed)).not.toContain('never retain orphan data');
    unsubscribe();
    const second = await session.start(textInput('orphan again'));
    await second.result();
    expect(observed).toHaveLength(1);
    await client.close();
  });

  it('maps create and resume failures without weakening Session ownership', async () => {
    for (const [status, code] of [
      [400, 'invalid_request'],
      [404, 'session_not_found'],
      [409, 'run_conflict'],
      [500, 'provider_error'],
    ] as const) {
      const { client } = await connected({
        serverOptions: { sessionCreateStatus: status },
      });
      await expect(client.createSession()).rejects.toMatchObject({ code });
      await client.close();
    }
    const malformed = await connected({
      serverOptions: { sessionCreateBody: { id: 'ses_bad' } },
    });
    await expect(malformed.client.createSession()).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
    await malformed.client.close();

    const missing = await connected();
    await expect(
      missing.client.resumeSession(ref('ses_missing', '/workspace')),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    await missing.client.close();

    const mismatch = await connected({
      serverOptions: { resumeMismatch: true },
    });
    const created = await mismatch.client.createSession({
      workspace: { uri: 'file:///workspace' },
    });
    await expect(
      mismatch.client.resumeSession(created.ref()),
    ).rejects.toMatchObject({
      code: 'session_provider_mismatch',
    });
    await mismatch.client.close();

    for (const sessionStatus of ['busy', 'retry'] as const) {
      const active = await connected({ serverOptions: { sessionStatus } });
      const activeSession = await active.client.createSession();
      await expect(
        active.client.resumeSession(activeSession.ref()),
      ).rejects.toMatchObject({ code: 'connection_aborted' });
      await active.client.close();
    }
  });

  it('keeps local Session close idempotent and aborts only its active Run', async () => {
    const { client, server } = await connected();
    const session = await client.createSession();
    const run = await session.start(textInput('connection abort input'));
    await session.close();
    await session.close();
    await expect(run.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    expect(() => session.start(textInput('closed'))).toThrow(
      expect.objectContaining({ code: 'connection_aborted' }),
    );
    expect(() =>
      session.respond('missing', { kind: 'approval', decision: 'deny' }),
    ).toThrow(expect.objectContaining({ code: 'connection_aborted' }));
    expect(server.deleteRequests()).toBe(0);
    await client.close();
  });

  it('accepts every documented permission decision and rejects malformed responses', async () => {
    const decisions: readonly [InteractionResponse, string][] = [
      [{ kind: 'approval', decision: 'deny' }, 'reject'],
      [
        {
          kind: 'approval',
          decision: 'approve',
          providerOptions: { scope: 'always' },
        },
        'always',
      ],
      [{ kind: 'provider', value: { response: 'once' } }, 'once'],
    ];
    for (const [response, expected] of decisions) {
      const { client, server } = await connected();
      const session = await client.createSession();
      const run = await session.start(textInput('permission input'));
      const { requestId } = await interactionRequest(run);
      await session.respond(requestId, response);
      await expect(run.result()).resolves.toMatchObject({
        status: 'completed',
      });
      expect(server.permissionResponses()).toEqual([expected]);
      await client.close();
    }

    const { client } = await connected();
    const session = await client.createSession();
    await expect(
      session.respond('missing', { kind: 'approval', decision: 'deny' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    const run = await session.start(textInput('permission input'));
    const { requestId } = await interactionRequest(run);
    for (const response of [
      { kind: 'provider', value: { response: 'future' } },
      { kind: 'approval', decision: 'approve', providerOptions: {} },
      {
        kind: 'approval',
        decision: 'approve',
        providerOptions: { scope: 'once' },
      },
      { kind: 'provider', value: null },
    ] as InteractionResponse[]) {
      await expect(session.respond(requestId, response)).rejects.toMatchObject({
        code: 'invalid_request',
      });
    }
    await session.respond(requestId, { kind: 'approval', decision: 'approve' });
    await run.result();
    await client.close();
  });

  it('deduplicates permissions, observes Provider resolution, and rejects false acknowledgements', async () => {
    const resolved = await connected({
      serverOptions: {
        duplicatePermission: true,
        providerResolvesPermission: true,
      },
    });
    const resolvedSession = await resolved.client.createSession();
    const resolvedRun = await resolvedSession.start(
      textInput('permission input'),
    );
    const events = await collectEvents(resolvedRun.events());
    expect(
      events.filter(({ type }) => type === 'interaction.requested'),
    ).toHaveLength(1);
    expect(
      events.filter(({ type }) => type === 'interaction.resolved'),
    ).toHaveLength(1);
    await resolved.client.close();

    const rejected = await connected({
      serverOptions: { permissionAcknowledged: false },
    });
    const rejectedSession = await rejected.client.createSession();
    const rejectedRun = await rejectedSession.start(
      textInput('permission input'),
    );
    const { requestId } = await interactionRequest(rejectedRun);
    await expect(
      rejectedSession.respond(requestId, {
        kind: 'approval',
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'provider_error' });
    await rejected.client.close();
    await rejectedRun.result();
  });

  it('atomically claims one permission response before Provider I/O', async () => {
    const { client, server } = await connected({
      serverOptions: { permissionResponseDelayMs: 20 },
    });
    const session = await client.createSession();
    const run = await session.start(textInput('permission input'));
    const { requestId } = await interactionRequest(run);
    const first = session.respond(requestId, {
      kind: 'approval',
      decision: 'approve',
    });
    await expect(
      session.respond(requestId, { kind: 'approval', decision: 'deny' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await first;
    await run.result();
    expect(server.permissionResponses()).toEqual(['once']);
    await client.close();
  });

  it('resolves outstanding interactions before terminal connection loss', async () => {
    const { client } = await connected();
    const session = await client.createSession();
    const run = await session.start(textInput('permission input'));
    const iterator = run.events()[Symbol.asyncIterator]();
    const observed: HarnessEvent[] = [];
    for (;;) {
      const event = await nextEvent(iterator);
      observed.push(event);
      if (event.type === 'interaction.requested') break;
    }
    await client.close();
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      observed.push(next.value);
    }
    expect(observed.slice(-2).map(({ type }) => type)).toEqual([
      'interaction.resolved',
      'connection.aborted',
    ]);
    await expect(run.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
  });

  it('uses native cancellation only when abort acknowledgement and terminal evidence agree', async () => {
    const rejected = await connected({
      serverOptions: { abortAcknowledged: false },
    });
    const rejectedSession = await rejected.client.createSession();
    const rejectedRun = await rejectedSession.start(textInput('cancel input'));
    await expect(rejectedRun.cancel()).rejects.toMatchObject({
      code: 'provider_error',
    });
    await rejected.client.close();
    await rejectedRun.result();

    const unsettled = await connected({
      profileOptions: { cancelSettlementTimeoutMs: 5, eventDrainTimeoutMs: 1 },
      serverOptions: { abortSettles: false },
    });
    const unsettledSession = await unsettled.client.createSession();
    const unsettledRun = await unsettledSession.start(
      textInput('cancel input'),
    );
    await expect(unsettledRun.cancel()).resolves.toEqual({
      mode: 'connection_aborted',
    });
    await expect(unsettledRun.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    await unsettled.client.close();
  });

  it('implements local timeout through native abort and records the terminal reason', async () => {
    const { client } = await connected({
      profileOptions: { cancelSettlementTimeoutMs: 50, eventDrainTimeoutMs: 1 },
    });
    const session = await client.createSession();
    const run = await session.start(textInput('cancel input'), {
      timeoutMs: 5,
    });
    await expect(run.result()).resolves.toMatchObject({
      providerResult: { reason: 'timeout' },
      status: 'cancelled',
    });
    await client.close();
  });

  it('bounds event buffering and rejects multiple or overlapping consumers', async () => {
    const overflow = await connected({ profileOptions: { maxRunEvents: 2 } });
    const overflowSession = await overflow.client.createSession();
    const overflowRun = await overflowSession.start(
      textInput('event overflow input'),
    );
    await expect(overflowRun.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    await overflow.client.close();

    const pending = await connected();
    const pendingSession = await pending.client.createSession();
    const pendingRun = await pendingSession.start(textInput('cancel input'));
    const iterator = pendingRun.events()[Symbol.asyncIterator]();
    await nextEvent(iterator);
    await nextEvent(iterator);
    const firstRead = iterator.next();
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await pendingRun.cancel();
    await firstRead;
    await expect(
      pendingRun.events()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await pending.client.close();
  });

  it('fails invalid initial and in-run SSE behavior without reporting success', async () => {
    for (const sseConnectMode of ['eof', 'named', 'wrong-type'] as const) {
      const { client } = await connected({ serverOptions: { sseConnectMode } });
      const session = await client.createSession();
      await expect(session.start(textInput('input'))).rejects.toMatchObject({
        code: 'provider_api_incompatible',
      });
      await client.close();
    }

    const named = await connected();
    const namedSession = await named.client.createSession();
    const namedRun = await namedSession.start(textInput('named SSE input'));
    await expect(namedRun.result()).resolves.toMatchObject({
      status: 'failed',
    });
    await named.client.close();

    const closed = await connected();
    const closedSession = await closed.client.createSession();
    const closedRef = closedSession.ref();
    const closedRun = await closedSession.start(
      textInput('close stream input'),
    );
    await expect(closedRun.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    expect(() => closedSession.start(textInput('unsafe reuse'))).toThrow(
      expect.objectContaining({ code: 'connection_aborted' }),
    );
    await expect(closed.client.resumeSession(closedRef)).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await closed.client.close();
  });

  it('quarantines a Session after uncertain message request timeout', async () => {
    const { client } = await connected({
      profileOptions: { eventDrainTimeoutMs: 1, runRequestTimeoutMs: 5 },
    });
    const session = await client.createSession();
    const sessionRef = session.ref();
    const run = await session.start(textInput('connection abort input'));
    await expect(run.result()).resolves.toMatchObject({
      providerResult: { error: 'timeout' },
      status: 'failed',
    });
    expect(() => session.start(textInput('unsafe reuse'))).toThrow(
      expect.objectContaining({ code: 'connection_aborted' }),
    );
    await expect(client.resumeSession(sessionRef)).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await client.close();
  });

  it('maps Provider terminal failures and empty successful output explicitly', async () => {
    const { client } = await connected();
    const failedSession = await client.createSession();
    const failed = await failedSession.start(
      textInput('assistant failure input'),
    );
    await expect(failed.result()).resolves.toMatchObject({
      providerResult: { error: 'SyntheticProviderFailure' },
      status: 'failed',
    });

    const emptySession = await client.createSession();
    const empty = await emptySession.start(textInput('empty final input'));
    const emptyResult = await empty.result();
    expect(emptyResult).toMatchObject({
      providerResult: { finish: 'stop' },
      status: 'completed',
      usage: { inputTokens: 4, outputTokens: 0 },
    });
    const providerResult = emptyResult.providerResult as
      { readonly messageId?: unknown } | undefined;
    expect(providerResult?.messageId).toMatch(/^msg_/u);
    expect(
      (await collectEvents(empty.events())).some(
        ({ type }) => type === 'message.completed',
      ),
    ).toBe(false);
    await client.close();
  });
});

function profile(
  url: string,
  providerOptions: Readonly<Record<string, unknown>> = {},
  authRef?: SecretRef,
): HarnessProfile {
  return {
    profileId: profileId('opencode-edge'),
    displayName: 'OpenCode edge fixture',
    providerId: OPENCODE_PROVIDER_ID,
    connection: {
      kind: 'endpoint',
      url,
      transport: 'http',
      ownership: 'external',
      ...(authRef === undefined ? {} : { authRef }),
    },
    ...(Object.keys(providerOptions).length === 0 ? {} : { providerOptions }),
  };
}

async function connected(
  options: {
    readonly profileOptions?: Readonly<Record<string, unknown>>;
    readonly serverOptions?: OpenCodeFixtureServerOptions;
  } = {},
): Promise<{
  readonly client: HarnessClient;
  readonly server: OpenCodeFixtureServer;
}> {
  const server = await fixture(options.serverOptions);
  const client = await createOpenCodeProviderFactory().connect(
    profile(server.url, options.profileOptions),
  );
  return { client, server };
}

async function fixture(
  options: OpenCodeFixtureServerOptions = {},
): Promise<OpenCodeFixtureServer> {
  const server = await startOpenCodeFixtureServer(options);
  servers.push(server);
  return server;
}

function textInput(text: string) {
  return { parts: [{ type: 'text' as const, text }] };
}

function ref(id: string, directory: string): SessionRef {
  return {
    providerId: OPENCODE_PROVIDER_ID,
    profileId: profileId('opencode-edge'),
    providerSessionId: providerSessionId(id),
    compatibilityRef: OPENCODE_SESSION_COMPATIBILITY_REF,
    providerState: { directory },
  };
}

function requiredNative(client: HarnessClient): OpenCodeNativeClient {
  const native = client.native<OpenCodeNativeClient>();
  if (native === undefined) throw new Error('Expected OpenCode native client.');
  return native;
}

async function interactionRequest(
  run: HarnessRun,
): Promise<{ readonly requestId: string }> {
  const iterator = run.events()[Symbol.asyncIterator]();
  for (;;) {
    const event = await nextEvent(iterator);
    if (event.type !== 'interaction.requested') continue;
    const data = event.data as { readonly requestId?: unknown };
    if (typeof data.requestId !== 'string') {
      throw new Error('Expected an OpenCode interaction request id.');
    }
    return { requestId: data.requestId };
  }
}

async function collectEvents(
  iterable: AsyncIterable<HarnessEvent>,
): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

async function nextEvent(
  iterator: AsyncIterator<HarnessEvent>,
): Promise<HarnessEvent> {
  const next = await iterator.next();
  if (next.done) throw new Error('Expected another OpenCode event.');
  return next.value;
}
