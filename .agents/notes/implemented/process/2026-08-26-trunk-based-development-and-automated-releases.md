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
The contributor chooses the pull request Conventional Commit type before
creating the branch, and the branch's first segment uses that same type.
Repository branch types override tool-specific prefixes such as `codex/`.
Commits carry a Developer Certificate of Origin sign-off. There is no long-lived
`develop` branch and no manually maintained release branch.

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

Release Please is staged but manual-only while Harapter establishes its first
portable contracts and provider adapters. Feature commits on `main` do not
automatically create a release pull request. After a maintainer approves the
first usable pre-alpha milestone, they explicitly enable Actions-created pull
requests and dispatch the reviewed Release Please workflow from `main` to
prepare the release pull request. After manually merging that pull request, they
dispatch the workflow from `main` a second time. Release Please creates a draft
Release, and an isolated finalizer builds and verifies its assets before
publication creates the immutable tag. The release job rejects non-`main` refs,
and the CI dispatch rejects a branch head that differs from the queried pull
request head. Enabling an automatic `main` trigger is a separate reviewed
repository-policy change. The first approved pre-alpha release is `0.1.0`.
Release Please owns its generated changelog formatting and retains its default
visible commit types. A user-visible addition or removal uses `feat`, `fix`, or
a breaking-change marker; `refactor` is reserved for behavior-preserving work
because making a normally hidden type visible can create an otherwise unintended
patch release. Markdown and link validation remain in force, and repository
metadata accepts both observed GitHub Actions bot login forms. The generated
root `CHANGELOG.md` accepts Release Please's consecutive blank lines while every
other Markdown file retains the standard blank-line rule, and its list markers
follow the generator's asterisk style.

Public Core, conformance, transport, and Provider Adapter packages use a single
synchronized version before 1.0. The Workspace root and examples remain private.
Harapter submits pre-alpha packages with the npm `next` dist-tag so consumers
select the pre-alpha channel explicitly. The public registry also creates
`latest` for a package's first version when publication selects another tag.
Harapter treats that initial tag as registry bootstrap behavior rather than
stable-channel approval and does not advance it during later pre-alpha
publication. Registry publication is a separate manual workflow after an
immutable GitHub Release exists. The workflow requires GitHub's
immutable-release setting, accepts Release Please's `harapter-vX.Y.Z` tag
format, requires that tag as its dispatch ref, resolves it exactly to the event
commit, downloads the Release tarballs, reproduces each one, submits those exact
files in dependency order with provenance, and uses a protected GitHub
environment. It uses npm trusted publishing through GitHub Actions OIDC after
bootstrap and stores no long-lived registry token.

npm scans accepted packages before making their version metadata and contents
available. Publication first uses a bounded availability window for versions
already pending at startup and audits all existing provenance before another
irreversible write. It then submits every missing tarball and polls that new
batch through a second bounded window. Each registry query receives a shorter
timeout within its remaining monotonic deadline. The workflow timeout covers
both windows plus evidence, packaging, provenance, and cleanup. Registry
visibility does not establish success by itself: the publisher still requires
the immutable SHA-512, `next`, and provenance checks for every package.

The Release finalizer runs repository evidence at the candidate SHA, packages
all 12 public workspaces, creates a deterministic SPDX document bound to the
candidate commit and exact tarballs, and creates canonical SHA-256 checksums for
the tarballs and SBOM. It uploads only absent draft assets, rejects remote name,
size, state, or digest conflicts, and publishes only the complete set. GitHub
creates and locks the tag and assets when the draft is published. Recovery
reruns the failed finalizer job in the same workflow run so Release Please
outputs and the source SHA cannot drift; it resumes a matching draft or
reverifies an already immutable Release. When the workflow itself must be fixed,
a new `main` dispatch may set `resume_release_tag` to an existing Release Please
draft. That path accepts only a stable Harapter tag, requires an unpublished
mutable draft without an existing Git ref, proves that its target commit is
reachable from the dispatch commit, and carries the same target SHA into the
ordinary finalizer.

