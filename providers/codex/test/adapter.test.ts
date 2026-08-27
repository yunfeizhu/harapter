import {
  profileId,
  providerSessionId,
  providerId,
  type HarnessEvent,
  type HarnessRun,
} from '@harapter/core';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_PROVIDER_ID,
  createCodexProviderFactory,
  type CodexNativeClient,
} from '../src/index.js';
import { createTestProfile } from './test-profile.js';

const clients: { close(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect() {
  return connectProfile(createTestProfile());
}

async function connectProfile(profile: ReturnType<typeof createTestProfile>) {
  const client = await createCodexProviderFactory().connect(profile);
  clients.push(client);
  return client;
}

async function collect(run: HarnessRun): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of run.events()) events.push(event);
  return events;
}

describe('Codex App Server adapter', () => {
  it('reports handshake-derived descriptor, capabilities, and native access', async () => {
    const factory = createCodexProviderFactory();
    expect(factory.descriptor()).toEqual({
      connectionKinds: ['process'],
      displayName: 'Codex App Server',
      documentationUrl: 'https://developers.openai.com/codex/app-server',
      providerId: CODEX_PROVIDER_ID,
    });
    const client = await connect();
    await expect(client.descriptor()).resolves.toMatchObject({
      compatibility: 'supported',
      connectionKind: 'process',
      runtime: {
        name: 'Codex App Server',
        protocol: 'JSONL RPC',
        protocolVersion: 'stable',
        version: '0.0.0-synthetic',
      },
    });
    await expect(client.capabilities()).resolves.toMatchObject({
      capabilities: {
        'event.raw': { mode: 'adapter_controlled' },
        'input.image': { mode: 'native' },
        'input.text': { mode: 'native' },
        'interaction.approval': { mode: 'native' },
        'interaction.user_input': { mode: 'unsupported' },
        'run.cancel': { mode: 'native' },
        'run.stream': { mode: 'native' },
        'session.create': { mode: 'native' },
        'session.resume': { mode: 'native' },
      },
      runtimeIdentity: 'openai.codex;app-server=stable;runtime=0.0.0-synthetic',
    });

    const native = client.native<CodexNativeClient>(
      (value): value is CodexNativeClient =>
        typeof value === 'object' && value !== null && 'request' in value,
    );
    expect(native?.runtimeIdentity).toContain('runtime=0.0.0-synthetic');
    const rejectedNative = client.native<{ readonly missing: true }>(
      (value): value is { readonly missing: true } =>
        typeof value === 'object' && value !== null && 'missing' in value,
    );
    expect(rejectedNative).toBeUndefined();
    expect(client.extensions().list()).toEqual([]);
    const session = await client.createSession();
    expect(session.ref()).toMatchObject({
      compatibilityRef: 'openai.codex;app-server=stable',
      providerState: { createdRuntimeVersion: '0.0.0-synthetic' },
    });
    await expect(session.capabilities()).resolves.toMatchObject({
      runtimeIdentity: 'openai.codex;app-server=stable;runtime=0.0.0-synthetic',
    });
    await session.close();

    const nativeThread = await native?.request<{ thread: { id: string } }>(
      'thread/start',
      {},
    );
    expect(typeof nativeThread?.thread.id).toBe('string');
    await expect(native?.notify('initialized')).resolves.toBeUndefined();
  });

  it('uses the stable protocol contract without locking the runtime version', async () => {
    const client = await connectProfile(
      createTestProfile(
        profileId('codex-alternate-runtime'),
        'alternate-runtime',
      ),
    );
    await expect(client.descriptor()).resolves.toMatchObject({
      compatibility: 'supported',
      runtime: {
        protocolVersion: 'stable',
        version: '0.0.1-synthetic',
      },
    });
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'Stable protocol reply.' }],
    });
    await collect(run);
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    await session.close();
  });

  it('routes Run notifications that arrive before the turn/start response', async () => {
    const client = await connectProfile(
      createTestProfile(
        profileId('codex-pre-response-events'),
        'notifications-before-response',
      ),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'Pre-response event reply.' }],
    });
    const events = await collect(run);
    expect(events.map(({ type }) => type)).toEqual([
      'run.started',
      'message.delta',
      'provider',
      'message.completed',
      'run.completed',
    ]);
    await expect(run.result()).resolves.toEqual({
      finalMessage: 'Pre-response event reply.',
      status: 'completed',
    });
    await session.close();
  });

  it('maps a complete run, redacts unknown raw events, and keeps terminal last', async () => {
    const client = await connect();
    const observedRaw: unknown[] = [];
    const native = client.native<CodexNativeClient>();
    const unsubscribeMutating = native?.onUnknownEvent((event) => {
      if (typeof event.params === 'object' && event.params !== null) {
        Reflect.set(event.params, 'threadId', 'listener-mutated');
      }
    });
    const unsubscribe = native?.onUnknownEvent((event) =>
      observedRaw.push(event),
    );
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'Synthetic adapter reply.' }],
    });
    const [events, result] = await Promise.all([collect(run), run.result()]);

    expect(events.map(({ type }) => type)).toEqual([
      'run.started',
      'message.delta',
      'provider',
      'message.completed',
      'run.completed',
    ]);
    expect(result).toEqual({
      finalMessage: 'Synthetic adapter reply.',
      status: 'completed',
    });
    expect(JSON.stringify(events)).not.toContain('synthetic-sensitive-value');
    expect(JSON.stringify(observedRaw)).not.toContain(
      'synthetic-sensitive-value',
    );
    expect(JSON.stringify(events)).not.toContain('listener-mutated');
    expect(JSON.stringify(observedRaw)).not.toContain('listener-mutated');
    expect(await run.cancel()).toEqual({ mode: 'already_terminal' });
    unsubscribeMutating?.();
    unsubscribe?.();
    await session.close();
  });

  it('round-trips a portable approval without exposing transport identifiers', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'approval interaction' }],
    });
    const iterator = run.events()[Symbol.asyncIterator]();
    const seen: HarnessEvent[] = [];
    let interaction: HarnessEvent | undefined;
    while (!interaction) {
      const next = await iterator.next();
      expect(next.done).toBe(false);
      if (next.done) throw new Error('Run ended before the interaction.');
      seen.push(next.value);
      if (next.value.type === 'interaction.requested') interaction = next.value;
    }
    expect(interaction.data).toMatchObject({
      kind: 'approval',
      prompt: 'Approve a synthetic command.',
    });
    const requestId = (interaction.data as { requestId: string }).requestId;
    expect(requestId).not.toContain('synthetic-approval');
    await session.respond(requestId, {
      kind: 'approval',
      decision: 'approve',
    });
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      seen.push(next.value);
    }
    expect(
      seen.filter(({ type }) => type === 'interaction.resolved'),
    ).toHaveLength(1);
    await expect(run.result()).resolves.toEqual({
      finalMessage: 'approval:accept',
      status: 'completed',
    });
    await expect(
      session.respond(requestId, { kind: 'approval', decision: 'deny' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await session.close();
  });

  it('uses native interrupt for cancellation and local timeout', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'cancel conformance input' }],
    });
    await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
    await expect(run.result()).resolves.toEqual({ status: 'cancelled' });

    const timed = await session.start(
      { parts: [{ type: 'text', text: 'connection abort input' }] },
      { timeoutMs: 10 },
    );
    await expect(timed.result()).resolves.toMatchObject({
      providerResult: { reason: 'timeout' },
      status: 'cancelled',
    });
    await session.close();
  });

  it('aborts the owning connection when interrupt has no terminal result', async () => {
    const client = await connectProfile({
      ...createTestProfile(profileId('codex-interrupt-watchdog')),
      providerOptions: { cancelSettlementTimeoutMs: 20 },
    });
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'interrupt without terminal' }],
    });
    await expect(run.cancel()).resolves.toEqual({
      mode: 'connection_aborted',
    });
    await expect(run.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('maps experimental user input as Provider interaction with rich events, usage, and failures', async () => {
    const client = await connect();
    const session = await client.createSession();

    const interactive = await session.start({
      parts: [{ type: 'text', text: 'user input interaction' }],
    });
    const iterator = interactive.events()[Symbol.asyncIterator]();
    let requestId: string | undefined;
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.type === 'interaction.requested') {
        requestId = (next.value.data as { requestId: string }).requestId;
        break;
      }
    }
    if (requestId === undefined) throw new Error('Expected user input.');
    await session.respond(requestId, {
      kind: 'provider',
      value: {
        answers: {
          'synthetic-question': { answers: ['Synthetic choice.'] },
        },
      },
    });
    for (;;) {
      if ((await iterator.next()).done) break;
    }
    await expect(interactive.result()).resolves.toMatchObject({
      status: 'completed',
    });

    const rich = await session.start({
      parts: [{ type: 'text', text: 'rich events' }],
    });
    const richEvents = await collect(rich);
    expect(
      richEvents
        .map(({ type }) => type)
        .filter((type) => type.startsWith('tool.')),
    ).toEqual(['tool.started', 'tool.updated', 'tool.completed']);
    await expect(rich.result()).resolves.toMatchObject({
      status: 'completed',
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    });

    const failed = await session.start({
      parts: [{ type: 'text', text: 'failed turn' }],
    });
    const failedEvents = await collect(failed);
    expect(JSON.stringify(failedEvents)).not.toContain(
      'Synthetic private error',
    );
    await expect(failed.result()).resolves.toEqual({
      providerResult: { providerCode: 'serverOverloaded' },
      status: 'failed',
    });

    const providerResolved = await session.start({
      parts: [{ type: 'text', text: 'provider resolves interaction' }],
    });
    const providerResolvedEvents = await collect(providerResolved);
    expect(
      providerResolvedEvents
        .filter(({ type }) => type.startsWith('interaction.'))
        .map(({ type }) => type),
    ).toEqual(['interaction.requested', 'interaction.resolved']);

    const image = await session.start({
      parts: [
        {
          type: 'image_ref',
          uri: 'https://example.invalid/synthetic-image.png',
        },
      ],
    });
    await collect(image);
    await expect(image.result()).resolves.toEqual({
      finalMessage: 'image-input',
      status: 'completed',
    });
    await session.close();
    await session.close();
    await expect(async () =>
      session.start({ parts: [{ type: 'text', text: 'closed' }] }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
  });

  it('round-trips an unknown in-run request through Provider interaction', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'provider interaction' }],
    });
    const iterator = run.events()[Symbol.asyncIterator]();
    let requestId: string | undefined;
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.type !== 'interaction.requested') continue;
      expect(next.value.data).toMatchObject({ kind: 'provider' });
      expect(JSON.stringify(next.value.data)).not.toContain(
        'synthetic-sensitive-value',
      );
      requestId = (next.value.data as { requestId: string }).requestId;
      break;
    }
    if (requestId === undefined) throw new Error('Expected Provider request.');
    await session.respond(requestId, {
      kind: 'provider',
      value: { decision: 'synthetic-provider-response' },
    });
    for (;;) {
      if ((await iterator.next()).done) break;
    }
    await expect(run.result()).resolves.toEqual({
      finalMessage: 'approval:synthetic-provider-response',
      status: 'completed',
    });
    await session.close();
  });

  it('releases Provider-resolved request capacity across Runs', async () => {
    const client = await connectProfile({
      ...createTestProfile(profileId('codex-provider-resolution-capacity')),
      providerOptions: { maxPendingInboundRequests: 2 },
    });
    const session = await client.createSession();
    for (let index = 0; index < 3; index += 1) {
      const run = await session.start({
        parts: [
          {
            type: 'text',
            text: `provider resolves interaction ${String(index)}`,
          },
        ],
      });
      const events = await collect(run);
      expect(
        events
          .filter(({ type }) => type.startsWith('interaction.'))
          .map(({ type }) => type),
      ).toEqual(['interaction.requested', 'interaction.resolved']);
      await expect(run.result()).resolves.toMatchObject({
        status: 'completed',
      });
    }
    const sessionAfterCapacityReuse = await client.createSession();
    await sessionAfterCapacityReuse.close();
    await session.close();
  });

  it('keeps late and malformed terminal notifications non-terminal', async () => {
    const client = await connect();
    const native = client.native<CodexNativeClient>();
    const observed: unknown[] = [];
    native?.onUnknownEvent((event) => observed.push(event));
    const session = await client.createSession();

    const seed = await session.start({
      parts: [{ type: 'text', text: 'terminal routing seed' }],
    });
    await collect(seed);

    const late = await session.start({
      parts: [{ type: 'text', text: 'late terminal' }],
    });
    let lateSettled = false;
    void late.result().then(() => {
      lateSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lateSettled).toBe(false);
    await expect(late.cancel()).resolves.toEqual({ mode: 'native' });
    await collect(late);

    const malformed = await session.start({
      parts: [{ type: 'text', text: 'malformed terminal' }],
    });
    const iterator = malformed.events()[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'run.started' },
    });
    const malformedTerminalRead = iterator.next();
    let malformedSettled = false;
    void malformed.result().then(() => {
      malformedSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(malformedSettled).toBe(false);
    await expect(malformed.cancel()).resolves.toEqual({ mode: 'native' });
    await expect(malformedTerminalRead).resolves.toMatchObject({
      value: { type: 'run.cancelled' },
    });
    for (;;) {
      if ((await iterator.next()).done) break;
    }

    const ownerless = await session.start({
      parts: [{ type: 'text', text: 'ownerless approval' }],
    });
    const ownerlessIterator = ownerless.events()[Symbol.asyncIterator]();
    await expect(ownerlessIterator.next()).resolves.toMatchObject({
      value: { type: 'run.started' },
    });
    const ownerlessTerminalRead = ownerlessIterator.next();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(ownerless.cancel()).resolves.toEqual({ mode: 'native' });
    await expect(ownerlessTerminalRead).resolves.toMatchObject({
      value: { type: 'run.cancelled' },
    });
    for (;;) {
      if ((await ownerlessIterator.next()).done) break;
    }
    expect(JSON.stringify(observed)).not.toContain('synthetic-turn');
    expect(observed).toContainEqual(
      expect.objectContaining({ method: 'turn/completed' }),
    );
    expect(observed).toContainEqual(
      expect.objectContaining({
        method: 'item/commandExecution/requestApproval',
      }),
    );
    await session.close();
  });

  it('rejects run conflicts, unsupported input, stale consumers, and remote failures', async () => {
    const client = await connect();
    const session = await client.createSession();
    const active = await session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await expect(
      session.start({ parts: [{ type: 'text', text: 'second turn' }] }),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await active.cancel();
    await expect(
      session.start({
        parts: [{ type: 'file_ref', uri: 'file:///synthetic' }],
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    const rejected = await session
      .start({ parts: [{ type: 'text', text: 'reject turn' }] })
      .catch((error: unknown) => error);
    expect(rejected).toMatchObject({
      code: 'provider_error',
      providerCode: '-32000',
    });

    const completed = await session.start({
      parts: [{ type: 'text', text: 'single consumer' }],
    });
    await collect(completed);
    const second = completed.events()[Symbol.asyncIterator]();
    await expect(second.next()).rejects.toMatchObject({ code: 'run_conflict' });
    await session.close();
  });

  it('rejects concurrent event reads and distinguishes interrupt races and failures', async () => {
    const client = await connect();
    const session = await client.createSession();
    const waiting = await session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    const iterator = waiting.events()[Symbol.asyncIterator]();
    await iterator.next();
    const firstPending = iterator.next();
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await waiting.cancel();
    await expect(firstPending).resolves.toMatchObject({
      done: false,
      value: { type: 'run.cancelled' },
    });

    const raced = await session.start({
      parts: [{ type: 'text', text: 'interrupt race' }],
    });
    await expect(raced.cancel()).resolves.toEqual({ mode: 'already_terminal' });
    await expect(raced.result()).resolves.toMatchObject({
      status: 'completed',
    });

    const terminalThenRejected = await session.start({
      parts: [{ type: 'text', text: 'interrupt terminal then error' }],
    });
    await expect(terminalThenRejected.cancel()).rejects.toMatchObject({
      code: 'provider_error',
    });
    await expect(terminalThenRejected.result()).resolves.toEqual({
      status: 'cancelled',
    });

    const rejected = await session.start({
      parts: [{ type: 'text', text: 'interrupt error' }],
    });
    await expect(rejected.cancel()).rejects.toMatchObject({
      code: 'provider_error',
    });

    await client.close();
    await expect(rejected.result()).resolves.toMatchObject({
      status: 'connection_aborted',
    });
  });

  it('fails closed when active Runs receive a duplicate Provider Turn id', async () => {
    const client = await connectProfile(
      createTestProfile(profileId('codex-duplicate-turn'), 'duplicate-turn-id'),
    );
    const firstSession = await client.createSession();
    const secondSession = await client.createSession();
    const first = await firstSession.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await expect(
      secondSession.start({
        parts: [{ type: 'text', text: 'connection abort input' }],
      }),
    ).rejects.toMatchObject({ code: 'provider_api_incompatible' });
    await expect(first.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('rejects Provider Turn id reuse after an earlier Run completes', async () => {
    const client = await connectProfile(
      createTestProfile(profileId('codex-reused-turn'), 'duplicate-turn-id'),
    );
    const session = await client.createSession();
    const first = await session.start({
      parts: [{ type: 'text', text: 'first completed Turn' }],
    });
    await collect(first);
    await expect(first.result()).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(
      session.start({
        parts: [{ type: 'text', text: 'second Turn with reused id' }],
      }),
    ).rejects.toMatchObject({ code: 'provider_api_incompatible' });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('fails a bounded Run as connection aborted instead of dropping events', async () => {
    const profile = {
      ...createTestProfile(profileId('codex-bounded')),
      providerOptions: { maxRunEvents: 2 },
    };
    const client = await connectProfile(profile);
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'Synthetic buffered reply.' }],
    });
    await expect(run.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    expect((await collect(run)).at(-1)?.type).toBe('connection.aborted');
  });

  it('settles active work as connection aborted when the client closes', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await expect(session.close()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await client.close();
    await expect(run.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    expect((await collect(run)).at(-1)?.type).toBe('connection.aborted');
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await client.close();
  });

  it('forces a bounded exit for a child that ignores normal termination', async () => {
    const client = await connectProfile(
      createTestProfile(profileId('codex-stubborn-child'), 'stubborn'),
    );
    const startedAt = Date.now();
    await client.close();
    expect(Date.now() - startedAt).toBeLessThan(4_500);
  });

  it('fails closed for invalid Profiles and unavailable runtimes', async () => {
    const factory = createCodexProviderFactory();
    await expect(
      factory.connect({
        ...createTestProfile(),
        providerId: providerId('synthetic.other'),
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect({
        ...createTestProfile(),
        connection: {
          kind: 'process',
          command: process.execPath,
          ownership: 'host',
        },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect({
        ...createTestProfile(),
        connection: {
          kind: 'process',
          command: process.execPath,
          envRefs: { TOKEN: { scheme: 'synthetic', id: 'not-resolved' } },
          ownership: 'adapter',
        },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect({
        ...createTestProfile(profileId('codex-missing')),
        connection: {
          kind: 'process',
          command: '/synthetic/missing-codex-runtime',
          ownership: 'adapter',
        },
      }),
    ).rejects.toMatchObject({ code: 'runtime_not_found' });
    await expect(
      factory.connect({
        ...createTestProfile(profileId('codex-options')),
        providerOptions: { unknown: true },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    const sensitiveOptionName = '/private/synthetic/secret\nPROMPT=do-not-log';
    let sensitiveFailure: unknown;
    try {
      await factory.connect({
        ...createTestProfile(profileId('codex-sensitive-option')),
        providerOptions: { [sensitiveOptionName]: true },
      });
    } catch (error) {
      sensitiveFailure = error;
    }
    expect(sensitiveFailure).toMatchObject({
      code: 'profile_invalid',
      message: 'Unsupported Codex Profile option.',
    });
    expect(inspect(sensitiveFailure)).not.toContain(sensitiveOptionName);
    await expect(
      factory.connect({
        ...createTestProfile(profileId('codex-capacity')),
        providerOptions: { maxRunEvents: 1 },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect(
        createTestProfile(
          profileId('codex-malformed-initialize'),
          'malformed-initialize',
        ),
      ),
    ).rejects.toMatchObject({ code: 'provider_api_incompatible' });
    await expect(
      factory.connect(
        createTestProfile(
          profileId('codex-reject-initialize'),
          'reject-initialize',
        ),
      ),
    ).rejects.toMatchObject({ code: 'provider_api_incompatible' });
    await expect(
      factory.connect({
        ...createTestProfile(profileId('codex-invalid-limit')),
        providerOptions: { requestTimeoutMs: 0 },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect({
        ...createTestProfile(profileId('codex-large-request-timeout')),
        providerOptions: { requestTimeoutMs: 2_147_483_648 },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect({
        ...createTestProfile(profileId('codex-large-cancel-timeout')),
        providerOptions: { cancelSettlementTimeoutMs: 2_147_483_648 },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
  });

  it('keeps request-local transport failures scoped to the operation', async () => {
    const client = await connect();
    await expect(
      client.createSession({ systemContext: 'x'.repeat(1_048_576) }),
    ).rejects.toMatchObject({ code: 'provider_error' });
    const session = await client.createSession();
    await expect(
      session.start(
        { parts: [{ type: 'text', text: 'large timeout' }] },
        { timeoutMs: 2_147_483_648 },
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await session.close();
  });

  it('maps request timeouts and unexpected process exit without claiming cancellation', async () => {
    const timed = await connectProfile({
      ...createTestProfile(profileId('codex-timeout')),
      providerOptions: {
        maxBufferedMessages: 16,
        maxMessageBytes: 65_536,
        maxPendingInboundRequests: 16,
        maxPendingRequests: 16,
        maxPendingWrites: 16,
        requestTimeoutMs: 100,
      },
    });
    await expect(
      timed.createSession({ model: { id: 'hold-model' } }),
    ).rejects.toMatchObject({ code: 'timeout' });

    const exited = await connectProfile(
      createTestProfile(profileId('codex-exit'), 'exit-during-turn'),
    );
    const session = await exited.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    await expect(run.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
  });

  it('keeps orphan server requests observable only as redacted native events', async () => {
    const client = await connectProfile(
      createTestProfile(profileId('codex-orphan'), 'orphan-after-thread'),
    );
    const native = client.native<CodexNativeClient>();
    const observed: unknown[] = [];
    native?.onUnknownEvent((event) => {
      observed.push(event);
      throw new Error('Synthetic observer failure.');
    });
    const session = await client.createSession();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(observed).toHaveLength(2);
    expect(JSON.stringify(observed)).not.toContain('synthetic-sensitive-value');
    await session.close();
  });

  it('rejects mismatched resume identities and thread responses before use', async () => {
    const client = await connect();
    const session = await client.createSession();
    await expect(
      client.resumeSession({
        ...session.ref(),
        providerSessionId: providerSessionId(
          session
            .ref()
            .providerSessionId.replace('synthetic-thread', 'mismatch-thread'),
        ),
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    await expect(
      client.createSession({ model: { id: 'reject-model' } }),
    ).rejects.toMatchObject({ code: 'provider_error' });

    const ephemeral = await client.createSession({
      providerOptions: { ephemeral: true },
    });
    expect(ephemeral.ref()).toMatchObject({
      compatibilityRef: 'openai.codex;app-server=stable',
      providerState: {
        createdRuntimeVersion: '0.0.0-synthetic',
        ephemeral: true,
      },
    });
    await expect(ephemeral.capabilities()).resolves.toMatchObject({
      capabilities: {
        'session.resume': { mode: 'unsupported', source: 'configuration' },
      },
    });
    await expect(client.resumeSession(ephemeral.ref())).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    const ephemeralRef = ephemeral.ref();
    if (ephemeralRef.compatibilityRef === undefined) {
      throw new Error('Expected Codex Session compatibility identity.');
    }
    await expect(
      client.resumeSession({
        providerId: ephemeralRef.providerId,
        profileId: ephemeralRef.profileId,
        providerSessionId: ephemeralRef.providerSessionId,
        compatibilityRef: ephemeralRef.compatibilityRef,
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await ephemeral.close();
    await session.close();
  });
});
