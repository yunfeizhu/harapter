import {
  definePortableProviderConformanceSuite,
  defineInteractionConformanceSuite,
} from '@harapter/conformance';

import { createOpenClawProviderFactory } from '../src/index.js';
import { createTestProfile } from './test-profile.js';

definePortableProviderConformanceSuite({
  name: 'OpenClaw ACP synthetic fixture',
  createFactory: createOpenClawProviderFactory,
  createProfile: createTestProfile,
});

defineInteractionConformanceSuite({
  name: 'openclaw synthetic interaction fixture',
  createFactory: createOpenClawProviderFactory,
  createProfile: () => createTestProfile(undefined, 'permission'),
  input: { parts: [{ type: 'text', text: 'synthetic approval' }] },
  kind: 'approval',
  responses: [
    { kind: 'approval', decision: 'approve' },
    { kind: 'approval', decision: 'deny' },
  ],
});
