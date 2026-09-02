import { pathToFileURL } from 'node:url';
import {
  profileId,
  providerId,
  type HarnessClient,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRun,
} from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DSH_NOTIFICATION_EXTENSION,
  DSH_PROVIDER_ID,
  createDshProviderFactory,
  type DshNativeClient,
  type DshNotificationObserver,
} from '../src/index.js';
import { createTestProfile } from './test-profile.js';

const clients = new Set<HarnessClient>();

afterEach(async () => {
  await Promise.all(
    [...clients].map(async (client) => client.close().catch(() => undefined)),
  );
  clients.clear();
});

describe('DeepSeek Harness Provider Adapter', () => {
  it('exposes detached discovery, experimental runtime identity, and observed capabilities', async () => {
    const factory = createDshProviderFactory();
    const first = factory.descriptor();
    (first.connectionKinds as string[]).push('endpoint');
    expect(factory.descriptor()).toEqual({
      providerId: DSH_PROVIDER_ID,
      displayName: 'DeepSeek Harness SDK Runtime',
      connectionKinds: ['process'],
      documentationUrl:
        'https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/sdk',
    });

    const client = await connect();
    const clientDescriptor = await client.descriptor();
    expect(clientDescriptor).toMatchObject({
      providerId: DSH_PROVIDER_ID,
      compatibility: 'experimental',
      runtime: {
        name: 'deepseek-harness-sdk-runtime',
        protocolVersion: 'current',
      },
      warnings: [{ code: 'pre_release_upstream_protocol' }],
    });
    const runtime = clientDescriptor.runtime;
    if (runtime === undefined) throw new Error('Synthetic runtime is missing.');
    expect(runtime.version).toMatch(/^version-[0-9a-f]{16}$/u);
    expect(runtime.version).not.toContain('synthetic');
    const capabilities = await client.capabilities({ refresh: true });
    expect(capabilities.runtimeIdentity).toMatch(
      /runtime=version-[0-9a-f]{16}$/u,
    );
    expect(capabilities.capabilities).toMatchObject({
      'session.create': { mode: 'native' },
      'session.resume': { mode: 'unsupported' },
      'session.close': { mode: 'adapter_controlled' },
      'run.stream': { mode: 'native' },
      'run.cancel': { mode: 'unsupported' },
      'run.timeout': { mode: 'adapter_controlled' },
      'connection.abort': { mode: 'adapter_controlled' },
      'input.text': { mode: 'native' },
      'input.image': { mode: 'unsupported' },
      'input.file': { mode: 'unsupported' },
      'interaction.approval': { mode: 'unsupported' },
      'event.raw': { mode: 'adapter_controlled' },
      'native.client': { mode: 'native' },
    });
  });

  it('binds local Sessions to the Profile, runtime evidence, and fixed workspace', async () => {
    const client = await connect();
    const session = await client.createSession({
      workspace: { uri: pathToFileURL(process.cwd()).href },
    });
    const reference = session.ref();
    expect(reference).toMatchObject({
      providerId: DSH_PROVIDER_ID,
      profileId: 'dsh-synthetic',
      providerSessionId: 'harapter-dsh-session-1',
      compatibilityRef: 'deepseek.harness;sdk-jsonrpc-stdio=current',
    });
    const providerState = reference.providerState as {
      readonly createdRuntimeVersion?: unknown;
    };
    expect(providerState.createdRuntimeVersion).toMatch(
      /^version-[0-9a-f]{16}$/u,
    );
    await expect(session.capabilities()).resolves.toMatchObject({
      providerId: DSH_PROVIDER_ID,
      profileId: 'dsh-synthetic',
    });
    const second = await client.createSession();
    expect(second.ref().providerSessionId).toBe('harapter-dsh-session-2');

    await expect(
      client.createSession({ workspace: { uri: 'file:///different' } }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(
      client.createSession({ systemContext: 'synthetic' }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
  });

  it('streams a correlated successful interval with one terminal result', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'synthetic answer' }],
    });
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);

    expect(result).toEqual({
      status: 'completed',
      finalMessage: 'synthetic answer',
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      providerResult: { reason: 'completed' },
    });
    expect(events.map(({ type }) => type)).toEqual([
      'run.started',
      'provider',
      'provider',
      'reasoning.delta',
      'message.delta',
      'usage.updated',
      'provider',
      'tool.started',
      'tool.completed',
      'message.completed',
      'usage.updated',
      'run.completed',
    ]);
    expect(events.at(-1)?.data).toEqual(result);
    expect(
      events.every(
        ({ raw }) =>
          raw === undefined || !JSON.stringify(raw).includes('private'),
      ),
    ).toBe(true);
    await expect(run.cancel()).resolves.toEqual({ mode: 'already_terminal' });
  });

  it('buffers an owned interval that arrives before the prompt response', async () => {
    const client = await connect('notifications-before-response');
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'pre-response' }],
    });
    await expect(run.result()).resolves.toMatchObject({
      status: 'completed',
      finalMessage: 'pre-response',
    });
    expect((await collectEvents(run)).at(-1)?.type).toBe('run.completed');
  });

  it('ignores pre-receipt status and raw activity when correlating the owned interval', async () => {
    const client = await connect('raw-before-receipt');
    const session = await client.createSession();
    const run = await session.start(textInput('owned interval'));
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
  });

  it('accepts the current SDK Profile event order without owning setup events', async () => {
    const client = await connect('current-profile');
    const session = await client.createSession();
    const run = await session.start(textInput('current profile'));
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      finalMessage: 'current profile',
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'provider',
          providerEventType: 'session/title',
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain('Synthetic title');
  });

  it.each([
    ['aborted-terminal', 'cancelled', 'run.cancelled', 'aborted'],
    ['blocked-terminal', 'failed', 'run.failed', 'blocked'],
    ['max-tokens-terminal', 'failed', 'run.failed', 'max-tokens'],
    ['interrupted-terminal', 'failed', 'run.failed', 'interrupted'],
    ['error-terminal', 'failed', 'run.failed', 'error'],
  ] as const)(
    'maps %s through the authoritative turn-end reason',
    async (mode, status, terminalType, reason) => {
      const client = await connect(mode);
      const session = await client.createSession();
      const run = await session.start(textInput('terminal mapping'));
      const [events, result] = await Promise.all([
        collectEvents(run),
        run.result(),
      ]);
      expect(result).toMatchObject({
        status,
        providerResult: { reason },
      });
      expect(events.at(-1)?.type).toBe(terminalType);
    },
  );

  it.each([
    ['missing-terminal', 'missing_terminal_reason'],
    ['duplicate-terminal', 'duplicate_terminal_reason'],
    ['unknown-terminal', 'unknown_terminal_reason'],
    ['malformed-aborted-terminal', 'malformed_aborted_reason'],
    ['malformed-error-terminal', 'malformed_error'],
  ] as const)('fails closed for %s', async (mode, reason) => {
    const client = await connect(mode);
    const session = await client.createSession();
    const run = await session.start(textInput('fail closed'));
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    expect(result).toMatchObject({
      status: 'failed',
      providerResult: { reason },
    });
    expect(events.at(-1)?.type).toBe('run.failed');
  });

  it.each([
    ['competing-prompt', 'competing_prompt'],
    ['competing-next-step', 'competing_prompt'],
    ['competing-plugin', 'competing_prompt'],
    ['ambiguous-receipt', 'ambiguous_prompt_receipt'],
    ['ambiguous-plugin-receipt', 'ambiguous_prompt_receipt'],
  ] as const)('quarantines the connection after %s', async (mode, reason) => {
    const client = await connect(mode);
    const session = await client.createSession();
    const run = await session.start(textInput('ambiguous ownership'));
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    expect(result).toMatchObject({
      status: 'failed',
      providerResult: { reason },
    });
    expect(events.at(-1)?.type).toBe('run.failed');
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it.each(['required-unknown', 'malformed-event', 'stale-terminal-sequence'])(
    'quarantines the connection after %s protocol activity',
    async (mode) => {
      const client = await connect(mode);
      const session = await client.createSession();
      const run = await session.start(textInput('incompatible event'));
      await expect(run.result()).resolves.toMatchObject({
        status: 'failed',
        providerResult: { reason: 'provider_api_incompatible' },
      });
      await expect(client.createSession()).rejects.toMatchObject({
        code: 'connection_aborted',
      });
    },
  );

  it('reports process loss as connection abort, never native cancellation', async () => {
    const client = await connect('exit-during-run');
    const session = await client.createSession();
    const run = await session.start(textInput('process loss'));
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    expect(result).toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'transport_ended' },
    });
    expect(events.at(-1)?.type).toBe('connection.aborted');
  });

  it('keeps native cancellation unsupported and Client close connection-scoped', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start(textInput('connection abort input'));
    await expect(run.cancel()).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    await expect(session.close()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await client.close();
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'client_closed' },
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await client.close();
  });

  it('uses timeout only to abort the owning connection', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start(textInput('connection abort input'), {
      timeoutMs: 20,
    });
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'local_timeout' },
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('enforces one active owned interval for the entire connection', async () => {
    const client = await connect();
    const firstSession = await client.createSession();
    const secondSession = await client.createSession();
    const active = await firstSession.start(
      textInput('connection abort input'),
    );
    await expect(
      secondSession.start(textInput('competing run')),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await client.close();
    await active.result();
  });

  it('keeps interactions, resume, and unsupported input explicit', async () => {
    const client = await connect();
    const session = await client.createSession();
    await expect(
      client.resumeSession({
        ...session.ref(),
        providerId: providerId('different.provider'),
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    await expect(
      client.resumeSession({
        ...session.ref(),
        profileId: profileId('different-profile'),
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    await expect(client.resumeSession(session.ref())).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    await expect(
      session.respond('request-synthetic', {
        kind: 'provider',
        value: {},
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(session.start({ parts: [] })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(
      session.start({
        parts: [{ type: 'image_ref', uri: 'file:///synthetic' }],
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(
      session.start(textInput('invalid timeout'), { timeoutMs: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await session.close();
    await session.close();
    await expect(session.start(textInput('closed'))).rejects.toMatchObject({
      code: 'session_not_found',
    });
  });

  it('exposes Provider-bound native and redacted notification observers', async () => {
    const client = await connect('subagent');
    const native = client.native<DshNativeClient>();
    expect(native?.runtimeIdentity).toContain('deepseek.harness');
    const guardedNative = client.native<{ readonly marker: true }>(
      (_value): _value is { readonly marker: true } => false,
    );
    expect(guardedNative).toBeUndefined();
    const observer = client
      .extensions()
      .get<DshNotificationObserver>(DSH_NOTIFICATION_EXTENSION);
    expect(observer).toBeDefined();
    expect(client.extensions().list()).toEqual([
      expect.objectContaining({
        name: DSH_NOTIFICATION_EXTENSION,
        providerId: DSH_PROVIDER_ID,
        stability: 'experimental',
      }),
    ]);

    const notifications: unknown[] = [];
    const unknown: unknown[] = [];
    const disposeNotification = observer?.onNotification((event) => {
      notifications.push(event);
      throw new Error('Synthetic observer failure.');
    });
    const disposeUnknown = native?.onUnknownEvent((event) => {
      unknown.push(event);
    });
    const session = await client.createSession();
    const run = await session.start(textInput('subagent'));
    await run.result();
    expect(notifications.length).toBeGreaterThan(0);
    expect(unknown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'subagent.started' }),
        expect.objectContaining({ method: 'subagent.finished' }),
      ]),
    );
    expect(JSON.stringify(notifications)).not.toContain(
      'synthetic child answer',
    );
    disposeNotification?.();
    disposeUnknown?.();
  });

  it('keeps finished child Session ownership scoped to its Run', async () => {
    const client = await connect('subagent-late');
    const native = client.native<DshNativeClient>();
    const unknown: unknown[] = [];
    native?.onUnknownEvent((event) => {
      unknown.push(event);
    });
    const session = await client.createSession();
    const first = await session.start(textInput('first subagent run'));
    await first.result();
    const second = await session.start(textInput('second root run'));
    const [events, result] = await Promise.all([
      collectEvents(second),
      second.result(),
    ]);
    expect(result).toMatchObject({ status: 'completed' });
    expect(
      events.some(
        ({ providerEventType }) => providerEventType === 'session.event',
      ),
    ).toBe(false);
    expect(unknown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'session.event' }),
        expect.objectContaining({ method: 'subagent.started' }),
      ]),
    );
  });

  it('allows explicit native requests and notifications after initialization', async () => {
    const client = await connect();
    const native = client.native<DshNativeClient>();
    await expect(
      native?.request('synthetic/echo', { type: 'synthetic' }),
    ).resolves.toEqual({ type: 'synthetic' });
    const observed = new Promise<void>((resolveObserved) => {
      native?.onUnknownEvent((event) => {
        if (event.method.startsWith('method-')) resolveObserved();
      });
    });
    await native?.notify('synthetic/notify');
    await observed;
    await client.close();
    await expect(native?.request('synthetic/echo')).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await expect(native?.notify('synthetic/notify')).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('responds safely to Provider-initiated requests without breaking the Run', async () => {
    const client = await connect('server-request');
    const session = await client.createSession();
    const run = await session.start(textInput('server request'));
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
  });

  it('aborts instead of dropping events when the Run queue reaches its bound', async () => {
    const client = await connect(undefined, { maxRunEvents: 2 });
    const session = await client.createSession();
    const run = await session.start(textInput('queue overflow'));
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'event_buffer_overflow' },
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('allows only one event consumer and one pending read', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start(textInput('connection abort input'));
    const first = run.events()[Symbol.asyncIterator]();
    await expect(first.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'run.started' },
    });
    const pending = first.next();
    await expect(first.next()).rejects.toMatchObject({ code: 'run_conflict' });
    const second = run.events()[Symbol.asyncIterator]();
    await expect(second.next()).rejects.toMatchObject({ code: 'run_conflict' });
    await client.close();
    await expect(pending).resolves.toMatchObject({
      value: { type: 'connection.aborted' },
    });
  });

  it.each([
    ['reject-initialize', 'provider_api_incompatible'],
    ['malformed-initialize', 'provider_api_incompatible'],
  ] as const)(
    'maps %s connection failures without remote details',
    async (mode, code) => {
      await expect(connect(mode)).rejects.toMatchObject({ code });
    },
  );

  it('keeps the connection reusable after an authoritative prompt rejection', async () => {
    const client = await connect('reject-prompt');
    const session = await client.createSession();
    await expect(
      session.start(textInput('prompt rejection')),
    ).rejects.toMatchObject({ code: 'provider_error' });
    await expect(client.createSession()).resolves.toBeDefined();
  });

  it.each([
    ['malformed-prompt', 'provider_api_incompatible'],
    ['malformed-prompt-after-complete', 'provider_api_incompatible'],
    ['exit-on-prompt', 'connection_aborted'],
  ] as const)(
    'maps %s prompt failures without manufacturing a Run',
    async (mode, code) => {
      const client = await connect(mode);
      const session = await client.createSession();
      await expect(
        session.start(textInput('prompt failure')),
      ).rejects.toMatchObject({ code });
      await expect(client.createSession()).rejects.toMatchObject({
        code: 'connection_aborted',
      });
    },
  );

  it('maps a bounded prompt wait timeout without implying run cancellation', async () => {
    const client = await connect('hold-prompt', { requestTimeoutMs: 500 });
    const session = await client.createSession();
    await expect(session.start(textInput('held prompt'))).rejects.toMatchObject(
      {
        code: 'timeout',
      },
    );
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('maps a missing executable to runtime_not_found', async () => {
    const profile = createTestProfile();
    await expect(
      createDshProviderFactory().connect({
        ...profile,
        connection: {
          kind: 'process',
          command: '/synthetic/missing/dsh-runtime',
          ownership: 'adapter',
        },
      }),
    ).rejects.toMatchObject({ code: 'runtime_not_found' });
  });

  it('rejects invalid Profile ownership, shape, and connection limits before spawn', async () => {
    const factory = createDshProviderFactory();
    const base = createTestProfile();
    const { providerOptions: _providerOptions, ...withoutProviderOptions } =
      base;
    const invalidProfiles: HarnessProfile[] = [
      { ...base, providerId: providerId('different.provider') },
      {
        ...base,
        connection: {
          kind: 'process',
          command: process.execPath,
          ownership: 'host',
        },
      },
      {
        ...base,
        connection: { kind: 'process', command: '', ownership: 'adapter' },
      },
      {
        ...base,
        connection: {
          kind: 'process',
          command: process.execPath,
          ownership: 'adapter',
          envRefs: { TOKEN: { scheme: 'secret', id: 'synthetic' } },
        },
      },
      { ...base, providerOptions: { model: 'model' } },
      { ...base, providerOptions: { provider: 'provider' } },
      withoutProviderOptions,
      {
        ...base,
        providerOptions: {
          provider: 'provider',
          model: 'model',
          futureOption: true,
        },
      },
      {
        ...base,
        providerOptions: { provider: '', model: 'model' },
      },
      {
        ...base,
        providerOptions: {
          provider: 'provider',
          model: 'model',
          reasoningEffort: '',
        },
      },
      {
        ...base,
        providerOptions: { provider: 'provider', model: 'model', maxTokens: 0 },
      },
      {
        ...base,
        providerOptions: {
          provider: 'provider',
          model: 'model',
          maxRunEvents: 1,
        },
      },
      {
        ...base,
        providerOptions: {
          provider: 'provider',
          model: 'model',
          maxRunEvents: 4_097,
        },
      },
      {
        ...base,
        providerOptions: {
          provider: 'provider',
          model: 'model',
          requestTimeoutMs: 2_147_483_648,
        },
      },
    ];
    for (const profile of invalidProfiles) {
      await expect(factory.connect(profile)).rejects.toMatchObject({
        code: 'profile_invalid',
      });
    }
  });

  it('accepts all bounded transport and handshake Profile options', async () => {
    const client = await connect(undefined, {
      provider: 'synthetic-provider',
      model: 'synthetic-model',
      reasoningEffort: 'synthetic-effort',
      maxTokens: 100,
      maxBufferedMessages: 16,
      maxMessageBytes: 4096,
      maxPendingInboundRequests: 4,
      maxPendingRequests: 4,
      maxPendingWrites: 4,
      maxRunEvents: 16,
      requestTimeoutMs: 1_000,
      shutdownTimeoutMs: 100,
    });
    await expect(client.descriptor()).resolves.toMatchObject({
      compatibility: 'experimental',
    });
  });

  it('closes after a bounded shutdown wait when the runtime does not answer', async () => {
    const client = await connect('shutdown-no-response', {
      shutdownTimeoutMs: 20,
    });
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('force-terminates an adapter-owned runtime that ignores graceful shutdown', async () => {
    const client = await connect('stubborn', { shutdownTimeoutMs: 20 });
    await expect(client.close()).resolves.toBeUndefined();
  });
});

async function connect(
  mode?: string,
  providerOptions: Readonly<Record<string, unknown>> = {},
): Promise<HarnessClient> {
  const client = await createDshProviderFactory().connect(
    createTestProfile(profileId('dsh-synthetic'), mode, providerOptions),
  );
  clients.add(client);
  return client;
}

function textInput(text: string) {
  return { parts: [{ type: 'text' as const, text }] };
}

async function collectEvents(run: HarnessRun): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of run.events()) events.push(event);
  return events;
}
