# `@harapter/adapter-openclaw`

`@harapter/adapter-openclaw` maps the official `openclaw acp` stdio bridge to
the portable Harapter lifecycle. The package is private and versioned `0.0.0`
during pre-alpha.

The host installs, configures, authenticates, and operates OpenClaw and its
Gateway. Harapter starts only the exact adapter-owned command selected by the
Profile. It does not install an OpenClaw Runtime or SDK, configure models or
tools, manage Gateway credentials, or change host security policy.

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

Evidence for this experimental Adapter includes:

- deterministic synthetic handshake, completion, permission, and unknown-event
  fixtures in
  [`fixtures/openclaw/acp-current`](../../fixtures/openclaw/acp-current/manifest.json);
- mapping, ownership, resume, cancellation, timeout, approval, disconnect,
  malformed-terminal, event-bound, process cleanup, native-access, and Provider
  negative tests;
- the shared portable Provider conformance suite;
- an opt-in live connection test for a host-installed authenticated bridge; and
- a trusted live canary that installs the current OpenClaw release on an
  ephemeral runner and exercises only runtime probing, the ACP handshake,
  isolated Session creation, Session close, and Client disposal.

The last repository-recorded live Session run passed on 2026-09-03 with
`openclaw@2026.8.2`. It verified current-package installation, version probing,
generated configuration validation, Gateway health, the ACP handshake, isolated
Session creation and close, and Client disposal. It did not submit a Prompt or
prove Run, Event, terminal, cancellation, resume, approval, or workspace
behavior. A production host may pin that release for reproducibility. Harapter
continues to admit newer releases and validates their observed structures
instead of using the recorded version as an executable allowlist.

Run live verification only when starting and closing an isolated bridge Session
is acceptable to the host:

```bash
HARAPTER_OPENCLAW_LIVE=1 \
HARAPTER_OPENCLAW_COMMAND="$(command -v openclaw)" \
pnpm vitest run providers/openclaw/test/live.test.ts
```

The live test sends no prompt and logs no Provider traffic. A skipped or
unrecorded live test is not support evidence. The scheduled canary likewise
receives no model credential, disables model catalog refresh, plugins, browser
automation, MCP, channels, cron, heartbeat, telemetry, auditing, and shell
environment loading, and retains no Runtime state or logs after its ephemeral
job ends. The scheduled canary is enabled after its trusted manual run passed.
These Session-only checks do not prove Run, Event, terminal, cancellation,
resume, approval, or workspace behavior, so the Adapter remains experimental in
source.

Shared Gateway session routing, history replay, per-Session MCP configuration,
audio input, generic file input, filesystem or terminal client services,
verified Gateway workspace execution, automatic process restart, and direct
Gateway WebSocket access are outside the current compatibility boundary.
