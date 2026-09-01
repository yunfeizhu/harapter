import type {
  HarnessClient,
  HarnessSession,
  ProviderAdapterFactory,
} from '@harapter/core';
import { profileId, providerId } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';
import { describe, expect, it, vi } from 'vitest';
import {
  runMultiProviderClient,
  type MultiProviderRecord,
  type MultiProviderSetup,
} from '../examples/multi-provider-client/src/index.js';
import { createCodexOpenCodeSetups } from '../examples/multi-provider-client/src/codex-opencode.js';

const ALPHA_PROVIDER_ID = providerId('harapter.example.alpha');
const BETA_PROVIDER_ID = providerId('harapter.example.beta');
const SECRET_INPUT = 'multi-provider prompt that must not be rendered';

describe('multi-provider reference client', () => {
  it('runs two Providers through one renderer and capability-gated controls', async () => {
    const records: MultiProviderRecord[] = [];
    const extensionDisposed = vi.fn();
    let extensionResult: string | undefined;
    let activeWrites = 0;
    let maximumActiveWrites = 0;

    const outcomes = await runMultiProviderClient({
      providers: fakeSetups(),
      tasks: [
        {
          profileId: profileId('alpha-local'),
          input: { parts: [{ type: 'text', text: SECRET_INPUT }] },
        },
        {
          profileId: profileId('beta-local'),
          input: { parts: [{ type: 'text', text: SECRET_INPUT }] },
        },
      ],
      onConnected: ({ client, profile }) => {
        if (profile.providerId !== ALPHA_PROVIDER_ID) return;
        const extension = client
          .extensions()
          .get(`${ALPHA_PROVIDER_ID}.echo`, isEchoExtension);
        extensionResult = extension?.echo('extension-ready');
        return extensionDisposed;
      },
      write: async (record) => {
        activeWrites += 1;
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 1);
        });
        records.push(record);
        activeWrites -= 1;
      },
    });

    expect(outcomes.map(({ status }) => status)).toEqual([
      'completed',
      'completed',
    ]);
    expect(outcomes[0]?.sessionRef).toMatchObject({
      providerId: ALPHA_PROVIDER_ID,
      profileId: 'alpha-local',
    });
    expect(outcomes[1]?.sessionRef).toMatchObject({
      providerId: BETA_PROVIDER_ID,
      profileId: 'beta-local',
    });
    expect(records.filter(({ type }) => type === 'connected')).toEqual([
      {
        type: 'connected',
        providerId: ALPHA_PROVIDER_ID,
        profileId: 'alpha-local',
        compatibility: 'supported',
      },
      {
        type: 'connected',
        providerId: BETA_PROVIDER_ID,
        profileId: 'beta-local',
        compatibility: 'supported',
      },
    ]);
    expect(records.filter(({ type }) => type === 'session')).toEqual([
      {
        type: 'session',
        providerId: ALPHA_PROVIDER_ID,
        profileId: 'alpha-local',
        controls: [
          { name: 'cancel', mode: 'adapter_controlled' },
          { name: 'resume', mode: 'native' },
        ],
      },
      {
        type: 'session',
        providerId: BETA_PROVIDER_ID,
        profileId: 'beta-local',
        controls: [],
      },
    ]);
    expect(records.filter(({ type }) => type === 'result')).toHaveLength(2);
    expect(
      new Set(
        records
          .filter(({ type }) => type === 'event')
          .map((record) => record.profileId),
      ),
    ).toEqual(new Set(['alpha-local', 'beta-local']));
    expect(extensionResult).toBe('extension-ready');
    expect(extensionDisposed).toHaveBeenCalledOnce();
    expect(maximumActiveWrites).toBe(1);
    expect(JSON.stringify(records)).not.toContain(SECRET_INPUT);
    expect(JSON.stringify(records)).not.toContain('extension-ready');
    expect(JSON.stringify(records)).not.toContain('synthetic');
  });

  it('rejects a SessionRef routed to the wrong Profile before Provider traffic', async () => {
    const initial = await runMultiProviderClient({
      providers: fakeSetups(),
      tasks: [
        {
          profileId: profileId('alpha-local'),
          input: { parts: [{ type: 'text', text: SECRET_INPUT }] },
        },
      ],
      write: () => undefined,
    });
    const alphaSessionRef = initial[0]?.sessionRef;
    if (alphaSessionRef === undefined) {
      throw new Error('Alpha task did not return a Session reference.');
    }
    const resumeCalls = vi.fn();
    const setups = fakeSetups({
      betaFactory: observingResumeFactory(resumeCalls),
    });

    await expect(
      runMultiProviderClient({
        providers: setups,
        tasks: [
          {
            profileId: profileId('beta-local'),
            sessionRef: alphaSessionRef,
            input: { parts: [{ type: 'text', text: SECRET_INPUT }] },
          },
        ],
        write: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'session_provider_mismatch' });

    expect(resumeCalls).not.toHaveBeenCalled();
  });

  it('uses Session capabilities when they are narrower than Client capabilities', async () => {
    const records: MultiProviderRecord[] = [];
    let clientResumeMode: string | undefined;

    await runMultiProviderClient({
      providers: fakeSetups({
        alphaFactory: sessionResumeUnsupportedFactory(),
      }),
      tasks: [
        {
          profileId: profileId('alpha-local'),
          input: { parts: [{ type: 'text', text: SECRET_INPUT }] },
        },
      ],
      onConnected: ({ capabilities, profile }) => {
        if (profile.providerId === ALPHA_PROVIDER_ID) {
          clientResumeMode = capabilities.capabilities['session.resume']?.mode;
        }
        return undefined;
      },
      write: (record) => {
        records.push(record);
      },
    });

    expect(clientResumeMode).toBe('native');
    expect(records.find(({ type }) => type === 'session')).toMatchObject({
      type: 'session',
      providerId: ALPHA_PROVIDER_ID,
      profileId: 'alpha-local',
      controls: [{ name: 'cancel', mode: 'native' }],
    });
  });

  it('closes every Session and Client after a renderer failure', async () => {
    const sessionClose = vi.fn<() => Promise<void>>();
    const clientClose = vi.fn<() => Promise<void>>();
    const providers = fakeSetups({
      alphaFactory: observingCleanupFactory(
        createFakeProviderFactory({ providerId: ALPHA_PROVIDER_ID }),
        sessionClose,
        clientClose,
      ),
      betaFactory: observingCleanupFactory(
        createFakeProviderFactory({
          providerId: BETA_PROVIDER_ID,
          cancelMode: 'missing',
          resumeMode: 'unsupported',
        }),
        sessionClose,
        clientClose,
      ),
    });

    await expect(
      runMultiProviderClient({
        providers,
        tasks: [
          {
            profileId: profileId('alpha-local'),
            input: { parts: [{ type: 'text', text: SECRET_INPUT }] },
          },
          {
            profileId: profileId('beta-local'),
            input: { parts: [{ type: 'text', text: SECRET_INPUT }] },
          },
        ],
        write: (record) => {
          if (record.type === 'event') {
            throw new Error('synthetic renderer failure');
          }
        },
      }),
    ).rejects.toThrow('synthetic renderer failure');

    expect(sessionClose).toHaveBeenCalledTimes(2);
    expect(clientClose).toHaveBeenCalledTimes(2);
  });

  it('builds Codex and OpenCode composition without connecting either runtime', () => {
    const setups = createCodexOpenCodeSetups({
      codexCommand: 'codex-reference',
      codexWorkspacePath: '/tmp/harapter-codex-reference',
      openCodeEndpoint: 'http://127.0.0.1:4096',
      openCodeTools: { read: false, write: false },
      openCodeWorkspacePath: '/tmp/harapter-opencode-reference',
    });

    expect(
      setups.map(({ factory }) => factory.descriptor().providerId),
    ).toEqual(['openai.codex', 'opencode']);
    expect(setups[0]).toMatchObject({
      profile: {
        connection: {
          kind: 'process',
          command: 'codex-reference',
          args: ['app-server', '--stdio'],
          cwd: '/tmp/harapter-codex-reference',
          ownership: 'adapter',
        },
      },
      sessionInput: {
        workspace: { uri: 'file:///tmp/harapter-codex-reference' },
        providerOptions: {
          approvalPolicy: 'never',
          ephemeral: true,
          sandbox: 'read-only',
        },
      },
    });
    expect(setups[1]).toMatchObject({
      profile: {
        connection: {
          kind: 'endpoint',
          url: 'http://127.0.0.1:4096',
          transport: 'http',
          ownership: 'external',
        },
      },
      sessionInput: {
        workspace: { uri: 'file:///tmp/harapter-opencode-reference' },
      },
      runOptions: {
        providerOptions: { tools: { read: false, write: false } },
      },
    });
  });

  it('rejects credentials embedded in a composed OpenCode endpoint', () => {
    expect(() =>
      createCodexOpenCodeSetups({
        codexCommand: 'codex-reference',
        codexWorkspacePath: '/tmp/harapter-codex-reference',
        openCodeEndpoint: 'https://user:secret@example.invalid',
        openCodeTools: { read: false },
        openCodeWorkspacePath: '/tmp/harapter-opencode-reference',
      }),
    ).toThrow(expect.objectContaining({ code: 'profile_invalid' }));
  });

  it('rejects an enabled Tool in the composed OpenCode policy', () => {
    expect(() =>
      createCodexOpenCodeSetups({
        codexCommand: 'codex-reference',
        codexWorkspacePath: '/tmp/harapter-codex-reference',
        openCodeEndpoint: 'http://127.0.0.1:4096',
        openCodeTools: { read: true } as unknown as Readonly<
          Record<string, false>
        >,
        openCodeWorkspacePath: '/tmp/harapter-opencode-reference',
      }),
    ).toThrow(expect.objectContaining({ code: 'profile_invalid' }));
  });
});

