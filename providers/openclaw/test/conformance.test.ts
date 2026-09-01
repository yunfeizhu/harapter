import { definePortableProviderConformanceSuite } from '@harapter/conformance';

import { createOpenClawProviderFactory } from '../src/index.js';
import { createTestProfile } from './test-profile.js';

definePortableProviderConformanceSuite({
  name: 'OpenClaw ACP synthetic fixture',
  createFactory: createOpenClawProviderFactory,
  createProfile: createTestProfile,
});
