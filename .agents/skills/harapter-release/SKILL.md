---
name: harapter-release
description:
  Verify a Harapter Release Please pull request and complete an authorized
  GitHub release safely, including version impact, changelog, checks, tags, and
  recovery. Do not use to invent manual versions or publish packages without
  configured trusted publishing.
---

# Harapter Release

Use this workflow only for a real release request. Inspection is read-only;
merging, publishing, rerunning write-capable jobs, or changing tags requires the
user's explicit authorization.

## Verify the release pull request

1. Confirm the user explicitly authorized release preparation. Enable the
   repository setting for Actions-created pull requests only with authorization,
   then dispatch `release-please.yml` with `--ref main`. Never dispatch the
   write-capable workflow from another ref.
2. Confirm the pull request is owned by Release Please and targets `main`.
3. Inspect every releasable squash commit since the previous tag. Verify that
   `feat`, `fix`, and breaking-change markers produce the intended SemVer bump.
4. Compare the version file, manifest, changelog, and release pull request
   title. The first approved pre-alpha release must be `0.1.0`. Do not hand-edit
   one artifact to hide a configuration error.
5. Verify that changelog entries describe user-visible behavior and breaking
   migration requirements without leaking private data.
6. Require all applicable CI, conformance, build, and security checks on the
   exact release pull request head. A skipped credential-backed test is not live
   compatibility evidence.

## Package boundary

The current repository publishes GitHub Releases only. Do not run `npm publish`
or add a registry token. A future package job must use reviewed trusted
publishing or provenance, verify the built artifact rather than the source tree,
and document rollback and deprecation behavior.

## Complete and verify

After explicit authorization, merge the release pull request through the normal
protected flow. Because the workflow is manual-only during initial development,
obtain authorization for publication and dispatch `release-please.yml` with
`--ref main` a second time. Wait for that run, then verify the immutable tag,
GitHub Release, changelog, target commit, and attached artifacts. Report the
exact URLs and any package publication that was intentionally not configured.

If a workflow fails, inspect existing tags, releases, and job logs before any
retry. Never delete, move, or recreate a published tag as an ordinary recovery
step; stop for an incident decision if immutable state conflicts.
