<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/core</code></h1>

<p align="center"><strong>The provider-agnostic lifecycle and registry at the center of Harapter.</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/v/%40harapter%2Fcore?style=flat-square&amp;label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/dm/%40harapter%2Fcore?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 license"></a>
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/core` is the provider-agnostic TypeScript API for Harapter. It owns
portable contracts and the runtime checks that can be applied without knowing a
Provider identity.

## Use this package when

- your application needs one Client → Session → Run lifecycle across several
  agent harnesses;
- you need capability-based routing without branching on Provider names; or
- you are implementing an Adapter and need the canonical contracts, errors,
  ownership checks, extensions, and native escape hatch.

## Installation

```bash
pnpm add @harapter/core
```

The Provider-free example below also uses the deterministic test package:

```bash
pnpm add -D @harapter/conformance
```

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

## Quick start

The deterministic Fake Provider gives the Core flow executable evidence without
introducing a Provider dependency:

```ts
import { HarnessRegistry } from '@harapter/core';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance';

const registry = new HarnessRegistry();
registry.register(createFakeProviderFactory());

const client = await registry.connect(createFakeProfile());
const session = await client.createSession();

try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'synthetic input' }],
  });

  for await (const event of run.events()) {
    console.log(event.type);
  }

  const result = await run.result();
  console.log(result.status);
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
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

| Package                                                                                                | Documentation                                 |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| [`@harapter/transport-jsonrpc-stdio`](https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio) | [Guide](../transport-jsonrpc-stdio/README.md) |
| [`@harapter/transport-jsonl-process`](https://www.npmjs.com/package/@harapter/transport-jsonl-process) | [Guide](../transport-jsonl-process/README.md) |
| [`@harapter/transport-http-sse`](https://www.npmjs.com/package/@harapter/transport-http-sse)           | [Guide](../transport-http-sse/README.md)      |
| [`@harapter/transport-acp`](https://www.npmjs.com/package/@harapter/transport-acp)                     | [Guide](../transport-acp/README.md)           |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)                         | [Guide](../conformance/README.md)             |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)                     | [Guide](../../providers/codex/README.md)      |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)                         | [Guide](../../providers/dsh/README.md)        |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)                   | [Guide](../../providers/hermes/README.md)     |
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw)               | [Guide](../../providers/openclaw/README.md)   |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode)               | [Guide](../../providers/opencode/README.md)   |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)                           | [Guide](../../providers/pi/README.md)         |
