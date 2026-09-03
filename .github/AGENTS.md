# Harapter GitHub Automation Agent Guide

These rules supplement the repository-wide [Agent Guide](../AGENTS.md) for files
under `.github/`.

- Pin third-party Actions to a full immutable commit SHA and retain a version
  comment that Dependabot can update.
- Set workflow and job permissions to the smallest required scope. Default to
  `contents: read`; grant write scopes only to the job that performs the write.
- Keep `persist-credentials: false` on checkouts unless a reviewed step must
  push with the workflow token.
- Treat pull requests from forks and Dependabot as untrusted. Do not expose
  secrets, execute checked-out code with privileged tokens, or use
  `pull_request_target` merely to gain credentials.
- A `pull_request_target` control-plane job may read event metadata and check
  out the default branch only. It must never check out, import, or execute the
  pull request head, and it must not receive model or provider credentials.
- Preserve stable required job names or coordinate the matching branch
  protection change. A renamed job can silently remove enforcement or block
  every pull request.
- Add explicit timeouts and concurrency controls. Cancellation must not
  interrupt release publication after an immutable tag or artifact is created.
- CI checks pull requests and `main`; exhaustive runtime or credential-backed
  tests use separately scoped workflows and environments.
- Release Please owns version PRs, changelog updates, tags, and GitHub Releases.
  Registry publication remains a separately authorized trusted-publishing job
  for an immutable GitHub Release at the dispatch run's current `main` commit,
  with provenance and environment protection.
- Dependabot groups compatible updates, but automated merging is enabled only
  after required checks and update policy are enforced by branch protection.
- Before push, the contributor flow completes risk-matched tests, an independent
  full-diff security and race-condition review, one batched repair of P0/P1 and
  worthwhile P2 findings, and a clean independent termination review limited to
  P0/P1.
- Prefer native branch protection, review policy, and auto-merge over a custom
  status bridge. Never parse bot prose into a required status, and do not add a
  workflow that asks a reviewer to rewrite a branch repeatedly. Hosted model
  review remains supplemental unless GitHub exposes it as a native policy.
- Review generated workflow expressions and shell interpolation as code. Do not
  place untrusted titles, bodies, branch names, or issue text directly in a
  shell script; pass them through environment variables or files.
- Validate both the ordinary pull request path and bot-generated pull request
  path after changing CI metadata rules.
