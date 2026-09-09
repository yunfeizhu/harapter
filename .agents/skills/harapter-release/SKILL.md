---
name: harapter-release
description:
  Verify a Harapter Release Please pull request and complete an authorized
  GitHub and npm release safely, including version impact, package artifacts,
  provenance, tags, and recovery. Do not use to invent manual versions or bypass
  the reviewed publication workflows.
---

# Harapter Release

Use this workflow only for a real release request. Inspection is read-only;
merging, publishing, rerunning write-capable jobs, or changing tags requires the
user's explicit authorization.

## Verify the release pull request

1. Confirm the user explicitly authorized release preparation. Enable the
   repository setting for Actions-created pull requests only with authorization,
   then dispatch `release-please.yml` with `--ref main -f operation=prepare`.
   Never dispatch the write-capable workflow from another ref.
2. Confirm the pull request is owned by Release Please and targets `main`.
3. Inspect every releasable squash commit since the previous tag. Verify that
   `feat`, `fix`, and breaking-change markers produce the intended SemVer bump.
4. Compare `version.txt`, the root manifest, every manifest listed in
   `scripts/public-packages.json`, the changelog, and release pull request
   title. They use the generated release version; do not hand-edit an artifact
   to hide a configuration error.
5. Verify that changelog entries describe user-visible additions, removals, and
   breaking migration requirements without leaking private data.
6. Require all applicable CI, conformance, build, and security checks on the
   exact release pull request head. A skipped credential-backed test is not live
   compatibility evidence.
7. Confirm `pnpm check` validated the publish metadata, dependency order,
   tarball contents, Workspace dependency rewrites, runtime imports, and strict
   TypeScript imports.

## Package boundary

Only `harapter` is public; implementation modules and examples stay private.
Follow `scripts/public-packages.json`, use the synchronized Release Please
version, and publish under the default npm `latest` dist-tag. Never publish from
a checkout, local tarball, mutable branch, or unreviewed workflow. npm uses only
the verified tarballs attached to an immutable GitHub Release.

Verify that `latest` identifies the release being published. Default-channel
installation does not imply a 1.0 API stability guarantee. Historical immutable
releases retain their original channel policy.

Normal npm publication uses the protected `npm` GitHub environment, OIDC trusted
publishing, and provenance without a registry token. Release Please tags the
single release train as `harapter-vX.Y.Z`; npm package versions remain `X.Y.Z`.
The single `harapter` package may require initial creation before OIDC setup.
Bootstrap is restricted to that absent name or a same-version retry; reject any
other published version or package. Use a short-lived `NPM_BOOTSTRAP_TOKEN` only
in the protected environment, then verify trusted-publisher setup, delete the
secret and revoke the token. Follow the current checks in `RELEASING.md`; the
historical scoped bootstrap remains owned by its immutable tag.

Before creating the first GitHub Release, require explicit authorization to
enable immutable releases; the setting is not retroactive. The npm workflow must
run from the immutable Release tag and resolve it exactly to the event commit so
npm provenance identifies the released source revision even after `main`
advances.

Release Please creates a draft Release. Its finalizer checks the Release output
against the dispatch SHA, runs repository and package evidence, builds the
policy-listed `pnpm pack` tarball, creates a deterministic SPDX SBOM bound to
that commit and those tarballs, writes SHA-256 checksums, uploads only missing
assets, verifies the exact remote names, sizes, and digests, and publishes only
that complete draft. Do not create the tag early, clobber a draft asset, or
publish a partial set.

## Complete and verify

After explicit authorization, merge the release pull request through the normal
protected flow. Because the workflow is manual-only during initial development,
obtain authorization for publication and dispatch `release-please.yml` with
`--ref main -f operation=finalize`. Wait for both jobs, then verify the
immutable tag, GitHub Release, the policy-derived asset set, changelog, and
target commit.

npm publication is a separate irreversible action and requires explicit
authorization immediately before dispatch. Run `publish-npm.yml` from the exact
GitHub Release tag with that tag as the input and the correct bootstrap flag.
Verify every package in `scripts/public-packages.json`, its Release tarball,
`latest` dist-tag, SHA-512 integrity, and provenance. Report the exact GitHub
Release, workflow, and package URLs.

Use one policy-defined availability window for each acceptance batch. Recovery
verifies a startup-pending batch before new writes; newly accepted tarballs
share a second window. The job timeout covers both. An accepted tarball is not
complete evidence until registry metadata, `latest`, and provenance are
verifiable; inspect held packages before rerunning the immutable release.

If a workflow fails, inspect existing tags, releases, assets, and job logs.
Retry an operational finalizer failure in the same workflow run. If recovery
requires a workflow fix, dispatch `release-please.yml` from `main` with
`operation=finalize` and `resume_release_tag` set to the exact existing Release
Please draft tag; the workflow verifies ancestry and resumes that draft SHA. An
immutable Release is only reverified. Recover partial npm publication by
rerunning that job, or after reauthorization by dispatching the same immutable
tag again. The publisher skips an existing package only after matching SHA-512,
`latest`, verified attestations, repository, workflow, builder, commit, and
tarball. Stop on any conflict. Never delete, move, or recreate a published tag,
replace a package version, or unpublish as an ordinary recovery step; deprecate
a bad version and release a fix. Stop for an incident decision if immutable
state conflicts.

Read [RELEASING.md](../../../RELEASING.md) before the one-time bootstrap or any
recovery operation.
