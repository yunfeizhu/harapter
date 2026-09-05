<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/adapter-dsh</code></h1>

<p align="center"><strong>Map the official DeepSeek Harness SDK Runtime protocol to Harapter.</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/adapter-dsh"><img src="https://img.shields.io/npm/v/%40harapter%2Fadapter-dsh/next?style=flat-square&amp;label=npm%20next" alt="npm next version"></a>
  <a href="https://www.npmjs.com/package/@harapter/adapter-dsh"><img src="https://img.shields.io/npm/dm/%40harapter%2Fadapter-dsh?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha status">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/adapter-dsh` maps the official
[DeepSeek Harness SDK protocol](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/README.md)
to the portable Harapter lifecycle. It connects to the newline-delimited
JSON-RPC 2.0 server exposed by the SDK Runtime and does not embed or reproduce
the DeepSeek Harness Agent Loop.

## Use this Adapter when

- your host installs and starts the official DeepSeek Harness SDK Runtime;
- you need its Session, Run, Event, interaction, resume, and cancellation
  behavior behind Harapter Core; or
- you want runtime validation and bounded raw observations without embedding the
  DeepSeek Harness Agent Loop in your application.

## Installation

```bash
pnpm add @harapter/core@next @harapter/adapter-dsh@next
```

## Runtime prerequisites and compatibility

The host installs, configures, and authenticates DeepSeek Harness. This package
does not install the DSH CLI, Runtime, SDK packages, Cordis application,
plugins, model adapters, or credentials. None of those packages enter the
default Harapter Workspace dependency graph or lockfile.

The Adapter targets the current official SDK stdio JSON-RPC interface. It
validates the wire-stable `deepseek-harness-sdk-runtime` handshake identity and
every required response, notification, event, and terminal structure it uses.
The runtime supplies a diagnostic version string, but the protocol has no
version negotiation or compatibility promise, so the Adapter has no executable
version allowlist. Harapter exposes only its stable diagnostic hash. Protocol
provenance, redacted fixtures, conformance, and an isolated live-runtime run
cover the current official SDK Profile, but cannot match an arbitrary connected
Runtime to that evidence. The Client descriptor therefore remains `experimental`
and retains a `pre_release_upstream_protocol` warning.

The fixture provenance records the official protocol package revision inspected
for this implementation. That revision and its package version do not pin the
host Runtime. A future incompatible protocol change requires new fixtures,
mapping tests, conformance, and compatibility documentation.

The last repository-recorded
[trusted lifecycle run](https://github.com/yunfeizhu/harapter/actions/runs/33735315426)
passed on 2026-09-03 with `@deepseek-ai/dsh@0.1.2-alpha.5`,
`@deepseek-ai/dsh-sdk-minimal@0.1.2-rc.1`, and
`@deepseek-ai/dsh-sdk-app@0.1.2-rc.1`. It verified the exact synthetic response,
`run.started`, `message.completed`, the final authoritative `run.completed`, and
the absence of tool or interaction Events. A production host may choose those
exact versions for a reproducible deployment, while Harapter continues to admit
newer Runtime versions and validates their observed structures instead of using
a version allowlist. The trusted scheduled live canary follows the current SDK
Profile prerelease channel and records the installed CLI, minimal Profile, and
SDK Runtime versions for every run. It composes `sdk-minimal`, disables every
model-facing tool in that composition, and verifies the complete effective
configuration before receiving the real model credential. Any composition drift,
unexpected response, missing terminal Event, or observed tool or interaction
Event fails the lifecycle.

DeepSeek Harness is MIT licensed. Harapter does not redistribute its Runtime or
SDK packages; see the [license record](../../licenses/deepseek-harness.md).

## Public entrypoints

- `DSH_PROVIDER_ID` is `deepseek.harness`.
- `createDshProviderFactory()` returns an independently registrable Provider
  factory.
- `DSH_NOTIFICATION_EXTENSION` names the bounded, redacted notification
  observer.
- `DshNativeClient` exposes initialized native requests and notifications, a
  non-sensitive runtime identity, and bounded unknown-event observation.

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  DSH_PROVIDER_ID,
  createDshProviderFactory,
} from '@harapter/adapter-dsh';

const registry = new HarnessRegistry();
registry.register(createDshProviderFactory());

const client = await registry.connect({
  profileId: profileId('dsh-local'),
  providerId: DSH_PROVIDER_ID,
  displayName: 'Local DeepSeek Harness',
  connection: {
    kind: 'process',
    command: 'dsh',
    args: ['--profile', 'sdk'],
    ownership: 'adapter',
  },
  providerOptions: {
    provider: 'host-configured-provider',
    model: 'host-configured-model',
  },
});

const session = await client.createSession();
try {
  const run = await session.start({
    parts: [{ type: 'text', text: 'Describe the current project.' }],
  });

  for await (const event of run.events()) {
    // Render or persist according to the host's data policy.
  }

  const result = await run.result();
  console.log(result.status);
} finally {
  try {
    await session.close();
  } finally {
    await client.close();
  }
}
```

