<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>harapter</code></h1>

<p align="center"><strong>The provider-agnostic lifecycle and registry at the center of Harapter.</strong></p>

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

`harapter` is the provider-agnostic TypeScript API for Harapter. It owns
portable contracts and the runtime checks that can be applied without knowing a
Provider identity.

## Quick start in an application

Connect Core to a real Adapter in your application. The complete Codex example
below uses published packages; no test Provider or repository build is needed.
Install and authenticate Codex separately, then supply `HARAPTER_CODEX_COMMAND`
and an absolute `HARAPTER_WORKSPACE`.

```sh
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

### Configuration supplied by the host

| Variable                 | Value                                                  |
| ------------------------ | ------------------------------------------------------ |
| `HARAPTER_CODEX_COMMAND` | Installed, authenticated Codex executable, e.g. codex. |
| `HARAPTER_WORKSPACE`     | Absolute path to an existing, empty test directory.    |

Secrets remain in the Runtime or host environment, never in source code or
Session references. Use an empty test Workspace and a host-reviewed
no-tools/read-only configuration for this first call.

Run `node app.ts` after providing the configuration below. Events are consumed
continuously, the final text is available as `result.finalMessage`, and cleanup
always runs. Metadata goes to stdout; route content only to an authorized
application response. A model call may consume tokens and create native Session
state.

<!-- sdk-example: quick-codex.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from 'harapter';
import { CODEX_PROVIDER_ID, createCodexProviderFactory } from 'harapter/codex';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createCodexProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-codex'),
    providerId: CODEX_PROVIDER_ID,
    displayName: 'Application codex',
    connection: {
      kind: 'process',
      command: required('HARAPTER_CODEX_COMMAND'),
      args: ['app-server', '--stdio'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({
      workspace: { uri: pathToFileURL(workspace).href },
      providerOptions: {
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
      },
    });
    const run = await session.start(
      {
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
          },
        ],
      },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      if (event.type === 'interaction.requested')
        throw new Error('Configure an explicit host interaction handler.');
      console.log({ type: event.type, sequence: event.sequence });
    }
    const result = await run.result();
    // Use result.finalMessage in your authorized application UI or response.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
    });
    if (result.status !== 'completed') process.exitCode = 1;
  } finally {
    // Client shutdown also releases an active Run if application event handling fails.
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

void main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
```

