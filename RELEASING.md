# Releasing Harapter

Release Please owns versions, changelogs, tag metadata, and draft GitHub
Releases. Verified Release assets precede publication; npm remains separate.

## Release model

The Workspace root and examples stay private. The public packages listed in
[`scripts/public-packages.json`](./scripts/public-packages.json) use one
synchronized pre-1.0 version. Internal `workspace:*` dependencies become exact
versions in npm tarballs.

Pre-alpha packages publish under `next`; consumers select `@next`. npm also
creates `latest` for a new package's first version. Harapter neither treats nor
advances that tag as stable. `feat` produces a minor release, `fix` a patch, and
`!` or `BREAKING CHANGE` a major release.

## GitHub release flow

Release Please is manual-only:

```bash
gh workflow run release-please.yml --ref main -f operation=prepare
# After manually merging the release pull request:
gh workflow run release-please.yml --ref main -f operation=finalize
```

1. Squash-merge eligible Conventional Commit pull requests into `main`.
2. With release authorization, dispatch `prepare` from `main`.
3. Use the [Harapter release skill](./.agents/skills/harapter-release/SKILL.md)
   to verify the generated version artifacts and changelog.
4. Require all checks on the exact head, then manually merge after review;
   release pull requests never use auto-merge.
5. Keep GitHub immutable releases enabled.
6. With publication authorization, dispatch `finalize`. It creates only the
   draft Release; the finalizer verifies the commit and assets before publishing
   it. `prepare` cannot create a Release, and `finalize` cannot create a pull
   request.

Each Release contains 12 tarballs, `harapter-X.Y.Z.spdx.json`, and
`SHA256SUMS.txt`. The deterministic SPDX SBOM binds the commit, artifacts, and
internal dependencies. Release Please owns `CHANGELOG.md`.

## npm publication flow

`publish-npm.yml` resolves a `harapter-vX.Y.Z` tag to its immutable commit,
reproduces its assets, then publishes the exact tarballs in dependency order
with provenance. The dispatch ref must match; branches and local artifacts are
rejected.

The protected `npm` environment gates publication. Normal releases use GitHub
Actions OIDC without a long-lived token.

After the GitHub Release exists, an authorized maintainer dispatches:

```bash
release_tag=harapter-vX.Y.Z
gh workflow run publish-npm.yml \
  --ref "$release_tag" \
  -f release_tag="$release_tag" \
  -f bootstrap=false
```

Replace `X.Y.Z` with the approved version.

The publisher submits missing tarballs, then polls the batch for up to 20
minutes. This covers npm's documented
[publish-time scanning delay](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)
without serializing scans. SHA-512, `next`, provenance, timeout, and conflicts
remain fail-closed.

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
   The registry-created initial `latest` tag is not a stable-channel decision.
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
package. Confirm provenance identifies the repository, workflow, tag commit, and
GitHub-hosted runner. Do not advance the registry-created initial `latest`.

## Recovery and rollback

Inspect before retrying. Resume a verified draft with `finalize` and
`resume_release_tag`. Resume partial npm publication from its immutable tag
after reauthorization; its timeout covers pre-write and post-write scans.

```bash
gh workflow run release-please.yml \
  --ref main \
  -f operation=finalize \
  -f resume_release_tag=harapter-vX.Y.Z
```

Published versions are immutable. Ordinary recovery deprecates a broken version
and releases a fix; it never unpublishes, retags, or replaces one. Incident
unpublishing requires a separate documented maintainer decision.

Authoritative platform behavior is documented by
[Release Please](https://github.com/googleapis/release-please),
[GitHub immutable releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes),
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/),
[npm trusted-publisher management](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[npm's observed initial `latest` behavior](https://github.com/npm/cli/issues/6408),
and [pnpm Workspace publishing](https://pnpm.io/workspaces).
