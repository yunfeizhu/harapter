# Releasing Harapter

Release Please owns versions, changelogs, tag metadata, and draft GitHub
Releases. Verified Release assets precede publication; npm remains separate.

## Release model

The Workspace root and examples stay private. The public packages listed in
[`scripts/public-packages.json`](./scripts/public-packages.json) use one
synchronized pre-1.0 version. Internal `workspace:*` dependencies become exact
versions in npm tarballs.

Pre-alpha packages use the npm `next` dist-tag. Consumers must opt in with
`@next`; the `latest` tag is reserved for a later stability decision. `feat`
produces a minor release, `fix` produces a patch release, and `!` or a
`BREAKING CHANGE` footer produces a major release.

## GitHub release flow

Release Please is manual-only and runs from `main`:

```bash
gh workflow run release-please.yml --ref main
```

1. Squash-merge eligible Conventional Commit pull requests into `main`.
2. With release authorization, dispatch Release Please from `main`.
3. Use the [Harapter release skill](./.agents/skills/harapter-release/SKILL.md)
   to verify that every version artifact and the changelog agree.
4. Require every applicable check on the exact release pull request head.
5. Manually merge the release pull request after maintainer review. Release
   Please pull requests do not use auto-merge.
6. Keep GitHub immutable releases enabled; they protect only releases created
   after activation.
7. With publication authorization, dispatch Release Please from `main` again. It
   creates a draft; the finalizer checks the exact release commit, builds and
   uploads assets, verifies GitHub digests, then publishes the immutable
   Release.

Each Release contains 12 tarballs, `harapter-X.Y.Z.spdx.json`, and
`SHA256SUMS.txt`. The deterministic SPDX SBOM binds the commit, artifacts, and
internal dependencies. Release Please owns `CHANGELOG.md`.

## npm publication flow

The `publish-npm.yml` workflow accepts a `harapter-vX.Y.Z` GitHub Release tag.
It resolves that tag to an immutable commit, verifies the Workspace, downloads
the complete Release asset set, checks SHA-256 and SPDX metadata, reproduces
each tarball, and publishes those exact files in dependency order with
provenance. It never publishes a branch head or local artifact. The Release tag
must also be the workflow dispatch ref, so provenance remains bound to the
released commit after `main` advances.

The protected `npm` environment gates publication. Normal releases use GitHub
Actions OIDC without a long-lived token.

After the GitHub Release exists, an authorized maintainer dispatches:

```bash
gh workflow run publish-npm.yml \
  --ref harapter-v0.1.1 \
  -f release_tag=harapter-v0.1.1 \
  -f bootstrap=true
```

Replace the tag as needed. Use `bootstrap=false` after the first publication.

Before skipping existing content, the publisher checks registry SHA-512, `next`,
and cryptographically verified provenance. Conflicts stop publication.

## One-time npm bootstrap

`harapter-v0.1.0` remains source-only. npm requires packages to exist before
trusted publishers can be configured, so registry publication begins with a
one-time `0.1.1` bootstrap:

1. Confirm `@harapter` scope control, account two-factor authentication, and
   reviewers on the GitHub `npm` environment.
2. Create a short-lived granular npm access token limited to creating and
   publishing the scoped public packages. Store it only as the
   `NPM_BOOTSTRAP_TOKEN` secret of the protected `npm` environment.
3. Create the `harapter-v0.1.1` GitHub Release through the normal Release Please
   flow.
4. With explicit publication authorization, dispatch `publish-npm.yml` for
   `harapter-v0.1.1` with `bootstrap=true`.
5. Verify every package, `next` dist-tag, provenance attestation, and content.
6. Delete `NPM_BOOTSTRAP_TOKEN` from GitHub and revoke it on npm.
7. Configure each published package's trusted publisher for repository
   `yunfeizhu/harapter`, workflow `publish-npm.yml`, and environment `npm`.
   Restrict token-based package access after trusted publishing is active.

The bootstrap flag accepts only `0.1.1`; it is not a fallback for later OIDC
failures.

## Verification

Before release review, `pnpm check` must pass. Its package gate validates
manifests, dependency order, tarballs, `workspace:*` rewrites, runtime imports,
release assets, and an isolated TypeScript consumer.

After publication, use
`npm view <name>@<version> version dist-tags dist.integrity` for every policy
package. Confirm that provenance identifies the repository, workflow, tag
commit, and GitHub-hosted runner.

## Recovery and rollback

Inspect state first. Retry failures in the run. After a workflow fix, dispatch
`release-please.yml` from `main` with `resume_release_tag` set to the draft tag;
it verifies ancestry and resumes the SHA. Retry partial npm publication from its
immutable tag after inspection and reauthorization.

Published npm versions are immutable. Do not unpublish, move a Git tag, or
replace a version during ordinary recovery. Deprecate a broken version with a
clear message, merge the fix, and create a new Release Please version. Security
incidents that may justify npm's narrowly limited unpublish path require a
separate documented maintainer decision.

Authoritative platform behavior is documented by
[Release Please](https://github.com/googleapis/release-please),
[GitHub immutable releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes),
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/),
[npm trusted-publisher management](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
and [pnpm Workspace publishing](https://pnpm.io/workspaces).
