import {
  providerSessionId,
  type HarnessClient,
  type HarnessProfile,
  type HarnessRun,
  type HarnessSession,
  type InteractionResponse,
  type SessionRef,
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
} from './test-support.js';

const clients: HarnessClient[] = [];
const firstSessionId = '00000000-0000-4000-8000-000000000001';

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('Claude Agent SDK adapter edge behavior', () => {
  it('validates generated and resumed Session identity before Provider use', async () => {
    const duplicateFactory = createClaudeProviderFactory({
      binding: new FixtureClaudeSdk(),
      createUuid: () => firstSessionId,
    });
    const duplicateClient = await duplicateFactory.connect(
      createTestProfile('duplicate-id'),
    );
    clients.push(duplicateClient);
    const session = await duplicateClient.createSession();
    await expect(duplicateClient.createSession()).rejects.toMatchObject({
      code: 'provider_api_incompatible',
      providerCode: 'session_id',
    });
    await expect(
      duplicateClient.resumeSession({
        ...session.ref(),
        providerSessionId: providerSessionId('not-a-uuid'),
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    await expect(duplicateClient.resumeSession(session.ref())).resolves.toBe(
      session,
    );

    const invalidFactory = createClaudeProviderFactory({
      binding: new FixtureClaudeSdk(),
      createUuid: () => 'invalid-generated-id',
    });
    const invalidClient = await invalidFactory.connect(
      createTestProfile('invalid-id'),
    );
    clients.push(invalidClient);
    await expect(invalidClient.createSession()).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
  });

  it('maps native resume inspection failures and workspace mismatch', async () => {
    const sdk = new FixtureClaudeSdk();
    const profile = createTestProfile('resume-errors');
    const factory = createFixtureFactory(sdk);
    const client = await factory.connect(profile);
    clients.push(client);
    const ref = materializedRef(profile, syntheticCwd);

    sdk.getSessionInfoError = new Error('synthetic-sensitive-inspection');
    const inspectionFailure = await client.resumeSession(ref).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(inspectionFailure).toMatchObject({
      code: 'connection_failed',
      providerCode: 'get_session_info',
    });
    expect((inspectionFailure as Error).cause).toBeUndefined();
    expect(String(inspectionFailure)).not.toContain(
      'synthetic-sensitive-inspection',
    );
    sdk.getSessionInfoError = undefined;
    await expect(client.resumeSession(ref)).rejects.toMatchObject({
      code: 'session_not_found',
    });
    sdk.sessions.set(firstSessionId, {
      sessionId: firstSessionId,
      cwd: '/synthetic/other-workspace',
    });
    await expect(client.resumeSession(ref)).rejects.toMatchObject({
      code: 'session_provider_mismatch',
    });
    sdk.sessions.set(firstSessionId, {
      sessionId: '00000000-0000-4000-8000-000000000099',
      cwd: syntheticCwd,
    });
    await expect(client.resumeSession(ref)).rejects.toMatchObject({
      code: 'session_not_found',
    });
    sdk.sessions.set(firstSessionId, { sessionId: firstSessionId });
    await expect(
      client.resumeSession({
        ...ref,
        providerState: { ...providerState(ref), cwd: undefined },
      }),
    ).rejects.toMatchObject({
      code: 'session_provider_mismatch',
    });
  });

  it('rejects overlapping Runs and quarantined resume on uncertain state', async () => {
    const sdk = new FixtureClaudeSdk();
    const client = await createFixtureFactory(sdk).connect(
      createTestProfile('conflict'),
    );
    clients.push(client);
    const session = await client.createSession();
    const ref = session.ref();
    const active = await session.start({
      parts: [{ type: 'text', text: 'remain active for conflict' }],
    });
    await expect(
      session.start({ parts: [{ type: 'text', text: 'Second Run.' }] }),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await session.close();
    await expect(active.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    await expect(client.resumeSession(ref)).rejects.toMatchObject({
      code: 'connection_aborted',
      providerCode: 'session_quarantined',
    });
  });

  it('contains duplicate concurrent native resume claims', async () => {
    const sdk = new FixtureClaudeSdk();
    sdk.sessions.set(firstSessionId, {
      sessionId: firstSessionId,
      cwd: syntheticCwd,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sdk.getSessionInfo = async () => {
      await gate;
      return { sessionId: firstSessionId, cwd: syntheticCwd };
    };
    const profile = createTestProfile('resume-race');
    const client = await createFixtureFactory(sdk).connect(profile);
    clients.push(client);
    const ref = materializedRef(profile, syntheticCwd);
    const first = client.resumeSession(ref);
    const second = client.resumeSession(ref);
    release();
    const outcomes = await Promise.allSettled([first, second]);
    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter(({ status }) => status === 'rejected'),
    ).toMatchObject([{ reason: { code: 'run_conflict' } }]);
  });

  it('does not install a resumed Session after Client close wins inspection', async () => {
    const sdk = new FixtureClaudeSdk();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sdk.getSessionInfo = async () => {
      await gate;
      return { sessionId: firstSessionId, cwd: syntheticCwd };
    };
    const profile = createTestProfile('resume-close-race');
    const client = await createFixtureFactory(sdk).connect(profile);
    clients.push(client);
    const pending = client.resumeSession(
      materializedRef(profile, syntheticCwd),
    );
    await client.close();
    release();
    await expect(pending).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('fails closed when SDK initialization changes the bound workspace', async () => {
    const query = new ImmediateQuery([initMessage(firstSessionId)]);
    const client = await createClaudeProviderFactory({
      binding: staticBinding(query),
      createUuid: () => firstSessionId,
    }).connect(createTestProfile('cwd-mismatch'));
    clients.push(client);
    const session = await client.createSession({
      workspace: { uri: 'file:///synthetic/expected-workspace' },
    });
    const run = await session.start({
      parts: [{ type: 'text', text: 'Workspace mismatch.' }],
    });
    await expect(run.result()).resolves.toMatchObject({
      status: 'failed',
      providerResult: {
        code: 'provider_api_incompatible',
        providerCode: 'cwd_mismatch',
      },
    });
  });

  it('fails closed when SDK initialization changes model or permission mode', async () => {
    const cases = [
      {
        suffix: 'model-mismatch',
        input: { model: { id: 'claude-expected' } },
        init: { model: 'claude-unexpected' },
        providerCode: 'model_mismatch',
      },
      {
        suffix: 'permission-mismatch',
        input: { providerOptions: { permissionMode: 'plan' } },
        init: { permissionMode: 'default' },
        providerCode: 'permission_mode_mismatch',
      },
    ] as const;
    for (const testCase of cases) {
      const query = new ImmediateQuery([
        initMessage(firstSessionId, testCase.init),
      ]);
      const client = await createClaudeProviderFactory({
        binding: staticBinding(query),
        createUuid: () => firstSessionId,
      }).connect(createTestProfile(testCase.suffix));
      clients.push(client);
      const session = await client.createSession(testCase.input);
      const run = await session.start({
        parts: [{ type: 'text', text: 'Validate initialization.' }],
      });
      await expect(run.result()).resolves.toMatchObject({
        status: 'failed',
        providerResult: {
          code: 'provider_api_incompatible',
          providerCode: testCase.providerCode,
        },
      });
    }
  });

  it('validates every interaction response shape and supports native answers', async () => {
    const client = await createFixtureFactory().connect(
      createTestProfile('interaction-errors'),
    );
    clients.push(client);
    const approvalCases: readonly InteractionResponse[] = [
      { kind: 'user_input', parts: [{ type: 'text', text: 'Synthetic.' }] },
      {
        kind: 'approval',
        decision: 'approve',
        providerOptions: { future: true },
      },
    ];
    for (const response of approvalCases) {
      const { session, run, requestId } = await interaction(
        client,
        'approval interaction',
      );
      await expect(session.respond(requestId, response)).rejects.toMatchObject({
        code: 'invalid_request',
      });
      await session.respond(requestId, { kind: 'approval', decision: 'deny' });
      await expect(run.result()).resolves.toMatchObject({
        finalMessage: 'permission:deny',
      });
    }

    const inputCases: readonly InteractionResponse[] = [
      { kind: 'approval', decision: 'deny' },
      { kind: 'user_input', parts: [] },
      {
        kind: 'user_input',
        parts: [{ type: 'provider', name: 'future.answers', value: {} }],
      },
      {
        kind: 'user_input',
        parts: [
          {
            type: 'provider',
            name: 'anthropic.claude-agent-sdk.answers',
            value: {},
          },
        ],
      },
      {
        kind: 'user_input',
        parts: [
          {
            type: 'provider',
            name: 'anthropic.claude-agent-sdk.answers',
            value: { 'Synthetic?': 1 },
          },
        ],
      },
      { kind: 'user_input', parts: [{ type: 'text', text: '' }] },
    ];
    for (const response of inputCases) {
      const { session, run, requestId } = await interaction(
        client,
        'user input interaction',
      );
      await expect(session.respond(requestId, response)).rejects.toMatchObject({
        code: 'invalid_request',
      });
      await session.respond(requestId, {
        kind: 'user_input',
        parts: [{ type: 'text', text: 'Synthetic fallback.' }],
      });
      await run.result();
    }

    const native = await interaction(client, 'user input interaction');
    await native.session.respond(native.requestId, {
      kind: 'user_input',
      parts: [
        {
          type: 'provider',
          name: 'anthropic.claude-agent-sdk.answers',
          value: { 'Choose a synthetic option.': 'Synthetic A' },
        },
      ],
    });
    await expect(native.run.result()).resolves.toMatchObject({
      finalMessage: 'input:answered',
    });
  });

  it('aborts instead of hiding an interaction behind a full event buffer', async () => {
    const sdk = new FixtureClaudeSdk();
    const client = await createFixtureFactory(sdk).connect({
      ...createTestProfile('interaction-overflow'),
      providerOptions: { maxRunEvents: 2 },
    });
    clients.push(client);
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'approval interaction' }],
    });
    await expect(run.result()).resolves.toEqual({
      status: 'connection_aborted',
    });
    const eventTypes: string[] = [];
    for await (const event of run.events()) eventTypes.push(event.type);
    expect(eventTypes).toEqual(['run.started', 'connection.aborted']);
    expect(sdk.queries[0]?.observation.closeCalls).toBe(1);
  });

  it('denies permission callbacks until initialization is validated', async () => {
    const query = new ManualQuery();
    let callbackResult: Promise<unknown> | undefined;
    const binding: ClaudeSdkBinding = {
      sdkVersion: '0.3.250-synthetic',
      getSessionInfo: () => Promise.resolve(undefined),
      query: (parameters) => {
        const controller = new AbortController();
        callbackResult = parameters.options.canUseTool(
          'SyntheticTool',
          { secret: 'synthetic-sensitive-value' },
          {
            requestId: 'pre-init-request',
            signal: controller.signal,
            toolUseID: 'pre-init-tool',
          },
        );
        return query;
      },
    };
    const client = await createClaudeProviderFactory({
      binding,
      createUuid: () => firstSessionId,
    }).connect({
      ...createTestProfile('interaction-before-init'),
      providerOptions: { initializationTimeoutMs: 5 },
    });
    clients.push(client);
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'Reject early interaction.' }],
    });
    await expect(callbackResult).resolves.toMatchObject({
      behavior: 'deny',
      interrupt: true,
    });
    await expect(run.result()).resolves.toMatchObject({
      status: 'failed',
      providerResult: {
        code: 'provider_api_incompatible',
        providerCode: 'interaction_before_init',
      },
    });
    const eventTypes: string[] = [];
    for await (const event of run.events()) eventTypes.push(event.type);
    expect(eventTypes).toEqual(['run.started', 'run.failed']);
    expect(query.closeCalls).toBe(1);
  });

  it('contains duplicate, malformed, aborted, and late permission callbacks', async () => {
    const sdk = new FixtureClaudeSdk();
    const client = await createFixtureFactory(sdk).connect(
      createTestProfile('callback-edges'),
    );
    clients.push(client);
    const first = await interaction(client, 'approval interaction');
    const secondSession = await client.createSession();
    const duplicate = await secondSession.start({
      parts: [{ type: 'text', text: 'approval interaction' }],
    });
    await expect(duplicate.result()).resolves.toMatchObject({
      status: 'failed',
    });
    await first.session.close();

    const callbackSdk = new FixtureClaudeSdk();
    let lateCallback:
      ClaudeSdkQueryParameters['options']['canUseTool'] | undefined;
    callbackSdk.queryImplementation = (parameters) => {
      lateCallback = parameters.options.canUseTool;
      const id = parameters.options.sessionId ?? firstSessionId;
      return new ImmediateQuery([
        initMessage(id),
        resultMessage(id, false, 'completed'),
      ]);
    };
    const callbackClient = await createFixtureFactory(callbackSdk).connect(
      createTestProfile('late-callback'),
    );
    clients.push(callbackClient);
    const callbackSession = await callbackClient.createSession();
    const callbackRun = await callbackSession.start({
      parts: [{ type: 'text', text: 'Complete before callback.' }],
    });
    await callbackRun.result();
    await expect(
      lateCallback?.(
        'SyntheticTool',
        {},
        {
          requestId: 'late-request',
          signal: new AbortController().signal,
          toolUseID: 'late-tool',
        },
      ),
    ).resolves.toMatchObject({ behavior: 'deny', interrupt: true });

    const malformedCallbackSdk = callbackBinding((canUseTool) =>
      canUseTool('SyntheticTool', {}, {
        requestId: 'missing-signal',
        toolUseID: 'tool',
      } as never),
    );
    const malformedClient = await createClaudeProviderFactory({
      binding: malformedCallbackSdk,
      createUuid: () => firstSessionId,
    }).connect(createTestProfile('malformed-callback'));
    clients.push(malformedClient);
    const malformedSession = await malformedClient.createSession();
    const malformedRun = await malformedSession.start({
      parts: [{ type: 'text', text: 'Malformed callback.' }],
    });
    await expect(malformedRun.result()).resolves.toMatchObject({
      status: 'failed',
    });

    const aborted = new AbortController();
    aborted.abort();
    const abortedCallbackSdk = callbackBinding((canUseTool) =>
      canUseTool(
        'SyntheticTool',
        {},
        {
          requestId: 'aborted-request',
          signal: aborted.signal,
          toolUseID: 'tool',
        },
      ),
    );
    const abortedClient = await createClaudeProviderFactory({
      binding: abortedCallbackSdk,
      createUuid: () => firstSessionId,
    }).connect(createTestProfile('aborted-callback'));
    clients.push(abortedClient);
    const abortedSession = await abortedClient.createSession();
    const abortedRun = await abortedSession.start({
      parts: [{ type: 'text', text: 'Aborted callback.' }],
    });
    await expect(abortedRun.result()).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('maps interrupt rejection, settlement timeout, and connection loss', async () => {
    for (const [suffix, configure, expectedCode] of [
      [
        'interrupt-rejected',
        (query: ManualQuery) => {
          query.interruptError = new Error('synthetic interrupt failure');
        },
        'interrupt_failed',
      ],
      [
        'interrupt-timeout',
        (_query: ManualQuery) => undefined,
        'interrupt_settlement_timeout',
      ],
      [
        'interrupt-never-settles',
        (query: ManualQuery) => {
          query.interruptPromise = new Promise(() => undefined);
        },
        'interrupt_settlement_timeout',
      ],
    ] as const) {
      const query = new ManualQuery();
      configure(query);
      const binding = manualBinding(query);
      const client = await createClaudeProviderFactory({
        binding,
        createUuid: () => firstSessionId,
      }).connect({
        ...createTestProfile(suffix),
        providerOptions: { cancelSettlementTimeoutMs: 5 },
      });
      clients.push(client);
      const session = await client.createSession();
      const run = await session.start({
        parts: [{ type: 'text', text: 'Cancel edge.' }],
      });
      query.push(initMessage(firstSessionId));
      await expect(run.cancel()).resolves.toEqual({
        mode: 'connection_aborted',
      });
      await expect(run.result()).resolves.toEqual({
        status: 'connection_aborted',
      });
      expect(query.closeCalls).toBe(1);
      expect(expectedCode).toBeTruthy();
    }

    const lateInterrupt = new ManualQuery();
    let rejectInterrupt!: (reason: unknown) => void;
    lateInterrupt.interruptPromise = new Promise((_, reject) => {
      rejectInterrupt = reject;
    });
    const lateClient = await createClaudeProviderFactory({
      binding: manualBinding(lateInterrupt),
      createUuid: () => firstSessionId,
    }).connect({
      ...createTestProfile('interrupt-close-race'),
      providerOptions: { cancelSettlementTimeoutMs: 1_000 },
    });
    clients.push(lateClient);
    const lateSession = await lateClient.createSession();
    const lateRun = await lateSession.start({
      parts: [{ type: 'text', text: 'Cancel then close.' }],
    });
    lateInterrupt.push(initMessage(firstSessionId));
    const cancellation = lateRun.cancel();
    await lateSession.close();
    rejectInterrupt(new Error('synthetic-sensitive-late-interrupt'));
    await expect(cancellation).resolves.toEqual({
      mode: 'connection_aborted',
    });

    const errorQuery = new ManualQuery();
    errorQuery.onInterrupt = () => {
      errorQuery.fail(new Error('synthetic stream loss'));
    };
    const errorClient = await createClaudeProviderFactory({
      binding: manualBinding(errorQuery),
      createUuid: () => firstSessionId,
    }).connect(createTestProfile('interrupt-stream-loss'));
    clients.push(errorClient);
    const errorSession = await errorClient.createSession();
    const errorRun = await errorSession.start({
      parts: [{ type: 'text', text: 'Cancel with stream loss.' }],
    });
    errorQuery.push(initMessage(firstSessionId));
    await expect(errorRun.cancel()).resolves.toEqual({
      mode: 'connection_aborted',
    });
  });

  it('contains duplicate init, terminal-before-init, overflow, and disposal failure', async () => {
    const preInitEventTypes: string[][] = [];
    const cases: readonly [string, readonly unknown[], number, string][] = [
      [
        'duplicate-init',
        [initMessage(firstSessionId), initMessage(firstSessionId)],
        128,
        'failed',
      ],
      [
        'result-before-init',
        [resultMessage(firstSessionId, false, 'completed')],
        128,
        'failed',
      ],
      [
        'event-before-init',
        [streamText(firstSessionId, 'Synthetic hidden text.')],
        128,
        'failed',
      ],
      [
        'event-overflow',
        [
          initMessage(firstSessionId),
          streamText(firstSessionId, 'Synthetic one.'),
          streamText(firstSessionId, 'Synthetic two.'),
        ],
        2,
        'connection_aborted',
      ],
    ];
    for (const [suffix, values, capacity, status] of cases) {
      const query = new ImmediateQuery(values, true);
      const client = await createClaudeProviderFactory({
        binding: staticBinding(query),
        createUuid: () => firstSessionId,
      }).connect({
        ...createTestProfile(suffix),
        providerOptions: { maxRunEvents: capacity },
      });
      clients.push(client);
      const session = await client.createSession();
      const run = await session.start({
        parts: [{ type: 'text', text: 'Malformed lifecycle.' }],
      });
      await expect(run.result()).resolves.toMatchObject({ status });
      if (suffix === 'event-before-init') {
        const eventTypes: string[] = [];
        for await (const event of run.events()) eventTypes.push(event.type);
        preInitEventTypes.push(eventTypes);
      }
      expect(query.closeCalls).toBeGreaterThan(0);
    }
    expect(preInitEventTypes).toEqual([['run.started', 'run.failed']]);
  });

  it('rejects duplicate event consumers and invalid numeric Run/Profile options', async () => {
    const sdk = new FixtureClaudeSdk();
    const client = await createFixtureFactory(sdk).connect(
      createTestProfile('consumer'),
    );
    clients.push(client);
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'Complete.' }],
    });
    run.events();
    expect(() => run.events()).toThrow(
      expect.objectContaining({ code: 'run_conflict' }),
    );
    await run.result();
    await client.close();
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });

    for (const providerOptions of [
      { maxRunEvents: 1 },
      { maxRunEvents: 4_097 },
      { cancelSettlementTimeoutMs: 0 },
      { cancelSettlementTimeoutMs: 1.5 },
      { initializationTimeoutMs: 0 },
    ]) {
      await expect(
        createFixtureFactory().connect({
          ...createTestProfile('numeric-profile'),
          providerOptions,
        }),
      ).rejects.toMatchObject({ code: 'profile_invalid' });
    }
    const optionClient = await createFixtureFactory().connect(
      createTestProfile('numeric-run'),
    );
    clients.push(optionClient);
    const optionSession = await optionClient.createSession();
    for (const options of [
      { timeoutMs: 0 },
      { providerOptions: { maxTurns: 0 } },
      { providerOptions: { maxBudgetUsd: Number.NaN } },
      { metadata: { synthetic: 'value' } },
    ]) {
      await expect(
        optionSession.start(
          { parts: [{ type: 'text', text: 'Invalid options.' }] },
          options,
        ),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    }
  });

  it('accepts a valid host-owned binding and can inspect the default native boundary', async () => {
    const hostBinding = new FixtureClaudeSdk();
    const hostProfile: HarnessProfile = {
      ...createTestProfile('host-owned'),
      connection: {
        kind: 'sdk',
        ownership: 'host',
        factory: hostBinding,
      },
    };
    const hostClient = await createClaudeProviderFactory().connect(hostProfile);
    clients.push(hostClient);
    expect(hostClient.native()).toMatchObject({ binding: hostBinding });

    const defaultClient = await createClaudeProviderFactory().connect(
      createTestProfile('default-binding'),
    );
    clients.push(defaultClient);
    expect(
      typeof defaultClient.native<ClaudeNativeClient>()?.official?.query,
    ).toBe('function');
  });
});

