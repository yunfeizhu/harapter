---
name: harapter-provider-implementation
description:
  Implement or materially update a Harapter provider adapter from an official
  harness machine interface, including mappings, capabilities, fixtures,
  conformance, compatibility evidence, and documentation. Do not use for
  portable Core features.
---

# Harapter Provider Implementation

Build a provider package whose support claims are no stronger than its evidence.
Read [provider rules](../../../providers/AGENTS.md), the
[adapter guide](../../../docs/design/provider-adapter-guide.md),
[compatibility design](../../../docs/design/compatibility.md), and
[fixture rules](../../../fixtures/AGENTS.md) before editing.

## Establish the upstream contract

1. Identify the official SDK, RPC, HTTP, streaming, or headless interface and
   its license. Do not treat interactive CLI text or private implementation
   details as a supported protocol.
2. Record installation and authentication ownership, runtime identity, version
   or protocol fingerprint, session model, run lifecycle, events, interactions,
   cancellation, result, error, and disposal behavior.
3. Separate behavior observed in documentation, fixtures, and a live runtime.
   Mark unknowns rather than filling them with assumptions.
4. Create or update an Agent Note for a new mapping or material compatibility
   decision.

## Design the mapping

- Map upstream concepts to canonical sessions, runs, events, interactions,
  capabilities, and errors.
- Keep provider-only behavior in typed extensions or explicit native access.
- Define session ownership and resume validation.
- Classify cancellation as native, cooperative, connection abort, or
  unsupported.
- Define one authoritative terminal-result source and the behavior for EOF,
  process exit, timeout, malformed messages, and unknown events.
- Define bounded redaction before any raw event, fixture, log, or error is
  stored.

## Implement with lifecycle ownership

Keep SDK imports and upstream terms inside the provider. Give startup,
readiness, each run, cancellation, and disposal explicit settlement and cleanup.
Contain callback exceptions and late messages. Fail invalid configuration before
sending provider traffic when possible.

## Prove the support claim

Add synthetic or irreversibly redacted fixtures for every declared capability.
Run shared conformance and provider-specific negative tests for relevant
malformed input, timeout, unsupported behavior, cancellation, restart, version
mismatch, and disposal paths. Run live tests when the documented credential and
runtime are available; record the exact version or fingerprint. A skip is not
evidence.

## Complete the provider contract

The provider README documents prerequisites, authentication ownership,
compatibility range, capability mapping, limitations, extensions, native access,
and verification. Update the provider matrix only after implementation and
evidence exist. Use [`$harapter-pre-push`](../harapter-pre-push/SKILL.md) before
an authorized push.
