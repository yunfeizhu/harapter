# Harapter

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

`harapter` is the default application entry for connecting harness Runtimes
through one Client / Session / Run API. Configure the Runtime connection and
reuse the same task, event-envelope and terminal-result handling.

`harapter` is the only public package. Core, Adapter, transport and conformance
implementations are private source modules bundled into it. The first
single-package npm release is pending; installation commands below apply after
that release.

## Install in your application

Use Node.js 24+ and ESM. Install one Harapter package:

```sh
npm install harapter
npm install -D typescript @types/node
npm pkg set type=module
```

The package bundles Core and the maintained first-party protocol mappings. Its
only runtime dependency is the small `ws` transport library. Selected
implementations load dynamically. No upstream harness SDK or Runtime is
installed. The tarball contains all maintained mappings; selection controls
loading, not download size. Install Vitest separately only when using
`harapter/conformance`; `harapter/testing` needs no Vitest.

## Configure DSH or OpenCode, then run the same application

Save this complete entry as `app.ts`. `runTask` contains the shared business
operation; only `selectedProfile` and host authentication describe Runtimes.
Import its `runTask` function into your own request handler when integrating a
service. Return `result.finalMessage` to an authorized UI.

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

## Prepare the selected Runtime

Use an empty test Workspace. Follow the
[DSH setup](../../providers/dsh/README.md) for its official CLI, `sdk-minimal`
profile, model credentials and a no-tools patch. Set `HARAPTER_HARNESS=dsh`,
`HARAPTER_WORKSPACE`, `HARAPTER_DSH_COMMAND`, `HARAPTER_DSH_PATCH`,
`HARAPTER_DSH_PROVIDER` and `HARAPTER_DSH_MODEL`.

Alternatively, prepare the authenticated, tool-disabled
[OpenCode server](../../providers/opencode/README.md). Set
`HARAPTER_HARNESS=opencode`, `HARAPTER_WORKSPACE` (an absolute directory on that
server), `HARAPTER_OPENCODE_URL`, `OPENCODE_SERVER_PASSWORD` and optionally
`OPENCODE_SERVER_USERNAME` (default `opencode`). Only the selected Profile reads
its own settings. Do not put secrets in a Profile or print them.

Run `node app.ts`. Expected: event types followed by
`{ status: "completed", hasText: true }`. Calls may incur model charges. A
60-second Run deadline does not prove native cancellation. The sample rejects
interactions requiring an unimplemented host UI and closes its Client and
Session on exit; an external OpenCode server remains running.

## Public API and configuration

- `createHarapter(options?)` returns `Promise<HarnessRegistry>`. Await it once
  during application composition, then call `connect(profile)` for each chosen
  Runtime. Creating the Registry opens no connections and starts no processes.
- `HarapterOptions.harnesses` explicitly selects built-in implementations.
  Duplicates load once. Omitting options returns an empty extensible Registry;
  passing an options object requires a `harnesses` array.
- `resolveAuthHeaders(ref)` supplies host-owned HTTP headers for OpenCode and
  Hermes; `resolveGatewayCookie(ref, signal)` supplies DSH Gateway cookies.
  Resolvers run only when the corresponding Adapter needs authentication. Keep
  authorization decisions in the resolver, keyed by the exact secret reference.
- All [Core exports](../core/README.md), including Profile, input, event,
  terminal result, capability, error and extension contracts, are re-exported.
  No Adapter namespace or third-party Runtime API is part of this entry.

| Selection  | Profile `providerId` | Runtime connection and compatibility owner                           |
| ---------- | -------------------- | -------------------------------------------------------------------- |
| `codex`    | `openai.codex`       | [Codex app-server](../../providers/codex/README.md)                  |
| `dsh`      | `deepseek.harness`   | [DSH SDK process or Gateway endpoint](../../providers/dsh/README.md) |
| `hermes`   | `nous.hermes-agent`  | [Hermes HTTP server](../../providers/hermes/README.md)               |
| `openclaw` | `openclaw`           | [OpenClaw ACP process](../../providers/openclaw/README.md)           |
| `opencode` | `opencode`           | [OpenCode HTTP server](../../providers/opencode/README.md)           |
| `pi`       | `pi.agent`           | [Pi JSONL process](../../providers/pi/README.md)                     |