async function interaction(
  client: HarnessClient,
  text: string,
): Promise<{
  requestId: string;
  run: HarnessRun;
  session: HarnessSession;
}> {
  const session = await client.createSession();
  const run = await session.start({ parts: [{ type: 'text', text }] });
  const iterator = run.events()[Symbol.asyncIterator]();
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error('Synthetic interaction was not emitted.');
    if (next.value.type !== 'interaction.requested') continue;
    const data = next.value.data as { requestId: string };
    return { requestId: data.requestId, run, session };
  }
}

function materializedRef(profile: HarnessProfile, cwd?: string): SessionRef {
  return {
    providerId: CLAUDE_PROVIDER_ID,
    profileId: profile.profileId,
    providerSessionId: providerSessionId(firstSessionId),
    compatibilityRef: CLAUDE_SESSION_COMPATIBILITY_REF,
    providerState: {
      materialized: true,
      permissionMode: 'default',
      ...(cwd === undefined ? {} : { cwd }),
    },
  };
}

function providerState(ref: SessionRef): Readonly<Record<string, unknown>> {
  if (typeof ref.providerState !== 'object' || ref.providerState === null) {
    throw new Error('Synthetic provider state is missing.');
  }
  return ref.providerState as Readonly<Record<string, unknown>>;
}

