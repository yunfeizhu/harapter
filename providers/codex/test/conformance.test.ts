import { definePortableProviderConformanceSuite } from '@harapter/conformance';
import { createCodexProviderFactory } from '../src/index.js';
import { createTestProfile } from './test-profile.js';

definePortableProviderConformanceSuite({
  name: 'Codex App Server stable fixture',
  createFactory: createCodexProviderFactory,
  createProfile: createTestProfile,
});
