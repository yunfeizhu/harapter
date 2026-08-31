import { definePortableProviderConformanceSuite } from '@harapter/conformance';
import { createDshProviderFactory } from '../src/index.js';
import { createTestProfile } from './test-profile.js';

definePortableProviderConformanceSuite({
  name: 'DeepSeek Harness SDK JSON-RPC synthetic fixture',
  createFactory: createDshProviderFactory,
  createProfile: createTestProfile,
});
