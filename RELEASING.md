# Releasing Harapter

Harapter uses Release Please. Maintainers do not edit versions, changelogs,
tags, or GitHub Releases manually.

## Release activation

Harapter does not prepare releases automatically while its first portable
contracts and provider adapters are still being established. The Release Please
workflow is manual-only. A maintainer enables the repository setting that lets
GitHub Actions create pull requests and explicitly dispatches the workflow only
after approving the first usable pre-alpha milestone. Every dispatch uses the
reviewed workflow on `main`:

```bash
gh workflow run release-please.yml --ref main
```

Until then, `main` remains at version `0.0.0`: feature commits do not create a
release pull request, tag, GitHub Release, or registry artifact. Changing the
workflow back to an automatic `main` trigger is a reviewed repository-policy
change, not an incidental consequence of merging the first feature.

The first approved pre-alpha release is configured as `0.1.0`. Release Please
owns the generated `CHANGELOG.md`, so Prettier does not rewrite it; Markdown and
link validation still apply. Repository metadata checks accept both GitHub
Actions bot login forms observed on generated pull requests.

## Release flow

1. Pull requests are squash-merged into `main` with Conventional Commit titles.
2. After release activation, a maintainer dispatches Release Please from `main`.
   It reads releasable commits and creates or updates one release pull request.
3. The release workflow explicitly dispatches repository checks for that exact
   bot-branch head because resources created by the default workflow token do
   not trigger ordinary pull request workflows.
4. A maintainer verifies version impact, changelog, migration guidance, and all
   applicable exact-head checks with the
   [Harapter release skill](./.agents/skills/harapter-release/SKILL.md).
5. A maintainer merges the release pull request.
6. A maintainer dispatches Release Please from `main` a second time.
7. Release Please creates the Git tag and GitHub Release.

Release Please branches do not enable native auto-merge even when deterministic
checks pass. The merge publishes release state and therefore remains an explicit
maintainer action.

`feat` produces a minor release, `fix` produces a patch release, and a commit
with `!` or a `BREAKING CHANGE` footer produces a major release. Documentation
and routine maintenance commits do not trigger a release.

## Package publishing

The initial workflow creates GitHub Releases only. npm, PyPI, binary, and
container publication is enabled per package after all of the following are
reviewed:

- package ownership and namespace;
- provenance or trusted publishing without a long-lived registry token;
- build, package-consumer, and conformance evidence;
- artifact signing or attestations where appropriate;
- rollback, deprecation, and incident policy.

## Recovery

If a release workflow fails, inspect the existing pull request, tag, release,
and failed job before retrying. A merged release pull request without its second
manual dispatch is pending publication, not a reason to edit or recreate release
state. Never delete, move, or recreate a published tag without a documented
incident decision.
