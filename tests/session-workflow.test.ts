import {
  type HarnessClient,
  type HarnessSession,
  type HarnessEvent,
  type HarnessRun,
  type ProviderAdapterFactory,
  profileId,
  providerId,
  providerSessionId,
} from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';
import { describe, expect, it, vi } from 'vitest';
import {
  runSessionWorkflow,
  type SessionWorkflowRecord,
  type SessionWorkflowSetup,
} from '../examples/multi-provider-client/src/session-workflow.js';

const owner = providerId('harapter.example.history');
const profile = createFakeProfile({
  providerId: owner,
  profileId: profileId('history-example'),
});

describe('session workflow example', () => {
  it('reconnects before resume, rebinds history, and preserves opaque refs privately', async () => {
    const scenario = createScenario();
    const records: SessionWorkflowRecord[] = [];
    const outcome = await runSessionWorkflow({
      setup: scenario.setup,
      write: (record) => {
        records.push(record);
      },
    });
    expect(scenario.calls).toEqual([
      'connect',
      'bind',
      'create',
      'start',
      'session.close',
      'client.close',
      'connect',
      'bind',
      'resume',
      'derive',
      'create',
      'start',
      'start',
      'session.close',
      'session.close',
      'client.close',
    ]);
    expect(outcome.parent).toBe('preserved');
    expect(outcome.sourceRef?.providerSessionId).not.toBe(
      outcome.childRef.providerSessionId,
    );
    expect(
      records
        .filter((record) => record.type === 'result')
        .map((record) => record.status),
    ).toEqual(['completed', 'completed', 'completed']);
    expect(records).toContainEqual({
      type: 'cancellation',
      scope: 'run',
      receipt: 'already_terminal',
    });
    expect(JSON.stringify(records)).not.toMatch(
      /fake-session|providerState|finalMessage|Remember/,
    );
  });

  it('omits the retired parent from resumable outcomes', async () => {
    const scenario = createScenario('retired');
    const outcome = await runSessionWorkflow({
      setup: scenario.setup,
      write: () => undefined,
    });
    expect(outcome.parent).toBe('retired');
    expect(outcome.sourceRef).toBeUndefined();
    expect(scenario.calls.filter((call) => call === 'resume')).toHaveLength(1);
  });

  it('refuses a foreign host reference before connecting', async () => {
    const scenario = createScenario();
    await expect(
      runSessionWorkflow({
        setup: scenario.setup,
        sourceRef: {
          providerId: providerId('harapter.example.foreign'),
          profileId: profile.profileId,
          providerSessionId: providerSessionId('private-id'),
        },
        write: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
    expect(scenario.calls).toEqual([]);
  });

  it('fails before model execution if the typed history extension is absent', async () => {
    const scenario = createScenario();
    await expect(
      runSessionWorkflow({
        setup: { ...scenario.setup, bindHistory: () => undefined },
        write: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    expect(scenario.calls).toEqual(['connect', 'client.close']);
  });

  it('closes every acquired resource if rendering fails after fork', async () => {
    const scenario = createScenario();
    const write = vi.fn((record: SessionWorkflowRecord) => {
      if (record.type === 'history')
        throw new Error('private renderer content');
    });
    await expect(
      runSessionWorkflow({ setup: scenario.setup, write }),
    ).rejects.toThrow('Session workflow failed.');
    expect(
      scenario.calls.filter((call) => call === 'client.close'),
    ).toHaveLength(2);
    expect(
      scenario.calls.filter((call) => call === 'session.close'),
    ).toHaveLength(3);
    expect(scenario.calls.filter((call) => call === 'start')).toHaveLength(1);
  });
});

describe('session workflow cancellation', () => {
  it('keeps draining while native cancellation waits for a later event', async () => {
    const scenario = controlledScenario('cancelled');
    const records: SessionWorkflowRecord[] = [];
    const outcome = await runSessionWorkflow({
      setup: scenario.setup,
      write: (record) => {
        records.push(record);
      },
    });
    expect(outcome.cancellationStatus).toBe('cancelled');
    expect(records).toContainEqual({
      type: 'cancellation',
      scope: 'run',
      receipt: 'native',
    });
    expect(scenario.cancel).toHaveBeenCalledOnce();
  });

  it('keeps a Session cancellation acceptance separate from a completed terminal', async () => {
    const scenario = controlledScenario('completed', true);
    const records: SessionWorkflowRecord[] = [];
    const outcome = await runSessionWorkflow({
      setup: scenario.setup,
      write: (record) => {
        records.push(record);
      },
    });
    expect(outcome.cancellationStatus).toBe('completed');
    expect(records).toContainEqual({
      type: 'cancellation',
      scope: 'session',
      receipt: 'accepted',
    });
    expect(records.at(-1)).toEqual({
      type: 'result',
      phase: 'cancellation',
      status: 'completed',
    });
  });

  it('releases the connection and settles the observer after cancellation rejection', async () => {
    const scenario = controlledScenario('reject');
    await expect(
      runSessionWorkflow({ setup: scenario.setup, write: () => undefined }),
    ).rejects.toThrow('Session workflow failed.');
    expect(scenario.cancel).toHaveBeenCalledOnce();
    expect(
      scenario.calls.filter((call) => call === 'session.close'),
    ).toHaveLength(3);
  });

  it('does not invent a cancellation when the Session checkpoint never appears', async () => {
    const scenario = createScenario();
    const bind = (client: HarnessClient) => scenario.setup.bindHistory(client);
    const request = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const setup = {
      ...scenario.setup,
      bindHistory: (client: HarnessClient) => {
        const history = bind(client);
        if (history === undefined) throw new Error('Missing test history.');
        return {
          ...history,
          sessionCancellation: { ready: () => false, request },
        };
      },
    };
    const records: SessionWorkflowRecord[] = [];
    await runSessionWorkflow({
      setup,
      write: (record) => {
        records.push(record);
      },
    });
    expect(request).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      type: 'cancellation',
      scope: 'session',
      receipt: 'not_requested',
    });
  });
});

function controlledScenario(
  mode: 'cancelled' | 'completed' | 'reject',
  sessionScope = false,
) {
  const scenario = createScenario();
  const original = scenario.setup;
  const advanced = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let count = 0;
  let active: HarnessRun | undefined;
  const cancel = vi.fn(async () => {
    await advanced.promise;
    if (mode === 'reject') throw new Error('private provider response');
    if (active === undefined) throw new Error('Missing test Run.');
    if (mode === 'completed') await active.result();
    const receipt =
      mode === 'completed'
        ? { mode: 'already_terminal' as const }
        : await active.cancel();
    release.resolve(undefined);
    return receipt;
  });
  const wrap = (session: HarnessSession): HarnessSession => ({
    ...session,
    start: async (input, options) => {
      const run = await session.start(input, options);
      if (++count !== 3) return run;
      active = run;
      const event = (
        type: HarnessEvent['type'],
        sequence: number,
        providerEventType?: string,
      ): HarnessEvent => ({
        id: `event-${String(sequence)}`,
        type,
        ...run.ref(),
        sequence,
        timestamp: '2026-01-01T00:00:00Z',
        data: { private: 'do not render' },
        ...(providerEventType === undefined ? {} : { providerEventType }),
      });
      return {
        ref: () => run.ref(),
        result: () => run.result(),
        cancel,
        events: async function* () {
          yield event('run.started', 0);
          yield event('provider', 1, 'step/start');
          advanced.resolve(undefined);
          await release.promise;
          for await (const item of run.events()) yield item;
        },
      };
    },
  });
  const factory: ProviderAdapterFactory = {
    descriptor: () => original.factory.descriptor(),
    connect: async (selected) => {
      const client = await original.factory.connect(selected);
      return {
        ...client,
        createSession: async (input) => wrap(await client.createSession(input)),
        resumeSession: async (ref) => wrap(await client.resumeSession(ref)),
        close: async () => {
          release.resolve(undefined);
          await client.close();
        },
      };
    },
  };
  const setup: SessionWorkflowSetup = {
    ...original,
    factory,
    bindHistory: (client) => {
      const history = original.bindHistory(client);
      if (history === undefined) throw new Error('Missing test history.');
      return {
        ...history,
        ...(sessionScope
          ? {
              sessionCancellation: {
                ready: (event: HarnessEvent) =>
                  event.providerEventType === 'step/start',
                request: async () => {
                  await cancel();
                  return { accepted: true as const };
                },
              },
            }
          : {}),
      };
    },
  };
  return { ...scenario, setup, cancel };
}

function createScenario(parent: 'preserved' | 'retired' = 'preserved') {
  const base = createFakeProviderFactory({ providerId: owner });
  const calls: string[] = [];
  const wrapSession = (session: HarnessSession): HarnessSession => ({
    ref: () => session.ref(),
    capabilities: () => session.capabilities(),
    start: (input, options) => {
      calls.push('start');
      return session.start(input, options);
    },
    respond: (id, response) => session.respond(id, response),
    close: () => {
      calls.push('session.close');
      return session.close();
    },
  });
  const factory: ProviderAdapterFactory = {
    descriptor: () => base.descriptor(),
    connect: async (selected) => {
      calls.push('connect');
      const client = await base.connect(selected);
      return {
        descriptor: () => client.descriptor(),
        capabilities: () => client.capabilities(),
        extensions: () => client.extensions(),
        native: (guard) => client.native(guard),
        createSession: async (input) => {
          calls.push('create');
          return wrapSession(await client.createSession(input));
        },
        resumeSession: async (ref) => {
          calls.push('resume');
          return wrapSession(await client.resumeSession(ref));
        },
        close: () => {
          calls.push('client.close');
          return client.close();
        },
      } satisfies HarnessClient;
    },
  };
  const setup: SessionWorkflowSetup = {
    factory,
    profile,
    bindHistory: (client) => {
      calls.push('bind');
      return {
        operation: parent === 'retired' ? 'branch' : 'fork',
        parent,
        history: 'stored-history',
        createChild: () => {
          calls.push('derive');
          return client.createSession();
        },
      };
    },
  };
  return { calls, setup };
}
