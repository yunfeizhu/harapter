import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDshProviderFactory } from '@harapter/adapter-dsh';
import { startOpenCodeFixtureServer } from '../../../providers/opencode/test/fixture-server.js';
import { runTask as runApplicationTask } from '../../../examples/runtime-profiles/src/quick-unified.js';
import {
  createHarapter,
  profileId,
  providerId,
  type HarnessProfile,
  type HarapterOptions,
  type SecretRef,
  type HarnessRegistry,
} from 'harapter';

const profiles = {
  dsh: {
    profileId: profileId('sdk-dsh'),
    providerId: providerId('deepseek.harness'),
    displayName: 'Synthetic DSH',
    connection: {
      kind: 'process',
      command: process.execPath,
      ownership: 'adapter',
      args: [
        fileURLToPath(
          new URL(
            '../../../providers/dsh/test/fixture-runtime.mjs',
            import.meta.url,
          ),
        ),
      ],
    },
    providerOptions: {
      provider: 'synthetic-provider',
      model: 'synthetic-model',
    },
  },
  pi: {
    profileId: profileId('sdk-pi'),
    providerId: providerId('pi.agent'),
    displayName: 'Synthetic Pi',
    connection: {
      kind: 'process',
      command: process.execPath,
      ownership: 'adapter',
      args: [
        fileURLToPath(
          new URL(
            '../../../providers/pi/test/fixture-runtime.mjs',
            import.meta.url,
          ),
        ),
      ],
    },
  },
} satisfies Record<string, HarnessProfile>;

async function runTask(harapter: HarnessRegistry, profile: HarnessProfile) {
  const events: string[] = [];
  const outcome = await runApplicationTask(
    harapter,
    profile,
    'synthetic answer',
    (event) => events.push(event.type),
  );
  return { result: outcome.result, ref: outcome.sessionRef, events };
}

describe('unified Harapter SDK', () => {
  it('loads only explicitly selected adapters without connecting a Runtime', async () => {
    const harapter = await createHarapter({ harnesses: ['dsh', 'pi'] });
    expect(
      harapter
        .listProviders()
        .map((provider) => provider.providerId)
        .sort(),
    ).toEqual(['deepseek.harness', 'pi.agent']);
  });

  it('supports each installed adapter, deduplicates selection and permits an empty registry', async () => {
    const empty = await createHarapter();
    expect(empty.listProviders()).toEqual([]);
    const all = await createHarapter({
      harnesses: [
        'codex',
        'dsh',
        'hermes',
        'openclaw',
        'opencode',
        'pi',
        'dsh',
      ],
    });
    expect(
      all
        .listProviders()
        .map((provider) => provider.providerId)
        .sort(),
    ).toEqual(
      [
        'openai.codex',
        'deepseek.harness',
        'nous.hermes-agent',
        'openclaw',
        'opencode',
        'pi.agent',
      ].sort(),
    );
  });

  it('keeps SDK instances independent and preserves explicit registry extension', async () => {
    const first = await createHarapter({ harnesses: ['dsh'] });
    const second = await createHarapter({ harnesses: ['dsh'] });
    first.unregister(providerId('deepseek.harness'));
    expect(first.getProvider(providerId('deepseek.harness'))).toBeUndefined();
    expect(second.getProvider(providerId('deepseek.harness'))).toBeDefined();
    first.register(createDshProviderFactory());
    expect(first.getProvider(providerId('deepseek.harness'))).toBeDefined();
    await expect(
      first.connect({
        ...profiles.pi,
        providerId: providerId('synthetic-unknown'),
      }),
    ).rejects.toMatchObject({ code: 'provider_not_found' });
  });

  it('uses the same application operation for authenticated OpenCode HTTP and DSH process connections', async () => {
    const server = await startOpenCodeFixtureServer({
      authorization: 'Bearer synthetic-token',
    });
    const seenRefs: string[] = [];
    class HostConfiguration implements HarapterOptions {
      readonly harnesses = ['dsh', 'opencode'] as const;
      readonly #authorization = 'Bearer synthetic-token';
      resolveAuthHeaders(ref: SecretRef) {
        seenRefs.push(ref.id);
        return { authorization: this.#authorization };
      }
    }
    const harapter = await createHarapter(new HostConfiguration());
    const endpoint: HarnessProfile = {
      profileId: profileId('sdk-opencode'),
      providerId: providerId('opencode'),
      displayName: 'Synthetic OpenCode',
      connection: {
        kind: 'endpoint',
        url: server.url,
        transport: 'http',
        ownership: 'external',
        authRef: { scheme: 'fixture', id: 'opencode' },
      },
    };
    try {
      const outcomes = await Promise.all(
        [profiles.dsh, endpoint].map((profile) => runTask(harapter, profile)),
      );
      expect(outcomes.map((outcome) => outcome.result.finalMessage)).toEqual([
        'synthetic answer',
        'fixture answer',
      ]);
      for (const outcome of outcomes) {
        expect(outcome.result.status).toBe('completed');
        expect(outcome.events).toContain('message.delta');
        expect(outcome.events.at(-1)).toBe('run.completed');
      }
      expect(outcomes.map((outcome) => outcome.ref.providerId)).toEqual([
        'deepseek.harness',
        'opencode',
      ]);
      expect(seenRefs).toContain('opencode');
      expect(server.deleteRequests()).toBe(0);
      expect(server.disposeRequests()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('preserves observed capabilities and rejects a Session from another harness', async () => {
    const harapter = await createHarapter({ harnesses: ['dsh', 'pi'] });
    const dshClient = await harapter.connect(profiles.dsh);
    try {
      const piClient = await harapter.connect(profiles.pi);
      try {
        expect(
          (await dshClient.capabilities()).capabilities['run.cancel']?.mode,
        ).toBe('unsupported');
        expect(
          (await piClient.capabilities()).capabilities['run.cancel']?.mode,
        ).toBe('native');
        const session = await dshClient.createSession();
        try {
          await expect(
            piClient.resumeSession(session.ref()),
          ).rejects.toMatchObject({ code: 'session_provider_mismatch' });
        } finally {
          await session.close();
        }
      } finally {
        await piClient.close();
      }
    } finally {
      await dshClient.close();
    }
  });
});
