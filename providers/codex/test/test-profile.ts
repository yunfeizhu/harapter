import { fileURLToPath } from 'node:url';
import { profileId, type HarnessProfile, type ProfileId } from '@harapter/core';
import { CODEX_PROVIDER_ID } from '../src/index.js';

const fixtureServer = fileURLToPath(
  new URL('./fixture-app-server.mjs', import.meta.url),
);

/** Create an adapter-owned synthetic App Server Profile. */
export function createTestProfile(
  id: ProfileId = profileId('codex-synthetic'),
  mode?: string,
): HarnessProfile {
  return {
    profileId: id,
    providerId: CODEX_PROVIDER_ID,
    displayName: 'Synthetic Codex App Server',
    connection: {
      kind: 'process',
      command: process.execPath,
      args: mode === undefined ? [fixtureServer] : [fixtureServer, mode],
      ownership: 'adapter',
    },
  };
}
