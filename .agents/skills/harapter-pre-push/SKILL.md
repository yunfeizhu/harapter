---
name: harapter-pre-push
description:
  Select and run the smallest credible evidence for a Harapter branch before an
  authorized push, review request, or merge-readiness claim. Use for Harapter
  changes; do not use as a generic full-suite runner.
---

# Harapter Pre-Push

Validate the outgoing Harapter change without repeating checks that do not cover
its risk. This skill does not authorize commit, push, or merge.

## Establish scope

1. Read the root and nearest subtree `AGENTS.md` files.
2. Confirm repository, branch, base, and worktree state:

```bash
git rev-parse --show-toplevel
git status --short --branch
git fetch origin main
git diff --stat origin/main...HEAD
git diff --stat
git diff --cached --stat
```

Include committed, staged, unstaged, and untracked task files in the scope.
Preserve unrelated user changes; do not stash, reset, or stage them to simplify
the report.

## Select evidence

Always run `pnpm check`. Add only evidence that would fail for the changed
surface:

- `docs/`, `.agents/`, or repository policy: Markdown, links, Agent governance,
  and relevant validator failure cases;
- `packages/schema` or Core contracts: focused unit tests, typecheck, and shared
  conformance cases;
- transports: framing, malformed input, timeout, cancellation, process exit,
  late-message, and disposal cases;
- providers: redacted fixture tests, capability declarations, shared
  conformance, provider negatives, and live tests when the runtime is available;
- exports, manifests, or build configuration: build and public-consumer smoke;
- `.github/`: workflow syntax, permission review, ordinary PR metadata, and bot
  PR metadata.

Do not treat a skipped live test as compatibility evidence. Do not run a future
full provider matrix merely because one provider changed.

Finish the implementation and all selected risk-matched evidence before local
review. A failing or incomplete required check stops the gate.

## Run the local review gate

1. Ask a model in an independent context to use
   [`$harapter-code-review`](../harapter-code-review/SKILL.md) for an initial
   full-diff review. Include committed, staged, unstaged, and untracked task
   changes. Require explicit security and race-condition analysis and collect
   every P0 and P1 plus only worthwhile P2 findings.
2. Repair all collected P0 and P1 findings and the selected P2 findings in one
   batch. Rerun every selected check affected by the repairs.
3. Ask an independent context for a termination review of the resulting full
   diff. This pass reports only P0 and P1; it does not open another P2 cycle.

A termination P0 or P1 blocks push. Repair it, rerun affected evidence, and
repeat only the P0/P1 termination review. A substantive change after a clean
termination pass invalidates that result; creating a commit without changing the
reviewed content does not. Local review never substitutes for GitHub's
deterministic checks; hosted review is supplemental unless a native repository
review policy is configured.

## Close the local evidence

Inspect the exact outgoing diff and whitespace before asking to push:

```bash
git diff --check
git diff --cached --check
git diff origin/main...HEAD
```

Report each command and result, plus relevant checks not run and why. Stop on a
real failure. If the environment blocks a required command, record the evidence
and request the narrowest needed permission; do not relabel it as a product
failure.

Only a branch with complete evidence and a clean P0/P1 termination review is
ready for an authorized commit and push.

## After an authorized push

Verify that the remote branch points to the intended commit and inspect the live
pull request checks. Pending is not passing; read failed logs before assigning a
cause. History rewrites require `--force-with-lease` against an observed remote
OID and separate explicit authorization.