npm does not allow a trusted publisher to be configured before a package exists.
The immutable `harapter-v0.1.0` Release remains source-only; the first registry
publication is `0.1.1` and permits one short-lived granular bootstrap token
scoped to the protected environment. That token is revoked and removed after
package creation and trusted-publisher setup. Later releases fail closed if OIDC
is unavailable; the bootstrap path cannot publish another version. Registry
recovery requires matching SHA-512 integrity, the `next` dist-tag,
cryptographically verified attestation bundles, and provenance that identifies
the expected repository, workflow, builder, commit, and tarball. It stops on any
mismatch. A retry uses the same immutable tag, so a later `main` commit cannot
change the provenance source. Ordinary rollback deprecates the bad version and
releases a fix rather than moving tags, replacing packages, or unpublishing. The
operational workflow is documented in
[development.md](../../../../docs/development.md) and
[RELEASING.md](../../../../RELEASING.md).

## Alternatives considered

### Git Flow with a permanent develop branch

This adds a second integration branch, duplicate merge points, and drift between
development and released state without solving a current multi-version support
need. It was rejected for the pre-alpha project.

### Direct commits to main

Direct commits reduce ceremony but bypass the public review record, PR metadata,
dependency review, and evidence attached to the change. Maintainer emergencies
use an explicit documented exception rather than the default path.

### Tool-specific branch namespaces

Prefixes such as `codex/` identify the tool that created a branch, but they do
not describe the change or match the Conventional Commit type that controls the
squash commit and release impact. Harapter uses the change type as the branch
namespace and leaves authorship to Git metadata and the pull request record.

### Manual versioning and tags

Manual release state is easy to make inconsistent with changelog and commit
history. Release Please provides a reviewable release pull request and one owner
for version artifacts.

### Prepare a release after every releasable main commit

This gives immediate version proposals, but the first feature commit can create
a release pull request before the portable API and a usable provider slice are
ready. Keeping the workflow manual during initial development avoids presenting
an incomplete foundation as a release while preserving the commit history that
Release Please will evaluate at activation.

### Version every public package independently

Independent versions reduce updates for packages that did not change, but they
also allow a pre-1.0 Adapter and Core combination that was never tested together
to appear current. A synchronized train makes the supported source revision and
dependency graph explicit while the contracts are still changing. Independent
versioning can be reconsidered after stable package boundaries and real consumer
upgrade data exist.

### Publish npm packages from every GitHub Release automatically

Automatic publication shortens the release path but makes the GitHub Release
event itself authorize an irreversible registry write. A separate manual
dispatch keeps the immutable source selection deterministic while preserving a
distinct approval boundary for npm publication and its protected environment.

### Keep a reusable npm token for all releases

A persistent token is simpler than OIDC but creates a credential that can be
copied, leaked, or used outside the reviewed workflow. Only the unavoidable
first-package bootstrap uses a short-lived token; normal releases use trusted
publishing and provenance.

### Verify each package before submitting the next package

Serial verification localizes the first unavailable package, but npm scans each
accepted version independently. Waiting for every scan before submitting the
next tarball multiplies registry delay across the synchronized package train.
Submitting verified tarballs in dependency order and waiting through one shared
deadline preserves the same final checks while allowing those scans to progress
together. Publication can already stop after a partial irreversible upload, so
the shared wait does not introduce a new atomicity guarantee.

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

`main` remains the single integration and eventual release source. Contributors
create more short-lived branches, choose the pull request type before branch
creation, and keep the branch and title types aligned. The pull request title
determines the eventual squash commit and release impact, while the metadata
check rejects tool-specific or mismatched branch prefixes. Early feature work
accumulates without creating release pull requests until a maintainer explicitly
activates the first pre-alpha release. Release preparation and GitHub
publication use two explicit workflow dispatches around the manual release pull
request merge. npm publication adds a third, separately authorized dispatch from
the immutable GitHub Release tag. Public packages share the generated version
and Harapter publishes them with `next`; npm's initial `latest` tag remains
explicitly outside the stable-channel decision. The publisher uses one bounded
shared availability window for independent npm scans. The first publication has
a documented one-time token bootstrap, while subsequent releases require OIDC.
Maintainers preserve `Repository checks`, `Pull request metadata`, and
`Dependency review` as required status checks. Local delivery retains one
independent model review and test rerun while its termination rule prevents P2
churn. Pull requests no longer wait for a second model review or permit
automated review-comment repair. Eligible contributors explicitly enable native
auto-merge, and GitHub waits for the deterministic requirements and resolved
conversations. The migration first removes the synthetic `AI code review`
required context while preserving strict updates and the three deterministic
contexts, then deletes its workflow producer.