## Profile and process ownership

The Adapter accepts only `process` connections with `ownership: "adapter"`. The
Profile supplies the complete command, arguments, optional working directory,
Provider route, and model. Harapter launches the exact command without a shell,
does not capture stderr, and never appends installation, authentication, plugin,
or Profile-management commands. `envRefs` are rejected; the child otherwise
inherits the environment chosen by the host process.

`HarnessProfile.providerOptions` requires non-empty `provider` and `model`
strings for the process-wide handshake. It also accepts:

- optional `reasoningEffort` and positive `maxTokens` handshake values;
- `maxMessageBytes`, `maxBufferedMessages`, `maxPendingRequests`,
  `maxPendingInboundRequests`, and `maxPendingWrites` for the shared JSON-RPC
  transport;
- `requestTimeoutMs` for outbound JSON-RPC request waits;
- `shutdownTimeoutMs` for the bounded graceful-shutdown attempt;
- `maxRunEvents` from 2 through 4096, which bounds unread portable events and
  reserves one terminal event.

An unread Run that reaches its event bound closes the connection and settles as
`connection_aborted` with an event-buffer reason. It never silently drops an
event or reports native cancellation.

## Session and Run lifecycle

`createSession()` allocates an SDK-side Session identifier locally. The Runtime
lazily creates the corresponding Agent and Session when `session/prompt` first
uses that identifier. Session settings are process-wide: a supplied workspace
must equal the initialized process working directory, while per-Session model,
system context, metadata, and Provider options are unsupported. The current
protocol exposes no resume or native Session-close method. Portable Session
close only releases the local handle after its active Run has settled.

The Adapter permits one active Harapter Run across the entire connection. A Run
accepts non-empty text parts only. `session/prompt` returns a durable inbox
`messageId`; it is not a result, Assistant Message identifier, or terminal
authority. The Adapter buffers bounded notifications that race the response,
correlates that exact identifier to one `agent/inbox/spliced` insertion, rejects
another insertion in the owned activity interval, and waits for the following
whole-Agent `idle` transition.

SDK Profile setup events emitted before that exact inbox insertion do not belong
to the Harapter Run and cannot provide portable or terminal authority. They
remain visible through the bounded, redacted notification observer. Events in
the owned interval, including the current `session/title` structure, are
validated and exposed through the redacted Provider event channel.

A request timeout, transport interruption, or malformed prompt response leaves
acceptance uncertain and quarantines the connection. An explicit JSON-RPC error
response is an authoritative rejection and leaves the connection reusable.
Subagent relationships belong only to their active Run; completed relationships
and every terminal Run release their child Session state. Late child activity
and subagent notifications received before receipt correlation remain visible
only through the redacted Provider observer. Root Session events after the
receipt must keep the upstream contiguous sequence; duplicate, stale, or skipped
positions fail the Run and quarantine the connection.

Exactly one structurally valid `turn/end.data.reason` must occur in the owned
interval:

- `completed` maps to `run.completed`;
- `aborted` with a recognized cause maps to `run.cancelled` as an observed
  upstream outcome, not as proof that Harapter requested native cancellation;
