# Agent Note: TypeScript quality gates

Status: implemented

## Problem

Harapter is moving from a design-only repository to executable TypeScript
packages. Formatting and repository-policy checks do not detect unsafe promise
handling, incomplete union branches, type regressions, untested behavior, or
package build failures. The baseline must catch those failures without copying
the cost and complexity of a mature multi-platform monorepo before Harapter has
its first package.

## Decision

Harapter uses a strict Node.js ESM TypeScript baseline shared by portable and
provider packages. ESLint covers JavaScript and TypeScript, while type-aware
rules cover TypeScript. The rules require Node.js protocol imports, enforce
explicit type-only imports, and apply Vitest rules to tests. TypeScript enables
strict optional properties, unchecked index protection, exhaustive control-flow
checks, and unused-code checks.

Vitest owns unit and integration tests. V8 coverage measures every source file
under `packages/*/src` and `providers/*/src` with per-file minimums of 90% for
statements, lines, and functions and 85% for branches. The empty bootstrap may
pass with no tests because it contains no executable package source; the first
package must add tests in the same change, after which the same command measures
its complete source set. The Vitest configuration derives this bootstrap
exception from the absence of matching source files, so adding executable source
without tests fails instead of retaining the exception.

`pnpm check` is the local and CI entry point. It runs formatting, type-aware
linting, TypeScript checking, coverage, every workspace package build, Markdown
and link validation, repository policy, and Agent governance. Individual
packages own their eventual build configuration, while the workspace root
orchestrates every declared package build. Repository policy requires every
workspace directory and a non-empty build script, preventing recursive builds
from silently skipping a new package.

This baseline adopts the flat ESLint and explicit build/test/coverage split used
by the
[Codex TypeScript SDK](https://github.com/openai/codex/blob/main/sdk/typescript/package.json)
and the Vitest, coverage, typecheck, and package-gate separation used by
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json).

## Alternatives considered

### Copy the complete DeepSeek Harness gate set

DeepSeek Harness enforces 100% per-file coverage and also runs Oxlint, duplicate
code detection, unused-file analysis, package publication checks, documentation
builds, and multiple platform-specific lanes. Those gates are appropriate for
its existing executable surface but would either do nothing or add maintenance
cost before Harapter has publishable packages and process transports. Harapter
will add package publication checks and cross-platform runtime lanes with the
first surface that can provide real evidence for them.

### Copy the Codex TypeScript SDK toolchain exactly

The Codex SDK uses Jest and a package-local bundler. Harapter instead uses
Vitest because provider conformance will need shared fixtures, filtering, and
coverage across many packages. A root bundler is deferred because portable
libraries and provider adapters may require different output and consumer-smoke
evidence.

### Keep formatting and untyped linting only

This would keep the bootstrap small but would allow lifecycle and concurrency
errors that only type-aware rules expose. It would also postpone test and
coverage semantics until after public contracts existed, when changing them
would be more disruptive.

## Consequences

All executable changes pay the cost of strict type checking, type-aware linting,
tests, per-file coverage, and a package build before review. Coverage exceptions
must remain narrow and justified; aggregate coverage cannot hide an untested
file. Tooling configuration itself remains part of repository policy.

The initial baseline deliberately does not include Oxlint, Knip, duplicate-code
checks, package publication validation, browser tests, live-provider tests, or a
platform matrix. Those gates become mandatory only when their owning package or
runtime boundary exists. The first publishable package must add export and
consumer-smoke validation, and the first managed-process or socket transport
must add relevant Windows and macOS evidence.
