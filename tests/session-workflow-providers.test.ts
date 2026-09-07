import {
  ExtensionRegistry,
  profileId,
  providerId,
  type HarnessClient,
  type HarnessEvent,
} from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';
import { describe, expect, it, vi } from 'vitest';
import {
  bindCodexSessionHistory,
  bindDshSessionHistory,
  bindHermesSessionHistory,
  bindOpenClawSessionHistory,
  bindOpenCodeSessionHistory,
  bindPiSessionHistory,
  createSessionWorkflowSetups,
  type SessionProviderConfiguration,
} from '../examples/multi-provider-client/src/session-providers.js';
import { runSessionWorkflow } from '../examples/multi-provider-client/src/session-workflow.js';

const cases = [
  {
    key: 'codex',
    id: 'openai.codex',
    extension: 'openai.codex.sessions',
    bind: bindCodexSessionHistory,
    method: 'fork',
    parent: 'preserved',
    history: 'stored-history',
  },
  {
    key: 'dsh',
    id: 'deepseek.harness',
    extension: 'deepseek.harness.gateway.sessions',
    bind: bindDshSessionHistory,
    method: 'fork',
    parent: 'preserved',
    history: 'completed-turn-prefix',
  },
  {
    key: 'hermes',
    id: 'nous.hermes-agent',
    extension: 'nous.hermes-agent.sessions',
    bind: bindHermesSessionHistory,
    method: 'branch',
    parent: 'retired',
    history: 'stored-history',
  },
  {
    key: 'openclaw',
    id: 'openclaw',
    extension: 'openclaw.gateway.sessions',
    bind: bindOpenClawSessionHistory,
    method: 'fork',
    parent: 'preserved',
    history: 'last-completed-assistant',
  },
  {
    key: 'opencode',
    id: 'opencode',
    extension: 'opencode.sessions',
    bind: bindOpenCodeSessionHistory,
    method: 'fork',
    parent: 'preserved',
    history: 'stored-history',
  },
  {
    key: 'pi',
    id: 'pi.agent',
    extension: 'pi.agent.sessions',
    bind: bindPiSessionHistory,
    method: 'fork',
    parent: 'preserved',
    history: 'active-branch',
  },
] as const;

describe('six explicit session history bindings', () => {
  it.each(cases)(
    '$key runs the workflow through its guarded public extension',
    async (item) => {
      const owner = providerId(item.id);
      const profile = createFakeProfile({ providerId: owner });
      const base = createFakeProviderFactory({ providerId: owner });
      const derive = vi.fn();
      const connect = vi.fn(async () => {
        const client = await base.connect(profile);
        const extensions = new ExtensionRegistry(owner);
        extensions.register(
          {
            name: item.extension,
            providerId: owner,
            displayName: 'Synthetic history extension',
          },
          {
            [item.method]: () => {
              derive();
              return client.createSession();
            },
            cancelSession: () => Promise.resolve({ accepted: true }),
          },
        );
        return withExtensions(client, extensions);
      });
      const outcome = await runSessionWorkflow({
        setup: {
          factory: { descriptor: () => base.descriptor(), connect },
          profile,
          bindHistory: item.bind,
        },
        write: () => undefined,
      });
      expect(outcome.parent).toBe(item.parent);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(derive).toHaveBeenCalledOnce();
    },
  );

  it.each(cases)(
    '$key refuses malformed extensions without falling back to a native escape hatch',
    async (item) => {
      const owner = providerId(item.id);
      const base = createFakeProviderFactory({ providerId: owner });
      const client = await base.connect(
        createFakeProfile({ providerId: owner }),
      );
      const extensions = new ExtensionRegistry(owner);
      extensions.register(
        {
          name: item.extension,
          providerId: owner,
          displayName: 'Malformed extension',
        },
        { fork: true, branch: 'invalid' },
      );
      expect(item.bind(withExtensions(client, extensions))).toBeUndefined();
      await client.close();
    },
  );

  it('requires the DSH step checkpoint and preserves the Session cancellation receipt', async () => {
    const owner = providerId('deepseek.harness');
    const client = await createFakeProviderFactory({
      providerId: owner,
    }).connect(createFakeProfile({ providerId: owner }));
    const session = await client.createSession();
    const run = await session.start({
      parts: [{ type: 'text', text: 'Fictional test.' }],
    });
    const events: HarnessEvent[] = [];
    for await (const event of run.events()) events.push(event);
    const started = events[0];
    if (started === undefined) throw new Error('Missing synthetic event.');
    const request = vi.fn(() => Promise.resolve({ accepted: true as const }));
    const extensions = new ExtensionRegistry(owner);
    extensions.register(
      {
        name: 'deepseek.harness.gateway.sessions',
        providerId: owner,
        displayName: 'Synthetic Gateway',
      },
      { fork: () => client.createSession(), cancelSession: request },
    );
    const binding = bindDshSessionHistory(withExtensions(client, extensions));
    expect(binding?.sessionCancellation?.ready(started)).toBe(false);
    expect(
      binding?.sessionCancellation?.ready({
        ...started,
        providerEventType: 'step/start',
      }),
    ).toBe(true);
    await expect(
      binding?.sessionCancellation?.request(session.ref()),
    ).resolves.toEqual({ accepted: true });
    expect(request).toHaveBeenCalledWith(session.ref());
    await session.close();
    await client.close();
  });
});

describe('inert session provider configuration', () => {
  it('constructs all six factories without launching or authenticating runtimes', () => {
    const configs = Object.fromEntries(
      cases.map((item) => [
        item.key,
        {
          profile: {
            providerId: providerId(item.id),
            profileId: profileId(`${item.key}-demo`),
            displayName: 'Fictional profile',
            connection: {
              kind: 'process',
              command: '/fictional/not-installed',
              ownership: 'adapter',
            },
          },
        },
      ]),
    ) as SessionProviderConfiguration;
    const setups = createSessionWorkflowSetups(configs);
    expect(
      setups.map(({ factory }) => factory.descriptor().providerId),
    ).toEqual(cases.map(({ id }) => id));
    expect(setups.map((setup) => setup.bindHistory.name)).toEqual(
      cases.map(({ bind }) => bind.name),
    );
  });

  it('rejects an empty selection and a mismatched Profile owner before connection', () => {
    expect(() => createSessionWorkflowSetups({})).toThrow(
      'Choose at least one Provider',
    );
    expect(() =>
      createSessionWorkflowSetups({ codex: { profile: createFakeProfile() } }),
    ).toThrow('wrong Profile owner');
  });
});

function withExtensions(
  client: HarnessClient,
  extensions: ExtensionRegistry,
): HarnessClient {
  return {
    descriptor: () => client.descriptor(),
    capabilities: () => client.capabilities(),
    createSession: (input) => client.createSession(input),
    resumeSession: (ref) => client.resumeSession(ref),
    extensions: () => extensions,
    native: (guard) => client.native(guard),
    close: () => client.close(),
  };
}
