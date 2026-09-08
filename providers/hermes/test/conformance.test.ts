import {
  definePortableProviderConformanceSuite,
  defineInteractionConformanceSuite,
} from '@harapter/conformance';

import {
  createHermesFixtureFactory,
  createHermesProfile,
  HermesFixtureApi,
} from './test-profile.js';

definePortableProviderConformanceSuite({
  name: 'Hermes Agent API Server Adapter',
  createFactory: createHermesFixtureFactory,
  createProfile: createHermesProfile,
});

defineInteractionConformanceSuite({
  name: 'hermes synthetic interaction fixture',
  createFactory: () => {
    const runtime = new HermesFixtureApi();
    runtime.queueScenario('approval');
    return createHermesFixtureFactory(runtime);
  },
  createProfile: createHermesProfile,
  input: { parts: [{ type: 'text', text: 'synthetic approval' }] },
  kind: 'approval',
  responses: [
    { kind: 'approval', decision: 'approve' },
    { kind: 'approval', decision: 'deny' },
  ],
});