interface EchoExtension {
  echo(value: string): string;
}

function isEchoExtension(value: unknown): value is EchoExtension {
  return (
    typeof value === 'object' &&
    value !== null &&
    'echo' in value &&
    typeof value.echo === 'function'
  );
}

function fakeSetups(
  overrides: {
    alphaFactory?: ProviderAdapterFactory;
    betaFactory?: ProviderAdapterFactory;
  } = {},
): readonly [MultiProviderSetup, MultiProviderSetup] {
  return [
    {
      factory:
        overrides.alphaFactory ??
        createFakeProviderFactory({
          providerId: ALPHA_PROVIDER_ID,
          cancelMode: 'adapter_controlled',
        }),
      profile: createFakeProfile({
        providerId: ALPHA_PROVIDER_ID,
        profileId: profileId('alpha-local'),
        displayName: 'Alpha fixture Provider',
      }),
    },
    {
      factory:
        overrides.betaFactory ??
        createFakeProviderFactory({
          providerId: BETA_PROVIDER_ID,
          cancelMode: 'missing',
          resumeMode: 'unsupported',
        }),
      profile: createFakeProfile({
        providerId: BETA_PROVIDER_ID,
        profileId: profileId('beta-local'),
        displayName: 'Beta fixture Provider',
      }),
    },
  ];
}

