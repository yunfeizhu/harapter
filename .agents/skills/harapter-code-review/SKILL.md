---
name: harapter-code-review
description:
  Review a Harapter pull request or diff against portable contracts, lifecycle
  semantics, provider evidence, security, tests, and repository governance. Use
  for substantive Harapter code or design review, not ordinary implementation.
---

# Harapter Code Review

Review the live change against its real base. Remain read-only unless the user
separately asks for fixes or external review submission. A local gate review
must run in a context independent from the implementation context.

## Orient the review

- Read root and affected subtree `AGENTS.md` files.
- Establish the exact base and head. For a local branch, inspect the committed,
  staged, unstaged, and untracked task changes as one complete diff; for a pull
  request, inspect the exact current head. Read enough surrounding code to trace
  both sides of each changed interface.
- Read the owning design document, package or provider README, existing Agent
  Note, and tests. A PR description is intent, not the source of truth.

## Review priorities

Prioritize correctness, lifecycle, security, compatibility, and broken public
behavior over style.

For concurrent or asynchronous code, trace settlement, reentrancy, ordering,
shared-state mutation, late events, timeout and cancellation races, and cleanup.
Documentation and policy changes still receive a security review for trust
boundaries, privilege, unsafe interpolation, and merge bypasses.

### Portable contracts

- Core remains provider-agnostic and does not infer behavior from provider IDs.
- Session and run ownership, terminality, retry, cancellation, and disposal are
  explicit.
- Unknown fields and events remain observable without becoming false success.
- Errors retain stable categories and retry semantics with redacted causes.
- Extensions preserve type and namespace ownership instead of arbitrary
  metadata.

### Provider adapters

- The implementation uses a documented public machine interface with a reviewed
  license boundary.
- Capability declarations match executable fixture, conformance, and available
  live evidence.
- Native cancellation, cooperative requests, and connection abort are not
  conflated.
- Runtime version or protocol fingerprint supports the claimed compatibility
  range.
- Startup, callback, stream, process exit, timeout, late event, and disposal
  paths settle once and clean up deterministically.

### Security and data handling

- Prompts, files, secrets, identifiers, environment values, and provider traffic
  are absent or irreversibly redacted in logs, errors, fixtures, and raw events.
- Validation and limits are enforced at the operation or untyped boundary that
  can otherwise bypass them.
- Workflow changes retain least privilege and do not expose secrets to untrusted
  pull request code.

### Evidence and documentation

- Tests would fail for the intended regression and assert observable behavior.
- Conformance covers every declared portable capability; skipped live tests are
  not counted as support evidence.
- Public behavior updates the owning design, README, and exported documentation.
- A non-trivial decision creates or updates one Agent Note without duplicating
  rationale.

## Choose the local pass

The initial local full-diff pass reports every P0 and P1 finding and only P2
findings with a concrete correctness, security, compatibility, or maintenance
benefit worth changing before push. The implementer handles those findings in
one batch and reruns affected evidence.

The independent termination pass reviews the resulting complete diff but reports
only P0 and P1. It must not introduce P2 findings or optional improvements. A P0
or P1 blocks push and invalidates the prior clean gate until the blocker is
repaired, affected evidence is rerun, and termination review is clean. Any
substantive edit after a clean pass also invalidates it.

Hosted review may be requested separately after push, but it is not converted
from model prose into a required status. A native repository review policy, when
configured, owns its own exact-head semantics.

## Report findings

For each actionable finding, state the defect, tight location, impact, and
evidence. Separate blockers from optional improvements. Omit style nits already
enforced by a passing formatter or linter. Label local findings P0, P1, or P2 so
the repair and stopping rules are unambiguous. If no permitted finding is found,
state that the pass is clear, along with remaining unverified risks and checks
observed.