A Profile selects an existing machine interface using `connection`,
`providerOptions` and optional `requiredCapabilities`. It does not accept an
arbitrary Runtime object and infer how that object works. Each built-in mapping
continues to have its own documented compatibility range and capability
evidence.

## Lifecycle, errors and native integrations

The returned Registry is the existing Core Registry: it snapshots Profiles,
validates connection kinds and capability requirements, and binds each Session
to its creating Provider, Profile and native state. Use a new Session after
switching harnesses. Registration does not make checkpoints portable, add native
fork/cancel support, or replace a Runtime's tool and permission policy.

Continuously drain `run.events()` and use `run.result()` as terminal authority.
Event types and envelopes are portable; `event.data` still follows the owning
Adapter mapping. Do not assume every payload is a common text-delta or tool
schema. Capabilities and typed extensions describe operations beyond the common
lifecycle. Keep private content and Session references inside authorized host
storage, outside generic logs.

Invalid harness selection rejects with `invalid_request`; initialization of an
unusable bundled implementation rejects with redacted
`provider_api_incompatible`. Neither is retryable without fixing configuration
or installation. An unregistered Profile rejects with `provider_not_found`.
Connection/authentication/lifecycle errors retain the existing Core categories.

Use `registry.register(factory)` for a custom Adapter. Native composition, such
as an OpenClaw host-owned Gateway binding, uses an explicit factory from
`harapter/openclaw` instead of selecting the built-in default. These are
subpaths of the same SDK. Core and native extension contracts remain unchanged.

## Verification and package links

The [Runtime profile example](../../examples/runtime-profiles/README.md) is
checked against DSH process and authenticated OpenCode HTTP fixtures, including
shared task code, terminal events, Session ownership and cleanup. The
publication check installs only the `harapter` tarball in an isolated consumer,
compiles the example and runs both fixtures with no standalone Adapter package
installed. These are deterministic integration tests, not new live Runtime
evidence.

[npm](https://www.npmjs.com/package/harapter) ·
[DSH](../../providers/dsh/README.md) ·
[OpenCode](../../providers/opencode/README.md)

## Public subpaths

These entries all belong to one installed package. Ordinary applications use the
root entry; the explicit subpaths support existing native integrations, custom
Adapters and tests.

| Import                              | Guide                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `harapter`                          | [core](../../packages/core/README.md)                                       |
| `harapter/transports/jsonrpc-stdio` | [transport-jsonrpc-stdio](../../packages/transport-jsonrpc-stdio/README.md) |
| `harapter/transports/jsonl-process` | [transport-jsonl-process](../../packages/transport-jsonl-process/README.md) |
| `harapter/transports/http-sse`      | [transport-http-sse](../../packages/transport-http-sse/README.md)           |
| `harapter/transports/acp`           | [transport-acp](../../packages/transport-acp/README.md)                     |
| `harapter/conformance`              | [conformance](../../packages/conformance/README.md)                         |
| `harapter/codex`                    | [adapter-codex](../../providers/codex/README.md)                            |
| `harapter/dsh`                      | [adapter-dsh](../../providers/dsh/README.md)                                |
| `harapter/hermes`                   | [adapter-hermes](../../providers/hermes/README.md)                          |
| `harapter/openclaw`                 | [adapter-openclaw](../../providers/openclaw/README.md)                      |
| `harapter/opencode`                 | [adapter-opencode](../../providers/opencode/README.md)                      |
| `harapter/pi`                       | [adapter-pi](../../providers/pi/README.md)                                  |
| `harapter/testing`                  | [Fake Provider](../conformance/README.md)                                   |

## Migration from separate packages

Replace dependencies on `@harapter/*` with `harapter`. Import portable Core
types from `harapter`, native factories and extensions from the matching harness
subpath, transports from `harapter/transports/*`, the Fake Provider from
`harapter/testing`, and the test suite from `harapter/conformance`. Update
application imports together; old package names are not compatibility aliases.
Existing Session ownership and native compatibility requirements still apply.
Removal of the old npm packages is a separately authorized registry operation
after the replacement is available.
