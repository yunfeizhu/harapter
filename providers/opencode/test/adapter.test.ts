import {
  HarnessRegistry,
  profileId,
  providerId,
  type HarnessEvent,
  type HarnessProfile,
  type SecretRef,
} from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOpenCodeProviderFactory,
  type OpenCodeNativeClient,
} from '../src/index.js';
import {
  startOpenCodeFixtureServer,
  type OpenCodeFixtureServer,
} from './fixture-server.js';

const servers: OpenCodeFixtureServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe('OpenCode HTTP provider adapter', () => {
  it('connects through host-resolved authentication without retaining a secret', async () => {
    const authorization = 'Bearer fixture-secret';
    const server = await fixture({ authorization });
    const seenRefs: SecretRef[] = [];
    const factory = createOpenCodeProviderFactory({
      resolveAuthHeaders: (reference) => {
        seenRefs.push(reference);
        return { authorization };
      },
    });
    const registry = new HarnessRegistry();
    registry.register(factory);
    const client = await registry.connect(
      profile(server.url, {
        authRef: { scheme: 'fixture', id: 'opencode' },
      }),
    );

    expect(seenRefs).toEqual([{ scheme: 'fixture', id: 'opencode' }]);
    await expect(client.descriptor()).resolves.toMatchObject({
      compatibility: 'supported',
      connectionKind: 'endpoint',
      providerId: 'opencode',
      runtime: {
        name: 'OpenCode Server',
        protocol: 'HTTP/OpenAPI + SSE',
        protocolVersion: 'stable',
        version: 'fixture-current',
      },
    });
    const native = client.native<OpenCodeNativeClient>();
    expect(native?.runtimeIdentity).toContain('runtime=fixture-current');
    await expect(native?.request('global/health')).resolves.toMatchObject({
      body: { healthy: true, version: 'fixture-current' },
      status: 200,
    });
    expect(JSON.stringify(client)).not.toContain(authorization);
    await client.close();
  });

  it('rejects incompatible Profiles before sending Provider traffic', async () => {
    const factory = createOpenCodeProviderFactory();
    await expect(
      factory.connect({
        ...profile('http://127.0.0.1:1/'),
        providerId: providerId('other'),
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect(
        profile('http://127.0.0.1:1/', {
          authRef: { scheme: 'secret', id: 'missing-resolver' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect({
        ...profile('http://127.0.0.1:1/'),
        connection: {
          kind: 'endpoint',
          url: 'http://127.0.0.1:1/',
          transport: 'acp',
          ownership: 'external',
        },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
  });

  it('creates and resumes the owning Session without deleting remote data on close', async () => {
    const server = await fixture();
    const factory = createOpenCodeProviderFactory();
    const first = await factory.connect(profile(server.url));
    const session = await first.createSession({
      workspace: { uri: 'file:///workspace' },
      systemContext: 'Keep the response concise.',
      model: {
        id: 'fixture-model',
        providerOptions: { providerId: 'fixture-provider' },
      },
    });
    const ref = session.ref();
    expect(ref).toMatchObject({
      compatibilityRef: 'opencode;http-openapi=stable',
      providerId: 'opencode',
      providerState: {
        directory: '/workspace',
        model: {
          modelId: 'fixture-model',
          providerId: 'fixture-provider',
        },
        system: 'Keep the response concise.',
      },
    });
    await session.close();
    expect(server.deleteRequests()).toBe(0);
    await first.close();

    const second = await factory.connect(profile(server.url));
    const resumed = await second.resumeSession(ref);
    const run = await resumed.start({
      parts: [{ type: 'text', text: 'resumed input' }],
    });
    await expect(run.result()).resolves.toMatchObject({
      finalMessage: 'fixture answer',
      status: 'completed',
    });
    await second.close();
    expect(server.disposeRequests()).toBe(0);
  });

  it('streams mapped events and settles only from the authoritative response', async () => {
    const server = await fixture();
    const client = await createOpenCodeProviderFactory().connect(
      profile(server.url),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'ordinary input' }],
    });
    const [events, result] = await Promise.all([
      collectEvents(run.events()),
      run.result(),
    ]);

    expect(events.map(({ type }) => type)).toEqual([
      'run.started',
      'usage.updated',
      'message.delta',
      'message.completed',
      'usage.updated',
      'run.completed',
    ]);
    expect(result).toMatchObject({
      finalMessage: 'fixture answer',
      status: 'completed',
    });
    expect(await run.cancel()).toEqual({ mode: 'already_terminal' });
    await client.close();
  });

  it('maps acknowledged abort to native cancellation and nothing stronger', async () => {
    const server = await fixture();
    const client = await createOpenCodeProviderFactory().connect(
      profile(server.url),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'cancel this run' }],
    });

    await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
    await expect(run.result()).resolves.toMatchObject({ status: 'cancelled' });
    expect((await collectEvents(run.events())).at(-1)?.type).toBe(
      'run.cancelled',
    );
    await client.close();
  });

  it('settles active work as connection aborted when the host closes locally', async () => {
    const server = await fixture();
    const client = await createOpenCodeProviderFactory().connect(
      profile(server.url),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await client.close();

    await expect(run.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    expect((await collectEvents(run.events())).at(-1)?.type).toBe(
      'connection.aborted',
    );
    expect(server.disposeRequests()).toBe(0);
  });

  it('round-trips documented permission responses through portable interactions', async () => {
    const server = await fixture();
    const client = await createOpenCodeProviderFactory().connect(
      profile(server.url),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'permission input' }],
    });
    const iterator = run.events()[Symbol.asyncIterator]();
    expect((await nextEvent(iterator)).type).toBe('run.started');
    expect((await nextEvent(iterator)).type).toBe('usage.updated');
    const interaction = await nextEvent(iterator);
    expect(interaction).toMatchObject({
      type: 'interaction.requested',
      data: {
        kind: 'approval',
        prompt: 'pnpm check',
        title: 'OpenCode bash permission',
      },
    });
    const requestId = (interaction.data as { requestId?: unknown }).requestId;
    expect(typeof requestId).toBe('string');
    await session.respond(String(requestId), {
      kind: 'approval',
      decision: 'approve',
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    expect(server.permissionResponses()).toEqual(['once']);
    await iterator.return?.();
    await client.close();
  });

  it('preserves unknown events as redacted Provider events', async () => {
    const server = await fixture();
    const client = await createOpenCodeProviderFactory().connect(
      profile(server.url),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'unknown input' }],
    });
    const events = await collectEvents(run.events());
    const unknown = events.find(
      ({ providerEventType }) => providerEventType === 'future.event',
    );
    expect(unknown?.type).toBe('provider');
    expect(JSON.stringify(unknown)).not.toContain(
      'never retain fixture prompt',
    );
    expect(JSON.stringify(unknown)).not.toContain('fixture-secret');
    await client.close();
  });

  it('never turns malformed SSE or failed HTTP into a successful result', async () => {
    const server = await fixture();
    const client = await createOpenCodeProviderFactory().connect(
      profile(server.url),
    );
    const malformedSession = await client.createSession();
    const malformed = await malformedSession.start({
      parts: [{ type: 'text', text: 'malformed input' }],
    });
    expect((await malformed.result()).status).not.toBe('completed');

    const failureSession = await client.createSession();
    const failure = await failureSession.start({
      parts: [{ type: 'text', text: 'provider failure input' }],
    });
    const failureResult = await failure.result();
    expect(failureResult.status).toBe('failed');
    expect(JSON.stringify(failureResult)).not.toContain('upstream-secret');
    await client.close();
  });

  it('rejects a second active Run on the same Session', async () => {
    const server = await fixture();
    const client = await createOpenCodeProviderFactory().connect(
      profile(server.url),
    );
    const session = await client.createSession();
    const first = await session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await expect(
      session.start({ parts: [{ type: 'text', text: 'second input' }] }),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await client.close();
    await first.result();
  });
});

function profile(
  url: string,
  connection: { readonly authRef?: SecretRef } = {},
): HarnessProfile {
  return {
    profileId: profileId('opencode-fixture'),
    displayName: 'OpenCode fixture',
    providerId: providerId('opencode'),
    connection: {
      kind: 'endpoint',
      url,
      transport: 'http',
      ownership: 'external',
      ...connection,
    },
  };
}

async function fixture(
  options: Parameters<typeof startOpenCodeFixtureServer>[0] = {},
): Promise<OpenCodeFixtureServer> {
  const server = await startOpenCodeFixtureServer(options);
  servers.push(server);
  return server;
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
