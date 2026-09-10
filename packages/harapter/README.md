# Harapter

[English](https://github.com/yunfeizhu/harapter/blob/main/packages/harapter/README.md)
·
[简体中文](https://github.com/yunfeizhu/harapter/blob/main/packages/harapter/README.zh-CN.md)
·
[日本語](https://github.com/yunfeizhu/harapter/blob/main/packages/harapter/README.ja.md)

[![npm version](https://img.shields.io/npm/v/harapter?style=flat-square&label=npm)](https://www.npmjs.com/package/harapter)
[![npm downloads](https://img.shields.io/npm/dm/harapter?style=flat-square)](https://www.npmjs.com/package/harapter)
[![CI status](https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml)
![Node.js 24 or newer](https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=nodedotjs&logoColor=white)
[![Apache-2.0 license](https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square)](https://github.com/yunfeizhu/harapter/blob/main/LICENSE)

`harapter` adapts agent harness Runtimes to one application API. Connect DSH,
OpenCode, Codex, Hermes, OpenClaw or Pi using the same Client, Session, Run,
event-envelope and terminal-result contracts.

Install **one package** and import the common API from **`harapter`**. Choose a
configured Runtime for each task; Harapter selects its built-in protocol
mapping. Your application does not need a separate Adapter import for each
harness.

[API reference](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.md)

## Quick start

Use Node.js 24+ and an ESM application:

```sh
npm install harapter
```

`run()` is an additive API introduced after `harapter@1.0.0`. Version 1.0.0 does
not contain it; use a release or source build that includes this API.

Already use Pi on this machine? Save the following as `app.ts`. Harapter finds
`pi` on `PATH` and uses its existing model and login settings.

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

`result.finalMessage` is the optional answer; `result.status` is the terminal
outcome. The example prints only the status. The SDK consumes the event stream
and closes the Client and Session for you.

In a new project, run `npm init -y` and `npm pkg set type=module` first. Run the
file with Node.js 24:

```sh
node app.ts
```

The selected harness must already be installed and authenticated, or its HTTP
service must be running. Harapter uses that Runtime and its native
tool/permission policy. A task may access the chosen workspace and incur model
charges.

## Continue a conversation

Use `openSession()` once, then call `send()` for each message. The same native
Session keeps the conversation history. This API is added after 1.0.0 and is not
yet in that release.

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

## Choose a Runtime connection

`run()` and `openSession()` accept the same `RuntimeOptions`. Omit `runtime` for
the documented CLI or HTTP defaults. You do not need a separate Harapter adapter
import.

For embedded Pi, install only the native Runtime you use
(`npm install @earendil-works/pi-coding-agent@0.85.1`), then supply its factory.
The host controls credentials, model selection, tools, resource discovery and
any shared ModelRuntime. Every factory result must be a fresh idle Session,
exclusively transferred to Harapter. Closing the chat disposes that Session, not
the shared host Runtime.

```ts
import { openSession, isHarnessError } from 'harapter';
import { createAgentSession } from '@earendil-works/pi-coding-agent';

try {
  const chat = await openSession({
    harness: 'pi',
    runtime: {
      kind: 'pi-sdk',
      version: '0.85.1',
      createSession: async () => (await createAgentSession()).session,
    },
  });
  try {
    const result = await chat.send('Hello!');
    // Return result.finalMessage to your application's authorized conversation UI.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
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

For an existing DSH Gateway, reuse the host-authenticated server. `protocol`,
`storeId` and `exclusiveSessions` are explicit host attestations; the cookie
resolver remains in memory. Harapter does not start the server or exchange its
launch token. Do not supply the process/model/workspace/header overrides with
this binding; configure those on the Runtime or use its native controls.

```ts
import { openSession, DSH_GATEWAY_PROTOCOL, isHarnessError } from 'harapter';

try {
  const chat = await openSession({
    harness: 'dsh',
    runtime: {
      kind: 'dsh-gateway',
      url: 'http://127.0.0.1:9345',
      protocol: DSH_GATEWAY_PROTOCOL,
      storeId: 'my-dsh-store',
      exclusiveSessions: true,
      resolveCookie: () => process.env.DSH_GATEWAY_COOKIE ?? '',
    },
  });
  try {
    const result = await chat.send('Hello!');
    // Return result.finalMessage to your application's authorized conversation UI.
    console.log({
      status: result.status,
      hasText: result.finalMessage !== undefined,
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

OpenCode uses HTTP/SSE and Hermes uses HTTP/SSE; neither requires a
Harapter-managed SDK subprocess. Codex keeps App Server stdio. OpenClaw keeps
ACP as its Run transport and accepts
`runtime: { kind: "openclaw-acp", gateway }` for an existing
`OpenClawGatewayBinding`; its profileId is preserved. The Gateway only adds
supported native Session controls and is never disposed by Harapter.

A chat permits one active Run at a time. `send()` consumes events and accepts
`{ timeoutMs, onEvent }`; its default deadline is the value supplied to
`openSession()` (60000 ms otherwise). Observer, deadline and interaction
failures close the owned connection. This is not proof of native cancellation.
Use inherited `start()` / `respond()` for interactions and `run.cancel()` for
capability-supported cancellation. `chat.client` exposes the same connection’s
capabilities, extensions, resume and native controls. Closing the chat also
closes that Client; keep the Client/Session API for independently owned or
resumed Sessions.

## Use DSH with the same call

DSH requires the model provider and model ID in its SDK handshake. Replace the
two placeholders with your existing DSH model route. Harapter supplies the
machine-interface arguments; no Harapter Profile file is needed.

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

[DSH](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.md) ·
[Pi](https://github.com/yunfeizhu/harapter/blob/main/providers/pi/README.md)

## Connect to an HTTP harness

For an existing OpenCode server, change the selector and pass its URL if it
differs from the default. Supply `headers` only when your server requires
authentication, using credentials from your own secret storage. Model
credentials stay in the Runtime.

```ts
import { run } from 'harapter';

const result = await run({
  harness: 'opencode',
  input: 'Hello!',
  url: 'http://127.0.0.1:4096',
});
```

[OpenCode](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.md)
·
[Hermes](https://github.com/yunfeizhu/harapter/blob/main/providers/hermes/README.md)

## Receive events in your application

Pass `onEvent` when your UI or worker needs progress. The callback may be
asynchronous; Harapter awaits it. Event envelopes are portable, but payloads
retain the selected mapping’s documented format. Keep private event data inside
your application.

```ts
import { run } from 'harapter';

const result = await run({
  harness: 'pi',
  input: 'Hello!',
  onEvent(event) {
    console.log({ type: event.type });
  },
});
```

## Results, deadlines and Sessions

Each `run()` creates a fresh Session and returns the authoritative `RunResult`,
including `failed`, `cancelled` or `connection_aborted`. A returned result is
not always success. Setup, observer and cleanup failures reject with a safe
`HarnessError`; inspect `error.code` using `isHarnessError`.

The default whole-call deadline is 60 seconds; change it with `timeoutMs`.
Expiry rejects with `timeout` and closes owned connections. This does not prove
native cancellation; a remote task may continue. Cleanup may extend beyond the
deadline, and late connection/session handles are closed when they arrive.

`run()` does not answer approvals or user-input requests:
`interaction.requested` rejects with `unsupported_capability`. For interactive
tasks, resume, fork, native cancellation or custom connection policies, use the
Client/Session controls. For ordinary multi-turn chat or a DSH Gateway
connection, use openSession() above. Closing handles does not delete native
history or stop externally owned servers.

[Full option types, default commands, URLs and model limitations](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.md#run)

## Advanced: application-owned connection Profiles

The longer recipes remain available when an application needs explicit Session
ownership. Copy `quick-start.ts` and `runtime-config.ts` together, or adapt the
reusable `runTask` service helper. These are alternatives to the single-call
API, not prerequisites for it.

[quick-start.ts](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/src/quick-start.ts)
·
[runtime-config.ts](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/src/runtime-config.ts)
·
[runTask](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/src/quick-unified.ts)

## Public API and configuration

Look up methods, parameters, return values and errors in the
[API reference](https://github.com/yunfeizhu/harapter/blob/main/docs/api-reference.md).

Built-in harnesses share the common imports from `harapter`. Selecting a
different connection Profile does not require a Provider subpath import or
manual Adapter factory registration.

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
- All
  [Core exports](https://github.com/yunfeizhu/harapter/blob/main/packages/core/README.md),
  including Profile, input, event, terminal result, capability, error and
  extension contracts, are re-exported. No Adapter namespace or third-party
  Runtime API is part of this entry.

| Selection  | Profile `providerId` | Runtime connection and compatibility owner                                                                     |
| ---------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `codex`    | `openai.codex`       | [Codex app-server](https://github.com/yunfeizhu/harapter/blob/main/providers/codex/README.md)                  |
| `dsh`      | `deepseek.harness`   | [DSH SDK process or Gateway endpoint](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.md) |
| `hermes`   | `nous.hermes-agent`  | [Hermes HTTP server](https://github.com/yunfeizhu/harapter/blob/main/providers/hermes/README.md)               |
| `openclaw` | `openclaw`           | [OpenClaw ACP process](https://github.com/yunfeizhu/harapter/blob/main/providers/openclaw/README.md)           |
| `opencode` | `opencode`           | [OpenCode HTTP server](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.md)           |
| `pi`       | `pi.agent`           | [Pi JSONL process](https://github.com/yunfeizhu/harapter/blob/main/providers/pi/README.md)                     |

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

The
[Runtime profile example](https://github.com/yunfeizhu/harapter/blob/main/examples/runtime-profiles/README.md)
is checked against DSH process and authenticated OpenCode HTTP fixtures,
including shared task code, terminal events, Session ownership and cleanup. The
publication check installs only the `harapter` tarball in an isolated consumer,
compiles the example and runs both fixtures with no standalone Adapter package
installed. These are deterministic integration tests, not new live Runtime
evidence.

[npm](https://www.npmjs.com/package/harapter) ·
[DSH](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.md) ·
[OpenCode](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.md)

## What is included in the package

The SDK bundles Core and all maintained first-party protocol mappings. Its only
runtime dependency is `ws`; selecting harnesses controls dynamic loading, not
the size of the downloaded tarball. Upstream harness SDKs and Runtime
distributions are not dependencies of `harapter`.

In the source repository, `packages/core`, `packages/transport-*`,
`packages/conformance` and `providers/*` remain private workspace modules. Their
implementation and tests are used to build the single public package. They are
not additional npm packages to install. See the
[source directory guide](https://github.com/yunfeizhu/harapter/blob/main/packages/README.md)
for their responsibilities.

Use `harapter/testing` for the Fake Provider without Vitest. Install Vitest
separately only if you use the optional `harapter/conformance` test suite.

## Public subpaths

These entries all belong to one installed package. Ordinary applications use the
root entry; the explicit subpaths support existing native integrations, custom
Adapters and tests.

| Import                              | Guide                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `harapter`                          | [core](https://github.com/yunfeizhu/harapter/blob/main/packages/core/README.md)                                       |
| `harapter/transports/jsonrpc-stdio` | [transport-jsonrpc-stdio](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-jsonrpc-stdio/README.md) |
| `harapter/transports/jsonl-process` | [transport-jsonl-process](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-jsonl-process/README.md) |
| `harapter/transports/http-sse`      | [transport-http-sse](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-http-sse/README.md)           |
| `harapter/transports/acp`           | [transport-acp](https://github.com/yunfeizhu/harapter/blob/main/packages/transport-acp/README.md)                     |
| `harapter/conformance`              | [conformance](https://github.com/yunfeizhu/harapter/blob/main/packages/conformance/README.md)                         |
| `harapter/codex`                    | [adapter-codex](https://github.com/yunfeizhu/harapter/blob/main/providers/codex/README.md)                            |
| `harapter/dsh`                      | [adapter-dsh](https://github.com/yunfeizhu/harapter/blob/main/providers/dsh/README.md)                                |
| `harapter/hermes`                   | [adapter-hermes](https://github.com/yunfeizhu/harapter/blob/main/providers/hermes/README.md)                          |
| `harapter/openclaw`                 | [adapter-openclaw](https://github.com/yunfeizhu/harapter/blob/main/providers/openclaw/README.md)                      |
| `harapter/opencode`                 | [adapter-opencode](https://github.com/yunfeizhu/harapter/blob/main/providers/opencode/README.md)                      |
| `harapter/pi`                       | [adapter-pi](https://github.com/yunfeizhu/harapter/blob/main/providers/pi/README.md)                                  |
| `harapter/testing`                  | [Fake Provider](https://github.com/yunfeizhu/harapter/blob/main/packages/conformance/README.md)                       |

## Migration from separate packages

Replace dependencies on `@harapter/*` with `harapter`. For built-in application
connections, use `createHarapter({ harnesses: [...] })` and the common types
from `harapter` instead of importing and registering each Adapter factory.
Existing Session ownership and native compatibility requirements still apply.

Custom Adapters, native extensions and low-level tests can use the subpaths
listed above. Old package names are not compatibility aliases; update the
application's dependencies and imports together.
