import { definePortableProviderConformanceSuite } from '@harapter/conformance';

import { createPiProviderFactory } from '../src/index.js';
import { createTestProfile } from './test-profile.js';

definePortableProviderConformanceSuite({
  name: 'Pi Agent RPC synthetic fixture',
  createFactory: createPiProviderFactory,
  createProfile: createTestProfile,
});
