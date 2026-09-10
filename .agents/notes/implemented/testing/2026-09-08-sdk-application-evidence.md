# Agent Note: Verify SDK onboarding as an independent application

Status: implemented

## Problem

Workspace references can compile while published-package consumers still lack
working setup, error handling, or lifecycle composition. README examples also
risk drifting from checked source, and requiring a repository build obscures the
first application integration. The existing multilingual entry-document policy
owns language coverage, but does not define executable onboarding evidence.

## Decision

The [SDK application](../../../../examples/sdk-application/README.md) is a
private, copyable Node.js application using the single public SDK. Workspace
linking is development-only; `tsconfig.build.json` defines an independent build.
Application code uses only public exports. Root and public-package entry guides
put complete npm-based calls before contributor setup. The
[multilingual policy](../process/2026-09-02-multilingual-public-design-docs.md)
continues to own synchronized language variants.

The service recipe drains events, preserves authoritative terminal results,
requires observed native cancellation for an explicit AbortSignal, and closes a
failed Client before releasing its Session. Host callbacks receive private
content only inside the application's authorized boundary; terminal output
contains status metadata. Storage ownership and request-specific approval policy
remain application decisions. Offline Fake approval demonstrates terminal input
without pretending that a generic redacted title proves a real command is safe.

The standalone application includes a local copy of the maintained reference
interaction observer. This is example host composition, not a new Core helper or
public package. The package consumer check rejects drift between the two copies;
lifecycle fixes must update both. It also compiles the complete application
against freshly packed public artifacts, exercises offline and
missing-configuration entrypoints, and rejects README entry snippets that differ
from their executable source. Positive and intentionally invalid snippet cases
exercise this validator.

The [Runtime profile example](../../../../examples/runtime-profiles/README.md)
now begins with independent single-file Pi and DSH calls. Marked snippets match
these sources and compile against the public tarball. Missing executable checks
run their real entries with an empty PATH; the installed consumer exercises the
same exported `run()` with DSH, Pi and authenticated OpenCode fixtures. This
keeps protocol and lifecycle composition out of the first application file. The
[single-call decision](../feature/2026-09-09-single-call-run.md) owns the new
facade and its cleanup semantics. Explicit Session composition remains in
`quick-start.ts` and `runtime-config.ts`, with its existing DSH/OpenCode entry
tests, and in the longer `runTask` service recipe.

Fresh-tarball installation outside the Workspace verifies the upcoming public
contract. Historical registry and live evidence belongs to its recorded release;
it does not establish the new bundle. The
[single-package decision](../architecture/2026-09-08-single-application-entry.md)
owns import migration and removal of old release-age exclusions. Offline
fixtures and type checks do not replace official Runtime compatibility evidence.

## Alternatives considered

### Keep onboarding in Workspace references only

This shares more source but cannot establish that an application installs and
builds using published exports alone. Existing references remain useful later in
the documentation for contributors and deeper implementation study.

### Add application orchestration and approval UI to Core

This avoids copying the observer, but would expand the public contract to own
host storage, UI and policy choices. The current task improves integration
examples without changing provider-agnostic runtime contracts.

### Maintain unchecked README snippets separately

Separate prose examples are easy to shorten, but type checking another file
would not catch broken imports or stale calls in the actual copyable entry.
Marked snippets are checked verbatim against executable sources instead.

## Consequences

- Users can start with npm SDKs and a complete service-based project without
  building Harapter. The sample remains private and adds no public package.
- Public-package READMEs retain direct npm package links and repository guides.
  Updated tarball documentation reaches npm only through a later authorized
  release; a documentation PR does not publish it.
- Entry examples intentionally print metadata. Authorized applications receive
  final text and events through return values and callbacks.
- The observer copy adds maintenance work, made explicit by an equality gate.
  Native state remains bound to its original Provider, Profile and storage.
- Copyable application setup replaces the development Workspace dependency with
  the released SDK. Fresh-tarball compilation detects public-export breakage.
