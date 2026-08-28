import {
  providerId,
  type HarnessClient,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRun,
} from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_PROVIDER_ID,
  CLAUDE_SESSION_COMPATIBILITY_REF,
  createClaudeProviderFactory,
  type ClaudeNativeClient,
  type ClaudeSdkBinding,
  type ClaudeSdkQuery,
  type ClaudeSdkQueryParameters,
} from '../src/index.js';
import {
  createFixtureFactory,
  createTestProfile,
  FixtureClaudeSdk,
  syntheticCwd,
  waitForQuery,
} from './test-support.js';

const clients: HarnessClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(
  sdk = new FixtureClaudeSdk(),
  profile = createTestProfile(),
): Promise<{ client: HarnessClient; sdk: FixtureClaudeSdk }> {
  const client = await createFixtureFactory(sdk).connect(profile);
  clients.push(client);
  return { client, sdk };
}

async function collect(run: HarnessRun): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of run.events()) events.push(event);
  return events;
}

async function nextInteraction(
  iterator: AsyncIterator<HarnessEvent>,
): Promise<HarnessEvent> {
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error('Synthetic Run ended before interaction.');
    if (next.value.type === 'interaction.requested') return next.value;
  }
}

describe('Claude Agent SDK adapter', () => {
  it('reports the SDK contract and refreshes observed runtime identity', async () => {
    const factory = createFixtureFactory();
    expect(factory.descriptor()).toEqual({
      providerId: CLAUDE_PROVIDER_ID,
      displayName: 'Claude Agent SDK',
      connectionKinds: ['sdk'],
      documentationUrl: 'https://code.claude.com/docs/en/agent-sdk/overview',
    });
    const profile = createTestProfile('descriptor');
    const client = await factory.connect(profile);
    clients.push(client);

    await expect(client.descriptor()).resolves.toMatchObject({
      providerId: CLAUDE_PROVIDER_ID,
      profileId: profile.profileId,
      compatibility: 'experimental',
      runtime: {
        name: 'Claude Agent SDK',
        version: '0.3.250-synthetic',
        protocol: 'query() streaming input',
        protocolVersion: 'stable',
      },
      warnings: [{ code: 'runtime_unobserved' }],
    });
    await expect(client.capabilities()).resolves.toMatchObject({
      providerId: CLAUDE_PROVIDER_ID,
      profileId: profile.profileId,
      capabilities: {
        'connection.abort': { mode: 'adapter_controlled' },
        'event.raw': { mode: 'adapter_controlled' },
        'event.reasoning': { mode: 'native' },
        'event.tool': { mode: 'native' },
        'event.usage': { mode: 'native' },
        'input.file': { mode: 'unsupported' },
        'input.image': { mode: 'unsupported' },
        'input.text': { mode: 'native' },
        'interaction.approval': { mode: 'native' },
        'interaction.user_input': { mode: 'native' },
        'native.client': { mode: 'native' },
        'run.cancel': { mode: 'native' },
        'run.stream': { mode: 'native' },
        'session.create': { mode: 'native' },
        'session.resume': { mode: 'native' },
      },
      runtimeIdentity:
        'provider=anthropic.claude-code;strategy=agent-sdk-query;sdk=0.3.250-synthetic;runtime=unobserved',
    });
    expect(client.extensions().list()).toEqual([]);
    expect(client.native<ClaudeNativeClient>()?.runtimeIdentity).toContain(
      'runtime=unobserved',
    );
    expect(
      client.native<{ readonly absent: true }>(
        (value): value is { readonly absent: true } =>
          typeof value === 'object' && value !== null && 'absent' in value,
      ),
    ).toBeUndefined();

    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'Observe runtime.' }],
    });
    await collect(run);
    await expect(client.descriptor()).resolves.toMatchObject({
      compatibility: 'supported',
    });
    await expect(client.descriptor()).resolves.not.toHaveProperty('warnings');
    expect(client.native<ClaudeNativeClient>()?.runtimeIdentity).toContain(
      'runtime=2.1.250-synthetic',
    );
    await expect(client.capabilities()).resolves.toMatchObject({
      capabilities: {
        'anthropic.claude-code.interrupt_receipt': { mode: 'native' },
      },
    });
  });

  it('maps a complete Run and binds SDK options to its Session', async () => {
    const { client, sdk } = await connect();
    const session = await client.createSession({
      workspace: { uri: 'file:///synthetic/workspace' },
      systemContext: 'Synthetic system context.',
      model: { id: 'claude-synthetic' },
      providerOptions: {
        allowedTools: ['SyntheticTool'],
        permissionMode: 'plan',
      },
    });
    const initialRef = session.ref();
    expect(initialRef).toMatchObject({
      compatibilityRef: CLAUDE_SESSION_COMPATIBILITY_REF,
      providerState: { materialized: false },
    });
    const run = await session.start(
      { parts: [{ type: 'text', text: 'Complete a synthetic Run.' }] },
      { providerOptions: { maxBudgetUsd: 1.5, maxTurns: 4 } },
    );
    const [events, result, query] = await Promise.all([
      collect(run),
      run.result(),
      waitForQuery(sdk),
    ]);

    expect(events.map(({ type }) => type)).toEqual([
      'run.started',
      'message.delta',
      'run.completed',
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      finalMessage: 'Synthetic Claude reply.',
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    expect(query.observation.options).toMatchObject({
      allowedTools: ['SyntheticTool'],
      cwd: syntheticCwd,
      includePartialMessages: true,
      maxBudgetUsd: 1.5,
      maxTurns: 4,
      model: 'claude-synthetic',
      permissionMode: 'plan',
      sessionId: initialRef.providerSessionId,
      settingSources: [],
      systemPrompt: 'Synthetic system context.',
    });
    expect(query.observation.options).not.toHaveProperty('resume');
    expect(query.observation.closeCalls).toBe(1);
    expect(session.ref()).toMatchObject({
      providerState: { materialized: true },
    });
    expect(await run.cancel()).toEqual({ mode: 'already_terminal' });
  });

  it('resumes materialized and pre-materialized Session references safely', async () => {
    const sdk = new FixtureClaudeSdk();
    const factory = createFixtureFactory(sdk);
    const profile = createTestProfile('resume');
    const first = await factory.connect(profile);
    clients.push(first);
    const unmaterialized = await first.createSession();
    const unmaterializedRef = unmaterialized.ref();
    await first.close();

    const second = await factory.connect(profile);
    clients.push(second);
    const reopened = await second.resumeSession(unmaterializedRef);
    const firstRun = await reopened.start({
      parts: [{ type: 'text', text: 'Materialize the Session.' }],
    });
    await firstRun.result();
    const materializedRef = reopened.ref();
    await second.close();

    const third = await factory.connect(profile);
    clients.push(third);
    const resumed = await third.resumeSession(materializedRef);
    const resumedRun = await resumed.start({
      parts: [{ type: 'text', text: 'Resume the Session.' }],
    });
    await expect(resumedRun.result()).resolves.toMatchObject({
      status: 'completed',
    });
    expect(sdk.queries.at(-1)?.observation.options).toMatchObject({
      resume: materializedRef.providerSessionId,
    });
    expect(sdk.queries.at(-1)?.observation.options).not.toHaveProperty(
      'sessionId',
    );

    await third.close();
    const fourth = await factory.connect(profile);
    clients.push(fourth);
    const resumedFromStaleRef = await fourth.resumeSession(unmaterializedRef);
    const staleRefRun = await resumedFromStaleRef.start({
      parts: [{ type: 'text', text: 'Resume from a retained pre-run ref.' }],
    });
    await expect(staleRefRun.result()).resolves.toMatchObject({
      status: 'completed',
    });
    expect(sdk.queries.at(-1)?.observation.options).toMatchObject({
      resume: unmaterializedRef.providerSessionId,
    });
    expect(sdk.queries.at(-1)?.observation.options).not.toHaveProperty(
      'sessionId',
    );
  });

  it('settles native interrupt only from an authoritative cancellation result', async () => {
    const { client, sdk } = await connect();
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'cancel conformance input' }],
    });
    const query = await waitForQuery(sdk);
    await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
    await expect(run.result()).resolves.toMatchObject({ status: 'cancelled' });
    expect(query.observation.interruptCalls).toBe(1);
    expect(query.observation.closeCalls).toBe(1);
    await expect(run.cancel()).resolves.toEqual({ mode: 'already_terminal' });
  });

  it('keeps local timeout and Client disposal distinct from native cancellation', async () => {
    const { client, sdk } = await connect();
    const session = await client.createSession();
    const timed = await session.start(
      { parts: [{ type: 'text', text: 'remain active until timeout' }] },
      { timeoutMs: 5 },
    );
    const timedQuery = await waitForQuery(sdk);
    await expect(timed.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    expect(timedQuery.observation.interruptCalls).toBe(0);
    expect(timedQuery.observation.closeCalls).toBe(1);
    await expect(
      session.start({
        parts: [{ type: 'text', text: 'Retry uncertain Session.' }],
      }),
    ).rejects.toMatchObject({
      code: 'connection_aborted',
      providerCode: 'session_quarantined',
    });

    const other = await client.createSession();
    const active = await other.start({
      parts: [{ type: 'text', text: 'connection abort input' }],
    });
    const activeQuery = await waitForQuery(sdk, 1);
    await client.close();
    await expect(active.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    expect(activeQuery.observation.interruptCalls).toBe(0);
    expect(activeQuery.observation.closeCalls).toBe(1);
  });

  it('round-trips approval and user-input interactions atomically', async () => {
    const { client } = await connect();
    const approvalSession = await client.createSession();
    const approvalRun = await approvalSession.start({
      parts: [{ type: 'text', text: 'approval interaction' }],
    });
    const approvalIterator = approvalRun.events()[Symbol.asyncIterator]();
    const approval = await nextInteraction(approvalIterator);
    expect(approval.data).toMatchObject({
      kind: 'approval',
      requestId: 'synthetic-approval-request',
    });
    expect(JSON.stringify(approval.data)).not.toContain(
      'synthetic-sensitive-value',
    );
    await approvalSession.respond('synthetic-approval-request', {
      kind: 'approval',
      decision: 'approve',
    });
    for (;;) {
      if ((await approvalIterator.next()).done) break;
    }
    await expect(approvalRun.result()).resolves.toMatchObject({
      finalMessage: 'permission:allow',
      status: 'completed',
    });
    await expect(
      approvalSession.respond('synthetic-approval-request', {
        kind: 'approval',
        decision: 'deny',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });

    const inputSession = await client.createSession();
    const inputRun = await inputSession.start({
      parts: [{ type: 'text', text: 'user input interaction' }],
    });
    const inputIterator = inputRun.events()[Symbol.asyncIterator]();
    const input = await nextInteraction(inputIterator);
    expect(input.data).toMatchObject({
      kind: 'user_input',
      requestId: 'synthetic-user-input-request',
    });
    await inputSession.respond('synthetic-user-input-request', {
      kind: 'user_input',
      parts: [{ type: 'text', text: 'Synthetic A' }],
    });
    for (;;) {
      if ((await inputIterator.next()).done) break;
    }
    await expect(inputRun.result()).resolves.toMatchObject({
      finalMessage: 'input:answered',
      status: 'completed',
    });
  });

  it('denies outstanding interactions when a Session closes', async () => {
    const { client } = await connect();
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'approval interaction' }],
    });
    const iterator = run.events()[Symbol.asyncIterator]();
    await nextInteraction(iterator);
    await session.close();
    await expect(run.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    await expect(
      session.respond('synthetic-approval-request', {
        kind: 'approval',
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'connection_aborted' });
  });

  it('validates Profile ownership and rejects unsupported options before SDK traffic', async () => {
    const sdk = new FixtureClaudeSdk();
    const factory = createFixtureFactory(sdk);
    const invalidProfiles: HarnessProfile[] = [
      {
        ...createTestProfile('wrong-provider'),
        providerId: providerId('other.provider'),
      },
      {
        ...createTestProfile('wrong-connection'),
        connection: {
          kind: 'endpoint',
          url: 'https://example.invalid',
          ownership: 'external',
        },
      },
      {
        ...createTestProfile('client'),
        connection: { kind: 'sdk', ownership: 'host', client: {} },
      },
      {
        ...createTestProfile('host-factory'),
        connection: { kind: 'sdk', ownership: 'host', factory: {} },
      },
      {
        ...createTestProfile('adapter-factory'),
        connection: { kind: 'sdk', ownership: 'adapter', factory: sdk },
      },
      {
        ...createTestProfile('profile-options'),
        providerOptions: { unknown: true },
      },
    ];
    for (const profile of invalidProfiles) {
      await expect(factory.connect(profile)).rejects.toMatchObject({
        code: 'profile_invalid',
      });
    }
    expect(sdk.queries).toHaveLength(0);

    const client = await factory.connect(createTestProfile('invalid-input'));
    clients.push(client);
    await expect(
      client.createSession({
        providerOptions: { permissionMode: 'bypassPermissions' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    const session = await client.createSession();
    await expect(
      session.start(
        { parts: [{ type: 'text', text: 'Unsupported options.' }] },
        { providerOptions: { unknown: true } },
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(sdk.queries).toHaveLength(0);
  });

  it('maps synchronous SDK startup failure without leaking its detail', async () => {
    const sdk = new FixtureClaudeSdk();
    sdk.queryImplementation = () => {
      throw new Error('synthetic-sensitive-startup-detail');
    };
    const { client } = await connect(sdk, createTestProfile('startup'));
    const session = await client.createSession();
    const failure = await session
      .start({ parts: [{ type: 'text', text: 'Start failure.' }] })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toMatchObject({
      code: 'runtime_not_found',
      providerCode: 'query_start',
    });
    expect((failure as Error).cause).toBeUndefined();
    expect(String(failure)).not.toContain('synthetic-sensitive-startup-detail');
  });

  it('fails and quarantines malformed or prematurely closed SDK streams', async () => {
    const malformedSdk = scriptedSdk([
      initMessage('00000000-0000-4000-8000-000000000001'),
      {
        type: 'result',
        subtype: 'future',
        is_error: false,
        session_id: '00000000-0000-4000-8000-000000000001',
      },
    ]);
    const malformedClient = await createClaudeProviderFactory({
      binding: malformedSdk,
      createUuid: () => '00000000-0000-4000-8000-000000000001',
    }).connect(createTestProfile('malformed'));
    clients.push(malformedClient);
    const malformedSession = await malformedClient.createSession();
    const malformedRun = await malformedSession.start({
      parts: [{ type: 'text', text: 'Malformed stream.' }],
    });
    await expect(malformedRun.result()).resolves.toMatchObject({
      status: 'failed',
      providerResult: { code: 'provider_api_incompatible' },
    });
    await expect(
      malformedSession.start({ parts: [{ type: 'text', text: 'Retry.' }] }),
    ).rejects.toMatchObject({ code: 'connection_aborted' });

    const eofSdk = scriptedSdk([
      initMessage('00000000-0000-4000-8000-000000000001'),
    ]);
    const eofClient = await createClaudeProviderFactory({
      binding: eofSdk,
      createUuid: () => '00000000-0000-4000-8000-000000000001',
    }).connect(createTestProfile('eof'));
    clients.push(eofClient);
    const eofSession = await eofClient.createSession();
    const eofRun = await eofSession.start({
      parts: [{ type: 'text', text: 'Premature EOF.' }],
    });
    await expect(eofRun.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
  });
});

function scriptedSdk(values: readonly unknown[]): ClaudeSdkBinding {
  return {
    sdkVersion: '0.3.250-synthetic',
    getSessionInfo: () => Promise.resolve(undefined),
    query: (_parameters: ClaudeSdkQueryParameters): ClaudeSdkQuery =>
      new ScriptedQuery(values),
  };
}

class ScriptedQuery implements ClaudeSdkQuery {
  readonly #values: readonly unknown[];
  closeCalls = 0;

  constructor(values: readonly unknown[]) {
    this.#values = values;
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    let index = 0;
    return {
      next: () => {
        const value = this.#values[index];
        index += 1;
        return Promise.resolve(
          value === undefined
            ? { done: true, value: undefined }
            : { done: false, value },
        );
      },
    };
  }

  interrupt(): Promise<unknown> {
    return Promise.resolve({});
  }

  close(): void {
    this.closeCalls += 1;
  }
}

function initMessage(sessionId: string): Readonly<Record<string, unknown>> {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    claude_code_version: '2.1.250-synthetic',
    cwd: syntheticCwd,
    model: 'claude-synthetic',
    permissionMode: 'default',
    capabilities: [],
  };
}
