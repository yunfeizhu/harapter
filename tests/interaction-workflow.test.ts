import { describe, expect, it, vi } from 'vitest';
import type {
  HarnessRun,
  InteractionRequest,
  InteractionResponse,
} from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';
import { observeInteractiveRun } from '../examples/multi-provider-client/src/interactions.js';

const input = { parts: [{ type: 'text' as const, text: 'synthetic input' }] };
const approval = { kind: 'approval', decision: 'approve' } as const;

async function setup(kind: InteractionRequest['kind'] = 'approval') {
  const client = await createFakeProviderFactory({
    interaction: { kind, prompt: 'fictional private request' },
  }).connect(createFakeProfile());
  const session = await client.createSession();
  const run = await session.start(input);
  return { client, session, run };
}

describe('host interaction composition', () => {
  it('keeps the original response association when a host changes its presentation object', async () => {
    const { client, session, run } = await setup();
    const respond = vi.spyOn(session, 'respond');
    let originalId: string | undefined;
    try {
      const result = await observeInteractiveRun({
        session,
        run,
        onEvent: () => undefined,
        onInteraction: ({ request }) => {
          originalId = request.requestId;
          request.requestId = 'changed-presentation-id';
          return approval;
        },
      });
      expect(result.status).toBe('completed');
      expect(respond).toHaveBeenCalledExactlyOnceWith(originalId, approval);
    } finally {
      await client.close();
    }
  });
  it('dismisses a remotely resolved request before the Run ends', async () => {
    const { client, session, run } = await setup();
    const response = Promise.withResolvers<InteractionResponse>();
    const asked = Promise.withResolvers<AbortSignal>();
    const resolved = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    const respond = vi.spyOn(session, 'respond');
    const wrapped: HarnessRun = {
      ref: () => run.ref(),
      cancel: () => run.cancel(),
      result: () => run.result(),
      events: async function* () {
        for await (const event of run.events()) {
          yield event;
          if (event.type === 'interaction.requested') {
            await asked.promise;
            yield {
              ...event,
              type: 'interaction.resolved',
              sequence: event.sequence + 1,
            };
            resolved.resolve(undefined);
            await finish.promise;
          }
        }
      },
    };
    try {
      const observed = observeInteractiveRun({
        session,
        run: wrapped,
        onEvent: () => undefined,
        onInteraction: ({ signal }) => {
          asked.resolve(signal);
          return response.promise;
        },
      });
      const signal = await asked.promise;
      await resolved.promise;
      expect(signal.aborted).toBe(true);
      response.reject(new Error('fictional late private failure'));
      finish.resolve(undefined);
      await run.cancel();
      expect((await observed).status).toBe('cancelled');
      expect(respond).not.toHaveBeenCalled();
    } finally {
      finish.resolve(undefined);
      await client.close();
    }
  });

  it.each(['duplicate', 'capacity', 'foreign'] as const)(
    'fails closed on %s requests and aborts outstanding UI',
    async (mode) => {
      const { client, session, run } = await setup();
      const signals: AbortSignal[] = [];
      const wrapped: HarnessRun = {
        ref: () => run.ref(),
        result: () => run.result(),
        cancel: () => run.cancel(),
        events: async function* () {
          for await (const event of run.events()) {
            if (event.type !== 'interaction.requested') {
              yield event;
              continue;
            }
            for (
              let index = 0;
              index < (mode === 'capacity' ? 65 : 2);
              index += 1
            ) {
              yield {
                ...event,
                ...(mode === 'foreign'
                  ? { runId: 'foreign-run' as typeof event.runId }
                  : {}),
                data: {
                  kind: 'approval',
                  requestId:
                    mode === 'capacity'
                      ? `synthetic-${String(index)}`
                      : 'synthetic',
                },
              };
            }
          }
        },
      };
      try {
        await expect(
          observeInteractiveRun({
            session,
            run: wrapped,
            onEvent: () => undefined,
            onInteraction: ({ signal }) => {
              signals.push(signal);
              return new Promise(() => undefined);
            },
          }),
        ).rejects.toThrow('Interaction workflow failed.');
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(signals.length).toBeLessThanOrEqual(64);
      } finally {
        await client.close();
      }
    },
  );

  it('redacts response failures and releases the observer without waiting for more events', async () => {
    const { client, session, run } = await setup();
    vi.spyOn(session, 'respond').mockRejectedValue(
      new Error('fictional private response failure'),
    );
    try {
      await expect(
        observeInteractiveRun({
          session,
          run,
          onEvent: () => undefined,
          onInteraction: () => approval,
        }),
      ).rejects.toThrow('Interaction workflow failed.');
    } finally {
      await client.close();
    }
  });

  it('does not ask for an already terminal replayed interaction', async () => {
    const { client, session, run } = await setup();
    await run.cancel();
    const onInteraction = vi.fn(() => approval);
    try {
      expect(
        (
          await observeInteractiveRun({
            session,
            run,
            onInteraction,
            onEvent: () => undefined,
          })
        ).status,
      ).toBe('cancelled');
      expect(onInteraction).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
  it.each<InteractionResponse>([
    approval,
    { kind: 'approval', decision: 'deny' },
    { kind: 'user_input', parts: input.parts },
    { kind: 'provider', value: { confirmed: true } },
  ])(
    'relays explicit $kind decisions through the bound Session',
    async (response) => {
      const { client, session, run } = await setup(response.kind);
      try {
        const events: string[] = [];
        const onInteraction = vi.fn(() => response);
        const result = await observeInteractiveRun({
          session,
          run,
          onInteraction,
          onEvent: (event) => {
            events.push(event.type);
          },
        });
        expect(result.status).toBe('completed');
        expect(onInteraction).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            request: expect.objectContaining({
              kind: response.kind,
            }) as InteractionRequest,
            sessionRef: session.ref(),
            runRef: run.ref(),
          }),
        );
        expect(events).toContain('interaction.resolved');
      } finally {
        await client.close();
      }
    },
  );

  it.each(['cancel', 'close'] as const)(
    'keeps draining on %s and drops a late answer even when the handler ignores abort',
    async (mode) => {
      const { client, session, run } = await setup();
      const answer = Promise.withResolvers<InteractionResponse>();
      const asked = Promise.withResolvers<AbortSignal>();
      const respond = vi.spyOn(session, 'respond');
      try {
        const observed = observeInteractiveRun({
          session,
          run,
          onEvent: () => undefined,
          onInteraction: ({ signal }) => {
            asked.resolve(signal);
            return answer.promise;
          },
        });
        const signal = await asked.promise;
        if (mode === 'cancel') await run.cancel();
        else await client.close();
        expect((await observed).status).toBe(
          mode === 'cancel' ? 'cancelled' : 'connection_aborted',
        );
        expect(signal.aborted).toBe(true);
        answer.resolve(approval);
        await Promise.resolve();
        expect(respond).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    },
  );

  it('fails promptly and redacts a rejected host callback', async () => {
    const { client, session, run } = await setup();
    try {
      await expect(
        observeInteractiveRun({
          session,
          run,
          onEvent: () => undefined,
          onInteraction: () => {
            throw new Error('fictional private callback error');
          },
        }),
      ).rejects.toThrow('Interaction workflow failed.');
    } finally {
      await client.close();
    }
  });

  it('requires a host handler rather than silently answering', async () => {
    const { client, session, run } = await setup();
    const respond = vi.spyOn(session, 'respond');
    try {
      await expect(
        observeInteractiveRun({ session, run, onEvent: () => undefined }),
      ).rejects.toMatchObject({ code: 'unsupported_capability' });
      expect(respond).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it('does not wait for response acknowledgement to consume resolving events', async () => {
    const { client, session, run } = await setup();
    const advanced = Promise.withResolvers<undefined>();
    const originalRespond = session.respond.bind(session);
    vi.spyOn(session, 'respond').mockImplementation(async (id, response) => {
      await advanced.promise;
      await originalRespond(id, response);
    });
    const wrapped: HarnessRun = {
      ref: () => run.ref(),
      result: () => run.result(),
      cancel: () => run.cancel(),
      events: async function* () {
        for await (const event of run.events()) {
          yield event;
          if (event.type === 'interaction.requested')
            advanced.resolve(undefined);
        }
      },
    };
    try {
      expect(
        (
          await observeInteractiveRun({
            session,
            run: wrapped,
            onEvent: () => undefined,
            onInteraction: () => approval,
          })
        ).status,
      ).toBe('completed');
    } finally {
      await client.close();
    }
  });

  it.each([null, { requestId: 'synthetic', kind: 'future' }])(
    'rejects malformed request data',
    async (data) => {
      const { client, session, run } = await setup();
      const wrapped: HarnessRun = {
        ref: () => run.ref(),
        result: () => run.result(),
        cancel: () => run.cancel(),
        events: async function* () {
          for await (const event of run.events())
            yield event.type === 'interaction.requested'
              ? { ...event, data }
              : event;
        },
      };
      const handler = vi.fn(() => approval);
      try {
        await expect(
          observeInteractiveRun({
            session,
            run: wrapped,
            onEvent: () => undefined,
            onInteraction: handler,
          }),
        ).rejects.toThrow('Interaction workflow failed.');
        expect(handler).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    },
  );
});
