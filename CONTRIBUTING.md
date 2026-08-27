# Contributing to Harapter

Thank you for helping build Harapter. The project is design-first and keeps the
portable core deliberately small.

## Before opening an issue

- Use a bug report only for behavior implemented in the repository.
- Use a design proposal for public API, lifecycle, compatibility, architecture,
  security, or governance changes.
- Use a provider request for a new harness integration.
- Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).

Non-trivial public API, provider, compatibility, security, lifecycle, and
process work starts from an issue or design proposal. The pull request links it
with `Closes #<number>`.

## Development setup

Requirements:

- Node.js 24 or later;
- Corepack;
- pnpm 11.

```bash
corepack enable
pnpm install
pnpm check
```

The complete branch, commit, pull request, and release procedure lives in the
[development workflow](./docs/development.md). Coding agents also follow the
root and nearest subtree [Agent Guides](./AGENTS.md).

## Pull request requirements

- Create one focused, short-lived task branch from the latest `main`; do not use
  a long-lived `develop` branch.
- Use the repository branch naming scheme and a Conventional Commit pull request
  title.
- Add tests before executable behavior and update the owning documentation.
- Add or update an [Agent Note](./.agents/notes/README.md) for every non-trivial
  durable decision.
- Run `pnpm check` plus the focused evidence required by the changed surface.
- Complete the pull request template with exact verification and compatibility
  impact.
- Resolve review conversations and wait for `Repository checks`,
  `Pull request metadata`, and `Dependency review`.
- Eligible trusted, non-breaking pull requests enable GitHub's native squash
  auto-merge after creation. Forks, release pull requests, and changes needing
  maintainer judgement remain manual.

Examples of valid pull request titles:

```text
feat(core): add versioned session references
fix(dsh): preserve unknown JSON-RPC notifications
docs: clarify cancellation semantics
chore(deps): update markdown tooling
```

Use `!` for a breaking change and document migration:

```text
feat(core)!: split session and run event scopes
```

## Provider acceptance

A provider is not supported until it has:

- a documented official machine interface and license boundary;
- session, run, event, capability, error, interaction, and cleanup mappings;
- redacted fixtures with provenance;
- the shared conformance suite and provider-specific negative tests;
- live-runtime evidence for the declared compatibility range when available;
- documented provider extensions, native access, and known limitations.

See the [Provider Agent Guide](./providers/AGENTS.md) and
[provider implementation skill](./.agents/skills/harapter-provider-implementation/SKILL.md).

## Certificate of origin

By contributing, you certify that you have the right to submit the work under
this repository's Apache-2.0 license. Add a Developer Certificate of Origin
sign-off to each commit:

```bash
git commit -s
```

See [developercertificate.org](https://developercertificate.org/) for the full
certificate.
