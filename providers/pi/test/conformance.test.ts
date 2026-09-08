import {
  definePortableProviderConformanceSuite,
  defineInteractionConformanceSuite,
} from '@harapter/conformance';

import { createPiProviderFactory } from '../src/index.js';
import { createTestProfile } from './test-profile.js';

definePortableProviderConformanceSuite({
  name: 'Pi Agent RPC synthetic fixture',
  createFactory: createPiProviderFactory,
  createProfile: createTestProfile,
});

defineInteractionConformanceSuite({
  name: 'pi synthetic interaction fixture',
  createFactory: createPiProviderFactory,
  createProfile: () => createTestProfile(undefined, 'interaction'),
  input: { parts: [{ type: 'text', text: 'synthetic interaction' }] },
  kind: 'provider',
  responses: [
    { kind: 'provider', value: { confirmed: true } },
    { kind: 'provider', value: { confirmed: false } },
  ],
});
