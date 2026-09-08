import { profileId, providerId, type HarnessProfile } from '@harapter/core';
import {
  definePortableProviderConformanceSuite,
  defineInteractionConformanceSuite,
} from '@harapter/conformance';
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

defineInteractionConformanceSuite({
  name: 'opencode synthetic interaction fixture',
  createFactory: createOpenCodeProviderFactory,
  createProfile: (): HarnessProfile => ({
    profileId: profileId('opencode-interaction-conformance'),
    displayName: 'Synthetic interaction fixture',
    providerId: providerId('opencode'),
    connection: {
      kind: 'endpoint',
      url: server.url,
      transport: 'http',
      ownership: 'external',
    },
  }),
  input: { parts: [{ type: 'text', text: 'permission input' }] },
  kind: 'approval',
  responses: [
    { kind: 'approval', decision: 'approve' },
    { kind: 'approval', decision: 'deny' },
  ],
});
