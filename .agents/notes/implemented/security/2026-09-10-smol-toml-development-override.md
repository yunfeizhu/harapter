# Agent Note: Temporary TOML parser security override

Status: implemented

## Problem

The development tool `markdownlint-cli2@0.23.2` pins `smol-toml@1.7.0`.
[GHSA-7w5x-hrqm-74c2](https://github.com/squirrelchat/smol-toml/security/advisories/GHSA-7w5x-hrqm-74c2)
describes an infinite loop on malformed TOML arrays and inline tables ending in
an unterminated comment. The fixed parser version is `1.7.1`. On 2026-09-10, the
latest published Markdown CLI still pins the affected version.

## Decision

The root [pnpm configuration](../../../../pnpm-workspace.yaml) overrides only
`markdownlint-cli2@0.23.2>smol-toml` to `1.7.1`. The generated lockfile records
the patched registry artifact and its integrity. The patch release fixes the
parser boundary while keeping the direct development dependency unchanged.

Remove this override when upgrading Markdown CLI to a release that resolves a
patched parser without it. Verify the replacement lockfile and audit before
removal. The selector does not constrain unrelated consumers or future parent
versions. Public Harapter runtime dependencies do not include this parser.

## Alternatives considered

### Upgrade the parent package

The latest published parent still selects `1.7.0`, so it cannot remove the
vulnerable dependency yet.

### Edit only the lockfile or add a direct parser dependency

A lockfile-only substitution is inconsistent with the parent's exact dependency
and can revert on resolution. A new direct dependency would not replace that
transitive edge. The scoped override makes the temporary exception explicit.

## Consequences

- Local checks through the Markdown CLI parser reproduce both hangs with `1.7.0`
  under a two-second child-process deadline. With `1.7.1`, both inputs throw
  `TomlError` promptly; normal scalar, array and inline-table parsing remains
  correct.
- A frozen install, dependency-chain inspection, official npm audit, and
  `pnpm check` verify dependency resolution and the consuming toolchain.
- Maintainers must remove the temporary rule when the parent adopts the fix.
  GitHub's default-branch alert remains open until the fix reaches that branch
  and its dependency graph is refreshed.
