# Agent Note: One public SDK with internal harness mappings

Status: implemented

## Problem

Applications already share portable Client, Session, Run and event-envelope
contracts, but installing separate Core and Adapter packages exposes Harapter's
implementation layout. The maintainer explicitly chose one public `harapter`
package, private implementation modules, and removal of the twelve old npm
packages after the replacement is usable.

## Decision

The [application entry](../../../../packages/harapter/README.md) bundles Core
and maintained protocol mappings, selects implementations asynchronously, and
returns the existing Registry. Selection stays outside provider-agnostic Core.
Profile validation, connection probes, capabilities, error classes, native
extensions and Session ownership retain their existing contracts. The
[portable boundaries note](2026-08-26-portable-core-and-provider-boundaries.md)
owns those invariants. Event envelopes are portable; Adapter-owned `event.data`
payloads do not become one universal text or tool schema.

Core, six Adapters, four transports and conformance remain independently tested
private Workspace modules. They have no public publication configuration. The
single public SDK exposes native factories and extensions through harness
subpaths, transports through `harapter/transports/*`, conformance through
`harapter/conformance`, and the lightweight Fake through `harapter/testing`.
These serve existing application, native Gateway and test consumers; they are
not separate packages. All examples migrate to these public imports together.

Pinned Rolldown bundles the maintained sources into shared ESM chunks, including
one Core implementation for error identity and contracts. Only `ws` remains a
runtime dependency. Vitest is an optional peer needed only by the conformance
entry. The compiler emits declarations for internal modules; an AST-based
relocator rewrites their import/export and import-type references into one local
declaration graph. It rejects undeclared Harapter imports without changing
string-literal types. Public subpath declarations reference that same graph.
Generated output is replaced before each build, preventing stale chunk leakage.

Host applications install and authenticate their own Runtimes. They provide
connection Profiles and optional HTTP-header or DSH Gateway-cookie resolvers.
Selection does not probe credentials, discover installations, start processes or
change policy. Selection and resolver references are snapshotted before loading;
prototype methods retain their original receiver, including private host state.
Initialization failures discard native diagnostics and expose only a safe
category and harness name.

Only `harapter` enters the public-package policy and Release Please version
files. Internal manifest versions are build metadata, not release trains. No
version, tag or changelog is manually created. The unscoped name requires exact
tarball naming and npm package-URL handling. npm requires a package to exist
before trusted-publisher setup, so the protected immutable-tag workflow permits
a short-lived creation credential only for the single `harapter` policy entry.
It accepts an absent name or a retry with only the same release version; another
version, package, or unknown registry state rejects bootstrap. Immutable
content, `latest` and provenance remain mandatory, including retries. OIDC
remains the normal publication path. See
[RELEASING.md](../../../../RELEASING.md).

The maintainer authorized deleting all twelve old scoped npm packages. This is
an intentional retirement, not ordinary rollback or an implicit deprecation.
Registry removal remains pending until the replacement is released and verified.
Check [npm unpublish eligibility](https://docs.npmjs.com/policies/unpublish/)
then remove dependent packages before their shared dependencies. If npm refuses
removal, report the exact restriction; do not claim deletion or silently
substitute deprecation. Existing immutable GitHub Releases remain historical
artifacts. Removing npm versions is irreversible and cannot republish the same
name/version pair.

## Alternatives considered

### Add a thirteenth public package depending on all Adapters

This gives one import but preserves all public release units and transitive
Adapter installations. It does not meet the explicitly chosen distribution
boundary.

### Optional Adapter peers installed per harness

This limits installed mappings but still makes applications manage one Harapter
dependency per Runtime. The chosen single tarball instead contains all small
first-party mappings; dynamic selection changes loading, not download size.

### Install Runtimes or infer arbitrary Runtime objects

Runtime tools, credentials, state and policy belong to the host. Harapter needs
an implemented official machine-interface mapping, not guessed method names or
another Agent Loop.

### Copy implementations or bundle separate Core copies

Copies diverge from fixtures and can split error-class identity. Shared sources,
chunks and declarations preserve one contract implementation across subpaths.

## Consequences

- This is a breaking packaging migration: replace old dependencies and imports
  together. No old-name compatibility aliases or independently published modules
  remain in the source. Native state still requires its original compatible
  Provider and Profile; packaging does not make checkpoints portable.
- Guides distinguish the local implementation from its pending first npm release
  and pending registry retirement. The replacement release and deletion are
  separate actions; source edits do not prove either external outcome.
- Focused tests reuse one business function across DSH process and authenticated
  OpenCode HTTP fixtures and pin ownership, capability differences, lazy
  loading, resolver receivers, mutation isolation and redacted errors.
- Package checks install only the SDK tarball outside the Workspace, verify
  every public subpath's runtime and types, reject standalone-module runtime
  dependencies, exercise both protocols and compile the complete applications.
  An ordinary consumer requires neither private modules nor Vitest.
- Development TypeScript configurations resolve source; build configurations
  resolve public artifacts. Full evidence starts without prebuilt `dist` to
  catch cold lint/type resolution failures. Existing conformance remains the
  Provider behavior gate. These checks establish no new credentialed live claim.
