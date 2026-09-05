<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/conformance</code></h1>

<p align="center"><strong>Reusable lifecycle tests and a deterministic Fake Provider for Harapter.</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/v/%40harapter%2Fconformance/next?style=flat-square&amp;label=npm%20next" alt="npm next version"></a>
  <a href="https://www.npmjs.com/package/@harapter/conformance"><img src="https://img.shields.io/npm/dm/%40harapter%2Fconformance?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha status">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/conformance` provides reusable Vitest behavior checks for Harapter
Provider Adapters and a deterministic Fake Provider. Passing the Fake Provider
suite proves the portable interfaces and test kit; it is not evidence that any
real Provider or runtime is supported.

## Use this package when

- you are building or reviewing a Harapter Provider Adapter;
- you want executable evidence for ownership, event ordering, terminal results,
  cancellation, resume, extensions, and cleanup; or
- you need a synthetic Provider for application tests without installing a real
  harness runtime.

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

Use it in application tests without discovering or starting a real runtime:

```ts
import { HarnessRegistry } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';

const registry = new HarnessRegistry();
registry.register(
  createFakeProviderFactory({
    cancelMode: 'native',
    resumeMode: 'native',
    includeUnknownEvent: true,
  }),
);

const client = await registry.connect(createFakeProfile());
const session = await client.createSession();

try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'synthetic input' }],
  });
  const events = [];
  for await (const event of run.events()) events.push(event.type);
  const result = await run.result();
  expect(result.status).toBe('completed');
  expect(events).toContain('provider');
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
}
```

The suite is a development dependency. A passing conformance suite is portable
contract evidence, not live Provider compatibility evidence.
