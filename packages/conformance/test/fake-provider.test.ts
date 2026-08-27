import { describe, expect, it } from 'vitest';
import {
  HarnessError,
  profileId,
  providerId,
  type HarnessEvent,
  type HarnessInput,
  type HarnessProfile,
  type HarnessRun,
} from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
  definePortableProviderConformanceSuite,
  validatePortableRunTrace,
} from '../src/index.js';

definePortableProviderConformanceSuite({
  name: 'deterministic Fake Provider',
  createFactory: () =>
    createFakeProviderFactory({
      includeUnknownEvent: true,
      rawEvents: true,
    }),
  createProfile: () => createFakeProfile(),
});

definePortableProviderConformanceSuite({
  name: 'restricted deterministic Fake Provider',
  createFactory: () =>
    createFakeProviderFactory({
      cancelMode: 'unsupported',
      resumeMode: 'unsupported',
      nativeClient: false,
    }),
  createProfile: () => createFakeProfile(),
});

for (const cancelMode of [
  'emulated',
  'adapter_controlled',
  'unknown',
  'missing',
] as const) {
  definePortableProviderConformanceSuite({
    name: `${cancelMode} cancellation Fake Provider`,
    createFactory: () => createFakeProviderFactory({ cancelMode }),
    createProfile: () => createFakeProfile(),
  });
}

async function collectEvents(run: HarnessRun): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of run.events()) events.push(event);
  return events;
}

const textInput: HarnessInput = {
  parts: [{ type: 'text', text: 'portable input' }],
};

