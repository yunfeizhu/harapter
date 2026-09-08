import type {
  HarnessClient,
  HarnessEvent,
  HarnessInput,
  HarnessRun,
  HarnessSession,
  InteractionRequest,
  InteractionResponse,
} from '@harapter/core';
import { describe, expect, it } from 'vitest';
import {
  validatePortableRunTrace,
  type PortableProviderConformanceOptions,
} from './suite.js';

/** Opt-in fixture must request one interaction and settle after its response. */
export interface InteractionConformanceOptions extends PortableProviderConformanceOptions {
  readonly input: HarnessInput;
  readonly kind: InteractionRequest['kind'];
  /** Explicit valid responses, including denial when the fixture offers it. */
  readonly responses: readonly [InteractionResponse, ...InteractionResponse[]];
}

/** Register shared interaction lifecycle checks using only public contracts. */
export function defineInteractionConformanceSuite(
  options: InteractionConformanceOptions,
): void {
  describe(`${options.name} interaction conformance`, () => {
    for (const [index, response] of options.responses.entries()) {
      it(`round-trips response ${String(index + 1)} exactly once`, async () => {
        await withPending(
          options,
          async ({ session, run, iterator, events, request }) => {
            const mode = (await session.capabilities()).capabilities[
              `interaction.${options.kind}`
            ]?.mode;
            expect(mode).toBeDefined();
            expect(['unsupported', 'unknown']).not.toContain(mode);
            await session.respond(request.requestId, response);
            await drain(iterator, events);
            validatePortableRunTrace(events, await run.result());
            expect(
              events.filter(({ type }) => type === 'interaction.resolved'),
            ).toHaveLength(1);
            await expect(
              session.respond(request.requestId, response),
            ).rejects.toBeInstanceOf(Error);
          },
        );
      });
    }

    it('rejects another Session and concurrent duplicate responses', async () => {
      await withPending(
        options,
        async ({ client, session, run, iterator, events, request }) => {
          const other = await client.createSession();
          const response = options.responses[0];
          await expect(
            other.respond(request.requestId, response),
          ).rejects.toBeInstanceOf(Error);
          const outcomes = await Promise.allSettled([
            session.respond(request.requestId, response),
            session.respond(request.requestId, response),
          ]);
          expect(
            outcomes.filter(({ status }) => status === 'fulfilled'),
          ).toHaveLength(1);
          await drain(iterator, events);
          validatePortableRunTrace(events, await run.result());
          expect(
            events.filter(({ type }) => type === 'interaction.resolved'),
          ).toHaveLength(1);
        },
      );
    });

    it('invalidates pending responses when its Client disconnects', async () => {
      await withPending(
        options,
        async ({ client, session, run, iterator, events, request }) => {
          await client.close();
          await drain(iterator, events);
          expect((await run.result()).status).toBe('connection_aborted');
          validatePortableRunTrace(events, await run.result());
          await expect(
            Promise.resolve().then(() =>
              session.respond(request.requestId, options.responses[0]),
            ),
          ).rejects.toBeInstanceOf(Error);
        },
      );
    });

    it('preserves cancellation strength and invalidates the pending request', async () => {
      await withPending(
        options,
        async ({ client, session, run, iterator, events, request }) => {
          const mode = (await session.capabilities()).capabilities['run.cancel']
            ?.mode;
          if (
            mode === undefined ||
            mode === 'unsupported' ||
            mode === 'unknown'
          ) {
            await expect(run.cancel()).rejects.toMatchObject({
              code: 'unsupported_capability',
            });
            await client.close();
          } else {
            const expected =
              mode === 'adapter_controlled' ? 'connection_aborted' : mode;
            const receipt = await run.cancel();
            if (receipt.mode !== 'already_terminal') {
              expect(receipt.mode).toBe(expected);
              expect((await run.result()).status).toBe(
                expected === 'connection_aborted'
                  ? 'connection_aborted'
                  : 'cancelled',
              );
            }
          }
          await drain(iterator, events);
          validatePortableRunTrace(events, await run.result());
          await expect(
            Promise.resolve().then(() =>
              session.respond(request.requestId, options.responses[0]),
            ),
          ).rejects.toBeInstanceOf(Error);
        },
      );
    });
  });
}

interface PendingFixture {
  client: HarnessClient;
  session: HarnessSession;
  run: HarnessRun;
  request: InteractionRequest;
  iterator: AsyncIterator<HarnessEvent>;
  events: HarnessEvent[];
}

async function withPending(
  options: InteractionConformanceOptions,
  test: (fixture: PendingFixture) => Promise<void>,
): Promise<void> {
  const client = await options.createFactory().connect(options.createProfile());
  try {
    const session = await client.createSession();
    const run = await session.start(options.input, { timeoutMs: 2_000 });
    const iterator = run.events()[Symbol.asyncIterator]();
    const events: HarnessEvent[] = [];
    for (;;) {
      const item = await iterator.next();
      if (item.done)
        throw new Error('Interaction fixture ended before requesting input.');
      events.push(item.value);
      if (item.value.type !== 'interaction.requested') continue;
      const request = item.value.data as InteractionRequest;
      expect(request.kind).toBe(options.kind);
      expect(request.requestId).toBeTypeOf('string');
      expect(request.requestId.length).toBeGreaterThan(0);
      const { providerId, profileId, sessionId, runId } = run.ref();
      expect(item.value).toMatchObject({
        providerId,
        profileId,
        sessionId,
        runId,
      });
      await test({ client, session, run, iterator, events, request });
      return;
    }
  } finally {
    await client.close();
  }
}

async function drain(
  iterator: AsyncIterator<HarnessEvent>,
  events: HarnessEvent[],
): Promise<void> {
  for (;;) {
    const item = await iterator.next();
    if (item.done) return;
    events.push(item.value);
  }
}
