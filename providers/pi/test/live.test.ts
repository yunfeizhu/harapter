import { profileId } from '@harapter/core';
import { describe, expect, it } from 'vitest';

import { PI_PROVIDER_ID, createPiProviderFactory } from '../src/index.js';

const liveEnabled = process.env['HARAPTER_PI_LIVE'] === '1';
const liveCommand = process.env['HARAPTER_PI_COMMAND'];

describe.skipIf(!liveEnabled || liveCommand === undefined)(
  'Pi Agent live RPC',
  () => {
    it('probes and opens an isolated host-supplied RPC Session', async () => {
      if (liveCommand === undefined) throw new Error('Missing Pi command.');
      const client = await createPiProviderFactory().connect({
        profileId: profileId('pi-live'),
        providerId: PI_PROVIDER_ID,
        displayName: 'Pi Agent live runtime',
        connection: {
          kind: 'process',
          command: liveCommand,
          ownership: 'adapter',
        },
      });
      try {
        await expect(client.descriptor()).resolves.toMatchObject({
          providerId: PI_PROVIDER_ID,
          compatibility: 'experimental',
          runtime: { name: 'pi' },
        });
        const session = await client.createSession();
        expect(session.ref().providerSessionId.length).toBeGreaterThan(0);
        await session.close();
      } finally {
        await client.close();
      }
    });
  },
);
