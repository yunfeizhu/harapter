import { profileId, providerId, type HarnessProfile } from '@harapter/core';
import { definePortableProviderConformanceSuite } from '@harapter/conformance';
import { afterAll, beforeAll } from 'vitest';
import { createOpenCodeProviderFactory } from '../src/index.js';
import {
  startOpenCodeFixtureServer,
  type OpenCodeFixtureServer,
} from './fixture-server.js';

let server: OpenCodeFixtureServer;

beforeAll(async () => {
  server = await startOpenCodeFixtureServer();
});

afterAll(async () => {
  await server.close();
});

definePortableProviderConformanceSuite({
  name: 'OpenCode HTTP fixture',
  createFactory: () => createOpenCodeProviderFactory(),
  createProfile: (): HarnessProfile => ({
    profileId: profileId('opencode-conformance'),
    displayName: 'OpenCode conformance fixture',
    providerId: providerId('opencode'),
    connection: {
      kind: 'endpoint',
      url: server.url,
      transport: 'http',
      ownership: 'external',
    },
  }),
});
