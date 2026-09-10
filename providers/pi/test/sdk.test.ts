import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import {
  definePortableProviderConformanceSuite,
  validatePortableRunTrace,
} from '@harapter/conformance';
import {
  profileId,
  type HarnessClient,
  type HarnessEvent,
} from '@harapter/core';
import { createPiProviderFactory, PI_PROVIDER_ID } from '../src/index.js';
import { sdkFixture, sdkProfile } from './sdk-fixture.js';

const clients: HarnessClient[] = [];
async function collect(events: AsyncIterable<HarnessEvent>) {
  const values: HarnessEvent[] = [];
  for await (const event of events) values.push(event);
  return values;
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});
async function connect(native = sdkFixture()) {
  const client = await createPiProviderFactory().connect(
    sdkProfile(() => Promise.resolve(native)),
  );
  clients.push(client);
  return { client, native, session: await client.createSession() };
}

definePortableProviderConformanceSuite({
  name: 'Pi embedded SDK synthetic fixture',
  createFactory: createPiProviderFactory,
  createProfile: () => sdkProfile(() => Promise.resolve(sdkFixture())),
});

it('keeps one native session for two portable messages and waits for prompt settlement', async () => {
  const { native, session } = await connect();
  for (const text of ['first', 'second']) {
    const run = await session.start({ parts: [{ type: 'text', text }] });
    const events = await collect(run.events());
    const result = await run.result();
    validatePortableRunTrace(events, result);
    expect(result).toMatchObject({
      status: 'completed',
      finalMessage: 'Synthetic SDK answer',
    });
  }
  expect(native.inputs).toEqual(['first', 'second']);
  await session.close();
  expect(native.disposed).toBe(1);
});

it('does not turn agent_end, an unknown event, or an empty resolved prompt into success', async () => {
  const native = sdkFixture('empty');
  const { session } = await connect(native);
  const run = await session.start({
    parts: [{ type: 'text', text: 'synthetic' }],
  });
  const events = await collect(run.events());
  expect((await run.result()).status).toBe('failed');
  expect(JSON.stringify(events)).not.toContain('synthetic-private-data');
  expect(
    events.some(
      (event) => event.type === 'provider' && event.raw !== undefined,
    ),
  ).toBe(true);
});

it('redacts a rejected prompt and rejects concurrent work', async () => {
  const { session } = await connect(sdkFixture('reject'));
  const task = await session.start({
    parts: [{ type: 'text', text: 'synthetic' }],
  });
  await expect(
    session.start({ parts: [{ type: 'text', text: 'second' }] }),
  ).rejects.toMatchObject({ code: 'run_conflict' });
  expect(await task.result()).toMatchObject({ status: 'failed' });
  expect(JSON.stringify(await task.result())).not.toContain(
    'synthetic-private-data',
  );
});

it('disposes an owned session after a bounded run timeout without claiming native cancellation', async () => {
  const { native, session } = await connect(sdkFixture('hang'));
  const task = await session.start(
    { parts: [{ type: 'text', text: 'synthetic' }] },
    { timeoutMs: 10 },
  );
  expect(await task.result()).toMatchObject({ status: 'connection_aborted' });
  expect(native.disposed).toBe(1);
  await expect(
    session.start({ parts: [{ type: 'text', text: 'late' }] }),
  ).rejects.toMatchObject({ code: 'connection_aborted' });
});

it('validates version and ownership before calling the SDK factory', async () => {
  const factory = vi.fn(() => Promise.resolve(sdkFixture()));
  for (const profile of [
    {
      ...sdkProfile(factory),
      connection: { kind: 'sdk' as const, factory, ownership: 'host' as const },
    },
    { ...sdkProfile(factory), providerOptions: { sdkVersion: '0.84.0' } },
    {
      ...sdkProfile(factory),
      providerId: PI_PROVIDER_ID,
      providerOptions: { sdkVersion: '0.85.1', unsafe: true },
    },
  ])
    await expect(
      createPiProviderFactory().connect(profile),
    ).rejects.toBeDefined();
  expect(factory).not.toHaveBeenCalled();
});

