import { pathToFileURL } from 'node:url';

import {
  profileId,
  providerId,
  type HarnessClient,
  type HarnessEvent,
  type HarnessRun,
} from '@harapter/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  OPENCLAW_OBSERVATION_EXTENSION,
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
  type OpenClawNativeClient,
  type OpenClawObservationExtension,
} from '../src/index.js';
import { createTestProfile } from './test-profile.js';

const clients = new Set<HarnessClient>();

afterEach(async () => {
  await Promise.all(
    [...clients].map(async (client) => client.close().catch(() => undefined)),
  );
  clients.clear();
});

describe('OpenClaw Provider Adapter', () => {
  it('exposes detached discovery and handshake-derived capabilities', async () => {
    const factory = createOpenClawProviderFactory();
    const descriptor = factory.descriptor();
    (descriptor.connectionKinds as string[]).push('endpoint');
    expect(factory.descriptor()).toEqual({
      providerId: OPENCLAW_PROVIDER_ID,
      displayName: 'OpenClaw ACP Gateway',
      connectionKinds: ['process'],
      documentationUrl: 'https://docs.openclaw.ai/cli/acp',
    });

    const client = await connect();
    const clientDescriptor = await client.descriptor();
    expect(clientDescriptor).toMatchObject({
      providerId: OPENCLAW_PROVIDER_ID,
      compatibility: 'supported',
      runtime: {
        name: 'openclaw-acp',
        protocol: 'ACP over stdio JSON-RPC 2.0',
        protocolVersion: '1',
      },
    });
    expect(clientDescriptor.warnings).toBeUndefined();
    const capabilities = await client.capabilities({ refresh: true });
    expect(capabilities.capabilities).toMatchObject({
      'session.create': { mode: 'native' },
      'session.resume': { mode: 'native' },
      'session.close': { mode: 'native' },
      'session.workspace': { mode: 'unknown' },
      'run.stream': { mode: 'native' },
      'run.cancel': { mode: 'native' },
      'run.timeout': { mode: 'emulated' },
      'run.concurrent': { mode: 'unsupported' },
      'input.text': { mode: 'native' },
      'input.file': { mode: 'unsupported' },
      'input.image': { mode: 'native' },
      'interaction.approval': { mode: 'unknown' },
      'event.raw': { mode: 'adapter_controlled' },
      'native.client': { mode: 'native' },
    });
  });

  it('creates an isolated resumable Session bound to Provider, Profile, and route state', async () => {
    const client = await connect();
    const session = await client.createSession({
      workspace: { uri: pathToFileURL(process.cwd()).href },
    });
    expect(session.ref()).toMatchObject({
      providerId: OPENCLAW_PROVIDER_ID,
      profileId: 'openclaw-synthetic',
      compatibilityRef: 'openclaw;acp-v1;strategy=isolated',
      providerState: {
        strategy: 'isolated',
        cwd: process.cwd(),
      },
    });
    expect(session.ref().providerSessionId).toMatch(
      /^synthetic-acp-bridge:harapter-/u,
    );
    const state = session.ref().providerState as { sessionKey?: unknown };
    expect(state.sessionKey).toMatch(/^acp-bridge:harapter-/u);
    await expect(session.capabilities()).resolves.toMatchObject({
      providerId: OPENCLAW_PROVIDER_ID,
    });
    const closing = session.close();
    expect(session.close()).toBe(closing);
    await expect(session.start(textInput('closing'))).rejects.toMatchObject({
      code: 'session_not_found',
    });
    await closing;
    await session.close();
  });

  it('streams mapped events and settles only from the ACP prompt response', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start(textInput('synthetic'));
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    expect(result).toEqual({
      status: 'completed',
      finalMessage: 'synthetic answer',
      usage: { totalTokens: 16 },
      providerResult: { stopReason: 'end_turn' },
    });
    expect(events.map(({ type }) => type)).toEqual([
      'run.started',
      'reasoning.delta',
      'message.delta',
      'tool.started',
      'tool.completed',
      'usage.updated',
      'message.completed',
      'reasoning.completed',
      'run.completed',
    ]);
    expect(events.at(-1)?.data).toEqual(result);
    expect(JSON.stringify(events)).not.toContain('private');
    await expect(run.cancel()).resolves.toEqual({ mode: 'already_terminal' });
  });

  it('keeps the authoritative terminal last and ignores late bridge activity', async () => {
    const client = await connect('late-after-terminal');
    const session = await client.createSession();
    const run = await session.start(textInput('late'));
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      finalMessage: 'synthetic answer',
    });
    expect(JSON.stringify(events)).not.toContain('synthetic late content');
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it.each([
    ['refusal', 'failed', 'run.failed'],
    ['max-tokens', 'failed', 'run.failed'],
    ['max-turns', 'failed', 'run.failed'],
    ['empty', 'completed', 'run.completed'],
    ['prompt-error', 'failed', 'run.failed'],
  ] as const)(
    'maps the %s terminal path',
    async (mode, status, terminalType) => {
      const client = await connect(mode);
      const session = await client.createSession();
      const run = await session.start(textInput(mode));
      const [events, result] = await Promise.all([
        collectEvents(run),
        run.result(),
      ]);
      expect(result.status).toBe(status);
      expect(events.at(-1)?.type).toBe(terminalType);
    },
  );

  it('maps explicit ACP cancellation only after the cancelled terminal', async () => {
    const client = await connect('cancel');
    const session = await client.createSession();
    const run = await session.start(textInput('cancel'));
    await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
    await expect(run.result()).resolves.toMatchObject({
      status: 'cancelled',
      providerResult: { stopReason: 'cancelled' },
    });
    expect((await collectEvents(run)).at(-1)?.type).toBe('run.cancelled');
  });

  it('aborts the owning connection when a prompt wait times out', async () => {
    const client = await connect('slow', { requestTimeoutMs: 30 });
    const first = await client.createSession();
    const second = await client.createSession();
    const run = await first.start(textInput('unconfirmed timeout'));
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'prompt_wait_uncertain' },
    });
    await expect(
      second.start(textInput('must not reuse')),
    ).rejects.toMatchObject({ code: 'connection_aborted' });
  });

  it('relays an active Run approval and updates observed capability evidence', async () => {
    const client = await connect('permission');
    const session = await client.createSession();
    const run = await session.start(textInput('approval'));
    const iterator = run.events()[Symbol.asyncIterator]();
    expect((await nextEvent(iterator)).type).toBe('run.started');
    const requested = await nextEvent(iterator);
    expect(requested).toMatchObject({
      type: 'interaction.requested',
      data: { kind: 'approval' },
    });
    const requestId = (requested.data as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string') throw new Error('Missing request ID.');
    await session.respond(requestId, {
      kind: 'approval',
      decision: 'approve',
      providerOptions: { optionId: 'allow' },
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    const remainder = await collectIterator(iterator);
    expect(remainder.some(({ type }) => type === 'interaction.resolved')).toBe(
      true,
    );
    await expect(client.capabilities()).resolves.toMatchObject({
      capabilities: { 'interaction.approval': { mode: 'native' } },
    });
  });

  it('maps denial and rejects responses that do not own an active approval', async () => {
    const client = await connect('permission');
    const session = await client.createSession();
    const run = await session.start(textInput('deny'));
    const iterator = run.events()[Symbol.asyncIterator]();
    await nextEvent(iterator);
    const requested = await nextEvent(iterator);
    const requestId = (requested.data as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string') throw new Error('Missing request ID.');
    await expect(
      session.respond('synthetic-missing', {
        kind: 'approval',
        decision: 'deny',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await session.respond(requestId, {
      kind: 'approval',
      decision: 'deny',
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    await collectIterator(iterator);
  });

  it('rejects explicit approval options that conflict with the portable decision', async () => {
    const client = await connect('permission');
    const session = await client.createSession();
    const run = await session.start(textInput('conflicting choices'));
    const iterator = run.events()[Symbol.asyncIterator]();
    await nextEvent(iterator);
    const requested = await nextEvent(iterator);
    const requestId = (requested.data as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string') throw new Error('Missing request ID.');

    for (const response of [
      {
        kind: 'approval' as const,
        decision: 'deny' as const,
        providerOptions: { optionId: 'allow' },
      },
      {
        kind: 'approval' as const,
        decision: 'approve' as const,
        providerOptions: { optionId: 'deny' },
      },
      {
        kind: 'approval' as const,
        decision: 'approve' as const,
        providerOptions: { optionId: 'missing' },
      },
      {
        kind: 'approval' as const,
        decision: 'approve' as const,
        providerOptions: { optionId: 7 },
      },
    ]) {
      await expect(session.respond(requestId, response)).rejects.toMatchObject({
        code: 'invalid_request',
      });
    }
    await session.respond(requestId, { kind: 'approval', decision: 'deny' });
    await run.result();
    await collectIterator(iterator);
  });

  it('blocks approval responses while Session close is settling', async () => {
    const client = await connect('permission');
    const session = await client.createSession();
    const run = await session.start(textInput('closing approval'));
    const iterator = run.events()[Symbol.asyncIterator]();
    await nextEvent(iterator);
    const requested = await nextEvent(iterator);
    const requestId = (requested.data as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string') throw new Error('Missing request ID.');

    const closing = session.close();
    await expect(
      session.respond(requestId, { kind: 'approval', decision: 'deny' }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    await expect(closing).rejects.toMatchObject({ code: 'run_conflict' });
    await session.respond(requestId, { kind: 'approval', decision: 'deny' });
    await run.result();
    await collectIterator(iterator);
  });

  it('defaults to one-time approval choices and requires explicit persistent selection', async () => {
    for (const selection of [
      {
        decision: 'approve' as const,
        expected: 'synthetic allow answer',
      },
      {
        decision: 'deny' as const,
        expected: 'synthetic deny answer',
      },
      {
        decision: 'approve' as const,
        providerOptions: { optionId: 'allow-always' },
        expected: 'synthetic allow-always answer',
      },
    ]) {
      const client = await connect('permission-persistent-first');
      const session = await client.createSession();
      const run = await session.start(textInput('ordered choices'));
      const iterator = run.events()[Symbol.asyncIterator]();
      await nextEvent(iterator);
      const requested = await nextEvent(iterator);
      const requestId = (requested.data as { requestId?: unknown }).requestId;
      if (typeof requestId !== 'string') throw new Error('Missing request ID.');
      await session.respond(requestId, {
        kind: 'approval',
        decision: selection.decision,
        ...(selection.providerOptions === undefined
          ? {}
          : { providerOptions: selection.providerOptions }),
      });
      await expect(run.result()).resolves.toMatchObject({
        finalMessage: selection.expected,
        status: 'completed',
      });
      await collectIterator(iterator);
    }
  });

  it('rejects an approval decision absent from the Provider choices', async () => {
    const client = await connect('permission-deny-only');
    const session = await client.createSession();
    const run = await session.start(textInput('choices'));
    const iterator = run.events()[Symbol.asyncIterator]();
    await nextEvent(iterator);
    const requested = await nextEvent(iterator);
    const requestId = (requested.data as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string') throw new Error('Missing request ID.');
    await expect(
      session.respond(requestId, {
        kind: 'approval',
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await session.respond(requestId, { kind: 'approval', decision: 'deny' });
    await run.result();
    await collectIterator(iterator);
  });

  it('resumes only an owned compatible isolated Session reference', async () => {
    const first = await connect();
    const original = await first.createSession();
    const ref = original.ref();
    await first.close();

    const second = await connect();
    const resumed = await second.resumeSession(ref);
    expect(resumed.ref()).toEqual(ref);
    const run = await resumed.start(textInput('resumed'));
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
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
    await expect(
      second.resumeSession({
        ...ref,
        compatibilityRef: 'openclaw;acp-v1;strategy=shared',
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
  });

  it('reserves resumed Session ownership and releases failed reservations', async () => {
    const source = await connect();
    const original = await source.createSession();
    const ref = original.ref();
    await source.close();

    const concurrentClient = await connect();
    const concurrent = await Promise.allSettled([
      concurrentClient.resumeSession(ref),
      concurrentClient.resumeSession(ref),
    ]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = concurrent.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'session_provider_mismatch' },
    });

    const retryClient = await connect('resume-error-once');
    await expect(retryClient.resumeSession(ref)).rejects.toMatchObject({
      code: 'provider_error',
    });
    const retried = await retryClient.resumeSession(ref);
    expect(retried.ref()).toEqual(ref);
  });

  it('keeps unknown updates bounded, redacted, observable, and non-terminal', async () => {
    const client = await connect('unknown');
    const extension = client
      .extensions()
      .get<OpenClawObservationExtension>(OPENCLAW_OBSERVATION_EXTENSION);
    const native = client.native<OpenClawNativeClient>();
    const observed: unknown[] = [];
    extension?.onObservation((event) => observed.push(event));
    native?.onUnknownEvent((event) => observed.push(event));
    const session = await client.createSession();
    const run = await session.start(textInput('unknown'));
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    expect(result.status).toBe('completed');
    expect(events.some(({ type }) => type === 'provider')).toBe(true);
    expect(observed.length).toBe(2);
    expect(JSON.stringify({ events, observed })).not.toContain('private');
    expect(events.at(-1)?.type).toBe('run.completed');
  });

  it.each([
    ['malformed-terminal', 'failed', 'run.failed'],
    ['exit-during-run', 'connection_aborted', 'connection.aborted'],
  ] as const)('fails closed for %s', async (mode, status, terminalType) => {
    const client = await connect(mode);
    const session = await client.createSession();
    const run = await session.start(textInput('fail closed'));
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    expect(result.status).toBe(status);
    expect(events.at(-1)?.type).toBe(terminalType);
  });

  it('uses Run timeout to invoke native cancellation', async () => {
    const client = await connect('slow');
    const session = await client.createSession();
    const run = await session.start(textInput('timeout'), { timeoutMs: 20 });
    await expect(run.result()).resolves.toMatchObject({
      status: 'cancelled',
      providerResult: { reason: 'timeout' },
    });
  });

  it.each(['cancel-unconfirmed', 'exit-on-cancel'])(
    'reports %s as connection abort rather than native cancellation',
    async (mode) => {
      const client = await connect(mode, { cancelSettlementTimeoutMs: 20 });
      const session = await client.createSession();
      const run = await session.start(textInput(mode));
      await expect(run.cancel()).resolves.toEqual({
        mode: 'connection_aborted',
      });
      await expect(run.result()).resolves.toMatchObject({
        status: 'connection_aborted',
      });
    },
  );

  it('aborts the connection on unread Run overflow and explicit Client close', async () => {
    const overflowing = await connect('overflow', { maxRunEvents: 2 });
    const overflowSession = await overflowing.createSession();
    const overflowRun = await overflowSession.start(textInput('overflow'));
    await expect(overflowRun.result()).resolves.toMatchObject({
      status: 'connection_aborted',
    });

    const closing = await connect('slow');
    const session = await closing.createSession();
    const run = await session.start(textInput('close'));
    await closing.close();
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'client_closed' },
    });
  });

  it('enforces one active Run and rejects unsupported Session and input controls', async () => {
    const client = await connect('slow');
    const first = await client.createSession();
    const second = await client.createSession();
    const active = await first.start(textInput('active'));
    await expect(second.start(textInput('conflict'))).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(
      client.createSession({ systemContext: 'unsupported' }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(
      first.start({
        parts: [{ type: 'file_ref', uri: 'file:///synthetic/file' }],
      }),
    ).rejects.toMatchObject({ code: 'run_conflict' });
    await client.close();
    await active.result();
  });

  it('rejects active Session close, duplicate event consumers, and invalid workspace input', async () => {
    const client = await connect('slow');
    await expect(
      client.createSession({
        workspace: { uri: 'https://synthetic.invalid/' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    const session = await client.createSession();
    const run = await session.start(textInput('active'));
    await expect(session.close()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    run.events();
    const secondRead = collectEvents(run);
    await expect(secondRead).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await client.close();
    await run.result();
  });

  it('allows Session close to retry after active Run conflict and remote failure', async () => {
    const activeClient = await connect('slow');
    const activeSession = await activeClient.createSession();
    const starting = activeSession.start(textInput('active close'));
    const closing = activeSession.close();
    const run = await starting;
    await expect(closing).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await run.cancel();
    await run.result();
    await expect(activeSession.close()).resolves.toBeUndefined();

    const retryClient = await connect('close-error-once');
    const retrySession = await retryClient.createSession();
    await expect(retrySession.close()).rejects.toMatchObject({
      code: 'provider_error',
    });
    await expect(retrySession.close()).resolves.toBeUndefined();
    await expect(retrySession.close()).resolves.toBeUndefined();
  });

  it('keeps a timed-out Session close unsafe and aborts its connection', async () => {
    const client = await connect('close-timeout', {
      operationTimeoutMs: 250,
    });
    const session = await client.createSession();
    await expect(session.close()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await expect(
      session.start(textInput('closed outcome unknown')),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('rejects concurrent pending reads and closed Session and Client use', async () => {
    const client = await connect('slow');
    const session = await client.createSession();
    const run = await session.start(textInput('pending read'));
    const iterator = run.events()[Symbol.asyncIterator]();
    await nextEvent(iterator);
    const pending = iterator.next();
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await client.close();
    await pending;
    await expect(
      session.start(textInput('closed client')),
    ).rejects.toMatchObject({
      code: 'connection_aborted',
    });

    const fresh = await connect();
    const closedSession = await fresh.createSession();
    await closedSession.close();
    await expect(
      closedSession.start(textInput('closed session')),
    ).rejects.toMatchObject({ code: 'session_not_found' });
  });

  it('derives unsupported handshake capabilities without Provider identity inference', async () => {
    const client = await connect('capabilities-limited');
    await expect(client.capabilities()).resolves.toMatchObject({
      capabilities: {
        'session.resume': { mode: 'unsupported' },
        'session.close': { mode: 'unsupported' },
        'input.image': { mode: 'unsupported' },
      },
    });
    const session = await client.createSession();
    await expect(session.close()).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    await expect(
      session.start({
        parts: [
          {
            type: 'image_ref',
            uri: 'file:///synthetic/image.png',
            mediaType: 'image/png',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
  });

  it('settles Provider requests arriving before the Adapter Client exists', async () => {
    const client = await connect('permission-during-init');
    await expect(client.capabilities()).resolves.toMatchObject({
      capabilities: { 'interaction.approval': { mode: 'unknown' } },
    });
  });

  it('keeps native ACP extensions and observation subscriptions explicit', async () => {
    const client = await connect('unknown');
    expect(
      client.native<OpenClawNativeClient>(
        (_value): _value is OpenClawNativeClient => false,
      ),
    ).toBeUndefined();
    const native = client.native<OpenClawNativeClient>();
    await expect(native?.requestExtension('_synthetic/echo')).resolves.toEqual({
      synthetic: 'extension',
    });
    await native?.notifyExtension('_synthetic/notice');
    const extension = client
      .extensions()
      .get<OpenClawObservationExtension>(OPENCLAW_OBSERVATION_EXTENSION);
    const observed: unknown[] = [];
    const stopExtension = extension?.onObservation((value) =>
      observed.push(value),
    );
    const stopNative = native?.onUnknownEvent((value) => observed.push(value));
    stopExtension?.();
    stopNative?.();
    const session = await client.createSession();
    await (await session.start(textInput('unknown'))).result();
    expect(observed).toEqual([]);
  });

  it('rejects invalid resumable state and duplicate Provider Session identifiers', async () => {
    const normal = await connect();
    const session = await normal.createSession();
    await expect(
      normal.resumeSession({
        ...session.ref(),
        providerState: { strategy: 'shared' },
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });

    const duplicate = await connect('reuse-session');
    await duplicate.createSession();
    await expect(duplicate.createSession()).rejects.toMatchObject({
      code: 'session_provider_mismatch',
    });
  });

  it.each(['new-error', 'resume-error', 'close-error'])(
    'maps the %s remote error without exposing its body',
    async (mode) => {
      const client = await connect(mode);
      let operation: Promise<unknown>;
      if (mode === 'new-error') {
        operation = client.createSession();
      } else if (mode === 'resume-error') {
        const source = await connect();
        const sourceSession = await source.createSession();
        const ref = sourceSession.ref();
        await source.close();
        operation = client.resumeSession(ref);
      } else {
        const session = await client.createSession();
        operation = session.close();
      }
      await expect(operation).rejects.toMatchObject({
        code: 'provider_error',
      });
    },
  );

  it('maps missing runtime and bounded operation timeout during connection use', async () => {
    const factory = createOpenClawProviderFactory();
    await expect(
      factory.connect({
        ...createTestProfile(),
        connection: {
          kind: 'process',
          command: '/synthetic/missing/openclaw',
          ownership: 'adapter',
        },
      }),
    ).rejects.toMatchObject({ code: 'runtime_not_found' });
    const client = await connect('new-timeout', { operationTimeoutMs: 250 });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('inherits the host-controlled process environment without exposing it', async () => {
    const key = 'HARAPTER_OPENCLAW_SYNTHETIC_SENTINEL';
    const previous = process.env[key];
    process.env[key] = 'present';
    try {
      const client = await connect('environment-inheritance');
      await expect(client.descriptor()).resolves.toMatchObject({
        runtime: { name: 'openclaw-acp' },
      });
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = previous;
    }
  });

  it('validates Run-local controls and accepts bounded transport configuration', async () => {
    const client = await connect(undefined, {
      requestTimeoutMs: 5_000,
      cancelSettlementTimeoutMs: 5_000,
      maxBufferedEvents: 16,
      maxBufferedMessages: 16,
      maxMessageBytes: 8_192,
      maxPendingInboundRequests: 8,
      maxPendingRequests: 8,
      maxPendingWrites: 8,
      maxRunEvents: 16,
      operationTimeoutMs: 5_000,
    });
    const session = await client.createSession();
    await expect(
      session.start(textInput('metadata'), { metadata: { synthetic: 'x' } }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      session.start(textInput('options'), { providerOptions: {} }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      session.start(textInput('timeout'), { timeoutMs: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('rejects invalid Profiles and incompatible bridge identities before use', async () => {
    const factory = createOpenClawProviderFactory();
    await expect(
      factory.connect({
        ...createTestProfile(),
        connection: {
          kind: 'process',
          command: process.execPath,
          ownership: 'external',
        },
      }),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect(createTestProfile(undefined, 'identity-mismatch')),
    ).rejects.toMatchObject({ code: 'provider_api_incompatible' });
    await expect(
      factory.connect(createTestProfile(undefined, 'protocol-mismatch')),
    ).rejects.toMatchObject({ code: 'provider_api_incompatible' });
    for (const profile of [
      {
        ...createTestProfile(),
        connection: {
          kind: 'process' as const,
          command: process.execPath,
          args: ['--session=synthetic'],
          ownership: 'adapter' as const,
        },
      },
      createTestProfile(undefined, undefined, { unknown: true }),
      createTestProfile(undefined, undefined, { maxRunEvents: 1 }),
      createTestProfile(undefined, undefined, {
        operationTimeoutMs: 2_147_483_648,
      }),
      createTestProfile(undefined, undefined, { maxBufferedEvents: 0 }),
    ]) {
      await expect(factory.connect(profile)).rejects.toMatchObject({
        code: 'profile_invalid',
      });
    }
  });
});

async function connect(
  mode?: string,
  providerOptions: Readonly<Record<string, unknown>> = {},
): Promise<HarnessClient> {
  const client = await createOpenClawProviderFactory().connect(
    createTestProfile(undefined, mode, providerOptions),
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

async function nextEvent(
  iterator: AsyncIterator<HarnessEvent>,
): Promise<HarnessEvent> {
  const next = await iterator.next();
  if (next.done) throw new Error('Expected another Run event.');
  return next.value;
}
