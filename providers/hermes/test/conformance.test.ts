import { definePortableProviderConformanceSuite } from '@harapter/conformance';

import {
  createHermesFixtureFactory,
  createHermesProfile,
} from './test-profile.js';

definePortableProviderConformanceSuite({
  name: 'Hermes Agent API Server Adapter',
  createFactory: createHermesFixtureFactory,
  createProfile: createHermesProfile,
});