describe('Fake Provider controls', () => {
  it('distinguishes unsupported cancellation from native cancellation', async () => {
    const factory = createFakeProviderFactory({ cancelMode: 'unsupported' });
    const client = await factory.connect(createFakeProfile());
    const session = await client.createSession();
    const run = await session.start(textInput);

    await expect(run.cancel()).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    expect((await run.result()).status).toBe('completed');
    await client.close();
  });

  it('reports client teardown as connection abort, never native cancel', async () => {
    const factory = createFakeProviderFactory();
    const client = await factory.connect(createFakeProfile());
    const session = await client.createSession();
    const run = await session.start(textInput);

    await client.close();
    expect(await run.result()).toMatchObject({ status: 'connection_aborted' });
    expect((await collectEvents(run)).at(-1)?.type).toBe('connection.aborted');
    expect(await run.cancel()).toEqual({ mode: 'already_terminal' });
  });

  it.each([
    ['emulated', 'emulated', 'cancelled'],
    ['adapter_controlled', 'connection_aborted', 'connection_aborted'],
  ] as const)(
    'reports %s cancellation without strengthening its lifecycle semantics',
    async (capabilityMode, cancelMode, terminalStatus) => {
      const factory = createFakeProviderFactory({
        cancelMode: capabilityMode,
      });
      const client = await factory.connect(createFakeProfile());
      const session = await client.createSession();
      const run = await session.start(textInput);

      expect(await run.cancel()).toEqual({ mode: cancelMode });
      expect(await run.result()).toMatchObject({ status: terminalStatus });
      await client.close();
    },
  );

  it('treats unknown cancellation evidence as unsupported at runtime', async () => {
    const factory = createFakeProviderFactory({ cancelMode: 'unknown' });
    const client = await factory.connect(createFakeProfile());
    const session = await client.createSession();
    const run = await session.start(textInput);

    expect((await client.capabilities()).capabilities['run.cancel']?.mode).toBe(
      'unknown',
    );
    await expect(run.cancel()).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    await run.result();
    await client.close();
  });

  it('keeps a missing cancellation capability distinct from unknown', async () => {
    const factory = createFakeProviderFactory({ cancelMode: 'missing' });
    const client = await factory.connect(createFakeProfile());
    const session = await client.createSession();
    const run = await session.start(textInput);

    expect(
      (await client.capabilities()).capabilities['run.cancel'],
    ).toBeUndefined();
    await expect(run.cancel()).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    await run.result();
    await client.close();
  });

  it('rejects overlapping runs and unsupported input before execution', async () => {
    const factory = createFakeProviderFactory();
    const client = await factory.connect(createFakeProfile());
    const session = await client.createSession();
    const first = await session.start(textInput);

    await expect(session.start(textInput)).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await first.result();
    await expect(
      session.start({
        parts: [{ type: 'image_ref', uri: 'memory:synthetic-image' }],
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    await client.close();
  });

  it('rejects unknown sessions and mismatched profile ownership', async () => {
    const factory = createFakeProviderFactory();
    const activeProfile = createFakeProfile();
    const client = await factory.connect(activeProfile);
    const session = await client.createSession();
    const ref = session.ref();

    await expect(
      client.resumeSession({
        ...ref,
        profileId: profileId('different-profile'),
      }),
    ).rejects.toBeInstanceOf(HarnessError);
    await expect(
      client.resumeSession({
        ...ref,
        providerId: providerId('different.provider'),
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    await expect(
      client.resumeSession({
        ...ref,
        providerSessionId: 'missing-session' as typeof ref.providerSessionId,
      }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    await client.close();
  });

  it('rejects native resume with missing or mismatched compatibility identity', async () => {
    const factory = createFakeProviderFactory();
    const client = await factory.connect(createFakeProfile());
    const session = await client.createSession();
    const ref = session.ref();
    const { compatibilityRef: _compatibilityRef, ...withoutCompatibility } =
      ref;

    await expect(
      client.resumeSession({
        ...ref,
        compatibilityRef: 'harapter-fake@2;protocol=2',
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    await expect(
      client.resumeSession(withoutCompatibility),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    expect((await client.resumeSession(ref)).ref()).toMatchObject(ref);
    await client.close();
  });

  it('supports distinct profiles without changing provider identity', async () => {
    const factory = createFakeProviderFactory();
    const secondProfile: HarnessProfile = createFakeProfile({
      profileId: profileId('fake-secondary'),
    });
    const firstClient = await factory.connect(createFakeProfile());
    const secondClient = await factory.connect(secondProfile);

    const firstSession = await firstClient.createSession();
    const secondSession = await secondClient.createSession();
    expect(firstSession.ref().providerId).toBe(secondSession.ref().providerId);
    expect(firstSession.ref().profileId).not.toBe(
      secondSession.ref().profileId,
    );
    await firstClient.close();
    await secondClient.close();
  });

  it('keeps the Fake Provider id configurable rather than known by Core', () => {
    const customProviderId = providerId('example.synthetic');
    const factory = createFakeProviderFactory({ providerId: customProviderId });
    expect(factory.descriptor().providerId).toBe(customProviderId);
  });

  it('rejects a Profile for another Provider or connection kind', async () => {
    const factory = createFakeProviderFactory();
    await expect(
      factory.connect(
        createFakeProfile({ providerId: providerId('other.provider') }),
      ),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
    await expect(
      factory.connect(
        createFakeProfile({
          connection: {
            kind: 'endpoint',
            url: 'https://example.invalid',
            ownership: 'external',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'profile_invalid' });
  });

  it('exercises local Session controls without inventing Provider support', async () => {
    const factory = createFakeProviderFactory();
    const client = await factory.connect(createFakeProfile());
    const session = await client.createSession();
    expect((await session.capabilities()).profileId).toBe(
      session.ref().profileId,
    );
    await expect(
      session.respond('synthetic-request', {
        kind: 'approval',
        decision: 'deny',
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });

    const active = await session.start(textInput);
    await expect(session.close()).rejects.toMatchObject({
      code: 'run_conflict',
    });
    await active.result();
    await session.close();
    await expect(session.start(textInput)).rejects.toMatchObject({
      code: 'session_not_found',
    });
    await client.close();
    await expect(client.createSession()).rejects.toMatchObject({
      code: 'connection_aborted',
    });
  });

  it('exposes a callable typed extension only while using the Fake Provider', async () => {
    const factory = createFakeProviderFactory();
    const client = await factory.connect(createFakeProfile());
    const extension = client
      .extensions()
      .get<{ echo(value: string): string }>('harapter.fake.echo');
    expect(extension?.echo('synthetic')).toBe('synthetic');
    await client.close();
  });

  it('preserves unknown events through an optional bounded synthetic raw payload', async () => {
    const rawClient = await createFakeProviderFactory({
      includeUnknownEvent: true,
      rawEvents: true,
    }).connect(createFakeProfile());
    const rawSession = await rawClient.createSession();
    const rawRun = await rawSession.start(textInput);
    const rawEvents = await collectEvents(rawRun);
    const providerEvent = rawEvents.find(({ type }) => type === 'provider');

    expect(providerEvent).toMatchObject({
      providerEventType: 'fake.unknown',
      raw: { kind: 'fake.unknown', value: 'synthetic' },
    });
    await rawClient.close();

    const redactedClient = await createFakeProviderFactory({
      includeUnknownEvent: true,
      rawEvents: false,
    }).connect(createFakeProfile());
    const redactedSession = await redactedClient.createSession();
    const redactedRun = await redactedSession.start(textInput);
    const redactedProviderEvent = (await collectEvents(redactedRun)).find(
      ({ type }) => type === 'provider',
    );

    expect(redactedProviderEvent).toBeDefined();
    expect(redactedProviderEvent).not.toHaveProperty('raw');
    await redactedClient.close();
  });

  it('validates sparse ordering and rejects malformed portable traces', async () => {
    const client =
      await createFakeProviderFactory().connect(createFakeProfile());
    const session = await client.createSession();
    const run = await session.start(textInput);
    const events = await collectEvents(run);
    const result = await run.result();
    const terminal = events.at(-1);

    if (terminal === undefined) {
      throw new Error('Fake Provider did not emit a terminal event.');
    }
    const firstEvent = events[0];
    if (firstEvent === undefined) {
      throw new Error('Fake Provider emitted an empty event trace.');
    }
    expect(() => {
      validatePortableRunTrace(
        events.map((event, index) => ({
          ...event,
          sequence: 10 + index * 2,
        })),
        result,
      );
    }).not.toThrow();
    expect(() => {
      validatePortableRunTrace([], result);
    }).toThrow(/must not be empty/i);
    expect(() => {
      validatePortableRunTrace(
        events.map((event, index) =>
          index === 1 ? { ...event, id: firstEvent.id } : event,
        ),
        result,
      );
    }).toThrow(/identifiers must be unique/i);
    expect(() => {
      validatePortableRunTrace(
        events.map((event, index) =>
          index === 1 ? { ...event, sequence: firstEvent.sequence } : event,
        ),
        result,
      );
    }).toThrow(/sequence values must increase/i);
    expect(() => {
      validatePortableRunTrace(events.slice(0, -1), result);
    }).toThrow(/exactly one terminal event/i);
    expect(() => {
      validatePortableRunTrace(
        [
          ...events,
          {
            ...terminal,
            id: `${terminal.id}:second-terminal`,
            sequence: terminal.sequence + 1,
          },
        ],
        result,
      );
    }).toThrow(/exactly one terminal event/i);
    expect(() => {
      validatePortableRunTrace(events, { ...result, status: 'failed' });
    }).toThrow(/must agree with the Run result/i);
    expect(() => {
      validatePortableRunTrace(
        [
          ...events,
          {
            ...terminal,
            id: `${terminal.id}:late`,
            type: 'message.delta',
            sequence: terminal.sequence + 1,
          },
        ],
        result,
      );
    }).toThrow(/terminal event must be last/i);
    await client.close();
  });
});
