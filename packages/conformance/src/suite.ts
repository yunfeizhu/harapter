import {
  HarnessRegistry,
  profileId,
  providerId,
  type HarnessClient,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRun,
  type ProviderAdapterFactory,
  type RunResult,
} from '@harapter/core';
import { describe, expect, it } from 'vitest';

/** Factory inputs for one reusable portable Provider conformance suite. */
export interface PortableProviderConformanceOptions {
  name: string;
  createFactory: () => ProviderAdapterFactory;
  createProfile: () => HarnessProfile;
}

const terminalTypes = new Set<HarnessEvent['type']>([
  'run.completed',
  'run.cancelled',
  'run.failed',
  'connection.aborted',
]);

/**
 * Validate portable sequence and terminal invariants for one collected Run.
 * @param events - Complete event trace emitted by the Run.
 * @param result - Settled terminal result for the same Run.
 */
export function validatePortableRunTrace(
  events: readonly HarnessEvent[],
  result: RunResult,
): void {
  if (events.length === 0) {
    throw new Error('A portable Run trace must not be empty.');
  }
  if (new Set(events.map(({ id }) => id)).size !== events.length) {
    throw new Error('Portable event identifiers must be unique within a Run.');
  }
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    const previous = events[index - 1];
    if (
      event !== undefined &&
      previous !== undefined &&
      event.sequence <= previous.sequence
    ) {
      throw new Error('Portable event sequence values must increase.');
    }
  }

  const terminals = events.filter(({ type }) => terminalTypes.has(type));
  const terminal = terminals[0];
  if (terminal === undefined || terminals.length !== 1) {
    throw new Error('A portable Run must emit exactly one terminal event.');
  }
  if (events.at(-1) !== terminal) {
    throw new Error('The terminal event must be last in a portable Run trace.');
  }

  const terminalByStatus: Record<RunResult['status'], HarnessEvent['type']> = {
    completed: 'run.completed',
    cancelled: 'run.cancelled',
    failed: 'run.failed',
    connection_aborted: 'connection.aborted',
  };
  if (terminal.type !== terminalByStatus[result.status]) {
    throw new Error('The terminal event must agree with the Run result.');
  }
}

/**
 * Register the shared portable Provider behavior suite with Vitest.
 * @param options - Fresh factory and Profile producers for isolated tests.
 */
