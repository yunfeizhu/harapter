<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter/conformance</code></h1>

<p align="center"><strong>Reusable lifecycle tests and a deterministic Fake Provider for Harapter.</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 license"></a>
</p>

<!-- markdownlint-enable MD033 -->

This guide describes a module included in the single `harapter` SDK. For
ordinary application setup, start with the
[application guide](../../packages/harapter/README.md). The first single-package
release is pending; the installation commands apply after that release.

`harapter/conformance` provides reusable Vitest behavior checks for Harapter
Provider Adapters and a deterministic Fake Provider. Passing the Fake Provider
suite proves the portable interfaces and test kit; it is not evidence that any
real Provider or runtime is supported.

## Test an application without a Runtime

Use the lightweight `harapter/testing` entrypoint for application tests. It does
not require Vitest at runtime. Install Vitest separately only when using the
conformance suite from `harapter/conformance`. The Fake result is deterministic
test evidence, not evidence about an installed Provider.

```sh
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

Save the following as `app.ts`. It imports only the npm packages installed
above; Node.js 24 can execute this TypeScript directly.

<!-- sdk-example: test-with-fake.ts -->

```ts
import { HarnessRegistry } from 'harapter';
import { createFakeProfile, createFakeProviderFactory } from 'harapter/testing';

// Replace the application's real Adapter at its composition boundary.
const registry = new HarnessRegistry();
registry.register(createFakeProviderFactory());
const client = await registry.connect(createFakeProfile());
try {
  const session = await client.createSession();
  try {
    const run = await session.start({
      parts: [{ type: 'text', text: 'Fictional test input.' }],
    });
    for await (const _event of run.events()) {
      /* Drain even when the test has no renderer. */
    }
    const result = await run.result();
    if (
      result.status !== 'completed' ||
      result.finalMessage !== 'Fictional test input.'
    )
      throw new Error('Application test failed.');
    console.log({ applicationTestPassed: true });
  } finally {
    await session.close();
  }
} finally {
  await client.close();
}
```

```sh
node app.ts
```

[Complete application, recipes and error handling](../../examples/sdk-application/README.md)
· [Harapter on npm](https://www.npmjs.com/package/harapter)

## Use this package when

- you are building or reviewing a Harapter Provider Adapter;
- you want executable evidence for ownership, event ordering, terminal results,
  cancellation, resume, extensions, and cleanup; or
- you need a synthetic Provider for application tests without installing a real
  harness runtime.

## Installation

Install the suite with Vitest 4:

```bash
pnpm add harapter
pnpm add -D vitest@^4.1.11
```

## Portable suite

`definePortableProviderConformanceSuite()` accepts fresh Adapter factory and
Profile producers. It verifies observable behavior through `harapter`:

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
import { definePortableProviderConformanceSuite } from 'harapter/conformance';
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
import { HarnessRegistry } from 'harapter';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from 'harapter/conformance';

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

## Shared interaction suite

`defineInteractionConformanceSuite()` is opt-in. Supply fresh factory/Profile
producers, a synthetic `input`, the observed `kind`, and a non-empty `responses`
array of valid replies. The fixture must request one interaction per Run and
settle after its response; include both approval and denial when offered. Cases
use a two-second Run deadline and always close the Client. They verify observed
capability, event ownership, one resolution, duplicate and foreign-Session
rejection, cancellation strength, and invalidation after connection teardown.
Cancellation may race an authoritative terminal result. Provider fixtures still
own malformed native payloads, expiration, transport acknowledgment, and
protocol ordering tests.

```ts
import { defineInteractionConformanceSuite } from 'harapter/conformance';

defineInteractionConformanceSuite({
  name: 'Example approval fixture',
  createFactory: createApprovalFixtureFactory,
  createProfile: createApprovalFixtureProfile,
  input: { parts: [{ type: 'text', text: 'synthetic approval input' }] },
  kind: 'approval',
  responses: [
    { kind: 'approval', decision: 'approve' },
    { kind: 'approval', decision: 'deny' },
  ],
});
```

The two fixture producers above are supplied by the Adapter's test harness.
Codex, OpenCode, Hermes, OpenClaw, and Pi run this suite with their synthetic
machine-interface fixtures. Pi uses `kind: 'provider'`; DSH does not opt in
because its current adapters do not expose a host response API.

## Fake interactions outside Vitest

`harapter/testing` exports `createFakeProfile`, `createFakeProviderFactory`,
their default identities, and `FakeProviderOptions` without importing Vitest.
Use this public subpath in offline Node demos. The existing package root also
exports these symbols for Vitest consumers.

Set `interaction: { kind: 'approval' }` (or `user_input` / `provider`) to make
each Fake Run emit one request and wait for an explicit response. Optional
request fields are synthetic host fixture data. Without this option,
interactions remain unsupported and the normal echo behavior is unchanged.
Requests use factory-unique Run identities; only the Session handle that started
the Run can respond. Wrong-kind, duplicate, foreign, closed, or expired
responses reject. Approval denial resolves that request and completes the
synthetic Run; it does not mean native Run cancellation. Fake user input accepts
non-empty arrays of text parts; native responses retain their explicit Provider
value.

The observed `run.timeout` mode is `adapter_controlled`.

`RunOptions.timeoutMs` accepts a positive safe integer up to 2,147,483,647.
Expiration emits `interaction.resolved` before `connection.aborted`, releases
waiters, and clears the timer. Native cancellation remains `run.cancelled`. The
[offline interaction example](../../examples/multi-provider-client/interactions.md)
demonstrates this lifecycle without real tools, runtimes, or model calls.

## Related packages

[All packages](../../README.md#packages-on-npm)

| Package                                                                       | Documentation                                 |
| ----------------------------------------------------------------------------- | --------------------------------------------- |
| [`harapter`](https://www.npmjs.com/package/harapter)                          | [Guide](../core/README.md)                    |
| [`harapter/transports/jsonrpc-stdio`](https://www.npmjs.com/package/harapter) | [Guide](../transport-jsonrpc-stdio/README.md) |
| [`harapter/transports/jsonl-process`](https://www.npmjs.com/package/harapter) | [Guide](../transport-jsonl-process/README.md) |
| [`harapter/transports/http-sse`](https://www.npmjs.com/package/harapter)      | [Guide](../transport-http-sse/README.md)      |
| [`harapter/transports/acp`](https://www.npmjs.com/package/harapter)           | [Guide](../transport-acp/README.md)           |
| [`harapter/codex`](https://www.npmjs.com/package/harapter)                    | [Guide](../../providers/codex/README.md)      |
| [`harapter/dsh`](https://www.npmjs.com/package/harapter)                      | [Guide](../../providers/dsh/README.md)        |
| [`harapter/hermes`](https://www.npmjs.com/package/harapter)                   | [Guide](../../providers/hermes/README.md)     |
| [`harapter/openclaw`](https://www.npmjs.com/package/harapter)                 | [Guide](../../providers/openclaw/README.md)   |
| [`harapter/opencode`](https://www.npmjs.com/package/harapter)                 | [Guide](../../providers/opencode/README.md)   |
| [`harapter/pi`](https://www.npmjs.com/package/harapter)                       | [Guide](../../providers/pi/README.md)         |
