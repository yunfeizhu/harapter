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
long-lived `develop` branch. Start every task from the latest `main`:

```bash
git status --short --branch
git switch main
git pull --ff-only
git switch -c feat/12-dsh-client
```

When an issue exists, use `<type>/<issue-number>-<short-kebab-description>`.
Trivial documentation or maintenance work may omit the issue number. Allowed
types are `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, and
`chore`.

Examples:

```text
feat/12-dsh-client
fix/18-session-cancel
docs/provider-acceptance
ci/pr-metadata
```

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

## Release flow

The squash pull request title determines eventual release impact. While Harapter
is establishing its first portable contracts and provider adapters, ordinary
`main` pushes do not start Release Please. After approving the first usable
pre-alpha milestone, a maintainer enables Actions-created pull requests and
manually dispatches the Release Please workflow. Enabling an automatic `main`
trigger requires a separate reviewed repository-policy change.

Maintainers review and manually merge the generated release pull request when
the accumulated changes are ready, then dispatch the workflow from `main` a
second time to create the tag and GitHub Release. The first dispatch prepares
the version update and changelog; the second publishes them after the release
pull request is merged. Do not create those artifacts manually. See
[RELEASING.md](../RELEASING.md) for the activation and verification procedure.

Package publication is enabled per package only after its build, conformance,
trusted-publishing, provenance, and rollback requirements are implemented.