function initMessage(
  sessionId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    claude_code_version: '2.1.250-synthetic',
    cwd: syntheticCwd,
    model: 'claude-synthetic',
    permissionMode: 'default',
    capabilities: [],
    ...overrides,
  };
}

function resultMessage(
  sessionId: string,
  isError: boolean,
  terminalReason: string,
): Readonly<Record<string, unknown>> {
  return {
    type: 'result',
    subtype: 'success',
    is_error: isError,
    session_id: sessionId,
    result: 'Synthetic result.',
    terminal_reason: terminalReason,
  };
}

function streamText(
  sessionId: string,
  text: string,
): Readonly<Record<string, unknown>> {
  return {
    type: 'stream_event',
    session_id: sessionId,
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
  };
}

function callbackBinding(
  callback: (
    canUseTool: ClaudeSdkQueryParameters['options']['canUseTool'],
  ) => Promise<unknown>,
): ClaudeSdkBinding {
  return {
    sdkVersion: '0.3.250-synthetic',
    getSessionInfo: () => Promise.resolve(undefined),
    query: (parameters) => {
      const id = parameters.options.sessionId ?? firstSessionId;
      const query = new ManualQuery();
      query.push(initMessage(id));
      void callback(parameters.options.canUseTool).then(
        () => {
          query.push(resultMessage(id, false, 'completed'));
          query.end();
        },
        (error: unknown) => {
          query.fail(error);
        },
      );
      return query;
    },
  };
}