it('bounds creation and disposes a factory result arriving after client close', async () => {
  let resolve!: (value: ReturnType<typeof sdkFixture>) => void;
  const profile = sdkProfile(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const client = await createPiProviderFactory().connect(profile);
  clients.push(client);
  const opening = client.createSession();
  const assertion = opening.catch((error: unknown) => error);
  await Promise.resolve();
  await client.close();
  expect(await assertion).toMatchObject({ code: 'connection_aborted' });
  const native = sdkFixture();
  resolve(native);
  await vi.waitFor(() => {
    expect(native.disposed).toBe(1);
  });
});

it('isolates sessions and retains profile identity', async () => {
  const { client, session } = await connect();
  await expect(
    client.resumeSession({ ...session.ref(), profileId: profileId('other') }),
  ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
  expect(
    (await session.capabilities()).capabilities['session.resume']?.mode,
  ).toBe('unsupported');
  await expect(
    session.respond('unknown', { kind: 'approval', decision: 'approve' }),
  ).rejects.toMatchObject({ code: 'unsupported_capability' });
});

it('bounds event buffering and preserves exactly one terminal', async () => {
  const native = sdkFixture('hang');
  const { session } = await connect(native);
  const task = await session.start({
    parts: [{ type: 'text', text: 'synthetic' }],
  });
  for (let index = 0; index < 200; index++)
    native.emit({ type: 'unknown', secret: 'synthetic-private-data' });
  const events: HarnessEvent[] = await collect(task.events());
  expect(events.length).toBeLessThanOrEqual(128);
  validatePortableRunTrace(events, await task.result());
  expect((await task.result()).status).toBe('connection_aborted');
});

it('rejects unsupported SDK session and run configuration before prompting', async () => {
  const { client, native, session } = await connect();
  await expect(
    client.createSession({ model: { id: 'unsupported' } }),
  ).rejects.toMatchObject({ code: 'unsupported_capability' });
  await expect(
    session.start({ parts: [{ type: 'text', text: 'x' }] }, { metadata: {} }),
  ).rejects.toMatchObject({ code: 'unsupported_capability' });
  await expect(
    session.start({ parts: [{ type: 'text', text: 'x' }] }, { timeoutMs: 0 }),
  ).rejects.toMatchObject({ code: 'invalid_request' });
  expect(native.inputs).toEqual([]);
  await client.close();
  await expect(client.createSession()).rejects.toMatchObject({
    code: 'connection_aborted',
  });
});

it('rejects malformed SDK objects and disposes transferred invalid Sessions', async () => {
  for (const patch of [
    { sessionId: '' },
    { sessionId: 'x'.repeat(513) },
    { isStreaming: true },
    { subscribe: () => undefined },
  ]) {
    const native = sdkFixture();
    Object.assign(native, patch);
    const client = await createPiProviderFactory().connect(
      sdkProfile(() => Promise.resolve(native)),
    );
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'provider_api_incompatible',
    });
    expect(native.disposed).toBe(1);
    await client.close();
  }
  const client = await createPiProviderFactory().connect(
    sdkProfile(() => Promise.resolve({}) as never),
  );
  await expect(client.createSession()).rejects.toMatchObject({
    code: 'provider_api_incompatible',
  });
  await client.close();
});

it('rejects reused native handles without disposing the existing owner', async () => {
  const { client, native, session } = await connect();
  await expect(client.createSession()).rejects.toMatchObject({
    code: 'provider_api_incompatible',
  });
  expect(native.disposed).toBe(0);
  expect(
    (
      await (
        await session.start({ parts: [{ type: 'text', text: 'still owned' }] })
      ).result()
    ).status,
  ).toBe('completed');
});

it('bounds startup time and releases a late native result', async () => {
  const result = Promise.withResolvers<ReturnType<typeof sdkFixture>>();
  const client = await createPiProviderFactory().connect({
    ...sdkProfile(() => result.promise),
    providerOptions: { sdkVersion: '0.85.1', operationTimeoutMs: 10 },
  });
  await expect(client.createSession()).rejects.toMatchObject({
    code: 'timeout',
  });
  const native = sdkFixture();
  result.resolve(native);
  await vi.waitFor(() => {
    expect(native.disposed).toBe(1);
  });
  await client.close();
});

it('limits live handles and cleans up every owned Session', async () => {
  const client = await createPiProviderFactory().connect(
    sdkProfile(() => Promise.resolve(sdkFixture())),
  );
  for (let index = 0; index < 16; index++) await client.createSession();
  await expect(client.createSession()).rejects.toMatchObject({
    code: 'run_conflict',
  });
  await client.close();
});

it('contains SDK cleanup exceptions and returns a stable error', async () => {
  const native = sdkFixture();
  native.dispose = () => {
    throw new Error('synthetic-private-data');
  };
  const { client } = await connect(native);
  await expect(client.close()).rejects.toMatchObject({
    code: 'connection_failed',
    cause: undefined,
  });
});

it.each(['error', 'aborted', 'length', 'toolUse'])(
  'requires an authoritative stop for completion: %s',
  async (stopReason) => {
    const native = sdkFixture('hang');
    let complete!: () => void;
    native.prompt = () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      });
    const { session } = await connect(native);
    const task = await session.start({ parts: [{ type: 'text', text: 'x' }] });
    await Promise.resolve();
    native.emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason,
        content: [],
        usage: { input: 1, output: 2, totalTokens: 3 },
      },
    });
    complete();
    expect((await task.result()).status).toBe('failed');
  },
);

