# Releasing Harapter

Release Please owns versions, changelogs, tags, and GitHub Releases. A separate
manual workflow publishes only an existing immutable GitHub Release to npm.

## Release model

The Workspace root and examples stay private. The public packages listed in
[`scripts/public-packages.json`](./scripts/public-packages.json) use one
synchronized pre-1.0 version. Internal `workspace:*` dependencies become exact
versions in npm tarballs.

Pre-alpha packages are published with the npm `next` dist-tag. Consumers must
opt in with `@next`; the `latest` tag is reserved for a later stability
decision. `feat` produces a minor release, `fix` produces a patch release, and
`!` or a `BREAKING CHANGE` footer produces a major release.

## GitHub release flow

Release Please remains manual-only and runs from `main`:

```bash
gh workflow run release-please.yml --ref main
```

1. Squash-merge eligible Conventional Commit pull requests into `main`.
2. With explicit release authorization, dispatch Release Please from `main`.
3. Use the [Harapter release skill](./.agents/skills/harapter-release/SKILL.md)
   to verify that every version artifact and the changelog agree.
4. Require every applicable check on the exact release pull request head.
5. Manually merge the release pull request after maintainer review. Release
   Please pull requests do not use auto-merge.
6. Before the first release, enable GitHub immutable releases with explicit
   authorization; the setting protects only releases created afterward.
7. With explicit publication authorization, dispatch Release Please from `main`
   again to create the immutable tag and GitHub Release.

The first approved pre-alpha version is `0.1.0`. Release Please owns the
generated `CHANGELOG.md`; Markdown and link validation still apply.

## npm publication flow

The `publish-npm.yml` workflow accepts a `vX.Y.Z` GitHub Release tag. It
resolves that tag to an immutable commit, rebuilds and verifies the Workspace,
packs public packages, and publishes in dependency order with provenance. It
never publishes a branch head or a locally built artifact. The immutable Release
tag must resolve exactly to the dispatch run's current `main` commit.

The protected `npm` environment is the approval boundary. Normal publication
uses GitHub Actions OIDC and stores no long-lived npm token.

After the GitHub Release exists, an explicitly authorized maintainer dispatches:

```bash
gh workflow run publish-npm.yml \
  --ref main \
  -f release_tag=v0.1.0 \
  -f bootstrap=false
```

Replace the tag as needed. Leave `bootstrap` false after the first publication.

The publisher checks registry SHA-512 integrity, the `next` dist-tag, and npm's
cryptographically verified provenance before skipping existing content. A
conflict stops publication. Recover a partial publication by rerunning the same
failed workflow run; a new dispatch is rejected after `main` advances.

## One-time npm bootstrap

npm requires a package to exist before a trusted publisher can be configured.
The first `0.1.0` publication therefore has a one-time bootstrap path:

1. Confirm control of the `@harapter` npm scope, account two-factor
   authentication, and intended reviewers on the GitHub `npm` environment.
2. Create a short-lived granular npm access token limited to creating and
   publishing the scoped public packages. Store it only as the
   `NPM_BOOTSTRAP_TOKEN` secret of the protected `npm` environment.
3. Create the `v0.1.0` GitHub Release through the normal Release Please flow.
4. With explicit publication authorization, dispatch `publish-npm.yml` for
   `v0.1.0` with `bootstrap=true`.
5. Verify every package, `next` dist-tag, provenance attestation, and content.
6. Delete `NPM_BOOTSTRAP_TOKEN` from GitHub and revoke it on npm.
7. Configure each published package's trusted publisher for repository
   `yunfeizhu/harapter`, workflow `publish-npm.yml`, and environment `npm`.
   Restrict token-based package access after trusted publishing is active.

The bootstrap flag rejects any version except `0.1.0`. It is not a fallback for
later OIDC failures.

## Verification

Before release review, `pnpm check` must pass. Its package gate validates public
manifests, publish policy, dependency order, tarball contents, `workspace:*`
rewrites, runtime imports, and strict TypeScript imports from an isolated
consumer.

After publication, use
`npm view <name>@<version> version dist-tags dist.integrity` for every policy
package. Confirm that provenance identifies the repository, workflow, tag
commit, and GitHub-hosted runner.

## Recovery and rollback

Inspect existing release state and the failed job before retrying. A merged
release pull request without its second Release Please dispatch is pending, not
broken. Recover partial npm publication by rerunning the same failed workflow.

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
