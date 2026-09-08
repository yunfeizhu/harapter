import {
  definePortableProviderConformanceSuite,
  defineInteractionConformanceSuite,
} from '@harapter/conformance';
import { createCodexProviderFactory } from '../src/index.js';
import { createTestProfile } from './test-profile.js';

definePortableProviderConformanceSuite({
  name: 'Codex App Server stable fixture',
  createFactory: createCodexProviderFactory,
  createProfile: createTestProfile,
});

defineInteractionConformanceSuite({
  name: 'codex synthetic interaction fixture',
  createFactory: createCodexProviderFactory,
  createProfile: createTestProfile,
  input: { parts: [{ type: 'text', text: 'approval interaction' }] },
  kind: 'approval',
  responses: [
    { kind: 'approval', decision: 'approve' },
    { kind: 'approval', decision: 'deny' },
  ],
});
