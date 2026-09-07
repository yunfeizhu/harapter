import { afterEach, beforeEach } from 'vitest';
import { definePortableProviderConformanceSuite } from '@harapter/conformance';
import { createDshProviderFactory } from '../src/index.js';
import { gatewayFixture } from './gateway-fixture.js';

let fixture: Awaited<ReturnType<typeof gatewayFixture>>;
beforeEach(async () => {
  fixture = await gatewayFixture();
});
afterEach(async () => {
  await fixture.close();
});

definePortableProviderConformanceSuite({
  name: 'DSH Gateway Session v2 synthetic HTTP/WebSocket fixture',
  createFactory: () =>
    createDshProviderFactory({
      resolveGatewayCookie: () => 'synthetic=session',
    }),
  createProfile: () => fixture.profile,
});
