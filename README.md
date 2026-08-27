# Harapter

> One API for every agent harness.

[简体中文](./README.zh-CN.md) · [Design documents](./docs/design/README.md) ·
[Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md)

Harapter is an open-source, stateful adapter layer for agent harnesses. It gives
applications a stable API for clients, sessions, runs, streaming events,
interactions, capabilities, and errors while provider packages translate those
contracts to public SDKs and machine protocols.

## Project status

Harapter is currently **pre-alpha and design-first**. The architecture and API
contracts are being validated before the first provider implementation is
published. No npm, PyPI, or CLI package is available yet.

## Why Harapter

Agent harnesses expose different concepts and transports: threads and turns,
sessions and prompts, embedded SDKs, JSON-RPC processes, HTTP services, SSE, and
WebSockets. A host application should not need to rebuild its entire execution
layer for every provider.

```text
Host application
      │
      │  Portable Harapter API
      ▼
Harapter Core
      │
      ├── Provider adapter ──▶ embedded SDK
      ├── Provider adapter ──▶ process / RPC
      └── Provider adapter ──▶ HTTP / streaming service
```

Harapter provides:

- a portable core for sessions, runs, events, interactions, and errors;
- runtime capability discovery instead of provider-name assumptions;
- independently installable provider adapters;
- typed provider extensions and a native escape hatch;
- conformance tests that isolate upstream breaking changes;
- explicit session ownership, so native state is never silently moved between
  incompatible harnesses.

## Non-goals

Harapter does not implement an agent loop, install or update third-party
runtimes, translate provider checkpoints, manage plugin marketplaces, or own a
host application's task database and security policy.

## Repository layout

```text
docs/       Current architecture and API design
packages/   Portable core, schema, transports, and conformance packages
providers/  Independently versioned provider adapters
examples/   Reference integrations
fixtures/   Redacted protocol fixtures
licenses/   Third-party notices and license records
```

Only `docs/` is populated today. The other directories reserve the reviewed
project boundaries and will be filled through pull requests.

## Development

```bash
corepack enable
pnpm install
pnpm check
```

The repository uses Conventional Commits. Pull requests run formatting,
type-aware linting, strict TypeScript checks, Vitest coverage, workspace builds,
Markdown, repository-integrity, and link checks. After an explicitly approved
first usable pre-alpha milestone, maintainers can start Release Please to
prepare a release pull request; no release automation runs on ordinary `main`
pushes before then.

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [RELEASING.md](./RELEASING.md) for
the complete workflow.

## License

Licensed under the [Apache License 2.0](./LICENSE).