[Complete application, recipes and error handling](../../examples/sdk-application/README.md)
· [Harapter on npm](https://www.npmjs.com/package/harapter)

## Use this package when

- your application needs one Client → Session → Run lifecycle across several
  agent harnesses;
- you need capability-based routing without branching on Provider names; or
- you are implementing an Adapter and need the canonical contracts, errors,
  ownership checks, extensions, and native escape hatch.

## Installation

```bash
pnpm add harapter
```

The offline example uses `harapter/testing`, included in the same SDK without
Vitest.

## Public entrypoints

- `HarnessRegistry` dynamically registers Adapter factories and connects host
  Profiles.
- `HarnessClient`, `HarnessSession`, and `HarnessRun` define the portable
  lifecycle.
- `HarnessEvent` and `RunResult` define ordered events and one terminal result.
- `CapabilityManifest` distinguishes `native`, `emulated`, `adapter_controlled`,
  `unsupported`, and `unknown`; a missing key means the active Adapter does not
  recognize that capability name.
- `HarnessError` carries a stable category and an explicit retry decision.
- `ExtensionRegistry` provides typed, Provider-bound extension lookup.
- `native()` exposes an explicit Provider-bound escape hatch.
- `assertSessionOwnership()` rejects a Session reference whose Provider or
  Profile differs from the active Client before resume traffic is sent.
- `assertSessionCompatibility()` rejects a Session reference whose runtime or
  protocol fingerprint differs from the active Client.

`HarnessRegistry.connect()` checks the registered connection kind, Client
descriptor identity, and Capability Manifest identity on every connection, then
checks any requested capability modes. `CapabilityRequirement.acceptedModes`
defaults to `native`; a host must opt in to weaker modes explicitly. Registry
validation uses an isolated Profile snapshot so an Adapter cannot rewrite the
requested identity or requirements. Once a Client exists, descriptor or
capability probe failures close it before a safe portable error is returned.

## Lifecycle

A `SessionRef` remains bound to the Provider and Profile that created it. Core
does not inspect `providerState`, parse Provider-native identifiers, migrate
checkpoints, or infer resume support.

A Run event sequence is monotonic and ends in exactly one of `run.completed`,
`run.cancelled`, `run.failed`, or `connection.aborted`. A connection or process
abort is not native Run cancellation. Native, emulated, and Adapter-controlled
cancellation return distinct results. Adapters own event production and
terminal-result mapping; the shared conformance package checks these obligations
through the public interfaces.

`close()` is asynchronous and must be idempotent. A Client rejected during
Registry validation is closed before the validation error is returned. Cleanup
failure is reported as `connection_failed` without attaching an unredacted
cause.

## Errors and sensitive data

Every `HarnessError` requires callers to state `retryable`; Core does not infer
retry behavior from a Provider name or error message. Provider causes and
details must be redacted before an Adapter attaches them. Hosts should not log
`cause`, `providerState`, raw events, or Provider results by default.

Profiles carry Secret references, not credential values. Credential resolution,
runtime installation, authentication, process policy, and product persistence
remain host or Provider responsibilities.

## Offline Core example

The deterministic Fake Provider gives the Core flow executable evidence without
introducing a Provider dependency:

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

Replace the Fake Provider with an
[implemented Adapter](../../providers/README.md) in an application. The
Registry, Client, Session, Run, Event, and Result flow stays the same.

## Limitations

- No Provider Adapter, transport, canonical wire schema, persistence layer, or
  runtime installer is included.
- Core defines event ordering and terminality but does not buffer, redact, or
  reinterpret Provider streams. Each Adapter and transport must prove bounded
  buffering, redaction, and terminal mapping.
- Interaction, artifact, usage, resume, cancellation, and other optional
  behavior depend on the active Capability Manifest.
- Public packages use the default npm `latest` channel. The 0.x API may contain
  breaking changes before 1.0.

The complete target contract remains in the
[API design](../../docs/design/api-design.md).

## Related packages

[All packages](../../README.md#packages-on-npm)

| Package                                                                       | Documentation                                 |
| ----------------------------------------------------------------------------- | --------------------------------------------- |
| [`harapter/transports/jsonrpc-stdio`](https://www.npmjs.com/package/harapter) | [Guide](../transport-jsonrpc-stdio/README.md) |
| [`harapter/transports/jsonl-process`](https://www.npmjs.com/package/harapter) | [Guide](../transport-jsonl-process/README.md) |
| [`harapter/transports/http-sse`](https://www.npmjs.com/package/harapter)      | [Guide](../transport-http-sse/README.md)      |
| [`harapter/transports/acp`](https://www.npmjs.com/package/harapter)           | [Guide](../transport-acp/README.md)           |
| [`harapter/conformance`](https://www.npmjs.com/package/harapter)              | [Guide](../conformance/README.md)             |
| [`harapter/codex`](https://www.npmjs.com/package/harapter)                    | [Guide](../../providers/codex/README.md)      |
| [`harapter/dsh`](https://www.npmjs.com/package/harapter)                      | [Guide](../../providers/dsh/README.md)        |
| [`harapter/hermes`](https://www.npmjs.com/package/harapter)                   | [Guide](../../providers/hermes/README.md)     |
| [`harapter/openclaw`](https://www.npmjs.com/package/harapter)                 | [Guide](../../providers/openclaw/README.md)   |
| [`harapter/opencode`](https://www.npmjs.com/package/harapter)                 | [Guide](../../providers/opencode/README.md)   |
| [`harapter/pi`](https://www.npmjs.com/package/harapter)                       | [Guide](../../providers/pi/README.md)         |
