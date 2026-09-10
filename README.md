<!-- markdownlint-disable MD033 MD041 -->

<p align="center">
  <img src="./docs/assets/harapter-banner.png" alt="Harapter connects one portable core to multiple agent harness runtimes" width="1200">
</p>

<h1 align="center">Harapter</h1>

<p align="center">
  <strong>One provider-agnostic TypeScript API for applications that orchestrate multiple agent harnesses.</strong><br>
  Use the same Client, Session, Run, streaming Event, Capability, and Error lifecycle across runtimes while each Adapter preserves Provider-owned state, observed capabilities, and native extensions.
</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./docs/api-reference.md">API reference</a> ·
  <a href="./docs/design/README.md">Design</a> ·
  <a href="./examples/README.md">Examples</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/v/harapter?style=flat-square&amp;label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/harapter"><img src="https://img.shields.io/npm/dm/harapter?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/yunfeizhu/harapter/releases"><img src="https://img.shields.io/github/v/release/yunfeizhu/harapter?display_name=tag&amp;include_prereleases&amp;sort=semver&amp;style=flat-square&amp;label=release" alt="GitHub Release"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 license"></a>
</p>

<!-- markdownlint-enable MD033 -->

Harapter is an open-source adapter layer for applications that work with more
than one agent harness. The host uses one TypeScript contract for Clients,
Sessions, Runs, streaming Events, Interactions, Capabilities, and Errors;
independent Provider Adapters translate that contract to official SDKs and
machine protocols.

It is infrastructure between an application and its chosen runtimes—not a new
agent loop. The host still selects, installs, authenticates, and secures every
runtime it uses.

## One SDK

Install **`harapter`** and call `run()` from the root entry. Choose a harness
for each task; Harapter selects its protocol mapping, connects, runs the task
and releases its handles. No Adapter import, Registry or configuration file is
needed for a single call.

## Quick start

Use Node.js 24+ and an ESM application. Choose the example for the Runtime you
already use: **DSH**, **Pi** or **OpenCode**.

**Version requirement:** these examples use `run()` and `openSession()`, which
were added after `harapter@1.0.0`. Use a release or source build that includes
these APIs; the 1.0.0 package cannot run them.

In a new application directory:

```sh
npm init -y
npm pkg set type=module
npm install harapter
```

Harapter connects to your existing Runtime. Install and authenticate only the
harness you choose, or start its HTTP server. It retains that Runtime's tools
and permissions; tasks may access its workspace and incur model charges.

Save **one** of the complete examples below as `app.ts`, then run:

```sh
node app.ts
```

### Use DSH with the same call

Have `dsh` on `PATH` and a configured model route. Replace `your-provider` and
`your-model` with that route's provider and model IDs; both are required by
DSH's SDK handshake. Harapter supplies the machine-interface arguments.

<!-- sdk-example: quick-dsh-run.ts -->

```ts
import { run, isHarnessError } from 'harapter';

try {
  const result = await run({
    harness: 'dsh',
    input: 'Hello!',
    model: { provider: 'your-provider', id: 'your-model' },
  });
  // Return result.finalMessage to your application's caller.
  console.log({ status: result.status });
  if (result.status !== 'completed') process.exitCode = 1;
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

### Pi: use your local login and model

Have `pi` on `PATH`, with its model and credentials already configured. Pi uses
those settings directly; do not pass `run.model`.

<!-- sdk-example: quick-run.ts -->

```ts
import { run, isHarnessError } from 'harapter';

