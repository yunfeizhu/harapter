# Agent Note: Codex App Server runtime identity

Status: implemented

## Problem

The Codex App Server `initialize` response exposes the user agent it will send
upstream. Its leading product name can come from the initialized client's
`clientInfo.name` or from a process-level originator. A fixed list of product
names therefore cannot identify the stable protocol or determine whether the
response belongs to Codex.

Harapter still needs a non-sensitive Runtime version for diagnostics and Session
compatibility evidence, while malformed handshakes must fail before a Session is
created.

## Decision

The Codex Adapter establishes Provider identity from its registered factory and
the configured Profile, not from the user-agent product name. During the stable
App Server handshake it:

- validates `userAgent`, `codexHome`, `platformFamily`, and `platformOs` as the
  required initialize response fields;
- extracts a semantic Runtime version from the leading user-agent product token
  without requiring a Codex-branded product name;
- bounds the product name and complete user-agent length and rejects line
  breaks;
- keeps the extracted version as diagnostic and Session compatibility evidence,
  not as an executable-version allowlist; and
- rejects missing or malformed required structure as
  `provider_api_incompatible`.

The synthetic fixture set includes the client-selected `harapter` originator.
The trusted live canary installs the current stable Runtime and exercises the
same handshake and lifecycle.

Public details remain in the
[Codex Adapter README](../../../../providers/codex/README.md), with synthetic
evidence in the
[stable App Server fixtures](../../../../fixtures/codex/app-server-stable/manifest.json).

## Alternatives considered

### Accept only known Codex product names

This couples compatibility to presentation metadata that the official Runtime
allows the initializing client or host process to select. It rejects a valid
stable handshake without finding a protocol incompatibility.

### Drop Runtime version diagnostics

This avoids user-agent parsing but removes useful non-sensitive evidence from
descriptors, Session references, support reports, and drift investigations.

### Allow only exact Codex executable versions

An allowlist would reject structurally compatible current releases and would
make an executable version substitute for Schema and lifecycle evidence.

## Consequences

- Client-selected and host-selected originator names can use the stable Adapter
  when the required initialize response remains valid.
- Provider identity and capability claims remain independent of user-agent
  branding.
- The Runtime version remains available without storing the complete user agent
  or `codexHome` path.
- A Runtime that removes the leading semantic version, exceeds the bounds, or
  changes a required field fails closed until its interface is reviewed.
- Fixture, protocol, Adapter, conformance, and current-release live evidence are
  required when this handshake contract changes.
