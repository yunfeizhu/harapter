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
  <a href="./docs/design/README.md">Design</a> ·
  <a href="./examples/README.md">Examples</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/v/%40harapter%2Fcore?style=flat-square&amp;label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@harapter/core"><img src="https://img.shields.io/npm/dm/%40harapter%2Fcore?style=flat-square" alt="npm downloads"></a>
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

## Packages on npm

| Package                                                                                                | Documentation                                         |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                                       | [Guide](./packages/core/README.md)                    |
| [`@harapter/transport-jsonrpc-stdio`](https://www.npmjs.com/package/@harapter/transport-jsonrpc-stdio) | [Guide](./packages/transport-jsonrpc-stdio/README.md) |
| [`@harapter/transport-jsonl-process`](https://www.npmjs.com/package/@harapter/transport-jsonl-process) | [Guide](./packages/transport-jsonl-process/README.md) |
| [`@harapter/transport-http-sse`](https://www.npmjs.com/package/@harapter/transport-http-sse)           | [Guide](./packages/transport-http-sse/README.md)      |
| [`@harapter/transport-acp`](https://www.npmjs.com/package/@harapter/transport-acp)                     | [Guide](./packages/transport-acp/README.md)           |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)                         | [Guide](./packages/conformance/README.md)             |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)                     | [Guide](./providers/codex/README.md)                  |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)                         | [Guide](./providers/dsh/README.md)                    |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)                   | [Guide](./providers/hermes/README.md)                 |
| [`@harapter/adapter-openclaw`](https://www.npmjs.com/package/@harapter/adapter-openclaw)               | [Guide](./providers/openclaw/README.md)               |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode)               | [Guide](./providers/opencode/README.md)               |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)                           | [Guide](./providers/pi/README.md)                     |

## Quick start

Use Node.js 24 or newer. Start in your own project; normal applications install
Core plus the Adapter they need. Transport and conformance packages are for
Adapter development and tests. No Harapter repository checkout is required.

### 1. Install the SDK in your application

```sh
mkdir my-harapter-app
cd my-harapter-app
npm init -y
npm pkg set type=module
npm install @harapter/core @harapter/adapter-codex
npm install -D typescript @types/node
```

| Runtime          | Published Adapter                                              | Connection owned by        |
| ---------------- | -------------------------------------------------------------- | -------------------------- |
| Codex            | [`@harapter/adapter-codex`](./providers/codex/README.md)       | Adapter-managed process    |
| OpenCode         | [`@harapter/adapter-opencode`](./providers/opencode/README.md) | Host/external HTTP service |
| DeepSeek Harness | [`@harapter/adapter-dsh`](./providers/dsh/README.md)           | Adapter-managed process    |
| Hermes Agent     | [`@harapter/adapter-hermes`](./providers/hermes/README.md)     | Host/external HTTP service |
| OpenClaw         | [`@harapter/adapter-openclaw`](./providers/openclaw/README.md) | Adapter-managed ACP bridge |
| Pi Agent         | [`@harapter/adapter-pi`](./providers/pi/README.md)             | Adapter-managed process    |

### 2. Prepare and authenticate a Runtime

For this example, install Codex using the
[official instructions](https://developers.openai.com/codex/cli/), then run
`codex` once and complete sign-in. The Runtime owns model authentication and may
consume tokens. Harapter uses its machine interface and does not install or
authenticate it. Create an empty test Workspace and keep the default read-only
policy.

### 3. Run a complete SDK call

Save the following as `app.ts`. It imports only the npm packages installed
above; Node.js 24 can execute this TypeScript directly.

<!-- sdk-example: quick-codex.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from '@harapter/core';
import {
  CODEX_PROVIDER_ID,
  createCodexProviderFactory,
} from '@harapter/adapter-codex';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createCodexProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-codex'),
    providerId: CODEX_PROVIDER_ID,
    displayName: 'Application codex',
    connection: {
      kind: 'process',
      command: required('HARAPTER_CODEX_COMMAND'),
      args: ['app-server', '--stdio'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({
      workspace: { uri: pathToFileURL(workspace).href },
      providerOptions: {
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
      },
    });
    const run = await session.start(
      {
        parts: [
          {
            type: 'text',
            text: 'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
          },
        ],
      },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      if (event.type === 'interaction.requested')
        throw new Error('Configure an explicit host interaction handler.');
      console.log({ type: event.type, sequence: event.sequence });
    }
    const result = await run.result();
    // Use result.finalMessage in your authorized application UI or response.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
    });
    if (result.status !== 'completed') process.exitCode = 1;
  } finally {
    // Client shutdown also releases an active Run if application event handling fails.
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

void main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
```

Run it from your project (POSIX shell shown; set the same environment variables
in PowerShell on Windows):

```sh
mkdir workspace
export HARAPTER_CODEX_COMMAND=codex
export HARAPTER_WORKSPACE="$PWD/workspace"
node app.ts
```

Expected output: lifecycle event types, followed by
`{ status: "completed", hasText: true }`. `result.finalMessage` is the model
text to return to your authorized application UI; the sample logs metadata only.
A failed or cancelled Run is not a completed answer. Each task has a 60-second
deadline and every resource is closed.

### 4. Integrate with your business code

Move connection configuration into your composition module and expose a service
function to your request handler or desktop application. The
[complete SDK application](./examples/sdk-application/README.md) includes its
own `package.json`, TypeScript configuration, a service returning text and
status, reconnection/resume, native fork, cancellation, concurrent Providers and
host interaction handling. It uses published dependencies and can be copied into
an independent project.

Use `isHarnessError(error)` to read the stable `code` and `retryable` fields.
Correct missing Runtime/authentication settings before retrying. Keep draining
`run.events()` and use `run.result()` as terminal authority. Persist Session
references only under the original Provider/Profile and an access-controlled
host storage policy. Do not log raw events, native state, credentials or
content.

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

| Area                  | Packages and modules                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portable API**      | [`@harapter/core`](./packages/core/README.md) — contracts, Registry, capability requirements, ownership checks, Errors, extensions, and native access                                                                                                               |
| **Conformance**       | [`@harapter/conformance`](./packages/conformance/README.md) — reusable portable behavior suite and deterministic Fake Provider                                                                                                                                      |
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

Harapter uses synchronized **0.x** package versions and the default npm `latest`
channel. Public packages have reviewed manifests, tarball consumer checks,
provenance, publishing, and rollback controls. The API may change before 1.0;
check npm or GitHub Releases for the currently published version. The Workspace
root and examples remain private, and Harapter does not publish a PyPI or
standalone CLI distribution.

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

Public Core, conformance, transport, and Adapter packages move together on one
pre-1.0 version and publish under `latest`. The Workspace root and examples stay
private. Release Please publishes 12 verified tarballs, an SPDX SBOM, and
SHA-256 checksums in each immutable GitHub Release; a separately authorized
workflow publishes those exact tarballs to npm with provenance.

## Non-goals

Harapter does not implement an agent loop, install or update Provider runtimes,
translate native checkpoints between harnesses, own host task storage, manage
Provider plugin marketplaces, resolve credentials, or silently change a host
application's security policy.

## License

Licensed under the [Apache License 2.0](./LICENSE).