function observingResumeFactory(
  resumeCalls: () => void,
): ProviderAdapterFactory {
  const delegate = createFakeProviderFactory({
    providerId: BETA_PROVIDER_ID,
    cancelMode: 'missing',
    resumeMode: 'unsupported',
  });
  return observeFactory(delegate, (client) => ({
    descriptor: () => client.descriptor(),
    capabilities: (options) => client.capabilities(options),
    createSession: (input) => client.createSession(input),
    resumeSession: (ref) => {
      resumeCalls();
      return client.resumeSession(ref);
    },
    extensions: () => client.extensions(),
    native: (guard) => client.native(guard),
    close: () => client.close(),
  }));
}

function sessionResumeUnsupportedFactory(): ProviderAdapterFactory {
  const delegate = createFakeProviderFactory({
    providerId: ALPHA_PROVIDER_ID,
  });
  return observeFactory(delegate, (client) => ({
    descriptor: () => client.descriptor(),
    capabilities: (options) => client.capabilities(options),
    createSession: async (input) => {
      const session = await client.createSession(input);
      return {
        ref: () => session.ref(),
        capabilities: async () => {
          const manifest = await session.capabilities();
          return {
            ...manifest,
            capabilities: {
              ...manifest.capabilities,
              'session.resume': {
                mode: 'unsupported',
                source: 'configuration',
              },
            },
          };
        },
        start: (taskInput, options) => session.start(taskInput, options),
        respond: (requestId, response) => session.respond(requestId, response),
        close: () => session.close(),
      };
    },
    resumeSession: (ref) => client.resumeSession(ref),
    extensions: () => client.extensions(),
    native: (guard) => client.native(guard),
    close: () => client.close(),
  }));
}

function observingCleanupFactory(
  delegate: ProviderAdapterFactory,
  sessionClose: () => Promise<void>,
  clientClose: () => Promise<void>,
): ProviderAdapterFactory {
  return observeFactory(delegate, (client) => ({
    descriptor: () => client.descriptor(),
    capabilities: (options) => client.capabilities(options),
    createSession: async (input) => {
      const session = await client.createSession(input);
      return observingSession(session, sessionClose);
    },
    resumeSession: (ref) => client.resumeSession(ref),
    extensions: () => client.extensions(),
    native: (guard) => client.native(guard),
    close: async () => {
      await client.close();
      await clientClose();
    },
  }));
}

function observeFactory(
  delegate: ProviderAdapterFactory,
  observe: (client: HarnessClient) => HarnessClient,
): ProviderAdapterFactory {
  return {
    descriptor: () => delegate.descriptor(),
    connect: async (profile) => observe(await delegate.connect(profile)),
  };
}

function observingSession(
  session: HarnessSession,
  sessionClose: () => Promise<void>,
): HarnessSession {
  return {
    ref: () => session.ref(),
    capabilities: () => session.capabilities(),
    start: (input, options) => session.start(input, options),
    respond: (requestId, response) => session.respond(requestId, response),
    close: async () => {
      await session.close();
      await sessionClose();
    },
  };
}
