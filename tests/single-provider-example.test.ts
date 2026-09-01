import type { HarnessClient, ProviderAdapterFactory } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';
import { describe, expect, it, vi } from 'vitest';
import {
  runSingleProviderExample,
  type SingleProviderExampleOptions,
  type SingleProviderExampleRecord,
} from '../examples/single-provider/src/index.js';
import { runCodexReference } from '../examples/single-provider/src/main.js';

const SECRET_INPUT = 'synthetic prompt that must not be logged';

describe('single-provider reference example', () => {
  it('uses only portable records and omits application and raw data', async () => {
    const records: SingleProviderExampleRecord[] = [];

    const status = await runSingleProviderExample({
      factory: createFakeProviderFactory({
        includeUnknownEvent: true,
        rawEvents: true,
      }),
      profile: createFakeProfile(),
      input: { parts: [{ type: 'text', text: SECRET_INPUT }] },
      write: (record) => {
        records.push(record);
      },
    });

    expect(status).toBe('completed');
    expect(records).toEqual([
      {
        type: 'connected',
        providerId: 'harapter.fake',
        profileId: 'fake-local',
        compatibility: 'supported',
        capabilities: {
          'input.text': 'native',
          'run.stream': 'native',
        },
      },
      { type: 'event', eventType: 'run.started', sequence: 0 },
      { type: 'event', eventType: 'message.delta', sequence: 1 },
      { type: 'event', eventType: 'provider', sequence: 2 },
      { type: 'event', eventType: 'message.completed', sequence: 3 },
      { type: 'event', eventType: 'run.completed', sequence: 4 },
      { type: 'result', status: 'completed' },
    ]);
    expect(JSON.stringify(records)).not.toContain(SECRET_INPUT);
    expect(JSON.stringify(records)).not.toContain('synthetic');
    expect(JSON.stringify(records)).not.toContain('fake.unknown');
  });

  it('closes the session and client when rendering fails', async () => {
    const sessionClose = vi.fn<() => Promise<void>>();
    const clientClose = vi.fn<() => Promise<void>>();
    const factory = observingFactory(sessionClose, clientClose);
    let writes = 0;

    await expect(
      runSingleProviderExample({
        factory,
        profile: createFakeProfile(),
        input: { parts: [{ type: 'text', text: SECRET_INPUT }] },
        write: () => {
          writes += 1;
          if (writes === 2) throw new Error('synthetic renderer failure');
        },
      }),
    ).rejects.toThrow('synthetic renderer failure');

    expect(sessionClose).toHaveBeenCalledOnce();
    expect(clientClose).toHaveBeenCalledOnce();
  });

  it('isolates the Codex composition root and removes its workspace', async () => {
    const workspace = '/private/tmp/harapter-codex-example-test';
    const removeTemporaryWorkspace = vi.fn<(path: string) => Promise<void>>();
    let received: SingleProviderExampleOptions | undefined;
    const runExample = (
      options: SingleProviderExampleOptions,
    ): Promise<'completed'> => {
      received = options;
      return Promise.resolve('completed');
    };

    await expect(
      runCodexReference('codex-test', () => undefined, {
        createTemporaryWorkspace: () => Promise.resolve(workspace),
        removeTemporaryWorkspace,
        runExample,
      }),
    ).resolves.toBe('completed');

    if (received === undefined) throw new Error('Example was not invoked.');
    expect(received.factory.descriptor().providerId).toBe('openai.codex');
    expect(received.profile.connection).toEqual({
      kind: 'process',
      command: 'codex-test',
      args: ['app-server', '--stdio'],
      cwd: workspace,
      ownership: 'adapter',
    });
    expect(received.sessionInput).toEqual({
      workspace: { uri: 'file:///private/tmp/harapter-codex-example-test' },
      providerOptions: {
        approvalPolicy: 'never',
        ephemeral: true,
        sandbox: 'read-only',
      },
    });
    expect(removeTemporaryWorkspace).toHaveBeenCalledExactlyOnceWith(workspace);
  });

  it('removes the isolated Workspace after a Codex execution failure', async () => {
    const removeTemporaryWorkspace = vi.fn<(path: string) => Promise<void>>();

    await expect(
      runCodexReference('codex-test', () => undefined, {
        createTemporaryWorkspace: () => Promise.resolve('/private/tmp/example'),
        removeTemporaryWorkspace,
        runExample: () => Promise.reject(new Error('synthetic run failure')),
      }),
    ).rejects.toThrow('synthetic run failure');

    expect(removeTemporaryWorkspace).toHaveBeenCalledWith(
      '/private/tmp/example',
    );
  });
});

function observingFactory(
  sessionClose: () => Promise<void>,
  clientClose: () => Promise<void>,
): ProviderAdapterFactory {
  const delegate = createFakeProviderFactory();
  return {
    descriptor: () => delegate.descriptor(),
    connect: async (profile) => {
      const client = await delegate.connect(profile);
      return observeClient(client, sessionClose, clientClose);
    },
  };
}

function observeClient(
  client: HarnessClient,
  sessionClose: () => Promise<void>,
  clientClose: () => Promise<void>,
): HarnessClient {
  return {
    descriptor: () => client.descriptor(),
    capabilities: (options) => client.capabilities(options),
    createSession: async (input) => {
      const session = await client.createSession(input);
      return {
        ref: () => session.ref(),
        capabilities: () => session.capabilities(),
        start: (runInput, options) => session.start(runInput, options),
        respond: (requestId, response) => session.respond(requestId, response),
        close: async () => {
          await session.close();
          await sessionClose();
        },
      };
    },
    resumeSession: (ref) => client.resumeSession(ref),
    extensions: () => client.extensions(),
    native: (guard) => client.native(guard),
    close: async () => {
      await client.close();
      await clientClose();
    },
  };
}
