import { describe, expect, it } from 'vitest';
import type { HarnessRun, InteractionResponse } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
  defineInteractionConformanceSuite,
} from '../src/index.js';

const input = { parts: [{ type: 'text' as const, text: 'synthetic input' }] };
const approval = { kind: 'approval', decision: 'approve' } as const;

for (const kind of ['approval', 'user_input', 'provider'] as const) {
  for (const cancelMode of [
    'native',
    'emulated',
    'adapter_controlled',
    'unknown',
    'unsupported',
    'missing',
  ] as const) {
    defineInteractionConformanceSuite({
      name: `Fake ${kind} ${cancelMode}`,
      createFactory: () =>
        createFakeProviderFactory({ interaction: { kind }, cancelMode }),
      createProfile: createFakeProfile,
      input,
      kind,
      responses:
        kind === 'approval'
          ? [approval, { kind, decision: 'deny' }]
          : kind === 'user_input'
            ? [{ kind, parts: input.parts }]
            : [{ kind, value: { confirmed: false } }],
    });
  }
}

async function requested(run: HarnessRun) {
  const iterator = run.events()[Symbol.asyncIterator]();
  for (;;) {
    const event = await iterator.next();
    if (event.done) throw new Error('Expected a pending interaction.');
    if (event.value.type === 'interaction.requested') {
      const data = event.value.data as { requestId: string };
      return { id: data.requestId, iterator };
    }
  }
}

describe('Fake interaction lifecycle', () => {
  it('does not reuse request identities or let an old Client answer a resumed Run', async () => {
    const factory = createFakeProviderFactory({
      interaction: { kind: 'approval' },
    });
    const first = await factory.connect(createFakeProfile());
    const old = await first.createSession();
    const firstRun = await old.start(input);
    const previous = await requested(firstRun);
    await first.close();
    const next = await factory.connect(createFakeProfile());
    try {
      const resumed = await next.resumeSession(old.ref());
      const run = await resumed.start(input);
      const current = await requested(run);
      expect(current.id).not.toBe(previous.id);
      await expect(old.respond(current.id, approval)).rejects.toMatchObject({
        code: 'connection_aborted',
      });
      await expect(
        resumed.respond(previous.id, approval),
      ).rejects.toMatchObject({ code: 'invalid_request' });
      await resumed.respond(current.id, approval);
      await run.result();
      await resumed.close();
      await expect(resumed.respond(current.id, approval)).rejects.toMatchObject(
        { code: 'invalid_request' },
      );
    } finally {
      await next.close();
    }
  });

  it('rejects invalid deadlines and unsupported user input while preserving the request', async () => {
    const client = await createFakeProviderFactory({
      interaction: { kind: 'user_input' },
    }).connect(createFakeProfile());
    try {
      const session = await client.createSession();
      for (const timeoutMs of [0, -1, 0.5, Number.NaN, 2_147_483_648]) {
        await expect(session.start(input, { timeoutMs })).rejects.toMatchObject(
          { code: 'invalid_request' },
        );
      }
      expect(
        (await session.capabilities()).capabilities['run.timeout']?.mode,
      ).toBe('adapter_controlled');
      const run = await session.start(input, { timeoutMs: 2_000 });
      const { id } = await requested(run);
      for (const parts of [
        [],
        [{ type: 'image_ref' as const, uri: 'memory:synthetic' }],
      ]) {
        await expect(
          session.respond(id, { kind: 'user_input', parts }),
        ).rejects.toMatchObject({ code: 'invalid_request' });
      }
      await session.respond(id, { kind: 'user_input', parts: input.parts });
      expect((await run.result()).status).toBe('completed');
    } finally {
      await client.close();
    }
  });
  it.each<InteractionResponse>([
    approval,
    { kind: 'approval', decision: 'deny' },
    { kind: 'user_input', parts: input.parts },
    { kind: 'provider', value: { confirmed: false } },
  ])(
    'waits for an explicit $kind response before completing',
    async (response) => {
      const client = await createFakeProviderFactory({
        interaction: { kind: response.kind },
      }).connect(createFakeProfile());
      try {
        const session = await client.createSession();
        expect(
          (await session.capabilities()).capabilities[
            `interaction.${response.kind}`
          ]?.mode,
        ).toBe('native');
        const run = await session.start(input);
        const { id, iterator } = await requested(run);
        let settled = false;
        void run.result().then(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        await session.respond(id, response);
        expect((await iterator.next()).value).toMatchObject({
          type: 'interaction.resolved',
          data: { requestId: id },
        });
        expect((await run.result()).status).toBe('completed');
        await expect(session.respond(id, response)).rejects.toMatchObject({
          code: 'invalid_request',
        });
      } finally {
        await client.close();
      }
    },
  );

  it('rejects foreign, malformed, and duplicate responses without consuming the request', async () => {
    const client = await createFakeProviderFactory({
      interaction: { kind: 'approval' },
    }).connect(createFakeProfile());
    try {
      const session = await client.createSession();
      const foreign = await client.createSession();
      const run = await session.start(input);
      const { id } = await requested(run);
      await expect(foreign.respond(id, approval)).rejects.toMatchObject({
        code: 'invalid_request',
      });
      await expect(
        session.respond(id, { kind: 'user_input', parts: input.parts }),
      ).rejects.toMatchObject({ code: 'invalid_request' });
      const responses = await Promise.allSettled([
        session.respond(id, approval),
        session.respond(id, approval),
      ]);
      expect(responses.map(({ status }) => status)).toEqual([
        'fulfilled',
        'rejected',
      ]);
      await run.result();
    } finally {
      await client.close();
    }
  });

  it.each(['cancel', 'close', 'timeout'] as const)(
    'invalidates a pending request on %s',
    async (mode) => {
      const client = await createFakeProviderFactory({
        interaction: { kind: 'approval' },
      }).connect(createFakeProfile());
      try {
        const session = await client.createSession();
        const run = await session.start(
          input,
          mode === 'timeout' ? { timeoutMs: 10 } : {},
        );
        const { id, iterator } = await requested(run);
        if (mode === 'cancel') await run.cancel();
        if (mode === 'close') await client.close();
        expect((await run.result()).status).toBe(
          mode === 'cancel' ? 'cancelled' : 'connection_aborted',
        );
        await expect(session.respond(id, approval)).rejects.toBeInstanceOf(
          Error,
        );
        expect((await iterator.next()).value).toMatchObject({
          type: 'interaction.resolved',
        });
        expect((await iterator.next()).value).toMatchObject({
          type: mode === 'cancel' ? 'run.cancelled' : 'connection.aborted',
        });
        expect((await iterator.next()).done).toBe(true);
      } finally {
        await client.close();
      }
    },
  );
});
