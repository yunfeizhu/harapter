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

## Packages on npm

Install only [`harapter`](https://www.npmjs.com/package/harapter). The entries
below are modules of that SDK, not separate npm packages. The first
single-package release is pending.

| API                                 | Guide                                                 |
| ----------------------------------- | ----------------------------------------------------- |
| `harapter`                          | [Guide](./packages/harapter/README.md)                |
| `harapter/transports/jsonrpc-stdio` | [Guide](./packages/transport-jsonrpc-stdio/README.md) |
| `harapter/transports/jsonl-process` | [Guide](./packages/transport-jsonl-process/README.md) |
| `harapter/transports/http-sse`      | [Guide](./packages/transport-http-sse/README.md)      |
| `harapter/transports/acp`           | [Guide](./packages/transport-acp/README.md)           |
| `harapter/conformance`              | [Guide](./packages/conformance/README.md)             |
| `harapter/codex`                    | [Guide](./providers/codex/README.md)                  |
| `harapter/dsh`                      | [Guide](./providers/dsh/README.md)                    |
| `harapter/hermes`                   | [Guide](./providers/hermes/README.md)                 |
| `harapter/openclaw`                 | [Guide](./providers/openclaw/README.md)               |
| `harapter/opencode`                 | [Guide](./providers/opencode/README.md)               |
| `harapter/pi`                       | [Guide](./providers/pi/README.md)                     |

## Quick start

Use Node.js 24+ in your own application. The default entry is `harapter`:
configure Runtime connections and share the same task code across harnesses. Its
first npm release is pending; the commands below target that release.

### 1. Install one Harapter package

```sh
mkdir my-harapter-app
cd my-harapter-app
npm init -y
npm pkg set type=module
npm install harapter
npm install -D typescript @types/node
```

Harapter includes its own protocol mappings and loads the implementations you
select. It does not install the DSH, Pi, Codex or other Runtime distributions.
You only prepare the Runtimes your application uses. The single tarball includes
all maintained mappings; selecting fewer harnesses does not shrink that tarball.
Advanced composition uses subpaths such as `harapter/dsh` from the same SDK.

### 2. Configure the Runtimes you need

Follow the [DSH setup](./providers/dsh/README.md) for its CLI, model
credentials, `sdk-minimal` profile and no-tools Patch. Set
`HARAPTER_HARNESS=dsh`, `HARAPTER_WORKSPACE`, `HARAPTER_DSH_COMMAND`,
`HARAPTER_DSH_PATCH`, `HARAPTER_DSH_PROVIDER` and `HARAPTER_DSH_MODEL`.

For [OpenCode](./providers/opencode/README.md), prepare its authenticated,
tool-disabled server and set `HARAPTER_HARNESS=opencode`, `HARAPTER_WORKSPACE`
(an absolute directory on the server), `HARAPTER_OPENCODE_URL`,
`OPENCODE_SERVER_PASSWORD` and optionally `OPENCODE_SERVER_USERNAME` (default
`opencode`). Only the selected Profile needs its environment settings. Use an
empty test Workspace; model calls may incur charges.

### 3. Run the same application operation

Save this as `app.ts`. Both configurations call the same `runTask`; business
code imports only `harapter`.

<!-- sdk-example: quick-unified.ts -->

```ts
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createHarapter,
  providerId,
  profileId,
  HarnessError,
  isHarnessError,
  type HarnessEvent,
  type HarnessProfile,
  type HarnessRegistry,
  type HarnessSession,
  type CreateSessionInput,
} from 'harapter';

/** The same business function runs on every configured harness. */
export async function runTask(
  harapter: HarnessRegistry,
  profile: HarnessProfile,
  text: string,
  onEvent: (event: HarnessEvent) => void,
  sessionOptions: CreateSessionInput = {},
) {
  const client = await harapter.connect(profile);
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession(sessionOptions);
    const run = await session.start(
      { parts: [{ type: 'text', text }] },
      { timeoutMs: 60_000 },
    );
    for await (const event of run.events()) {
      onEvent(event);
      if (event.type === 'interaction.requested')
        throw new HarnessError(
          'unsupported_capability',
          'This text example requires a non-interactive Runtime configuration.',
          { retryable: false },
        );
    }
    return { result: await run.result(), sessionRef: session.ref() };
  } finally {
    try {
      await client.close();
    } finally {
      await session?.close();
    }
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

/** Only connection configuration differs; Runtime preparation belongs to the host. */
function selectedProfile(): HarnessProfile {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const profiles = {
    dsh: (): HarnessProfile => ({
      profileId: profileId('local-dsh'),
      providerId: providerId('deepseek.harness'),
      displayName: 'Local DSH',
      connection: {
        kind: 'process',
        ownership: 'adapter',
        cwd: workspace,
        command: required('HARAPTER_DSH_COMMAND'),
        args: [
          '--profile',
          'sdk-minimal',
          '--patch',
          required('HARAPTER_DSH_PATCH'),
        ],
      },
      providerOptions: {
        provider: required('HARAPTER_DSH_PROVIDER'),
        model: required('HARAPTER_DSH_MODEL'),
      },
    }),
    opencode: (): HarnessProfile => ({
      profileId: profileId('local-opencode'),
      providerId: providerId('opencode'),
      displayName: 'Local OpenCode',
      connection: {
        kind: 'endpoint',
        ownership: 'external',
        transport: 'http',
        url: required('HARAPTER_OPENCODE_URL'),
        authRef: { scheme: 'env', id: 'opencode' },
      },
    }),
  };
  const name = required('HARAPTER_HARNESS');
  if (name !== 'dsh' && name !== 'opencode')
    throw new Error('Select dsh or opencode.');
  return profiles[name]();
}

async function main() {
  const harapter = await createHarapter({
    harnesses: ['dsh', 'opencode'],
    resolveAuthHeaders: (ref) => {
      if (ref.scheme !== 'env' || ref.id !== 'opencode')
        throw new Error('Unknown authentication reference.');
      return {
        authorization:
          'Basic ' +
          Buffer.from(
            (process.env['OPENCODE_SERVER_USERNAME'] ?? 'opencode') +
              ':' +
              required('OPENCODE_SERVER_PASSWORD'),
          ).toString('base64'),
      };
    },
  });
  const { result } = await runTask(
    harapter,
    selectedProfile(),
    'Reply with exactly HARAPTER_OK. Do not use tools or inspect files.',
    (event) => {
      console.log({ type: event.type, sequence: event.sequence });
    },
    { workspace: { uri: pathToFileURL(required('HARAPTER_WORKSPACE')).href } },
  );
  // Return result.finalMessage to an authorized application UI; log metadata only.
  console.log({
    status: result.status,
    hasText: result.finalMessage !== undefined,
  });
  if (result.status !== 'completed') process.exitCode = 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        error: isHarnessError(error) ? error.code : 'application_failed',
      }),
    );
    process.exitCode = 1;
  });
}
```

Run `node app.ts`. Expected: event types followed by
`{ status: "completed", hasText: true }`. `result.finalMessage` contains the
optional answer for your authorized UI. A failed Run remains a failure. The
example drains events, applies a 60-second deadline and closes its resources; an
external server stays running. It requires a non-interactive Runtime policy.

### 4. Integrate into your project

Import `runTask` from this module into a request handler. Keep connection and
secret resolution in application composition, select a Profile per task, and
reuse task/result handling. The [entry guide](./packages/harapter/README.md)
owns configuration, capability boundaries and errors; the
[Runtime profile example](./examples/runtime-profiles/README.md) is its
executable source. [Service recipes](./examples/sdk-application/README.md) cover
host storage, reconnection, cancellation and approval UI.

Sessions remain bound to their original Provider, Profile and native state;
switching a Runtime means creating a new Session. Event envelopes are portable,
while `event.data` still follows the Adapter mapping. Never infer native
cancellation or fork support from the selected name, and do not log private
content, credentials or Session state.

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
| **Portable API**      | [`harapter`](./packages/core/README.md) — contracts, Registry, capability requirements, ownership checks, Errors, extensions, and native access                                                                                                                     |
| **Conformance**       | [`harapter/conformance`](./packages/conformance/README.md) — reusable portable behavior suite and deterministic Fake Provider                                                                                                                                       |
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
controls remain required. The first single-package release is pending. Harapter
publishes no PyPI package or standalone CLI.

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