it('contains malformed or oversized SDK events', async () => {
  for (const event of [
    null,
    {
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'future' },
    },
    {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'x'.repeat(262_145) },
    },
  ]) {
    const { native, session } = await connect(sdkFixture('hang'));
    const task = await session.start({ parts: [{ type: 'text', text: 'x' }] });
    native.emit(event);
    expect((await task.result()).status).not.toBe('completed');
    expect(native.disposed).toBe(1);
  }
});

it('maps reasoning and ignores late events after terminal settlement', async () => {
  const { native, session } = await connect(sdkFixture('hang'));
  const task = await session.start({ parts: [{ type: 'text', text: 'x' }] });
  native.emit({
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      content: [{ type: 'thinking', thinking: 'Synthetic reasoning' }],
      usage: { input: 0, output: 0, totalTokens: 0 },
    },
  });
  await session.close();
  native.emit({ type: 'late', secret: 'synthetic-private-data' });
  const events = await collect(task.events());
  expect(events.some((event) => event.type === 'reasoning.completed')).toBe(
    true,
  );
  validatePortableRunTrace(events, await task.result());
});

it('downgrades unconfirmed or stalled aborts to connection abort', async () => {
  for (const stall of [false, true]) {
    const native = sdkFixture('hang');
    native.abort = () =>
      stall
        ? new Promise<void>(() => undefined)
        : Promise.reject(new Error('synthetic-private-data'));
    const client = await createPiProviderFactory().connect({
      ...sdkProfile(() => Promise.resolve(native)),
      providerOptions: { sdkVersion: '0.85.1', operationTimeoutMs: 20 },
    });
    const session = await client.createSession();
    const task = await session.start(
      { parts: [{ type: 'text', text: 'x' }] },
      { timeoutMs: 1000 },
    );
    expect(await task.cancel()).toEqual({ mode: 'connection_aborted' });
    expect((await task.result()).status).toBe('connection_aborted');
    await client.close();
  }
});

it('holds Session ownership until an in-flight abort confirms, even after a stop message', async () => {
  const native = sdkFixture('hang');
  const prompt = Promise.withResolvers<undefined>();
  const abort = Promise.withResolvers<undefined>();
  native.prompt = () => prompt.promise;
  native.abort = () => abort.promise;
  const { session } = await connect(native);
  const task = await session.start({ parts: [{ type: 'text', text: 'x' }] });
  const cancellation = task.cancel();
  native.emit({
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      content: [],
      usage: { input: 0, output: 0, totalTokens: 0 },
    },
  });
  prompt.resolve(undefined);
  await Promise.resolve();
  await Promise.resolve();
  await expect(
    session.start({ parts: [{ type: 'text', text: 'next' }] }),
  ).rejects.toMatchObject({ code: 'run_conflict' });
  abort.resolve(undefined);
  expect(await cancellation).toEqual({ mode: 'already_terminal' });
  expect((await task.result()).status).toBe('completed');
});

it('rejects an already-aborted SDK deadline without waiting for its host promise', async () => {
  const { sdkDeadline } = await import('../src/sdk-utils.js');
  await expect(
    sdkDeadline(new Promise(() => undefined), 1000, AbortSignal.abort()),
  ).rejects.toMatchObject({ code: 'connection_aborted' });
});

it('does not release a cancelling Session when prompt resolves without an assistant outcome', async () => {
  const native = sdkFixture('hang');
  const prompt = Promise.withResolvers<undefined>();
  const abort = Promise.withResolvers<undefined>();
  native.prompt = () => prompt.promise;
  native.abort = () => abort.promise;
  const { session } = await connect(native);
  const task = await session.start({
    parts: [{ type: 'text', text: 'synthetic' }],
  });
  const cancellation = task.cancel();
  prompt.resolve(undefined);
  await Promise.resolve();
  await Promise.resolve();
  await expect(
    session.start({ parts: [{ type: 'text', text: 'next' }] }),
  ).rejects.toMatchObject({ code: 'run_conflict' });
  abort.resolve(undefined);
  expect(await cancellation).toEqual({ mode: 'connection_aborted' });
  expect((await task.result()).status).toBe('connection_aborted');
  expect(native.disposed).toBe(1);
  await expect(
    session.start({ parts: [{ type: 'text', text: 'late' }] }),
  ).rejects.toMatchObject({ code: 'connection_aborted' });
});

it('records the exact tested public SDK provenance without private traffic', () => {
  const metadata: unknown = JSON.parse(
    readFileSync(
      new URL('../../../fixtures/pi/sdk-0.85.1/manifest.json', import.meta.url),
      'utf8',
    ),
  );
  expect(metadata).toMatchObject({
    fixtureFormatVersion: 1,
    providerId: 'pi.agent',
    upstreamEvidence: {
      runtimeVersion: '0.85.1',
      commit: 'd981de1229ef899957bbe968bc8dcda02a21f477',
      license: 'MIT',
    },
  });
});
