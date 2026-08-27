# Releasing Harapter

Harapter uses Release Please. Maintainers do not edit versions, changelogs,
tags, or GitHub Releases manually.

## Automated release flow

1. Pull requests are squash-merged into `main` with Conventional Commit titles.
2. Release Please reads releasable commits and creates or updates one release
   pull request.
3. The release workflow explicitly dispatches repository checks for that bot
   branch because resources created by the default workflow token do not trigger
   ordinary pull request workflows.
4. A maintainer verifies version impact, changelog, migration guidance, and all
   applicable checks with the
   [Harapter release skill](./.agents/skills/harapter-release/SKILL.md).
5. A maintainer merges the release pull request.
6. Release Please creates the Git tag and GitHub Release.

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
and failed job before retrying. Never delete, move, or recreate a published tag
without a documented incident decision.
