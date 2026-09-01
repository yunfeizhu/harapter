# Harapter

> One portable, stateful API for agent harnesses.

[![CI](https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml/badge.svg)](https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)

[English](./README.md) · [简体中文](./README.zh-CN.md) ·
[日本語](./README.ja.md) · [Design](./docs/design/README.md) ·
[Examples](./examples/README.md) · [Contributing](./CONTRIBUTING.md)

Harapter is an open-source adapter layer for applications that work with more
than one agent harness. Applications use one TypeScript contract for Clients,
Sessions, Runs, streaming Events, Interactions, Capabilities, and Errors;
independent Provider Adapters translate that contract to official SDKs and
machine protocols.

Harapter does not replace an agent runtime. The host selects, installs,
authenticates, and secures every runtime it uses.

## Why Harapter

- **One lifecycle, different harnesses.** Build the host workflow once and
  select a Harness Profile per task.
- **State stays with its owner.** Every Session remains bound to the Provider,
  connection Profile, and native state that created it.
- **Capabilities are evidence, not guesses.** `native`, `emulated`,
  `adapter_controlled`, `unsupported`, and `unknown` remain distinct.
- **Lifecycle outcomes stay honest.** A process or connection abort never
  masquerades as native Run cancellation.
- **Provider-native features remain reachable.** Typed extensions and an
  explicit native escape hatch preserve behavior that is not portable.
- **Unknown events stay observable.** Adapters retain them through bounded,
  redacted Provider channels instead of guessing a successful result.

## Architecture

```text
Host application
      │
      │  @harapter/core
      ▼
HarnessRegistry ──▶ Client ──▶ Session ──▶ Run ──▶ Events + Result
      │
      ├── Codex Adapter ─────▶ App Server / JSON-RPC stdio
      ├── OpenCode Adapter ──▶ HTTP + SSE
      ├── Claude Adapter ────▶ Agent SDK
      ├── DSH Adapter ───────▶ SDK Runtime / JSON-RPC stdio
      ├── Hermes Adapter ────▶ API Server / HTTP + SSE
      ├── OpenClaw Adapter ──▶ ACP v1 / JSON-RPC stdio
      └── Pi Adapter ────────▶ strict JSONL process RPC
```

Core imports no Provider SDK, contains no Provider-name branches, and never
infers capability support from Provider identity. Adapters own protocol mapping,
compatibility checks, bounded transport behavior, and redacted fixtures.

## Implemented today

| Layer             | Implemented modules                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Portable API      | Core contracts and Registry for Client, Session, Run, Event, Interaction, Capability, Error, extensions, and native access |
| Transports        | JSON-RPC stdio, strict JSONL process RPC, bounded HTTP/SSE, and ACP v1                                                     |
| Provider Adapters | Codex, OpenCode, Claude, DeepSeek Harness, Hermes Agent, OpenClaw, and Pi Agent                                            |
| Evidence          | Redacted fixtures, mapping and lifecycle tests, Provider-negative tests, and shared conformance                            |
| References        | Single-Provider lifecycle app and concurrent multi-Provider client                                                         |

### Provider evidence status

| Provider                                      | Official interface        | Current status                                                                     |
| --------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| [Codex](./providers/codex/README.md)          | stable App Server         | Verified source Adapter with fixture, conformance, and live-runtime evidence       |
| [OpenCode](./providers/opencode/README.md)    | stable HTTP/OpenAPI + SSE | Verified source Adapter with fixture, conformance, and live-runtime evidence       |
| [Claude](./providers/claude/README.md)        | Claude Agent SDK          | Experimental; deterministic evidence exists, live-runtime evidence is not recorded |
| [DeepSeek Harness](./providers/dsh/README.md) | SDK Runtime JSON-RPC      | Experimental; deterministic evidence exists, live-runtime evidence is not recorded |
| [Hermes Agent](./providers/hermes/README.md)  | API Server HTTP/SSE       | Experimental; deterministic evidence exists, live-runtime evidence is not recorded |
| [OpenClaw](./providers/openclaw/README.md)    | ACP v1 bridge             | Experimental; deterministic evidence exists, live-runtime evidence is not recorded |
| [Pi Agent](./providers/pi/README.md)          | strict JSONL RPC mode     | Experimental; deterministic evidence exists, live-runtime evidence is not recorded |

“Verified” describes the evidence held by the source Adapter, not a published
package guarantee. Adapters validate the active runtime or interface at the
relevant compatibility boundary and fail closed on incompatible structures.
“Experimental” means the Adapter is implemented and tested against redacted or
synthetic evidence, but the declared interface has no recorded live-runtime
evidence yet. Harapter does not install these runtimes to obtain that evidence.

See the [Provider matrix](./docs/design/provider-matrix.md) and each Provider
README for exact capabilities and compatibility boundaries.

## Explore the references

- [Single-Provider reference](./examples/single-provider/README.md) — one
  complete Client → Session → Run → Event → Result lifecycle with safe cleanup.
- [Multi-Provider reference](./examples/multi-provider-client/README.md) —
  Profile routing, concurrent streams, Session-level controls, ownership
  validation, and an explicit Provider-extension boundary.

The references do not discover, install, authenticate, or invoke a third-party
runtime during the default test suite.

## Project status

Harapter is **pre-alpha**. The TypeScript implementation is usable from this
workspace for evaluation, but every package remains private at `0.0.0`; no npm,
PyPI, or CLI distribution has been released. The first public release will
follow API, packaging, provenance, publishing, and rollback review.

Current stabilization work is focused on consumer feedback, host-operated live
evidence for experimental Adapters, and release readiness. Portable wire
schemas, non-TypeScript SDKs, and a local-socket transport will be added when a
real consumer requires them. Goose, Qwen Code, Crush, GitHub Copilot CLI, and
Cursor Agent CLI are outside the current implementation scope.

## Develop from source

Prerequisites: Node.js 24 and Corepack. The repository pins its pnpm version.

```bash
git clone https://github.com/yunfeizhu/harapter.git
cd harapter
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs formatting, type-aware linting, strict TypeScript checks,
coverage, all workspace builds, Markdown and link checks, repository
consistency, and Agent governance checks.

## Documentation

- [Architecture and target design](./docs/design/README.md)
- [Portable Core contract](./packages/core/README.md)
- [Provider implementation guide](./docs/design/provider-adapter-guide.md)
- [Development workflow](./docs/development.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Release policy](./RELEASING.md)

## Non-goals

Harapter does not implement an agent loop, install or update Provider runtimes,
translate native checkpoints between harnesses, own host task storage, manage
Provider plugin marketplaces, resolve credentials, or silently change a host
application's security policy.

## License

Licensed under the [Apache License 2.0](./LICENSE).
