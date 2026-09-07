import { readFile } from 'node:fs/promises';
import { profileId, type HarnessRun } from '@harapter/core';
import { describe, expect, it } from 'vitest';
import {
  createDshProviderFactory,
  DSH_GATEWAY_PROTOCOL,
  DSH_GATEWAY_SESSION_EXTENSION,
  DSH_PROVIDER_ID,
  type DshGatewaySessions,
} from '../src/index.js';

/** Opt in only against an isolated, tool-free host and a scripted local model. */
describe.runIf(process.env['HARAPTER_DSH_GATEWAY_LIVE'] === '1')(
  'DSH Gateway pinned Runtime with synthetic model',
  () => {
    it('creates, forks, reconnects, continues, and observes Session cancellation', async () => {
      const factory = createDshProviderFactory({
        resolveGatewayCookie: async () =>
          (
            await readFile(required('HARAPTER_DSH_GATEWAY_COOKIE_FILE'), 'utf8')
          ).trim(),
      });
      const profile = {
        providerId: DSH_PROVIDER_ID,
        profileId: profileId('dsh-gateway-live'),
        displayName: 'Isolated DSH Gateway',
        connection: {
          kind: 'endpoint' as const,
          ownership: 'external' as const,
          url: required('HARAPTER_DSH_GATEWAY_URL'),
          authRef: { scheme: 'host-test-file', id: 'isolated-cookie' },
        },
        providerOptions: {
          protocol: DSH_GATEWAY_PROTOCOL,
          storeId: required('HARAPTER_DSH_GATEWAY_STORE_ID'),
          exclusiveSessions: true,
          runTimeoutMs: 15_000,
        },
      };
      let client = await factory.connect(profile);
      try {
        expect(
          (await client.capabilities()).capabilities['run.cancel']?.mode,
        ).toBe('unsupported');
        const parent = await client.createSession();
        await completed(await parent.start(input));
        const controls = client
          .extensions()
          .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION);
        if (controls === undefined)
          throw new Error('Gateway controls unavailable.');
        const child = await controls.fork(parent.ref());
        if (child.ref().providerSessionId === parent.ref().providerSessionId)
          throw new Error('Gateway fork did not create a distinct Session.');
        const ref = child.ref();
        await client.close();
        client = await factory.connect(profile);
        const resumed = await client.resumeSession(ref);
        await completed(await resumed.start(input));
        const run = await resumed.start(input);
        const started = Promise.withResolvers<undefined>();
        const events = drain(run, () => {
          started.resolve(undefined);
        });
        await Promise.race([
          started.promise,
          events.then(() => {
            throw new Error(
              'Gateway turn ended before the cancellation checkpoint.',
            );
          }),
        ]);
        await client
          .extensions()
          .get<DshGatewaySessions>(DSH_GATEWAY_SESSION_EXTENSION)
          ?.cancelSession(ref);
        if ((await run.result()).status !== 'cancelled')
          throw new Error(
            'Gateway did not observe the synthetic cancelled turn.',
          );
        await events;
      } finally {
        await client.close();
      }
    }, 60_000);
  },
);

const input = {
  parts: [{ type: 'text' as const, text: 'Synthetic Gateway test request.' }],
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Gateway live test requires ${name}.`);
  return value;
}

async function drain(run: HarnessRun, started?: () => void): Promise<void> {
  for await (const event of run.events()) {
    if (event.providerEventType === 'step/start') started?.();
    if (
      event.type.startsWith('tool.') ||
      event.type === 'interaction.requested'
    )
      throw new Error('Gateway live test observed a model-facing action.');
  }
}

async function completed(run: HarnessRun): Promise<void> {
  await drain(run);
  const result = await run.result();
  if (
    result.status !== 'completed' ||
    result.finalMessage !== 'HARAPTER_DSH_GATEWAY_LIVE_OK'
  )
    throw new Error(
      'Gateway did not return the expected synthetic completed turn.',
    );
}
