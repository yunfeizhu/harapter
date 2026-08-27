# Harapter Provider Agent Guide

These rules supplement the repository-wide [Agent Guide](../AGENTS.md) for
provider adapters under `providers/`.

## Acceptance boundary

A provider is supported only when the pull request includes all of the
following:

- an official, documented machine interface and a reviewed license boundary;
- runtime identity and a declared compatibility range or protocol fingerprint;
- mappings for session, run, event, interaction, capability, error, and cleanup
  behavior;
- redacted, deterministic fixtures for every declared portable capability;
- the shared conformance suite and provider-specific negative tests;
- live-runtime evidence for behavior that fixtures cannot establish;
- a provider README covering installation, authentication ownership,
  limitations, extensions, and native access.

Popularity, naming similarity, CLI output scraping, or an architecture table is
not acceptance evidence.

## Implementation rules

- Use only public SDKs, APIs, and machine protocols. If an upstream private
  interface is unavoidable for research, keep it out of a supported package and
  do not make compatibility claims from it.
- Keep upstream terminology inside the adapter. Translate only semantics that
  have a portable equivalent; expose the rest through typed extensions or native
  access.
- Probe capabilities from the connected runtime and configuration. Do not infer
  them from the provider name or adapter version alone.
- Preserve session ownership. Resume only with the provider, profile, native
  identifier, and compatibility conditions that created the session.
- Separate native run cancellation from cooperative cancellation and whole
  connection abort. Advertise only the strongest behavior demonstrated by the
  interface and tests.
- Contain subprocess callbacks, stream errors, and late messages. Startup,
  readiness, run settlement, cancellation, and disposal each need an explicit
  owner and deterministic cleanup.
- Publish terminal success only from an authoritative upstream result. Process
  exit, EOF, or an unrecognized message cannot become success by default.
- Preserve unknown upstream messages in a bounded raw event after redaction. Raw
  events must not bypass size, secret, or user-content controls.
- Fail misconfiguration at connection creation when possible. Report unsupported
  behavior through capability or stable error contracts rather than silent
  fallback.

## Fixtures and live evidence

- Follow [fixture rules](../fixtures/AGENTS.md). Record provenance without user
  content or credentials.
- Test supported, unsupported, malformed, timeout, cancellation, restart,
  disposal, and upstream-version mismatch paths relevant to the adapter.
- A live test may self-skip only when its documented credential or runtime is
  unavailable. The skipped result is not evidence for a compatibility claim.
- Store the exact runtime version or protocol fingerprint with live evidence.
  Revalidate the declared range when upstream behavior changes.

Use the
[`$harapter-provider-implementation`](../.agents/skills/harapter-provider-implementation/SKILL.md)
workflow for new providers and material compatibility changes.
