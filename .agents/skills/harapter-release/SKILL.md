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

1. Confirm the pull request is owned by Release Please and targets `main`.
2. Inspect every releasable squash commit since the previous tag. Verify that
   `feat`, `fix`, and breaking-change markers produce the intended SemVer bump.
3. Compare the version file, manifest, changelog, and release pull request
   title. Do not hand-edit one artifact to hide a configuration error.
4. Verify that changelog entries describe user-visible behavior and breaking
   migration requirements without leaking private data.
5. Require all applicable CI, conformance, build, and security checks. A skipped
   credential-backed test is not live compatibility evidence.

## Package boundary

The current repository publishes GitHub Releases only. Do not run `npm publish`
or add a registry token. A future package job must use reviewed trusted
publishing or provenance, verify the built artifact rather than the source tree,
and document rollback and deprecation behavior.

## Complete and verify

After explicit authorization, merge the release pull request through the normal
protected flow. Wait for Release Please, then verify the immutable tag, GitHub
Release, changelog, target commit, and attached artifacts. Report the exact URLs
and any package publication that was intentionally not configured.

If a workflow fails, inspect existing tags, releases, and job logs before any
retry. Never delete, move, or recreate a published tag as an ordinary recovery
step; stop for an incident decision if immutable state conflicts.
