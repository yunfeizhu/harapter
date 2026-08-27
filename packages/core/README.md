# `@harapter/core`

`@harapter/core` is the provider-agnostic TypeScript API for Harapter. It owns
portable contracts and the runtime checks that can be applied without knowing a
Provider identity. The package is private and versioned `0.0.0` while the
pre-alpha API is exercised against real Provider Adapters.

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

## Example

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
const run = await session.start({
  parts: [{ type: 'text', text: 'synthetic input' }],
});

for await (const event of run.events()) {
  console.log(event.type);
}

const result = await run.result();
await session.close();
await client.close();
```

## Limitations

- No Provider Adapter, transport, canonical wire schema, persistence layer, or
  runtime installer is included.
- Core defines event ordering and terminality but does not buffer, redact, or
  reinterpret Provider streams. Each Adapter and transport must prove bounded
  buffering, redaction, and terminal mapping.
- Interaction, artifact, usage, resume, cancellation, and other optional
  behavior depend on the active Capability Manifest.
- Package exports and versions are not publication-ready. Publication remains
  disabled until real Provider conformance and consumer packaging evidence
  exist.

The complete target contract remains in the
[API design](../../docs/design/api-design.md).
