<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-openclaw</code></h1>

<p align="center"><strong>Drive an isolated OpenClaw Gateway Session through stable ACP v1.</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-openclaw"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-openclaw?style=flat-square&amp;label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-openclaw"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-openclaw?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 license"></a>
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-openclaw` maps the official `openclaw acp` stdio bridge to
the portable Harapter lifecycle.

The host installs, configures, authenticates, and operates OpenClaw and its
Gateway. Harapter starts only the exact adapter-owned command selected by the
Profile. It does not install an OpenClaw Runtime or SDK, configure models or
tools, manage Gateway credentials, or change host security policy.

## Quick start in an application

Use a Node.js 24+ ESM project. Save the complete example as `app.ts`; no
Harapter checkout or private imports are needed.

```sh
npm init -y
npm pkg set type=module
npm install @harapter/core @harapter/adapter-openclaw
npm install -D typescript @types/node
```

### Configuration supplied by the host

| Variable                    | Value                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `HARAPTER_OPENCLAW_COMMAND` | Installed OpenClaw executable; the host operates and authenticates the Gateway first. |
| `HARAPTER_WORKSPACE`        | Absolute path to an existing, empty test directory.                                   |

Secrets remain in the Runtime or host environment, never in source code or
Session references. Use an empty test Workspace and a host-reviewed
no-tools/read-only configuration for this first call.

Run `node app.ts` after providing the configuration below. Events are consumed
continuously, the final text is available as `result.finalMessage`, and cleanup
always runs. Metadata goes to stdout; route content only to an authorized
application response. A model call may consume tokens and create native Session
state.

<!-- sdk-example: quick-openclaw.ts -->

```ts
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isHarnessError, profileId, type HarnessSession } from '@harapter/core';
import {
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from '@harapter/adapter-openclaw';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the application environment.`);
  return value;
}

async function main() {
  const workspace = required('HARAPTER_WORKSPACE');
  if (!isAbsolute(workspace))
    throw new Error('Choose an absolute Workspace path.');
  const factory = createOpenClawProviderFactory();
  const client = await factory.connect({
    profileId: profileId('my-openclaw'),
    providerId: OPENCLAW_PROVIDER_ID,
    displayName: 'Application openclaw',
    connection: {
      kind: 'process',
      command: required('HARAPTER_OPENCLAW_COMMAND'),
      args: ['acp', '--no-prefix-cwd'],
      cwd: workspace,
      ownership: 'adapter',
    },
  });
  let session: HarnessSession | undefined;
  try {
    session = await client.createSession({
      workspace: { uri: pathToFileURL(workspace).href },
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
    // ACP session/close needs an open connection after the Run has settled.
    await session.close();
  } catch (error) {
    // On failure, abort any active Run and preserve the original error.
    await client.close().catch(() => undefined);
    await session?.close().catch(() => undefined);
    throw error;
  }
  await client.close();
}

await main().catch((error: unknown) => {
  console.error({
    error: isHarnessError(error) ? error.code : 'application_failed',
  });
  process.exitCode = 1;
});
```

[Complete application, recipes and error handling](../../examples/sdk-application/README.md)
· [All published packages](https://www.npmjs.com/org/harapter)

## Use this Adapter when

- your host already operates an authenticated OpenClaw Gateway;
- you need one isolated Gateway Session exposed as a portable Session over the
  stable ACP v1 bridge; or
- you need resume, native cancellation, approvals, and unknown ACP observations
  without direct Gateway WebSocket coupling.

## Installation

```bash
pnpm add @harapter/core @harapter/adapter-openclaw
```

## Runtime prerequisites and compatibility

Connection requires the stable ACP v1 wire contract and an initialize response
whose implementation name is `openclaw-acp`. Session create, resume, close,
prompt content, and image support are derived from the validated handshake.
Approval remains `unknown` until the connected bridge sends a valid permission
request. The runtime release is not pinned; a non-sensitive hash participates in
diagnostics, while incompatible protocol or required response shapes fail
closed.

The fixture manifest records the current upstream source revision inspected for
the evidence baseline. That revision is provenance, not a runtime allowlist.
OpenClaw is MIT licensed; Harapter does not redistribute it. See the
[license record](../../licenses/openclaw.md).

## Profile and process ownership

An OpenClaw Profile uses an adapter-owned process. The normal command shape is:

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  OPENCLAW_PROVIDER_ID,
  createOpenClawProviderFactory,
} from '@harapter/adapter-openclaw';

const registry = new HarnessRegistry();
registry.register(createOpenClawProviderFactory());

const client = await registry.connect({
  profileId: profileId('openclaw-local'),
  providerId: OPENCLAW_PROVIDER_ID,
  displayName: 'OpenClaw',
  connection: {
    kind: 'process',
    command: 'openclaw',
    args: ['acp'],
    ownership: 'adapter',
  },
});
```

The host may select another exact executable path or working directory. Shell
execution, unresolved `envRefs`, external process ownership, and OpenClaw
session-routing arguments are rejected. The adapter does not inspect or
interpolate environment entries, but the child process inherits the
host-controlled process environment. OpenClaw may use that environment for
Gateway authentication, and the host remains responsible for its contents.

Profile `providerOptions` accepts positive bounded values for
`operationTimeoutMs`, `requestTimeoutMs`, `cancelSettlementTimeoutMs`,
`maxRunEvents`, `maxBufferedEvents`, `maxBufferedMessages`, `maxMessageBytes`,
`maxPendingRequests`, `maxPendingInboundRequests`, and `maxPendingWrites`.
Unknown options are rejected. `maxRunEvents` must be between 2 and 4096 so an
unread Run queue always reserves terminal capacity.

## Session and Run lifecycle

`createSession()` generates an explicit isolated `acp-bridge:harapter-...`
Gateway session key and passes it through ACP metadata. The native ACP Session
identifier, working directory, routing strategy, and session key remain bound to
the Provider and Profile in `SessionRef`. `resumeSession()` requires the same
Provider, Profile, compatibility reference, native identifier, and isolated
route state, then asks OpenClaw to require the existing Gateway Session. A
Session reference is not portable to another Provider or Profile.

ACP accepts the Session working directory, but current evidence does not prove
that Gateway tool execution uses it. `session.workspace` therefore remains
`unknown` until an opt-in live Run verifies the effective execution directory.
Active and in-flight native Session identifiers are reserved per connection.
Closing enters a local `closing` state before the native request, blocks new
Runs and approval responses, and reopens only when the close attempt fails.

The Adapter deliberately permits one active Run per ACP connection. Typed
Session updates contain a Session identifier, but unknown ACP observations do
not provide a route that can safely distinguish concurrent Runs. The
connection-wide bound keeps unknown events observable without guessing their
owner.

Portable Runs accept non-empty text and handshake-advertised image references.
Harapter sends image URIs as ACP resource links and never reads the referenced
file. Generic file references, Provider-native input parts, Run metadata, and
Run Provider options remain unsupported.

Message, reasoning, tool lifecycle, usage, and approval observations map to
portable events. Tool identifiers are hashed and tool input or output is never
retained in portable events. The validated ACP prompt response is the only Run
terminal authority:

- `end_turn` maps to `run.completed`;
- `cancelled` maps to `run.cancelled`;
- `refusal`, `max_tokens`, and `max_turn_requests` map to `run.failed`;
- malformed or unknown stop reasons fail closed;
- EOF, process loss, Client close, queue overflow, or unconfirmed cancellation
  maps to `connection.aborted`;
- a local ACP wait ending before an authoritative prompt or Session mutation
  response aborts the owning connection and never releases it for reuse.

The transport and ACP client use an inbound wire-order barrier so every update
received before the terminal response finishes Adapter handling first. Messages
received after that response cannot append to or rewrite the terminal Run.

## Cancellation, timeout, and approval

`run.cancel()` sends native ACP `session/cancel`, but reports
`{ mode: 'native' }` only after the authoritative prompt response is
`cancelled`. A successful notification write alone is not cancellation evidence.
Missing confirmation, process loss, or cancellation write failure aborts the
connection instead.

Session create, resume, close, and prompt operations can mutate remote state.
When their local ACP timeout or abort ends the wait before an authoritative
response, the Adapter closes the connection, preserves any closing Session as
unsafe, and reports connection abort rather than a recoverable operation
failure.

A positive `RunOptions.timeoutMs` starts a local timer that requests the same
native cancellation. It is reported as emulated timeout control because the
timer is Harapter-owned, while the final `cancelled` status still requires
Provider evidence. Closing a Client or Session is never presented as native Run
cancellation.

Valid `session/request_permission` requests map to portable approval
interactions. Approval and denial select only choices explicitly offered by the
Provider. Portable decisions default only to matching one-time choices;
persistent choices require an explicit, decision-compatible Provider option ID.
Pending approvals settle as cancelled when their Run or connection terminates.
Since ACP initialization does not advertise permission support, the capability
changes from `unknown` to `native` only after a valid request is observed on the
active connection.

## Unknown events, extension, and native access

Unknown ACP notifications, requests, and future Session update discriminators
remain observable as `provider` events and through `openclaw.acp.observations`.
The observation channel bounds depth and collection size, hashes arbitrary
strings and identifiers, and does not retain prompt, file, credential,
environment, or tool content. Unknown observations never produce terminal
success.

`client.native()` returns an `OpenClawNativeClient` with the non-sensitive
runtime identity, explicitly namespaced ACP extension requests and
notifications, and unknown-event observation. Native extensions remain outside
portable lifecycle, capability, redaction, and compatibility guarantees.

## Evidence and limitations

Evidence for this supported ACP v1 Adapter includes:

- deterministic synthetic handshake, completion, permission, and unknown-event
  fixtures in
  [`fixtures/openclaw/acp-current`](../../fixtures/openclaw/acp-current/manifest.json);
- mapping, ownership, resume, cancellation, timeout, approval, disconnect,
  malformed-terminal, event-bound, process cleanup, native-access, and Provider
  negative tests;
- the shared portable Provider conformance suite;
- an opt-in live lifecycle test for a host-installed authenticated bridge; and
- a trusted live canary that installs the current OpenClaw release on an
  ephemeral runner and is configured to exercise runtime probing, the ACP
  handshake, isolated Session creation, a completed Run, Client reconnection,
  Session resume, native cancellation, authoritative terminal results, Session
  close, and Client disposal.

The [repository-recorded live lifecycle run][openclaw-live-2026-09-03] passed on
2026-09-03 with `openclaw@2026.8.2`. It verified current-package installation,
version probing, generated configuration validation, Gateway health, the ACP
handshake, isolated Session creation, exact completed text content,
`run.started`, `message.completed`, and authoritative `run.completed` Events. It
then closed the first ACP Client, opened a new bridge connection, resumed the
same isolated Gateway Session, and verified native cancellation with an
authoritative `run.cancelled` terminal. The resumed Session and both Clients
were disposed, and no model-facing tools or approval interactions were observed.
A production host may pin that release for reproducibility. Harapter continues
to admit newer releases and validates their ACP identity and observed structures
instead of using the recorded version as an executable allowlist.

Run live verification only when submitting two synthetic text Prompts through a
host-operated Gateway is acceptable to the host:

```bash
HARAPTER_OPENCLAW_LIVE=1 \
HARAPTER_OPENCLAW_COMMAND="$(command -v openclaw)" \
pnpm vitest run providers/openclaw/test/live.test.ts
```

The live test sends one exact-response Prompt, closes its first ACP Client,
opens a new bridge connection, resumes the same isolated Gateway Session, and
submits a second long-response Prompt for immediate native cancellation. It logs
no Provider traffic, requires authoritative `run.completed` and `run.cancelled`
terminals, and rejects every tool or approval Event. A skipped or failed live
test is not support evidence. The scheduled canary uses a generated, text-only
model route with OpenClaw's model tool support disabled, disables model catalog
refresh, plugins, browser automation, MCP, channels, cron, heartbeat, telemetry,
auditing, and shell environment loading, and retains no Runtime state or logs
after its ephemeral job ends. The model credential is an environment-backed
SecretRef resolved by the isolated Gateway and is removed before the Harapter
test process starts the ACP bridge. The bridge also omits the temporary
working-directory prefix from the Prompt.

The recorded live lifecycle above proves the supported ACP v1 completed text
Run, isolated Session resume, and native cancellation paths. Approval, image
input, and effective workspace execution remain live-unverified. Those
capabilities retain their documented `native`, `unknown`, or unsupported status
according to deterministic protocol evidence; hosts that depend on an unverified
capability should run focused live evidence before production use.

Shared Gateway session routing, history replay, per-Session MCP configuration,
audio input, generic file input, filesystem or terminal client services,
verified Gateway workspace execution, automatic process restart, and direct
Adapter-owned Gateway WebSocket transport are outside the current compatibility
boundary.

[openclaw-live-2026-09-03]:
  https://github.com/yunfeizhu/harapter/actions/runs/33740322290

## Native Session history operations

ACP does not advertise fork. To enable `openclaw.gateway.sessions`, supply
`createOpenClawProviderFactory({ gateway })` with an `OpenClawGatewayBinding`:
`profileId` must match the ACP Profile, `methods` must come from that Gateway
hello, and `request(method, params, { signal })` calls its authenticated RPC.
The host must bind the same Gateway/store as ACP and owns authentication,
reconnection and disposal. Harapter never discovers or installs this connection.
The extension appears only when `sessions.list` and `sessions.create` are
observed.

`OpenClawSessions.fork(ref)` finds the exact isolated route, checks source
policy, and requests `sessions.create` with `fork: true`,
`forkFrom: last-completed`, no initial input and no command hooks. It verifies
native lineage, permission and directory preservation, then attaches the child
through ACP with `requireExisting: true`. Worktree/session-root, remote
execution, subagent ownership, per-Session `sendPolicy`, incognito and
private-access state are rejected because their preservation is not established.
A pending fork excludes new ACP operations; an uncertain write or attachment
aborts the ACP Client. Each RPC is bounded by `operationTimeoutMs`, even if the
host ignores its abort signal. The host-owned Gateway connection remains the
host's responsibility.

Use this after the source Run has settled. The host must keep the source
quiescent across every client and external writer; local reservations cannot
lock another process. Child references retain Provider/Profile ownership.
Portable `session.fork` remains unsupported: these typed native operations have
different history and parent-lifecycle semantics.

```ts
import {
  OPENCLAW_SESSION_EXTENSION,
  type OpenClawSessions,
} from '@harapter/adapter-openclaw';

const sessions = client
  .extensions()
  .get<OpenClawSessions>(OPENCLAW_SESSION_EXTENSION);
if (sessions === undefined)
  throw new Error('Native Session extension unavailable.');
const child = await sessions.fork(session.ref());
// The child uses the normal HarnessSession lifecycle.
await child.close();
```

Official-runtime and fixture evidence, tested versions, and reproduction
commands are recorded in
[Session fork evidence](../../docs/provider-session-fork-evidence.md). These
tests use real runtimes with a local synthetic model, not a hosted model.

## Related packages

[All packages](../../README.md#packages-on-npm)

| Package                                                                                  | Documentation                                 |
| ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| [`@harapter/core`](https://www.npmjs.com/package/@harapter/core)                         | [Guide](../../packages/core/README.md)        |
| [`@harapter/conformance`](https://www.npmjs.com/package/@harapter/conformance)           | [Guide](../../packages/conformance/README.md) |
| [`@harapter/adapter-codex`](https://www.npmjs.com/package/@harapter/adapter-codex)       | [Guide](../codex/README.md)                   |
| [`@harapter/adapter-dsh`](https://www.npmjs.com/package/@harapter/adapter-dsh)           | [Guide](../dsh/README.md)                     |
| [`@harapter/adapter-hermes`](https://www.npmjs.com/package/@harapter/adapter-hermes)     | [Guide](../hermes/README.md)                  |
| [`@harapter/adapter-opencode`](https://www.npmjs.com/package/@harapter/adapter-opencode) | [Guide](../opencode/README.md)                |
| [`@harapter/adapter-pi`](https://www.npmjs.com/package/@harapter/adapter-pi)             | [Guide](../pi/README.md)                      |
