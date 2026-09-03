# `@harapter/conformance`

`@harapter/conformance` provides reusable Vitest behavior checks for Harapter
Provider Adapters and a deterministic Fake Provider. Passing the Fake Provider
suite proves the portable interfaces and test kit; it is not evidence that any
real Provider or runtime is supported.

## Installation

Install the suite with Vitest 4:

```bash
pnpm add -D @harapter/conformance@next vitest@^4.1.11
```

## Portable suite

`definePortableProviderConformanceSuite()` accepts fresh Adapter factory and
Profile producers. It verifies observable behavior through `@harapter/core`:

- Client descriptor and Capability Manifest identity;
- Session and Run ownership;
- monotonic event sequence, stable event identities, and one terminal event;
- acceptance of sparse increasing sequence values and rejection of events after
  the terminal event;
- agreement between terminal event and `RunResult`;
- cancellation no stronger than the declared mode;
- connection abort distinct from native cancellation;
- native Session references resumed through a new Client on the same Profile,
  with distinct native Session identities and Provider, Profile, and declared
  runtime compatibility mismatches rejected before resume behavior;
- Provider-bound extensions and native access;
- idempotent Client cleanup.

Every shared case closes its connected Client in a `finally` path so an
assertion failure cannot intentionally leave a Provider process or connection
owned by the test. `validatePortableRunTrace()` is also exported for focused
fixture and mapping tests.

Provider packages add this suite to their own fixture and live-runtime tests.
The suite does not replace protocol parsing, malformed-input, compatibility,
redaction, timeout, race, or Provider-specific lifecycle evidence.

```ts
import { definePortableProviderConformanceSuite } from '@harapter/conformance';
import { createAdapterFactory, createTestProfile } from './test-support.js';

definePortableProviderConformanceSuite({
  name: 'Example Provider',
  createFactory: createAdapterFactory,
  createProfile: createTestProfile,
});
```

## Fake Provider

`createFakeProviderFactory()` and `createFakeProfile()` provide deterministic,
synthetic behavior for Core consumers. Configuration can enable or reject native
cancellation and resume, expose emulated or Adapter-controlled cancellation,
leave cancellation missing or unknown, control native access, and emit an
unknown Provider event with an optional safe raw payload.

The Fake Provider keeps all data synthetic, permits one active Run per Session,
supports text only, and settles active Runs as `connection_aborted` when its
Client closes. It exposes a typed echo extension and a native test object so
hosts can exercise both Provider-bound escape paths without a Provider SDK.
Factory-scoped native Session state survives individual Client cleanup, so the
suite can exercise a SessionRef round trip through a fresh Client without
allowing two native Sessions to collide.

The suite is a development dependency. A passing conformance suite is portable
contract evidence, not live Provider compatibility evidence.
