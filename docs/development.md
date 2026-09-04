# Harapter Development Workflow

This guide owns the daily contributor workflow. Repository-wide invariants live
in [AGENTS.md](../AGENTS.md); contribution policy lives in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- Node.js 24 or later;
- Corepack;
- pnpm 11;
- Git 2.26 or later;
- GitHub CLI for maintainers who create or inspect pull requests from the
  terminal.

Install and verify a checkout:

```bash
corepack enable
pnpm install
pnpm check
```

The complete check includes formatting, type-aware ESLint, strict TypeScript,
Vitest coverage, workspace package builds, documentation validation, and
repository governance. During implementation, the focused commands are:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
```

## One task, one branch

Harapter uses trunk-based development. `main` remains releasable; there is no
long-lived `develop` branch. Choose the intended pull request Conventional
Commit type before creating the branch, then start every task from the latest
`main`:

```bash
git status --short --branch
git switch main
git pull --ff-only
git switch -c feat/12-dsh-client
```

When an issue exists, use `<type>/<issue-number>-<short-kebab-description>`.
Trivial documentation or maintenance work may omit the issue number. The first
branch segment must equal the pull request title type. This repository rule
overrides tools or agents that normally prepend their own namespace: a
`docs(design):` pull request uses `docs/provider-roadmap`, not
`codex/docs-provider-roadmap`. Allowed types are `feat`, `fix`, `docs`,
`refactor`, `test`, `perf`, `build`, `ci`, `chore`, and `revert`. Public
additions and removals use release-visible types; `refactor` stays
behavior-preserving.

Examples:

```text
feat/12-dsh-client
fix/18-session-cancel
docs/provider-acceptance
ci/pr-metadata
```

Before committing or opening the pull request, compare the current branch with
the planned title. `scripts/check-pr-metadata.mjs` rejects an unknown branch
prefix or a branch type that differs from the title type.

Do not mix unrelated changes into the branch. If the worktree contains user
changes that cannot be isolated safely, stop rather than stashing, resetting, or
committing them without permission.

## Decide whether an Agent Note is required

Create or update an [Agent Note](../.agents/notes/README.md) when a change makes
a non-trivial decision about:

- portable API or schema semantics;
- session, run, event, interaction, or cancellation lifecycle;
- package or provider boundaries;
- compatibility, version detection, or capability claims;
- security, redaction, process, filesystem, or network ownership;
- testing strategy, release policy, or contributor process.

Mechanical formatting, typo, dependency refresh, and strictly local
implementation changes are exempt when they do not alter a durable decision.

## Develop and verify

Write or update tests before executable behavior. During development, run the
narrowest test that would fail for the affected behavior. Before review, run:

```bash
pnpm check
```

Additional evidence depends on the diff:

- Core/schema: unit, type, and conformance tests;
- transport: protocol, malformed input, timeout, cancellation, and disposal;
- provider: fixtures, conformance, provider negatives, and available live tests;
- package/export: build and public-consumer smoke tests;
- workflow/release: syntax, permissions, bot PR, and ordinary PR paths.

Use the [Harapter pre-push skill](../.agents/skills/harapter-pre-push/SKILL.md)
before an authorized push.

## Local review gate

Complete the local gate before committing and pushing the task:

1. Finish the implementation and all applicable risk-matched tests, including
   `pnpm check`.
2. Give an independent model the complete task diff against the real base,
   including committed, staged, unstaged, and untracked task files. The initial
   [Harapter code review](../.agents/skills/harapter-code-review/SKILL.md)
   examines correctness, security, lifecycle, and race conditions and reports
   every P0 and P1 plus only P2 findings worth changing before push.
3. Repair all P0/P1 findings and the selected P2 findings once as one batch,
   then rerun every affected check from step 1.
4. Ask an independent context to review the complete resulting diff again. This
   termination pass reports only P0 and P1 and does not start another P2 cycle.

A termination P0 or P1 blocks push. Repair it, rerun affected checks, and repeat
only the P0/P1 termination review. Any substantive edit after a clean
termination pass invalidates the result and requires affected checks and a new
termination pass. Creating the reviewed commit does not change the reviewed
content.

## Stage and commit

Stage explicit files and inspect the exact commit:

```bash
git add packages/core/src/session.ts packages/core/test/session.test.ts
git diff --cached
git diff --cached --check
git commit -s -m "feat(core): add session lifecycle"
```

Every commit carries a Developer Certificate of Origin sign-off. Commit and pull
request titles use Conventional Commit syntax:

```text
feat(core): add versioned session references
fix(dsh): preserve unknown JSON-RPC notifications
docs: clarify connection-abort semantics
feat(core)!: split session and run event scopes
```

## Open and complete a pull request

Push only after the user authorizes the external action:

```bash
git push -u origin feat/12-dsh-client
gh pr create --title "feat(dsh): add JSON-RPC client" --body "Closes #12"
gh pr merge --auto --squash --delete-branch
gh pr checks --watch
```

The pull request description summarizes the change, evidence, compatibility and
security impact, verification, limitations, and release impact. Link a relevant
issue with `Closes #<number>`; `feat` and `fix` pull requests require one unless
the maintainer records why an emergency exception is necessary.