export function definePortableProviderConformanceSuite(
  options: PortableProviderConformanceOptions,
): void {
  describe(`${options.name} portable conformance`, () => {
    it('binds descriptor and capabilities to the requested Profile', async () => {
      await withConnection(options, async ({ client, profile }) => {
        const descriptor = await client.descriptor();
        const capabilities = await client.capabilities();

        expect(descriptor).toMatchObject({
          providerId: profile.providerId,
          profileId: profile.profileId,
          connectionKind: profile.connection.kind,
        });
        expect(capabilities).toMatchObject({
          providerId: profile.providerId,
          profileId: profile.profileId,
        });
        expect(capabilities.capabilities['session.create']?.mode).toBe(
          'native',
        );
        expect(capabilities.capabilities['run.stream']?.mode).toBe('native');
      });
    });

    it('emits ordered identity-bound events and exactly one matching terminal result', async () => {
      await withConnection(options, async ({ client, profile }) => {
        const session = await client.createSession();
        const run = await session.start({
          parts: [{ type: 'text', text: 'conformance input' }],
        });
        const [events, result] = await Promise.all([
          collectEvents(run),
          run.result(),
        ]);

        expect(session.ref()).toMatchObject({
          providerId: profile.providerId,
          profileId: profile.profileId,
        });
        expect(run.ref()).toMatchObject({
          providerId: profile.providerId,
          profileId: profile.profileId,
          sessionId: session.ref().providerSessionId,
        });
        expect(
          events.every(
            (event) =>
              event.providerId === profile.providerId &&
              event.profileId === profile.profileId &&
              event.sessionId === session.ref().providerSessionId &&
              event.runId === run.ref().runId,
          ),
        ).toBe(true);
        expect(() => {
          validatePortableRunTrace(events, result);
        }).not.toThrow();
        expect(await run.cancel()).toEqual({ mode: 'already_terminal' });
        await session.close();
        await client.close();
        await client.close();
      });
    });

    it('reports cancellation no stronger than the observed capability', async () => {
      await withConnection(options, async ({ client }) => {
        const capabilities = await client.capabilities();
        const session = await client.createSession();
        const run = await session.start({
          parts: [{ type: 'text', text: 'cancel conformance input' }],
        });
        const cancelMode = capabilities.capabilities['run.cancel']?.mode;

        if (
          cancelMode === undefined ||
          cancelMode === 'unsupported' ||
          cancelMode === 'unknown'
        ) {
          let cancellation;
          try {
            cancellation = await run.cancel();
          } catch (error) {
            expect(error).toMatchObject({ code: 'unsupported_capability' });
            await run.result();
            return;
          }
          expect(cancellation).toEqual({ mode: 'already_terminal' });
          await run.result();
          return;
        }

        const cancellation = await run.cancel();
        if (cancellation.mode === 'already_terminal') {
          await run.result();
          return;
        }
        if (cancelMode === 'native') {
          expect(cancellation).toEqual({ mode: 'native' });
          expect((await run.result()).status).toBe('cancelled');
          return;
        }
        if (cancelMode === 'emulated') {
          expect(cancellation).toEqual({ mode: 'emulated' });
          expect((await run.result()).status).toBe('cancelled');
          return;
        }
        expect(cancelMode).toBe('adapter_controlled');
        expect(cancellation).toEqual({ mode: 'connection_aborted' });
        expect((await run.result()).status).toBe('connection_aborted');
      });
    });

    it('rejects Session references owned by another Provider or Profile', async () => {
      const profile = options.createProfile();
      const registry = new HarnessRegistry();
      registry.register(options.createFactory());
      const firstClient = await registry.connect(profile);
      let resumeClient: HarnessClient = firstClient;
      let secondClient: HarnessClient | undefined;

      try {
        const capabilities = await firstClient.capabilities();
        const session = await firstClient.createSession();
        const ref = session.ref();

        if (capabilities.capabilities['session.resume']?.mode === 'native') {
          await firstClient.close();
          secondClient = await registry.connect(profile);
          resumeClient = secondClient;
          const secondSession = await secondClient.createSession();
          expect(secondSession.ref().providerSessionId).not.toBe(
            ref.providerSessionId,
          );
          const resumed = await secondClient.resumeSession(ref);
          expect(resumed.ref()).toMatchObject({
            providerId: ref.providerId,
            profileId: ref.profileId,
            providerSessionId: ref.providerSessionId,
          });
          const resumedRun = await resumed.start({
            parts: [{ type: 'text', text: 'resumed conformance input' }],
          });
          expect((await resumedRun.result()).status).toBe('completed');
          if (ref.compatibilityRef !== undefined) {
            await expect(
              secondClient.resumeSession({
                ...ref,
                compatibilityRef: `${ref.compatibilityRef};mismatch`,
              }),
            ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
            const {
              compatibilityRef: _compatibilityRef,
              ...withoutCompatibility
            } = ref;
            await expect(
              secondClient.resumeSession(withoutCompatibility),
            ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
          }
          await resumed.close();
          await secondSession.close();
        } else {
          await expect(firstClient.resumeSession(ref)).rejects.toMatchObject({
            code: 'unsupported_capability',
          });
        }

        await expect(
          resumeClient.resumeSession({
            ...ref,
            providerId: providerId('conformance.other-provider'),
          }),
        ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
        await expect(
          resumeClient.resumeSession({
            ...ref,
            profileId: profileId('conformance-other-profile'),
          }),
        ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
      } finally {
        await secondClient?.close();
        await firstClient.close();
      }
    });

    it('settles an active Run as connection aborted when the Client closes', async () => {
      await withConnection(options, async ({ client }) => {
        const session = await client.createSession();
        const run = await session.start({
          parts: [{ type: 'text', text: 'connection abort input' }],
        });
        await client.close();
        const [events, result] = await Promise.all([
          collectEvents(run),
          run.result(),
        ]);
        expect(result.status).toBe('connection_aborted');
        expect(() => {
          validatePortableRunTrace(events, result);
        }).not.toThrow();
      });
    });

    it('keeps extensions and native access explicitly Provider-bound', async () => {
      await withConnection(options, async ({ client, profile }) => {
        const capabilities = await client.capabilities();
        const extensions = client.extensions();

        expect(
          extensions
            .list()
            .every(({ providerId }) => providerId === profile.providerId),
        ).toBe(true);
        for (const extension of extensions.list()) {
          expect(extensions.has(extension.name)).toBe(true);
          expect(extensions.get(extension.name)).toBeDefined();
        }
        if (capabilities.capabilities['native.client']?.mode === 'native') {
          expect(client.native()).toBeDefined();
        } else {
          expect(client.native()).toBeUndefined();
        }
      });
    });
  });
}

async function withConnection(
  options: PortableProviderConformanceOptions,
  test: (connected: {
    client: HarnessClient;
    profile: HarnessProfile;
  }) => Promise<void>,
): Promise<void> {
  const connected = await connect(options);
  try {
    await test(connected);
  } finally {
    await connected.client.close();
  }
}

async function connect(
  options: PortableProviderConformanceOptions,
): Promise<{ client: HarnessClient; profile: HarnessProfile }> {
  const profile = options.createProfile();
  const registry = new HarnessRegistry();
  registry.register(options.createFactory());
  return { client: await registry.connect(profile), profile };
}

async function collectEvents(run: HarnessRun): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of run.events()) events.push(event);
  return events;
}
