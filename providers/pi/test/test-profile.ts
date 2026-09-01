import { fileURLToPath } from 'node:url';

import { profileId, type HarnessProfile, type ProfileId } from '@harapter/core';

import { PI_PROVIDER_ID } from '../src/index.js';

const fixtureRuntime = fileURLToPath(
  new URL('./fixture-runtime.mjs', import.meta.url),
);

/** Create an adapter-owned synthetic Pi Agent RPC Profile. */
export function createTestProfile(
  id: ProfileId = profileId('pi-synthetic'),
  mode = 'normal',
  providerOptions?: Readonly<Record<string, unknown>>,
): HarnessProfile {
  return {
    profileId: id,
    providerId: PI_PROVIDER_ID,
    displayName: 'Synthetic Pi Agent RPC runtime',
    connection: {
      kind: 'process',
      command: process.execPath,
      args: [fixtureRuntime, '--fixture-mode', mode],
      ownership: 'adapter',
    },
    ...(providerOptions === undefined ? {} : { providerOptions }),
  };
}
