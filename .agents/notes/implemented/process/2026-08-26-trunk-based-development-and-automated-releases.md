# Agent Note: Trunk-based development and automated releases

Status: implemented

## Problem

Harapter needs a contribution flow that keeps its public main branch reviewable
and releasable without maintaining duplicate integration and release branches.
Version edits, changelog maintenance, and manual tags would create inconsistent
release state for a project intended to support independently evolving packages.

## Decision

Harapter uses trunk-based development with one short-lived branch per task.
Changes reach `main` through pull requests, automated checks, and squash merge.
Branch and pull request titles use Conventional Commit types, and commits carry
a Developer Certificate of Origin sign-off. There is no long-lived `develop`
branch and no manually maintained release branch.

Before push, the implementer completes the change and all risk-matched tests,
including repository checks. A model in an independent context then reviews the
complete task diff for correctness, security, lifecycle, and race conditions.
The initial pass reports every P0 and P1 plus only P2 findings whose benefit
justifies a pre-push change. The implementer repairs those findings once as a
batch and reruns affected evidence. An independent termination pass examines the
resulting complete diff but reports only P0 and P1, preventing optional
improvements from creating an open-ended review loop. A termination blocker or
substantive later edit invalidates the clean gate and requires affected evidence
and another P0/P1 termination pass.

Merge gates are deterministic repository checks, pull request metadata,
dependency review, an up-to-date branch, and resolved review conversations.
Harapter does not convert model prose into a required commit status or ask a
review bot to rewrite a branch in a workflow loop. A hosted Codex review is
supplemental unless a native repository review policy is deliberately enabled;
its absence or wording cannot leave a synthetic status permanently pending.

After opening an eligible same-repository pull request, the contributor enables
GitHub's native squash auto-merge. GitHub branch protection remains the merge
authority and waits for every required check and conversation. Forks, breaking
changes, Release Please pull requests, and changes needing maintainer judgement
do not enable auto-merge. No custom control-plane workflow duplicates GitHub's
merge-state evaluation. If an enabled pull request later becomes ineligible, the
contributor disables auto-merge immediately and re-enables it only after the
eligibility issue is resolved.

Release Please reads squash commit titles on `main`, maintains the release pull
request and changelog, and creates the version tag and GitHub Release after that
pull request is merged. Registry publication remains disabled until a package
has reviewed build, conformance, provenance or trusted-publishing, and rollback
controls. The operational workflow is documented in
[development.md](../../../../docs/development.md).

## Alternatives considered

### Git Flow with a permanent develop branch

This adds a second integration branch, duplicate merge points, and drift between
development and released state without solving a current multi-version support
need. It was rejected for the pre-alpha project.

### Direct commits to main

Direct commits reduce ceremony but bypass the public review record, PR metadata,
dependency review, and evidence attached to the change. Maintainer emergencies
use an explicit documented exception rather than the default path.

### Manual versioning and tags

Manual release state is easy to make inconsistent with changelog and commit
history. Release Please provides a reviewable release pull request and one owner
for version artifacts.

### Human-only review and merge

This keeps every decision with a maintainer but repeats high-signal review and
merge coordination that can be expressed as repository policy. It remains the
fallback for external, breaking, release, or explicitly labelled changes.

### Custom AI status bridge and autonomous repair

A workflow can parse a bot comment, publish a required commit status, request a
repair, and repeat. This duplicates the completed local review, couples merge
liveness to mutable natural-language output, and spreads one decision across
several webhook event types. A cosmetic Codex response change already left the
synthetic status pending after a clean review. Native review policy is the only
acceptable future blocking integration; automated review-comment repair is not
part of the merge control plane.

### Rely on GitHub review alone

Deferring the first complete security and concurrency review until after push
makes basic repair depend on remote automation and gives the pull request a head
that has not passed the maintainer's local evidence gate. GitHub review remains
valuable because it evaluates the exact remote head in a separate environment,
but it is a second boundary rather than the only review.

### Continue local review through every new P2

Repeatedly reopening optional improvements can expand scope and create review
oscillation without improving the merge-blocking guarantees. One batched P2
decision retains worthwhile improvements; the P0/P1-only termination pass gives
the local process a stable stopping rule.

## Consequences

`main` remains the single integration and release source. Contributors create
more short-lived branches and must keep pull request titles accurate because the
title determines the squash commit and release impact. Release publication still
has an explicit maintainer merge gate. Package publication needs additional
automation before any registry artifact is released. Maintainers preserve
`Repository checks`, `Pull request metadata`, and `Dependency review` as
required status checks. Local delivery retains one independent model review and
test rerun while its termination rule prevents P2 churn. Pull requests no longer
wait for a second model review or permit automated review-comment repair.
Eligible contributors explicitly enable native auto-merge, and GitHub waits for
the deterministic requirements and resolved conversations. The migration first
removes the synthetic `AI code review` required context while preserving strict
updates and the three deterministic contexts, then deletes its workflow
producer.