try {
  const result = await run({ harness: 'pi', input: 'Hello!' });
  // Return result.finalMessage to your application's caller.
  console.log({ status: result.status });
  if (result.status !== 'completed') process.exitCode = 1;
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

### OpenCode: connect to an existing HTTP server

This example connects to an **already running OpenCode server** at
`http://127.0.0.1:4096`. Change `url` for your server. If it requires
authentication, add `headers` from your application's secret store. Model
credentials stay in OpenCode.

```ts
import { run, isHarnessError } from 'harapter';

try {
  const result = await run({
    harness: 'opencode',
    url: 'http://127.0.0.1:4096',
    input: 'Hello!',
  });
  // Return result.finalMessage to your application's caller.
  console.log({ status: result.status });
  if (result.status !== 'completed') process.exitCode = 1;
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

All three examples return the same `RunResult`: `status` is the terminal outcome
and `finalMessage` is the optional answer for your application's caller or
conversation UI. These examples log only the status. Each `run()` creates a
fresh Session, consumes events and releases its Client and Session. A returned
`failed` result and a thrown connection error are handled separately.

### Codex, Hermes and OpenClaw

Keep the import, result handling and `try/catch` above; replace only the `run()`
call with the one you need:

| Harness  | Replacement call                                      | Runtime prerequisite                                                          |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Codex    | `await run({ harness: 'codex', input: 'Hello!' })`    | `codex` on `PATH`, already authenticated; Harapter starts App Server stdio.   |
| Hermes   | `await run({ harness: 'hermes', input: 'Hello!' })`   | An existing HTTP server at `http://127.0.0.1:8642`; override `url` if needed. |
| OpenClaw | `await run({ harness: 'openclaw', input: 'Hello!' })` | `openclaw` on `PATH`, already configured; Harapter starts `openclaw acp`.     |

Runtime setup and compatibility: [DSH](./providers/dsh/README.md) ·
[Pi](./providers/pi/README.md) · [OpenCode](./providers/opencode/README.md) ·
[Codex](./providers/codex/README.md) · [Hermes](./providers/hermes/README.md) ·
[OpenClaw](./providers/openclaw/README.md)

Full options, events and Runtime bindings: [API](./docs/api-reference.md#run) ·
[SDK](./packages/harapter/README.md)

## Continue a conversation

Use `openSession()` once, then call `send()` for each message. The same native
Session keeps the conversation history. This API is added after 1.0.0 and is not
yet in that release.

`openSession()` accepts the same Runtime options used above. Pass the DSH
`model` or OpenCode `url`/`headers` when needed, then keep using the same
`chat.send()` calls. An existing Session remains bound to its original Runtime.

<!-- sdk-example: quick-chat.ts -->

```ts
import { openSession, isHarnessError } from 'harapter';

try {
  const chat = await openSession({ harness: 'pi' });
  try {
    const first = await chat.send('My name is Alex.');
    // Return finalMessage to your application's authorized conversation UI.
    console.log({
      status: first.status,
      hasText: first.finalMessage !== undefined,
    });
    const second = await chat.send('What is my name?');
    console.log({
      status: second.status,
      hasText: second.finalMessage !== undefined,
    });
  } finally {
    await chat.close();
  }
} catch (error) {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
}
```

## Why Harapter

| Principle                           | What it means for a host application                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **One lifecycle**                   | Build the orchestration flow once, then select a Harness Profile per task.                                       |
| **State has an owner**              | A Session stays bound to the Provider, connection Profile, and native state that created it.                     |
| **Capabilities are observed**       | `native`, `emulated`, `adapter_controlled`, `unsupported`, and `unknown` remain distinct.                        |
| **Terminal outcomes are honest**    | A process or connection abort never masquerades as native Run cancellation or successful completion.             |
| **Native behavior stays reachable** | Typed extensions and an explicit native escape hatch preserve useful behavior that is not portable.              |
| **Unknown events stay observable**  | Bounded, redacted Provider channels retain upstream changes without guessing them into a portable success event. |

## Architecture

<!-- markdownlint-disable MD033 -->

<p align="center">
  <img src="./docs/assets/harapter-architecture.svg" alt="Harapter portable lifecycle and Provider Adapter architecture" width="1200">
</p>

<!-- markdownlint-enable MD033 -->

Core imports no Provider SDK, contains no Provider-name branches, and never
infers capability support from Provider identity. Adapters own protocol mapping,
compatibility checks, bounded transport behavior, and redacted fixtures.

### The portability boundary

| Harapter normalizes                                                             | The Provider or host still owns                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Profile selection and dynamic Adapter registration                              | Runtime installation, updates, authentication, and licensing                         |
| Client, Session, Run, ordered Event stream, and authoritative terminal Result   | Agent loops, prompts, models, tools, plugins, skills, and native configuration       |
| Capability modes, portable Errors, Interactions, and lifecycle ownership checks | Native checkpoints, Provider storage, and service availability                       |
| Typed Provider extensions plus a deliberate native escape hatch                 | Host task storage, credential resolution, and the host application's security policy |

## Implemented modules

| Area                  | Responsibilities and guides                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portable API**      | [`harapter`](./packages/core/README.md) — contracts, Registry, capability requirements, ownership checks, Errors, extensions, and native access                                                                                                                     |
| **Conformance**       | [Conformance tests](./packages/conformance/README.md) — reusable portable behavior suite and deterministic Fake Provider                                                                                                                                            |
| **Transports**        | [JSON-RPC stdio](./packages/transport-jsonrpc-stdio/README.md), [strict JSONL process RPC](./packages/transport-jsonl-process/README.md), [HTTP/SSE](./packages/transport-http-sse/README.md), and [ACP v1](./packages/transport-acp/README.md)                     |
| **Provider Adapters** | [Codex](./providers/codex/README.md), [OpenCode](./providers/opencode/README.md), [DeepSeek Harness](./providers/dsh/README.md), [Hermes Agent](./providers/hermes/README.md), [OpenClaw](./providers/openclaw/README.md), and [Pi Agent](./providers/pi/README.md) |
| **References**        | [Single-Provider lifecycle](./examples/single-provider/README.md) and [concurrent multi-Provider client](./examples/multi-provider-client/README.md)                                                                                                                |

## Evidence before support

A matrix entry alone is not a support claim. An Adapter needs an implementation,
redacted fixtures, protocol mapping and lifecycle tests, Provider-negative
tests, shared conformance, a declared compatibility boundary, and live-runtime
evidence before Harapter describes the interface as supported in source.

| Provider                                      | Official interface        | Current evidence status                                                                         |
| --------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| [Codex](./providers/codex/README.md)          | stable App Server         | **Supported in source** — fixture, conformance, compatibility, and live evidence                |
| [OpenCode](./providers/opencode/README.md)    | stable HTTP/OpenAPI + SSE | **Supported in source** — fixture, conformance, compatibility, and live evidence                |
| [DeepSeek Harness](./providers/dsh/README.md) | SDK Runtime JSON-RPC      | **Experimental in source** — live evidence exists; Runtime compatibility is not negotiated      |
| [Hermes Agent](./providers/hermes/README.md)  | API Server HTTP/SSE       | **Experimental in source** — live-verified with 0.21.0; Runtime compatibility is not negotiated |
| [OpenClaw](./providers/openclaw/README.md)    | ACP v1 bridge             | **Supported in source** — fixture, conformance, compatibility, and live text Run evidence       |
| [Pi Agent](./providers/pi/README.md)          | strict JSONL RPC mode     | **Experimental in source** — live-verified with 0.84.4; Runtime compatibility is not negotiated |

“Supported in source” describes evidence held by the source Adapter, not a
published package guarantee. “Experimental in source” means the Adapter is
implemented and deterministically tested against its declared interface, but
either required live-runtime evidence is outstanding or the connected Runtime
cannot be matched safely to verified evidence. Harapter libraries never install
Provider runtimes in a host application. The trusted live-canary workflow may
install selected current runtimes only inside ephemeral GitHub-hosted jobs to
collect recurring evidence.

See the [Provider matrix](./docs/design/provider-matrix.md) and each Provider
README for exact capabilities and compatibility boundaries.

## More examples

Start with the
[independent SDK application](./examples/sdk-application/README.md) for
user-facing integration recipes.

- [Single-Provider reference](./examples/single-provider/README.md) shows a full
  Client → Session → Run → Event → Result lifecycle with safe cleanup.
- [Multi-Provider reference](./examples/multi-provider-client/README.md) shows
  Profile routing, concurrent streams, Session-level controls, ownership
  validation, and an explicit Provider-extension boundary.

Both references are deterministic by default: their tests do not discover,
install, authenticate, or invoke a third-party runtime. Optional live entry
points run only when the host supplies an explicit runtime configuration.

### Run repository references (contributors, optional)

Clone the repository only to develop Harapter or work on its maintained
references. The Workspace pins pnpm 11.23.0:

```sh
git clone https://github.com/yunfeizhu/harapter.git
cd harapter
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

## Project status

Only `harapter` is published on npm under `latest`. Core, Adapters, transports,
conformance, the Workspace root and examples are private. Release Please owns
the public package version; reviewed tarball checks, provenance and rollback
controls remain required. Harapter publishes no PyPI package or standalone CLI.

Current stabilization work focuses on consumer feedback, host-operated live
evidence for experimental Adapters, and release readiness. Portable wire
schemas, non-TypeScript SDKs, and a local-socket transport will be added when a
real consumer requires them. Goose, Qwen Code, Crush, GitHub Copilot CLI, and
Cursor Agent CLI are outside the current implementation scope.

## Documentation

| Start here                                                               | Use it for                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| [Architecture and target design](./docs/design/README.md)                | System boundaries, invariants, contracts, and design sequence |
| [Portable Core contract](./packages/core/README.md)                      | Public TypeScript API and ownership semantics                 |
| [Provider matrix](./docs/design/provider-matrix.md)                      | Per-Provider interface, evidence, and capability status       |
| [Provider implementation guide](./docs/design/provider-adapter-guide.md) | Building an Adapter without weakening portable truth          |
| [Development workflow](./docs/development.md)                            | Toolchain, branches, validation, review, and pull requests    |
| [Contributing](./CONTRIBUTING.md)                                        | Contribution expectations and repository workflow             |
| [Security policy](./SECURITY.md)                                         | Reporting vulnerabilities and supported security boundaries   |
| [Release policy](./RELEASING.md)                                         | Release Please, versioning, and publication readiness         |

## Frequently asked questions

### Does Harapter install or manage agent runtimes?

No. Runtime selection, installation, authentication, credentials, licensing, and
security policy remain host responsibilities.

### Can a Session move between Providers or connection Profiles?

No. A Session remains bound to its creating Provider, Profile, and opaque native
state. Moving work requires creating a new Session; Harapter does not imply
checkpoint portability.

### Does disconnecting a process cancel a Run?

Not unless the Provider proves native cancellation. A transport abort and a
Provider-acknowledged cancellation are different lifecycle outcomes.

### Are experimental Adapters placeholders?

No. They include implementations, bounded and redacted fixtures, mapping and
lifecycle tests, Provider-negative coverage, shared conformance, and declared
compatibility boundaries. The experimental label records an unresolved
live-evidence or Runtime-compatibility probe boundary rather than missing
deterministic implementation evidence.

### How are packages versioned and published?

Release Please versions the single `harapter` package and creates immutable
GitHub Releases containing its verified tarball, SPDX SBOM and SHA-256
checksums. A separately authorized workflow publishes that exact tarball to npm
with provenance under `latest`. Internal modules have no separate release train.

## Non-goals

Harapter does not implement an agent loop, install or update Provider runtimes,
translate native checkpoints between harnesses, own host task storage, manage
Provider plugin marketplaces, resolve credentials, or silently change a host
application's security policy.

## License

Licensed under the [Apache License 2.0](./LICENSE).
