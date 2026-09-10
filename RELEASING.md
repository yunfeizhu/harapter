# Releasing Harapter

Release Please owns versions, changelogs, tags and draft Releases. Verified
assets precede publication; npm remains separate.

## Release model

Only `harapter` is public under
[`scripts/public-packages.json`](./scripts/public-packages.json). Other
workspaces stay private; implementation modules are bundled without
`@harapter/*` dependencies. npm `latest` is the default channel, not an API
stability guarantee. `feat` produces a minor release, `fix` a patch, and `!` or
`BREAKING CHANGE` a major.

## GitHub release flow

Release Please is manual-only:

```bash
gh workflow run release-please.yml --ref main -f operation=prepare
# After manually merging the release pull request:
gh workflow run release-please.yml --ref main -f operation=finalize
```

1. Squash-merge eligible Conventional Commit PRs into `main`.
2. With release authorization, dispatch `prepare` from `main`. Verify generated
   versions and changelog using the
   [release skill](./.agents/skills/harapter-release/SKILL.md).
3. Review the exact bot PR head, then approve its pending native `ci.yml` run.
   [GitHub requires approval for bot-created PR workflows](https://docs.github.com/en/actions/concepts/security/github_token).
   Select **Approve workflows to run**, or use the
   [workflow-run approval API](https://docs.github.com/en/rest/actions/workflow-runs).
   Match the pending run's PR and head before approving.
4. Wait for `Repository checks`, `Pull request metadata`, and
   `Dependency review`. Recheck the unchanged head and merge manually; never
   enable auto-merge.
5. Keep immutable releases enabled. With publication authorization, dispatch
   `finalize`. It creates a draft, verifies its commit and assets, then
   publishes. `prepare` cannot create Releases; `finalize` cannot create PRs.

Preparation neither approves workflows nor dispatches duplicate CI. Manual CI
checks the repository only; it cannot replace PR approval or required checks. Do
not change tokens or merge protection to avoid approval.

Release assets are the policy-listed tarballs, `harapter-X.Y.Z.spdx.json`, and
`SHA256SUMS.txt`. The deterministic SPDX SBOM binds the commit and tarballs.

## npm publication flow

The protected `npm` environment gates OIDC publication with provenance and no
long-lived token. `publish-npm.yml` reproduces the immutable Release assets and
publishes those tarballs. Its dispatch ref and input must identify the same tag.

After GitHub publication, an authorized maintainer runs:

```bash
release_tag=harapter-vX.Y.Z
gh workflow run publish-npm.yml \
  --ref "$release_tag" \
  -f release_tag="$release_tag" \
  -f bootstrap=false
```

Replace `X.Y.Z` with the approved version. Missing tarballs share a 20-minute
availability window for
[npm scanning](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/).
SHA-512, `latest`, provenance, timeout and conflicts remain fail-closed.

## One-time npm bootstrap

npm requires the `harapter` package to exist before trusted-publisher setup:

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