The clean local termination review is the model-review gate. GitHub does not
parse Codex comments into a required status or run an automatic model repair
loop. A hosted Codex review may still provide supplemental feedback; it becomes
blocking only if the repository later adopts a native review policy.

For an eligible trusted pull request, enable GitHub's native squash auto-merge
immediately after creation. GitHub waits for `Repository checks`,
`Pull request metadata`, `Dependency review`, an up-to-date branch, and resolved
review conversations. Forks, breaking changes, Release Please pull requests, and
changes needing maintainer judgement remain manual and do not run the `--auto`
command. If an enabled pull request later becomes ineligible because its title,
body, branch, or review requirements change, disable auto-merge immediately:

```bash
gh pr merge --disable-auto
```

Re-enable it only after the pull request is eligible again. The merge command
for a deliberately manual pull request, after verification, is:

```bash
gh pr merge --squash --delete-branch
git switch main
git pull --ff-only
git branch -d feat/12-dsh-client
```

Do not remove a required check or use an admin merge path that can bypass the
three deterministic checks or unresolved conversations.

## Trusted Provider live canaries

[`provider-live-canary.yml`](../.github/workflows/provider-live-canary.yml) runs
weekly or by manual dispatch from the trusted default branch. Pull requests and
ordinary pushes cannot execute it with model credentials.

Schedule flags are `HARAPTER_LIVE_<PROVIDER>_ENABLED` for Codex, OpenCode, DSH,
Hermes, OpenClaw, and Pi. Enable one only after review and a passing manual run;
manual dispatch does not change these flags.

The model-facing Codex, OpenCode, DSH, and Hermes Agent jobs require these
repository Secrets:

- `HARAPTER_LIVE_MODEL_API_KEY` — a dedicated, revocable, low-budget key;
- `HARAPTER_LIVE_MODEL_URL` — the HTTPS URL used by the configured model;
- `HARAPTER_LIVE_MODEL_ID` — the model identifier passed to the Runtime.

A selected model-facing job with missing configuration fails at a named
validation step. Codex requires the Responses interface and passes a fail-closed
feature-inventory check before credentials are available. DSH similarly checks
its exact effective composition. OpenCode denies every permission, disables
tools, and loads no plugins. Their Run tests reject tool or interaction events.

Pi receives no model Secret or Prompt. It opens and closes an isolated,
non-persistent RPC Session and verifies that its Session directory stays empty.

OpenClaw receives no model Secret or Prompt. Its isolated loopback Gateway uses
generated authentication and disables external subsystems.

Hermes Agent runs its current official container by resolved image identity,
mounts only isolated temporary data, and publishes only on host loopback. It
submits one synthetic Prompt only after its authenticated inventory reports
every configurable toolset disabled and its full Agent-side resolver reports no
enabled toolsets. The Harapter test process does not inherit the model Secret.

Each ephemeral job records its Runtime identity and Harapter revision, applies
bounded readiness and execution deadlines, and uploads no Runtime data, Provider
traffic, credentials, Prompt, or response.

## Release flow

The squash pull request title determines release impact. Ordinary `main` pushes
do not start Release Please; a maintainer enables Actions-created pull requests
and manually dispatches the workflow. An automatic `main` trigger requires a
separate repository-policy change.

Maintainers merge the release pull request, then dispatch the workflow from
`main` again. The first dispatch prepares versions and the changelog. The second
creates a draft Release; an isolated finalizer checks the SHA, builds 12
tarballs, an SPDX SBOM, and SHA-256 checksums, verifies the uploaded digests,
then publishes the immutable Release. Do not create those artifacts manually.
See [RELEASING.md](../RELEASING.md) for the activation and verification
procedure.

Public packages use one synchronized pre-1.0 version and the npm `next`
dist-tag. `pnpm check` validates their manifests, tarballs, dependency rewrites,
and consumer imports. The Workspace root and examples remain private.

npm publication is a separate manual workflow for an immutable Release at the
dispatch ref. It verifies the asset set, reproduces and publishes the attached
tarballs, then checks SHA-512, `next`, and provenance. The first registry
publication is `0.1.1` with a one-time short-lived token; later releases use the
protected `npm` environment and trusted publishing. See
[RELEASING.md](../RELEASING.md) for setup, recovery, and rollback.
