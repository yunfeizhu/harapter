# Harapter Agent Guide

This file defines repository-wide instructions for coding agents. Read the
nearest subtree `AGENTS.md` before changing files in that subtree.

## Source of truth

- Implemented behavior is defined by source, schemas, tests, and released
  artifacts.
- Target behavior that has not shipped is defined by reviewed documents in
  [`docs/design/`](docs/design/README.md).
- The reason for a non-trivial decision belongs in an
  [Agent Note](.agents/notes/README.md), including alternatives and
  consequences.
- Package and provider READMEs own their public runtime contracts once the
  corresponding implementation exists.
- A provider matrix entry is not support. Support requires an implementation,
  redacted fixtures, conformance evidence, and a declared compatibility range.

## Instruction map

- [Agent-owned repository resources](.agents/AGENTS.md)
- [Agent Note authoring rules](.agents/notes/AGENTS.md)
- [Repository Skill authoring rules](.agents/skills/AGENTS.md)
- [Documentation rules](docs/AGENTS.md)
- [Portable package rules](packages/AGENTS.md)
- [Provider implementation rules](providers/AGENTS.md)
- [Fixture rules](fixtures/AGENTS.md)
- [Example rules](examples/AGENTS.md)
- [Automation rules](.github/AGENTS.md)
- [Repository script rules](scripts/AGENTS.md)
- [Daily development workflow](docs/development.md)

## Architecture invariants

- Core is provider-agnostic. It must not import provider SDKs, branch on
  provider names, or infer capabilities from identity.
- Portable contracts cover clients, sessions, runs, events, interactions,
  capabilities, errors, and provider extensions. Provider-native behavior stays
  in typed extensions or an explicit native escape hatch.
- Sessions remain bound to the provider, connection profile, and native state
  that created them. Harapter never implies checkpoint portability.
- Capabilities describe observed runtime behavior. Missing, unknown, emulated,
  and native support are distinct states.
- A process or connection abort is not native run cancellation. Adapters must
  report the lifecycle semantics they can actually prove.
- Unknown upstream events remain observable through a bounded, redacted raw
  channel. Never guess an unknown event into a successful terminal result.
- Harapter does not implement an agent loop, install provider runtimes, own host
  task storage, or silently change a host application's security policy.

## Working rules

- Inspect `git status --short --branch` before editing. Preserve unrelated user
  changes and stop if safe isolation is not possible.
- Prefer `rg` and `rg --files` for discovery. Read the owning design, note,
  package README, and tests before changing a public contract.
- Choose the intended pull request Conventional Commit type before creating a
  task branch. A non-bot branch starts with that same type, such as `docs/` for
  a `docs:` pull request. This repository rule overrides tool or agent defaults:
  do not prepend `codex/` or another owner namespace.
- Keep one logical task per short-lived branch. Do not work directly on `main`
  or create a long-lived `develop` branch.
- Use test-driven changes for executable behavior. A regression fix begins with
  evidence that fails for the reported behavior.
- Before push, finish the implementation and all risk-matched tests, then ask an
  independent model to review the complete task diff for correctness, security,
  lifecycle, and race conditions. The first pass reports every P0 and P1 plus
  only P2 findings whose benefit justifies another change.
- Repair the first-pass findings once as a batch, rerun affected evidence, and
  obtain an independent termination review that reports only P0 and P1. A
  blocker requires another repair, affected tests, and P0/P1 termination review;
  a substantive post-review edit invalidates the clean result. Do not start a
  new P2 cycle during termination review.
- Update contracts before producers and consumers when public data changes.
- Add or update an Agent Note in the same pull request for non-trivial API,
  architecture, lifecycle, compatibility, security, testing, or process
  decisions.
- Do not add compatibility shims without a supported consumer, a removal
  condition, and explicit compatibility evidence.
- Do not print or commit prompts, file bodies, credentials, tokens, cookies,
  authorization headers, environment values, private paths, or unredacted
  provider traffic.
- Do not commit, push, publish, merge, create external resources, or change
  GitHub settings unless the user explicitly authorizes that action.

## Evidence and verification

Match verification to the changed surface rather than reflexively running every
future suite:

- documentation and Agent Notes: formatting, Markdown, links, Agent governance,
  and repository checks;
- portable contracts or Core behavior: focused unit tests, type checks, and the
  shared conformance suite;
- transports and process lifecycle: focused protocol, timeout, cancellation,
  disposal, and malformed-input tests;
- provider behavior: redacted fixtures, declared capability tests, shared
  conformance, and live-runtime evidence when credentials are available;
- package exports or build configuration: build, package-consumer smoke tests,
  and publication checks;
- workflow or release changes: syntax validation, least-privilege review, and a
  safe event-path test.

Run `pnpm check` before requesting the initial independent review. Use
[`$harapter-pre-push`](.agents/skills/harapter-pre-push/SKILL.md) before an
authorized push and report exactly which additional checks ran or were not
applicable. A passing command is evidence only for the surface it exercises.

## Code Review Rules

### Portable truth

- Flag provider identity checks, provider SDK imports in Core, or capability
  claims without fixture and conformance evidence as P1.
- Flag code that converts unknown events into success, conflates connection
  abort with native cancellation, or allows a session to change owners as P1.

### Security and automation

- Flag prompt, file, secret, environment, private-path, or unredacted provider
  data exposure as P1; use P0 when exploitation can affect published artifacts
  or credentials broadly.
- Flag privileged workflows that execute a pull request head, mutable Action
  references, or merge paths that can bypass required checks as P1.
- Mechanical formatting belongs in deterministic CI, not model findings.

## Git, pull requests, and releases

- Follow the branch, DCO sign-off, Conventional Commit, pull request, and squash
  workflow in [`docs/development.md`](docs/development.md).
- Pull request titles become squash commit messages and therefore determine
  release impact. Keep the title accurate at merge time.
- Never merge with failed, cancelled, or missing checks that apply to the diff.
- Keep merge gates deterministic. Do not parse model prose into required commit
  statuses or build an automatic repair loop around review comments. A hosted
  Codex review is supplemental unless a native repository review policy is
  explicitly configured.
- Enable GitHub's native squash auto-merge explicitly after opening an eligible
  trusted pull request. Required checks and unresolved conversations remain the
  merge authority. Forks, Release Please, breaking changes, and changes needing
  maintainer judgement remain manual. Disable auto-merge immediately if an
  enabled pull request later becomes ineligible.
- `feat` produces a minor release, `fix` a patch release, and `!` or a
  `BREAKING CHANGE` footer a major release. Routine docs and maintenance do not
  trigger a release.
- Do not create versions, changelog entries, tags, or GitHub Releases manually.
  Release Please owns those artifacts.
- Package publication remains disabled until the package, provenance or trusted
  publishing, build evidence, and rollback policy are reviewed.

## Pre-alpha policy

Before the first stable public contract, prefer a coherent foundation over
permanent compatibility layers. Breaking design changes still require an Agent
Note, migration impact, and synchronized updates to every affected document,
fixture, schema, producer, and consumer.
