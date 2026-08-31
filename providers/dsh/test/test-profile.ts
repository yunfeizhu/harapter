import { fileURLToPath } from 'node:url';
import { profileId, type HarnessProfile, type ProfileId } from '@harapter/core';
import { DSH_PROVIDER_ID } from '../src/index.js';

const fixtureRuntime = fileURLToPath(
  new URL('./fixture-runtime.mjs', import.meta.url),
);

/** Create an adapter-owned synthetic DeepSeek Harness SDK Runtime Profile. */
export function createTestProfile(
  id: ProfileId = profileId('dsh-synthetic'),
  mode?: string,
  providerOptions: Readonly<Record<string, unknown>> = {},
): HarnessProfile {
  return {
    profileId: id,
    providerId: DSH_PROVIDER_ID,
    displayName: 'Synthetic DeepSeek Harness SDK Runtime',
    connection: {
      kind: 'process',
      command: process.execPath,
      args: mode === undefined ? [fixtureRuntime] : [fixtureRuntime, mode],
      ownership: 'adapter',
    },
    providerOptions: {
      provider: 'synthetic-provider',
      model: 'synthetic-model',
      ...providerOptions,
    },
  };
}