function manualBinding(query: ManualQuery): ClaudeSdkBinding {
  return staticBinding(query);
}

function staticBinding(query: ClaudeSdkQuery): ClaudeSdkBinding {
  return {
    sdkVersion: '0.3.250-synthetic',
    getSessionInfo: () => Promise.resolve(undefined),
    query: () => query,
  };
}

class ImmediateQuery implements ClaudeSdkQuery {
  readonly #values: readonly unknown[];
  readonly #throwOnClose: boolean;
  closeCalls = 0;

  constructor(values: readonly unknown[], throwOnClose = false) {
    this.#values = values;
    this.#throwOnClose = throwOnClose;
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    let index = 0;
    return {
      next: () => {
        const done = index >= this.#values.length;
        const value = this.#values[index];
        index += 1;
        return Promise.resolve(
          done ? { done: true, value: undefined } : { done: false, value },
        );
      },
    };
  }

  interrupt(): Promise<unknown> {
    return Promise.resolve({});
  }

  close(): void {
    this.closeCalls += 1;
    if (this.#throwOnClose) throw new Error('Synthetic disposal failure.');
  }
}

class ManualQuery implements ClaudeSdkQuery {
  readonly #queue = new AsyncQueue();
  closeCalls = 0;
  interruptError: Error | undefined;
  interruptPromise: Promise<unknown> | undefined;
  onInterrupt: (() => void) | undefined;

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this.#queue[Symbol.asyncIterator]();
  }

