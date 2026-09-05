# Harapter Portable Packages Agent Guide

These rules supplement the repository-wide [Agent Guide](../AGENTS.md) for
portable packages under `packages/`.

## Package boundaries

- `schema` owns versioned wire and persisted data definitions without importing
  a provider SDK.
- `core` owns portable clients, sessions, runs, events, interactions,
  capabilities, errors, and extension dispatch.
- `transport-*` packages move canonical messages and lifecycle signals; they do
  not reinterpret provider semantics.
- `conformance` owns reusable behavioral tests. It must depend on public
  contracts rather than provider internals.
- Shared utilities must have at least two current consumers or a demonstrated
  cross-package contract. Do not create speculative abstraction packages.

Core, schema, transport, and conformance code must not branch on provider IDs or
import packages from `providers/`.

## Contract changes

- Start with the owning design document and an Agent Note for non-trivial public
  changes.
- Specify additive, breaking, optional, and unknown-field behavior explicitly.
- Use discriminated unions for closed portable states and preserve an explicit
  unknown path for upstream-extensible values.
- Keep stable identifiers opaque and typed. Never assign meaning by parsing a
  provider-native identifier.
- State ownership and terminality for every resource and operation. A run has
  one terminal result; a transport closure alone does not prove that result.
- Public errors expose a stable category and retry semantics while retaining a
  redacted provider cause for diagnostics.
- Runtime validation belongs at process, network, durable-data, configuration,
  and untyped extension boundaries. Do not duplicate validation at a trusted
  same-process TypeScript boundary without evidence.

## Testing

- Unit tests pin state transitions, capability evaluation, error mapping, and
  cleanup behavior.
- Conformance tests exercise only declared portable behavior and must be
  reusable across providers.
- Add negative cases for malformed boundary input, duplicate terminal events,
  late events, timeout, cancellation, disposal, and unknown upstream values when
  the changed contract can encounter them.
- Tests assert externally observable events, results, state, and cleanup rather
  than private implementation structure.
- Public exports, package metadata, ESM entrypoints, and Node compatibility need
  a built consumer smoke test before publication.

## Documentation

Each published package owns a synchronized README triad: `README.md` is English,
`README.zh-CN.md` is Simplified Chinese, and `README.ja.md` is Japanese. Every
variant links to its two siblings and describes the package purpose, when to use
it, installation, a minimal example, public entrypoints, configuration,
lifecycle, errors, and limitations. Keep canonical identifiers and code exact in
every language. Package all three variants and update them together when public
behavior changes.