- `blocked`, `error`, `max-tokens`, and `interrupted` map to `run.failed`;
- missing, duplicate, malformed, or unknown terminal reasons map to
  `run.failed`, never success.

The last validated Assistant Message supplies `finalMessage`, and validated
usage records supply the portable usage summary. Whole-Agent `idle`, the last
Assistant Message, process exit, or JSON-RPC EOF cannot independently establish
success.

## Cancellation, timeout, and cleanup

The current official SDK protocol has no prompt-cancel method. The Adapter
therefore reports `run.cancel` as unsupported. Closing the Client or losing the
process settles an active Run as `connection_aborted`; neither path is described
as native cancellation.

A positive `RunOptions.timeoutMs` is an Adapter-controlled connection deadline.
When it expires, Harapter closes the owning Runtime connection and reports
`connection_aborted` with a local timeout reason. Client close first attempts
the official `shutdown` request within `shutdownTimeoutMs`, then terminates the
adapter-owned child process with a bounded forced-cleanup fallback.

## Events, redaction, and native access

Assistant text, reasoning, Tool lifecycle, usage, final Assistant Message, and
turn outcome events map to the portable vocabulary. Known structural events and
ignorable unknown Session events remain observable as `provider` events. Unknown
required Session event types fail the Run and quarantine the connection because
their lifecycle meaning cannot be guessed.

Raw notifications are bounded by depth, entry count, node count, and collection
length. Prompt text, Assistant content, Tool arguments and results, identifiers,
paths, failure messages, unknown keys, credentials, and arbitrary scalar values
are redacted. Runtime versions and unknown structural names use bounded, stable
diagnostic hashes rather than their original values.
`deepseek.harness.notifications` observes every safe notification;
`DshNativeClient.onUnknownEvent()` observes safe Provider-local activity that
does not map directly to a portable event. Observer failures cannot break Run
lifecycle processing.

`DshNativeClient.request()` and `notify()` are explicit escape hatches. Native
traffic does not gain portable ordering, lifecycle, ownership, redaction, or
authorization guarantees, and must not inject competing work into an active
owned Session interval.

## Errors, evidence, and limitations

Errors use fixed Harapter messages and stable categories without Provider
message bodies, prompts, file content, credentials, environment values, or host
paths. Runtime absence is `runtime_not_found`; malformed handshake, response, or
required event structures are `provider_api_incompatible`; request wait expiry
is `timeout`; an unexpected process or stream loss after connect is
`connection_aborted`; and an operation-local upstream rejection is
`provider_error`.

Evidence for this experimental source Adapter includes:

- official protocol provenance and deterministic synthetic traces in
  [`fixtures/dsh/sdk-jsonrpc-current`](../../fixtures/dsh/sdk-jsonrpc-current/manifest.json);
- mapping, redaction, malformed input, receipt-order race, exclusive interval,
  terminal reason, timeout, process-loss, buffer overflow, and forced-cleanup
  tests;
- the shared portable Provider conformance suite;
- an opt-in live-runtime test verified against the current official SDK Profile
  with an empty temporary working directory and isolated Runtime home. It logs
  and stores no Provider traffic, credentials, environment values, or host
  paths;
- a trusted scheduled live canary that installs the current SDK Profile
  prerelease on an ephemeral runner, validates its tool-disabled effective
  composition, records its actual package versions, and executes the same
  minimal lifecycle when enabled.

Run live verification only in a host environment with an installed and
authenticated Runtime plus a Provider route and model:

```bash
HARAPTER_DSH_LIVE=1 \
HARAPTER_DSH_PROVIDER=host-provider \
HARAPTER_DSH_MODEL=host-model \
pnpm vitest run providers/dsh/test/live.test.ts
```

`HARAPTER_DSH_COMMAND` can replace the default `dsh` executable, and
`HARAPTER_DSH_ARGS_JSON` can replace the default `["--profile","sdk"]`
arguments. A skipped or unrecorded live test is not support evidence.

Native prompt cancellation, Session resume, Session deletion, portable image or
file input, interactions, plugin management, shared Runtime Profiles with
competing Session work, and host-owned process streams are outside this source
baseline.
