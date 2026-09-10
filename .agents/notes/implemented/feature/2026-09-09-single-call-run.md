# Agent Note: Run a single task through the application entry

Status: implemented

## Problem

One install and one import still left first-time users assembling Provider and
Profile IDs, protocol arguments, authentication resolvers, event consumption and
cleanup. Moving that composition into an application configuration file reduced
the first code block but did not remove the integration work.

## Decision

The public [Harapter entry](../../../../packages/harapter/README.md) adds
`run(request)` for one text task and retains the Registry, Client, Session and
Run APIs for stateful applications. The facade lives outside provider-agnostic
Core and composes the existing six protocol implementations. It does not create
an Agent Loop, install Runtimes, provision accounts or change Runtime policy.
The
[single-package decision](../architecture/2026-09-08-single-application-entry.md)
continues to own packaging and explicit low-level composition.

Known local machine-interface commands and HTTP loopback endpoints are SDK
presets. Explicit command/argument or URL/header overrides are application
configuration. Local calls use the calling process's working directory unless an
override is supplied. An HTTP workspace override must be an absolute server-side
directory; the helper does not send the local default directory to a remote
service. Executable lookup uses absolute PATH entries or an explicit path, never
a shell or an implicit current-directory search. Missing executables produce a
safe actionable error without installation or filesystem diagnostics.

Model routing is explicit where the implemented interface requires it: DSH
initialization and an OpenCode model override need both Provider and model ID.
There is no invented model default or native configuration-file parser. Other
optional fields are translated only where the existing Adapter supports them;
unsupported settings reject rather than disappear. Header values remain in a
private resolver closure and are never attached to the Profile or Session.
Options and nested connection values are snapshotted before asynchronous work.

Each call owns a fresh Client and Session. It drains the bounded event stream,
optionally forwards events to a host callback, and returns the authoritative
`RunResult`, including non-completed outcomes. The callback may be asynchronous;
its failure is redacted. Interactive requests fail closed and point callers to
the Session API instead of silently approving or inventing an approval UI.

The whole-call deadline includes initialization and host event callbacks.
Deadline expiry rejects with `timeout` and closes owned handles; it is not
native cancellation. A Client or Session arriving after expiry is disposed
without starting further task work. A host promise already executing cannot be
forcibly cancelled, but it cannot cause further event forwarding after the call
stops. Cleanup may take the Adapter's bounded shutdown time beyond the task
deadline. Successful Runs release Sessions before closing their Client,
preserving native close operations that need a connection. Failure cleanup
closes the Client first so active Runs cannot prevent Session cleanup. Cleanup
never masks a primary failure; failed cleanup after a successful call rejects
safely.

The same Runtime configuration also powers `openSession()` and its `send()`
helper for multi-turn chat. The facade preserves Core's Session interface and
exposes its owned Client for advanced controls. Closing the chat closes that
Client too. Send deadlines include host observers; failures close owned handles
and never imply native cancellation. Local invalid input and overlapping sends
reject before Provider traffic.

The default selectors remain unchanged. Explicit bindings expose existing DSH
Gateway and OpenClaw host Gateway session controls, preserving protocol/store
attestations, authentication closures and OpenClaw Profile identity. OpenClaw
still runs over ACP. Pi's optional embedded SDK follows its separate
[compatibility decision](../compatibility/2026-09-09-pi-embedded-sdk.md). A host
reuses a small Runtime configuration object; no global mutable registry,
mandatory configuration file or per-harness Harapter import is introduced. DSH
protocol metadata is duplicated only as a type-checked literal in the public
entry, avoiding eager loading of the Provider merely to read a constant.

## Alternatives considered

### Require a copied Runtime configuration module

That remains useful for advanced application composition but asks every user to
repeat known protocol and lifecycle details. It does not meet the requested
single-call onboarding experience.

### Replace the portable Session API with completion-only semantics

This would remove multi-turn ownership, resume, native extensions and host
interaction control. The new function is an additional application convenience,
not a replacement for stateful contracts.

### Guess models or install and authenticate missing Runtimes

The selected Runtime owns credentials, model configuration, permissions and
licensing. Guessing a model would route work unpredictably; implicit
installation or policy changes would exceed the adaptation boundary. Necessary
model or endpoint choices remain small direct call parameters.

## Consequences

- The addition is a minor public API feature. Existing low-level consumers keep
  their current contract and no compatibility aliases or extra packages appear.
- Every call creates fresh native Session state. Closing handles does not delete
  persisted history, transfer it to another harness or make external work stop
  natively. Applications needing reuse retain their Session explicitly.
- Fixture tests cover all six existing implementations through the same entry,
  configuration rejection, native outcomes and cleanup. Separate lifecycle tests
  cover deadline races and asynchronous observers. Public tarball consumers
  exercise the exported entry without Workspace aliases.
- README snippets are checked against maintained executable sources. The full
  application recipe and API reference remain separate from the small initial
  example. No fixture result is promoted to new live Runtime compatibility
  evidence, and the new export is unreleased until an authorized release.