  interrupt(): Promise<unknown> {
    if (this.interruptError !== undefined) {
      return Promise.reject(this.interruptError);
    }
    if (this.interruptPromise !== undefined) return this.interruptPromise;
    this.onInterrupt?.();
    return Promise.resolve({});
  }

  close(): void {
    this.closeCalls += 1;
    this.#queue.end();
  }

  push(value: unknown): void {
    this.#queue.push(value);
  }

  fail(error: unknown): void {
    this.#queue.fail(error);
  }

  end(): void {
    this.#queue.end();
  }
}

class AsyncQueue implements AsyncIterable<unknown> {
  readonly #values: unknown[] = [];
  #done = false;
  #error: Error | undefined;
  #waiter: (() => void) | undefined;

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return this.#iterator();
  }

  push(value: unknown): void {
    this.#values.push(value);
    this.#wake();
  }

  fail(error: unknown): void {
    this.#error =
      error instanceof Error ? error : new Error('Synthetic failure.');
    this.#done = true;
    this.#wake();
  }

  end(): void {
    this.#done = true;
    this.#wake();
  }

  async *#iterator(): AsyncGenerator {
    for (;;) {
      const value = this.#values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.#error !== undefined) throw this.#error;
      if (this.#done) return;
      await new Promise<void>((resolve) => {
        this.#waiter = resolve;
      });
    }
  }

  #wake(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}
