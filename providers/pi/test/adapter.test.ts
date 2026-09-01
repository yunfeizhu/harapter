import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  PI_OBSERVATION_EXTENSION,
  PI_PROVIDER_ID,
  createPiProviderFactory,
  type PiNativeClient,
  type PiObservationExtension,
} from '../src/index.js';
import { createTestProfile } from './test-profile.js';

const clients = new Set<HarnessClient>();

afterEach(async () => {
  await Promise.all(
    [...clients].map(async (client) => client.close().catch(() => undefined)),
  );
  clients.clear();
});

describe('Pi Agent Provider Adapter', () => {
  it('exposes detached discovery and source-derived capabilities', async () => {
    const factory = createPiProviderFactory();
    const first = factory.descriptor();
    (first.connectionKinds as string[]).push('endpoint');
    expect(factory.descriptor()).toEqual({
      providerId: PI_PROVIDER_ID,
      displayName: 'Pi Agent',
      connectionKinds: ['process'],
      documentationUrl:
        'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md',
    });

    const client = await connect();
    await expect(client.descriptor()).resolves.toMatchObject({
      providerId: PI_PROVIDER_ID,
      compatibility: 'experimental',
      runtime: {
        name: 'pi',
        version: '0.84.4',
        protocol: 'Pi RPC over strict JSONL stdio',
        protocolVersion: 'current',
      },
    });
    await expect(client.capabilities({ refresh: true })).resolves.toMatchObject(
      {
        capabilities: {
          'session.create': { mode: 'native' },
          'session.resume': { mode: 'native' },
          'session.close': { mode: 'adapter_controlled' },
          'session.workspace': { mode: 'unsupported' },
          'run.stream': { mode: 'native' },
          'run.cancel': { mode: 'native' },
          'run.timeout': { mode: 'emulated' },
          'run.concurrent': {
            mode: 'unsupported',
            limits: { perSession: 1 },
          },
          'connection.abort': { mode: 'adapter_controlled' },
          'input.text': { mode: 'native' },
          'input.image': { mode: 'unsupported' },
          'input.file': { mode: 'unsupported' },
          'interaction.approval': { mode: 'unsupported' },
          'interaction.user_input': { mode: 'unsupported' },
          'interaction.provider': { mode: 'unknown' },
          'event.raw': { mode: 'adapter_controlled' },
          'native.client': { mode: 'native' },
        },
      },
    );
  });

  it('creates an isolated persisted Session', async () => {
    const client = await connect();
    const session = await client.createSession();
    expect(session.ref()).toMatchObject({
      providerId: PI_PROVIDER_ID,
      profileId: 'pi-synthetic',
      compatibilityRef: 'pi-agent;rpc-jsonl-current;strategy=isolated-process',
      providerState: {
        strategy: 'isolated-process',
        persisted: true,
      },
    });
    expect(session.ref().providerSessionId).toMatch(/^synthetic-pi-session-/u);
    await expect(session.capabilities()).resolves.toMatchObject({
      providerId: PI_PROVIDER_ID,
    });
    const closing = session.close();
    expect(session.close()).toBe(closing);
    await closing;
    await expect(session.start(textInput('closed'))).rejects.toMatchObject({
      code: 'session_not_found',
    });
  });

  it('streams safe message, reasoning, tool, and usage events and settles at agent_settled', async () => {
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
      usage: { inputTokens: 7, outputTokens: 5, totalTokens: 15 },
      providerResult: { stopReason: 'stop' },
    });
    expect(events.map(({ type }) => type)).toContain('message.delta');
    expect(events.map(({ type }) => type)).toContain('reasoning.delta');
    expect(events.map(({ type }) => type)).toContain('tool.started');
    expect(events.map(({ type }) => type)).toContain('tool.completed');
    expect(events.map(({ type }) => type)).toContain('message.completed');
    expect(events.map(({ type }) => type)).toContain('usage.updated');
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(JSON.stringify(events)).not.toContain('private fixture body');
    expect(JSON.stringify(events)).not.toContain('/private/synthetic/path');
    await expect(run.cancel()).resolves.toEqual({ mode: 'already_terminal' });
  });

  it('does not treat agent_end as terminal while Pi retries', async () => {
    const client = await connect('retry');
    const session = await client.createSession();
    const run = await session.start(textInput('retry'));
    const events = await collectEvents(run);
    await expect(run.result()).resolves.toMatchObject({
      status: 'completed',
      finalMessage: 'synthetic answer',
    });
    expect(events.filter(({ type }) => type === 'run.completed')).toHaveLength(
      1,
    );
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(JSON.stringify(events)).not.toContain('private provider failure');
  });

  it('disables extension interception for ordinary portable text', async () => {
    const client = await connect('handled-input');
    const session = await client.createSession();
    const run = await session.start(textInput('ordinary text'));
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
  });

  it.each([
    ['error', 'error'],
    ['length', 'length'],
    ['tool-use', 'toolUse'],
    ['deferred', 'deferred'],
  ] as const)(
    'maps authoritative %s assistant outcomes to failure',
    async (mode, stopReason) => {
      const client = await connect(mode);
      const session = await client.createSession();
      const run = await session.start(textInput(mode));
      const [events, result] = await Promise.all([
        collectEvents(run),
        run.result(),
      ]);
      expect(result).toMatchObject({
        status: 'failed',
        providerResult: { stopReason },
      });
      expect(events.at(-1)?.type).toBe('run.failed');
    },
  );

  it('fails closed when agent_settled has no authoritative assistant outcome', async () => {
    const client = await connect('missing-terminal');
    const session = await client.createSession();
    const run = await session.start(textInput('missing'));
    await expect(run.result()).resolves.toEqual({
      status: 'failed',
      providerResult: { reason: 'missing_assistant_terminal' },
    });
    expect((await collectEvents(run)).at(-1)?.type).toBe('run.failed');
  });

  it('omits an empty final message without inventing content', async () => {
    const client = await connect('empty');
    const session = await client.createSession();
    const run = await session.start(textInput('empty'));
    const result = await run.result();
    expect(result).toEqual({
      status: 'completed',
      usage: { inputTokens: 7, outputTokens: 5, totalTokens: 15 },
      providerResult: { stopReason: 'stop' },
    });
  });

  it('maps RPC EOF before agent_settled to connection abort', async () => {
    const client = await connect('eof');
    const session = await client.createSession();
    const run = await session.start(textInput('eof'));
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'transport_ended' },
    });
    await expect(session.start(textInput('after eof'))).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('reports native cancellation only after aborted and agent_settled', async () => {
    const client = await connect('cancel');
    const session = await client.createSession();
    const run = await session.start(textInput('cancel'));
    await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
    await expect(run.result()).resolves.toMatchObject({
      status: 'cancelled',
      providerResult: { stopReason: 'aborted' },
    });
    expect((await collectEvents(run)).at(-1)?.type).toBe('run.cancelled');
  });

  it('uses native abort for local Run timeout but records the local reason', async () => {
    const client = await connect('cancel');
    const session = await client.createSession();
    const run = await session.start(textInput('timeout'), { timeoutMs: 10 });
    await expect(run.result()).resolves.toMatchObject({
      status: 'cancelled',
      providerResult: { stopReason: 'aborted', reason: 'timeout' },
    });
  });

  it('aborts the Session process when abort acknowledgement lacks a terminal', async () => {
    const client = await connect('abort-no-terminal', {
      cancelSettlementTimeoutMs: 20,
    });
    const session = await client.createSession();
    const run = await session.start(textInput('cancel'));
    await expect(run.cancel()).resolves.toEqual({ mode: 'connection_aborted' });
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'cancel_terminal_timeout' },
    });
  });

  it('maps an explicit abort rejection to connection abort', async () => {
    const client = await connect('abort-reject');
    const session = await client.createSession();
    const run = await session.start(textInput('cancel'));
    await expect(run.cancel()).resolves.toEqual({ mode: 'connection_aborted' });
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'cancel_confirmation_failed' },
    });
  });

  it('does not publish cancellation before the abort response is confirmed', async () => {
    const client = await connect('abort-response-lost', {
      operationTimeoutMs: 100,
    });
    const session = await client.createSession();
    const run = await session.start(textInput('cancel'));
    await expect(run.cancel()).resolves.toEqual({
      mode: 'connection_aborted',
    });
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'cancel_confirmation_failed' },
    });
    expect((await collectEvents(run)).at(-1)?.type).toBe('connection.aborted');
  });

  it('does not publish cancellation without a correlated abort request', async () => {
    const client = await connect('unsolicited-abort');
    const session = await client.createSession();
    const run = await session.start(textInput('unexpected abort'));
    await expect(run.result()).resolves.toEqual({
      status: 'failed',
      providerResult: { reason: 'unconfirmed_native_cancellation' },
    });
    expect((await collectEvents(run)).at(-1)?.type).toBe('run.failed');
  });

  it('aborts an uncertain Run when prompt acknowledgement times out', async () => {
    const client = await connect('slow-ack', { operationTimeoutMs: 100 });
    const session = await client.createSession();
    const run = await session.start(textInput('slow'));
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'prompt_ack_uncertain' },
    });
  });

  it('keeps an authoritative prompt rejection as failure without exposing its body', async () => {
    const client = await connect('prompt-reject');
    const session = await client.createSession();
    const run = await session.start(textInput('rejected'));
    const [events, result] = await Promise.all([
      collectEvents(run),
      run.result(),
    ]);
    expect(result).toEqual({
      status: 'failed',
      providerResult: { reason: 'prompt_rejected' },
    });
    expect(JSON.stringify(events)).not.toContain('private provider rejection');
  });

  it('relays typed Pi extension UI interactions and updates capability evidence', async () => {
    const client = await connect('interaction');
    const session = await client.createSession();
    const run = await session.start(textInput('interaction'));
    const iterator = run.events()[Symbol.asyncIterator]();
    const requested = await findEvent(iterator, 'interaction.requested');
    expect(requested).toMatchObject({
      data: {
        kind: 'provider',
        title: 'Synthetic confirmation',
        prompt: 'Continue the synthetic Run?',
        schema: { method: 'confirm', response: 'confirmed' },
        providerState: { method: 'confirm' },
      },
    });
    const requestId = (requested.data as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string') throw new Error('Missing request ID.');
    await expect(
      session.respond('missing', {
        kind: 'provider',
        value: { confirmed: true },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      session.respond(requestId, {
        kind: 'approval',
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      session.respond(requestId, {
        kind: 'provider',
        value: { value: 'wrong shape' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await session.respond(requestId, {
      kind: 'provider',
      value: { confirmed: true },
    });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    const remainder = await collectIterator(iterator);
    expect(remainder.some(({ type }) => type === 'interaction.resolved')).toBe(
      true,
    );
    await expect(client.capabilities()).resolves.toMatchObject({
      capabilities: { 'interaction.provider': { mode: 'native' } },
    });
  });

  it('supports select values and explicit cancellation for Provider interactions', async () => {
    for (const response of [
      { value: 'second' },
      { cancelled: true as const },
    ]) {
      const client = await connect('select-interaction');
      const session = await client.createSession();
      const run = await session.start(textInput('select'));
      const iterator = run.events()[Symbol.asyncIterator]();
      const requested = await findEvent(iterator, 'interaction.requested');
      expect(requested).toMatchObject({
        data: {
          schema: {
            method: 'select',
            options: ['first', 'second'],
            response: 'value',
          },
        },
      });
      const requestId = (requested.data as { requestId?: unknown }).requestId;
      if (typeof requestId !== 'string') throw new Error('Missing request ID.');
      await session.respond(requestId, { kind: 'provider', value: response });
      await expect(run.result()).resolves.toMatchObject({
        status: 'completed',
      });
      await collectIterator(iterator);
      await client.close();
      clients.delete(client);
    }
  });

  it('settles a pending Provider interaction when the Run is cancelled', async () => {
    const client = await connect('interaction');
    const session = await client.createSession();
    const run = await session.start(textInput('cancel interaction'));
    const iterator = run.events()[Symbol.asyncIterator]();
    const requested = await findEvent(iterator, 'interaction.requested');
    expect(requested.type).toBe('interaction.requested');
    const requestId = (requested.data as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string') throw new Error('Missing request ID.');
    await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
    await collectIterator(iterator);
    await expect(
      session.respond(requestId, {
        kind: 'provider',
        value: { confirmed: true },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('exposes only bounded observations and ownership-preserving native reads', async () => {
    const client = await connect('unknown');
    const observer = client
      .extensions()
      .get<PiObservationExtension>(PI_OBSERVATION_EXTENSION);
    expect(observer).toBeDefined();
    const observations: unknown[] = [];
    const stop = observer?.onObservation((event) => {
      observations.push(event);
      throw new Error('observer isolation');
    });
    const native = client.native<PiNativeClient>();
    expect(native).toBeDefined();
    expect(
      client.native<PiNativeClient>(
        (value): value is PiNativeClient => value === native,
      ),
    ).toBe(native);
    const guardedNative = client.native<PiNativeClient>(
      (_value): _value is PiNativeClient => false,
    );
    expect(guardedNative).toBeUndefined();
    const nativeObservations: unknown[] = [];
    const stopNative = native?.onObservation((event) => {
      nativeObservations.push(event);
    });
    const session = await client.createSession();
    await expect(
      native?.request(session.ref().providerSessionId, {
        type: 'get_commands',
      }),
    ).resolves.toEqual({ fixture: 'get_commands' });
    await expect(
      native?.request(session.ref().providerSessionId, { type: 'new_session' }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(
      native?.request(session.ref().providerSessionId, {
        id: 'caller-id',
        type: 'get_state',
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    const run = await session.start(textInput('unknown'));
    const events = await collectEvents(run);
    await run.result();
    stop?.();
    stopNative?.();
    const serialized = JSON.stringify([
      observations,
      nativeObservations,
      events,
    ]);
    expect(serialized).not.toContain('fixture-secret-must-not-escape');
    expect(serialized).not.toContain('/private/synthetic/path');
    expect(serialized).not.toContain('future_private_event');
    expect(
      events.some(({ providerEventType }) =>
        /^event-[a-f0-9]{16}$/u.test(providerEventType ?? ''),
      ),
    ).toBe(true);
    await session.close();
    await expect(
      native?.request(session.ref().providerSessionId, {
        type: 'get_commands',
      }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
  });

  it('honors local abort signals for native request waits', async () => {
    const client = await connect();
    const session = await client.createSession();
    const native = client.native<PiNativeClient>();
    const controller = new AbortController();
    controller.abort();
    await expect(
      native?.request(
        session.ref().providerSessionId,
        { type: 'get_state' },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'timeout', retryable: false });
  });

  it('aborts an in-flight native wait without closing the Session process', async () => {
    const client = await connect('slow-native');
    const session = await client.createSession();
    const native = client.native<PiNativeClient>();
    if (native === undefined) throw new Error('Missing native Client.');
    const controller = new AbortController();
    const waiting = native.request(
      session.ref().providerSessionId,
      { type: 'get_messages' },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(waiting).rejects.toMatchObject({
      code: 'timeout',
      retryable: false,
    });
    await expect(
      native.request(session.ref().providerSessionId, { type: 'get_state' }),
    ).resolves.toMatchObject({ sessionId: session.ref().providerSessionId });
  });

  it('ignores a valid late response after a local native request timeout', async () => {
    const client = await connect('late-native');
    const session = await client.createSession();
    const native = client.native<PiNativeClient>();
    if (native === undefined) throw new Error('Missing native Client.');
    await expect(
      native.request(
        session.ref().providerSessionId,
        { type: 'get_messages' },
        { timeoutMs: 10 },
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(
      native.request(session.ref().providerSessionId, { type: 'get_state' }),
    ).resolves.toMatchObject({ sessionId: session.ref().providerSessionId });
  });

  it('bounds concurrent native request correlation', async () => {
    const client = await connect('slow-native', {
      maxPendingRequests: 1,
      operationTimeoutMs: 100,
    });
    const session = await client.createSession();
    const native = client.native<PiNativeClient>();
    if (native === undefined) throw new Error('Missing native Client.');
    const first = native.request(
      session.ref().providerSessionId,
      { type: 'get_messages' },
      { timeoutMs: 20 },
    );
    await expect(
      native.request(session.ref().providerSessionId, { type: 'get_messages' }),
    ).rejects.toMatchObject({ code: 'provider_error' });
    await expect(first).rejects.toMatchObject({ code: 'timeout' });
  });

  it('resumes only an owned compatible persisted Session', async () => {
    const first = await connect();
    const original = await first.createSession();
    const ref = original.ref();
    await first.close();

    const second = await connect();
    const resumed = await second.resumeSession(ref);
    expect(resumed.ref()).toEqual(ref);
    const run = await resumed.start(textInput('resumed'));
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });

    const { compatibilityRef: _compatibilityRef, ...withoutCompatibility } =
      ref;
    for (const invalid of [
      { ...ref, providerId: providerId('other.provider') },
      { ...ref, profileId: profileId('other-profile') },
      { ...ref, compatibilityRef: 'pi-agent;future' },
      withoutCompatibility,
      { ...ref, providerState: {} },
      {
        ...ref,
        providerState: {
          strategy: 'isolated-process',
          persisted: true,
          workspaceUri: 'https://example.com',
        },
      },
    ]) {
      await expect(second.resumeSession(invalid)).rejects.toMatchObject({
        code: 'session_provider_mismatch',
      });
    }
    await expect(second.resumeSession(ref)).rejects.toMatchObject({
      code: 'session_provider_mismatch',
    });
  });

  it('keeps ephemeral Sessions explicitly non-resumable', async () => {
    const client = await connect('normal', { persistSessions: false });
    await expect(client.capabilities()).resolves.toMatchObject({
      capabilities: { 'session.resume': { mode: 'unsupported' } },
    });
    const session = await client.createSession();
    expect(session.ref()).toMatchObject({
      providerState: { persisted: false },
    });
    await expect(client.resumeSession(session.ref())).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
  });

  it('rejects a non-persisted reference even on a persistent Client', async () => {
    const ephemeral = await connect('normal', { persistSessions: false });
    const original = await ephemeral.createSession();
    const ref = original.ref();
    await ephemeral.close();

    const persistent = await connect();
    await expect(persistent.resumeSession(ref)).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
  });

  it('fails resume when the Runtime reports a different native Session', async () => {
    const first = await connect();
    const original = await first.createSession();
    const ref = original.ref();
    await first.close();

    const second = await connect('wrong-session');
    await expect(second.resumeSession(ref)).rejects.toMatchObject({
      code: 'session_provider_mismatch',
    });
  });

  it.each(['busy-state', 'invalid-state', 'unmatched-response'])(
    'fails closed when %s breaks Session readiness',
    async (mode) => {
      const client = await connect(mode);
      await expect(client.createSession()).rejects.toMatchObject({
        code: 'provider_api_incompatible',
      });
    },
  );

  it('maps a rejected Session state probe to a safe Provider error', async () => {
    const client = await connect('state-reject');
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'provider_error',
      providerCode: 'remote_rejected',
    });
  });

  it('rejects a duplicate active native Session identifier', async () => {
    const client = await connect('fixed-session');
    const first = await client.createSession();
    expect(first.ref().providerSessionId).toBe('synthetic-fixed-session');
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'session_provider_mismatch',
    });
  });

  it('isolates concurrent Runs in separate Session processes', async () => {
    const client = await connect();
    const first = await client.createSession();
    const second = await client.createSession();
    expect(first.ref().providerSessionId).not.toBe(
      second.ref().providerSessionId,
    );
    const [firstRun, secondRun] = await Promise.all([
      first.start(textInput('first')),
      second.start(textInput('second')),
    ]);
    expect(firstRun.ref().runId).not.toBe(secondRun.ref().runId);
    await expect(
      Promise.all([firstRun.result(), secondRun.result()]),
    ).resolves.toMatchObject([
      { status: 'completed' },
      { status: 'completed' },
    ]);
  });

  it('rejects a second Run and Session close while one Run is active', async () => {
    const client = await connect('cancel');
    const session = await client.createSession();
    const run = await session.start(textInput('active'));
    await expect(session.start(textInput('conflict'))).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await expect(session.close()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await run.cancel();
    await run.result();
    await session.close();
  });

  it('returns already_terminal when abort races an authoritative completion', async () => {
    const client = await connect('abort-completes');
    const session = await client.createSession();
    const run = await session.start(textInput('race'));
    await expect(run.cancel()).resolves.toEqual({ mode: 'already_terminal' });
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
  });

  it('aborts an active Run when the Client closes and keeps close idempotent', async () => {
    const client = await connect('cancel');
    const session = await client.createSession();
    const run = await session.start(textInput('active'));
    const closing = client.close();
    expect(client.close()).toBe(closing);
    await closing;
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'client_closed' },
    });
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('does not register a Session that finishes opening after Client close', async () => {
    const client = await connect('slow-state');
    const opening = client.createSession();
    let openingSettled = false;
    void opening.then(
      () => {
        openingSettled = true;
      },
      () => {
        openingSettled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.close();
    expect(openingSettled).toBe(true);
    await expect(opening).rejects.toMatchObject({ code: 'connection_aborted' });
  });

  it('keeps a closing Session registered until process cleanup settles', async () => {
    const client = await connect('slow-exit');
    const session = await client.createSession();
    const sessionClosing = session.close();
    let sessionSettled = false;
    void sessionClosing.then(
      () => {
        sessionSettled = true;
      },
      () => {
        sessionSettled = true;
      },
    );
    await client.close();
    expect(sessionSettled).toBe(true);
    await expect(sessionClosing).resolves.toBeUndefined();
  });

  it('keeps the Profile working directory stable after connection', async () => {
    const originalCwd = process.cwd();
    const alternateCwd = await mkdtemp(join(tmpdir(), 'harapter-pi-cwd-'));
    const profile = createTestProfile();
    if (profile.connection.kind !== 'process') throw new Error('Bad fixture.');
    const client = await createPiProviderFactory().connect({
      ...profile,
      connection: {
        ...profile.connection,
        args: [
          'providers/pi/test/fixture-runtime.mjs',
          '--fixture-mode',
          'normal',
        ],
        cwd: '.',
      },
    });
    clients.add(client);
    try {
      process.chdir(alternateCwd);
      const session = await client.createSession();
      const run = await session.start(textInput('stable cwd'));
      await expect(run.result()).resolves.toMatchObject({
        status: 'completed',
      });
    } finally {
      process.chdir(originalCwd);
      await rm(alternateCwd, { recursive: true, force: true });
    }
  });

  it('aborts when the bounded Run event queue overflows', async () => {
    const client = await connect('normal', { maxRunEvents: 2 });
    const session = await client.createSession();
    const run = await session.start(textInput('overflow'));
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'event_buffer_overflow' },
    });
  });

  it.each(['malformed-event', 'malformed-json'])(
    'fails a Run and closes its process for %s',
    async (mode) => {
      const client = await connect(mode);
      const session = await client.createSession();
      const run = await session.start(textInput(mode));
      const result = await run.result();
      expect(result.status).toBe('failed');
    },
  );

  it('keeps late post-terminal activity out of the completed Run trace', async () => {
    const client = await connect('late');
    const session = await client.createSession();
    const run = await session.start(textInput('late'));
    const events = await collectEvents(run);
    await run.result();
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(JSON.stringify(events)).not.toContain('late private content');
  });

  it('keeps non-interactive extension UI messages as redacted observations', async () => {
    const client = await connect('notify');
    const observations: unknown[] = [];
    client
      .extensions()
      .get<PiObservationExtension>(PI_OBSERVATION_EXTENSION)
      ?.onObservation((event) => observations.push(event));
    const session = await client.createSession();
    const run = await session.start(textInput('notify'));
    await run.result();
    expect(JSON.stringify(observations)).not.toContain('private notification');
  });

  it('bounds pending Provider interactions per Session', async () => {
    const client = await connect('multi-interaction', {
      maxPendingInteractions: 1,
    });
    const session = await client.createSession();
    const run = await session.start(textInput('capacity'));
    await expect(run.result()).resolves.toMatchObject({
      status: 'connection_aborted',
      providerResult: { reason: 'interaction_capacity_exceeded' },
    });
  });

  it('maps Provider input interaction schema and value response', async () => {
    const client = await connect('input-interaction');
    const session = await client.createSession();
    const run = await session.start(textInput('input'));
    const iterator = run.events()[Symbol.asyncIterator]();
    const requested = await findEvent(iterator, 'interaction.requested');
    expect(requested).toMatchObject({
      data: {
        kind: 'provider',
        schema: { method: 'input', response: 'value' },
      },
    });
    const requestId = (requested.data as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string') throw new Error('Missing request ID.');
    await session.respond(requestId, {
      kind: 'provider',
      value: { value: 'synthetic value' },
    });
    await run.result();
    await collectIterator(iterator);
  });

  it('rejects duplicate Run event consumers', async () => {
    const client = await connect();
    const session = await client.createSession();
    const run = await session.start(textInput('consumer'));
    const first = collectEvents(run);
    await expect(collectEvents(run)).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await first;
  });

  it('rejects overlapping pending reads on one Run event iterator', async () => {
    const client = await connect('cancel');
    const session = await client.createSession();
    const run = await session.start(textInput('pending reads'));
    const iterator = run.events()[Symbol.asyncIterator]();
    await iterator.next();
    const waiting = iterator.next();
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await run.cancel();
    await waiting;
  });

  it('rejects unsupported Session, Run, input, and Workspace shapes', async () => {
    const client = await connect();
    for (const input of [
      { workspace: { uri: 'file:///synthetic' } },
      { systemContext: 'synthetic' },
      { model: { id: 'synthetic-model' } },
      { providerOptions: {} },
      { metadata: {} },
    ]) {
      await expect(client.createSession(input)).rejects.toMatchObject({
        code: 'unsupported_capability',
      });
    }
    const session = await client.createSession();
    for (const input of [
      { parts: [] },
      { parts: [{ type: 'text' as const, text: '' }] },
      { parts: [{ type: 'file_ref' as const, uri: 'file:///synthetic' }] },
    ]) {
      await expect(session.start(input)).rejects.toBeDefined();
    }
    await expect(
      session.start(textInput('metadata'), { metadata: {} }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await expect(
      session.start(textInput('options'), { providerOptions: {} }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
  });

  it('rejects invalid Profiles before starting Provider traffic', async () => {
    const factory = createPiProviderFactory();
    const valid = createTestProfile();
    const invalidProfiles: HarnessProfile[] = [
      { ...valid, providerId: providerId('other.provider') },
      {
        ...valid,
        connection: {
          kind: 'endpoint',
          url: 'http://127.0.0.1',
          ownership: 'host',
        },
      },
      {
        ...valid,
        connection: { kind: 'process', command: '', ownership: 'adapter' },
      },
      {
        ...valid,
        connection: { kind: 'process', command: 'pi', ownership: 'adapter' },
      },
      {
        ...valid,
        connection: {
          kind: 'process',
          command: './pi',
          ownership: 'adapter',
        },
      },
      {
        ...valid,
        connection: {
          kind: 'process',
          command: process.execPath,
          ownership: 'host',
        },
      },
      {
        ...valid,
        connection: {
          kind: 'process',
          command: process.execPath,
          args: ['--mode', 'rpc'],
          ownership: 'adapter',
        },
      },
      {
        ...valid,
        connection: {
          kind: 'process',
          command: process.execPath,
          ownership: 'adapter',
          envRefs: { TOKEN: { scheme: 'test', id: 'synthetic' } },
        },
      },
      { ...valid, providerOptions: { unknown: true } },
      { ...valid, providerOptions: { persistSessions: 'yes' } },
      { ...valid, providerOptions: { maxRunEvents: 1 } },
      { ...valid, providerOptions: { maxRunEvents: 4_097 } },
      { ...valid, providerOptions: { operationTimeoutMs: 0 } },
      { ...valid, providerOptions: { operationTimeoutMs: 2_147_483_648 } },
      { ...valid, providerOptions: { maxPendingRequests: 'many' } },
      {
        ...valid,
        connection: {
          kind: 'process',
          command: process.execPath,
          args: ['--'],
          ownership: 'adapter',
        },
      },
      {
        ...valid,
        connection: {
          kind: 'process',
          command: process.execPath,
          args: ['--api-key=synthetic'],
          ownership: 'adapter',
        },
      },
      {
        ...valid,
        connection: {
          kind: 'process',
          command: process.execPath,
          args: ['--extension', '/synthetic/extension.mjs'],
          ownership: 'adapter',
        },
      },
    ];
    for (const profile of invalidProfiles) {
      await expect(factory.connect(profile)).rejects.toMatchObject({
        code: 'profile_invalid',
      });
    }
  });

  it('reports a missing host-supplied Runtime without installing it', async () => {
    await expect(
      createPiProviderFactory().connect({
        profileId: profileId('pi-missing'),
        providerId: PI_PROVIDER_ID,
        displayName: 'Missing Pi',
        connection: {
          kind: 'process',
          command: '/synthetic/missing/pi-runtime',
          ownership: 'adapter',
        },
      }),
    ).rejects.toMatchObject({ code: 'runtime_not_found' });
  });

  it.each([
    ['bad-version', 'provider_api_incompatible'],
    ['oversized-version', 'provider_api_incompatible'],
    ['version-exit', 'connection_failed'],
  ] as const)('fails a %s Runtime probe safely', async (mode, code) => {
    await expect(
      createPiProviderFactory().connect(createTestProfile(undefined, mode)),
    ).rejects.toMatchObject({ code });
  });

  it('times out a silent Runtime version probe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harapter-pi-probe-'));
    const pidFile = join(directory, 'pid');
    const base = createTestProfile(
      profileId('pi-version-timeout'),
      'version-timeout',
      { operationTimeoutMs: 100 },
    );
    if (base.connection.kind !== 'process') throw new Error('Missing process.');
    const profile: HarnessProfile = {
      ...base,
      connection: {
        ...base.connection,
        args: [...(base.connection.args ?? []), '--pid-file', pidFile],
      },
    };
    let pid: number | undefined;
    try {
      await expect(
        createPiProviderFactory().connect(profile),
      ).rejects.toMatchObject({ code: 'timeout', retryable: true });
      const observedPid = Number(await readFile(pidFile, 'utf8'));
      if (!Number.isSafeInteger(observedPid)) throw new Error('Invalid PID.');
      pid = observedPid;
      expect(() => process.kill(observedPid, 0)).toThrow();
    } finally {
      if (pid !== undefined) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // The Adapter already reaped the synthetic process.
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('observes startup events emitted before Session ownership is bound', async () => {
    const client = await connect('startup-event');
    const observations: unknown[] = [];
    client
      .extensions()
      .get<PiObservationExtension>(PI_OBSERVATION_EXTENSION)
      ?.onObservation((event) => observations.push(event));
    const session = await client.createSession();
    expect(JSON.stringify(observations)).not.toContain('startup-private-value');
    expect(observations.length).toBeGreaterThan(0);
    await session.close();
  });

  it('accepts explicit bounded connection limits', async () => {
    const client = await connect('normal', {
      cancelSettlementTimeoutMs: 50,
      maxBufferedMessages: 8,
      maxMessageBytes: 4096,
      maxPendingInteractions: 4,
      maxPendingRequests: 4,
      maxPendingWrites: 4,
      maxRunEvents: 32,
      operationTimeoutMs: 1_000,
      writeTimeoutMs: 1_000,
    });
    const session = await client.createSession();
    const run = await session.start(textInput('bounded'));
    await expect(run.result()).resolves.toMatchObject({ status: 'completed' });
    await expect(
      session.start(textInput('bad timeout'), { timeoutMs: 0 }),
    ).rejects.toBeDefined();
    await expect(
      session.start(textInput('large timeout'), {
        timeoutMs: 2_147_483_648,
      }),
    ).rejects.toBeDefined();
  });
});

async function connect(
  mode = 'normal',
  providerOptions?: Readonly<Record<string, unknown>>,
): Promise<HarnessClient> {
  const client = await createPiProviderFactory().connect(
    createTestProfile(profileId('pi-synthetic'), mode, providerOptions),
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

async function findEvent(
  iterator: AsyncIterator<HarnessEvent>,
  type: HarnessEvent['type'],
): Promise<HarnessEvent> {
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error(`Missing ${type} event.`);
    if (next.value.type === type) return next.value;
  }
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
