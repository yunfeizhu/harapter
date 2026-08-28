import { definePortableProviderConformanceSuite } from '@harapter/conformance';
import { createFixtureFactory, createTestProfile } from './test-support.js';

definePortableProviderConformanceSuite({
  name: 'Claude Agent SDK query fixture',
  createFactory: createFixtureFactory,
  createProfile: createTestProfile,
});
