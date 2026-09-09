# Releasing Harapter

Release Please owns versions, changelogs, tag metadata, and draft GitHub
Releases. Verified Release assets precede publication; npm remains separate.

## Release model

Only `harapter` is public, as declared in
[`scripts/public-packages.json`](./scripts/public-packages.json). Core,
Adapters, transports, conformance, the Workspace root and examples remain
private. Internal implementations are bundled; consumers have no `@harapter/*`
runtime dependency.

The SDK publishes under `latest`; consumers install without a tag suffix. The
channel does not guarantee API stability. `feat` produces a minor release, `fix`
a patch, and `!` or `BREAKING CHANGE` a major release.

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

Each Release contains all policy-listed tarballs, `harapter-X.Y.Z.spdx.json`,
and `SHA256SUMS.txt`. The deterministic SPDX SBOM binds the commit, artifacts,
and internal dependencies. Release Please owns `CHANGELOG.md`.

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
without serializing scans. SHA-512, `latest`, provenance, timeout, and conflicts
remain fail-closed.

## One-time npm bootstrap

npm requires a package to exist before configuring its trusted publisher. The
new unscoped `harapter` name therefore needs its own initial creation:

1. Confirm name availability, account two-factor authentication and protected
   `npm` environment reviewers.
2. Store a short-lived granular creation credential only as the environment's
   `NPM_BOOTSTRAP_TOKEN`; restrict it to the required publication scope.
3. Create the approved Release through Release Please, then explicitly authorize
   `publish-npm.yml` from that immutable tag with `bootstrap=true`.
4. Verify `harapter`, its `latest` tag, content and provenance. Configure its
   trusted publisher for repository `yunfeizhu/harapter`, workflow
   `publish-npm.yml`, environment `npm`.
5. Delete the environment secret and revoke the token. Later releases use OIDC.

Bootstrap permits only the single `harapter` policy entry and an absent npm
name. A retry may find only the same release version and must still verify
immutable content and provenance. A different published version, unknown
registry state or another package rejects bootstrap. This is not an OIDC failure
fallback. The historical scoped-package bootstrap remains owned by its immutable
release tag.

## Verification

Before release review, `pnpm check` must pass. Its package gate validates
manifests, dependency order, tarballs, `workspace:*` rewrites, runtime imports,
release assets, and an isolated TypeScript consumer.

After publication, use
`npm view <name>@<version> version dist-tags dist.integrity` for every policy
package. Confirm provenance identifies the repository, workflow, tag commit, and
GitHub-hosted runner. Verify `latest` identifies the approved release.

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

Published versions and Git tags are immutable. Ordinary recovery deprecates a
broken version and releases a fix; it never replaces or unpublishes one.
Unpublishing requires a separate documented maintainer decision. The authorized
retirement of the twelve scoped packages is recorded in the
[single-package decision](./.agents/notes/implemented/architecture/2026-09-08-single-application-entry.md);
execute it only after the replacement is usable and npm eligibility is checked.

Authoritative platform behavior is documented by
[Release Please](https://github.com/googleapis/release-please),
[GitHub immutable releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes),
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/),
[npm trusted-publisher management](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[npm distribution tags](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/),
and [pnpm Workspace publishing](https://pnpm.io/workspaces).
