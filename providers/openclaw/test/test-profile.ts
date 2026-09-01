import { fileURLToPath } from 'node:url';

import { profileId, type HarnessProfile, type ProfileId } from '@harapter/core';

import { OPENCLAW_PROVIDER_ID } from '../src/index.js';

const fixtureRuntime = fileURLToPath(
  new URL('./fixture-runtime.mjs', import.meta.url),
);

/** Create an adapter-owned synthetic OpenClaw ACP bridge Profile. */
export function createTestProfile(
  id: ProfileId = profileId('openclaw-synthetic'),
  mode?: string,
  providerOptions?: Readonly<Record<string, unknown>>,
): HarnessProfile {
  return {
    profileId: id,
    providerId: OPENCLAW_PROVIDER_ID,
    displayName: 'Synthetic OpenClaw ACP bridge',
    connection: {
      kind: 'process',
      command: process.execPath,
      args: mode === undefined ? [fixtureRuntime] : [fixtureRuntime, mode],
      ownership: 'adapter',
    },
    ...(providerOptions === undefined ? {} : { providerOptions }),
  };
}
