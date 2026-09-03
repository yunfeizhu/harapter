# `@harapter/adapter-codex`

`@harapter/adapter-codex` exposes the official Codex harness through the stable
[Codex App Server](https://developers.openai.com/codex/app-server) interface and
maps it to the portable Harapter lifecycle. The harness and App Server source
live in the open-source
[OpenAI Codex repository](https://github.com/openai/codex). The package is
private and versioned `0.0.0` while the pre-alpha API is validated against
additional Provider shapes.

## Runtime prerequisites and compatibility

The host installs and authenticates Codex. This package does not include the
Codex binary, read credentials, resolve `SecretRef` values, or change a host
security policy. The configured process is launched without a shell, and its
stderr is not captured or exposed.

The Adapter targets the current stable App Server interface with
`experimentalApi: false`. `connect()` completes the required `initialize` /
`initialized` handshake, validates the required response structure, and keeps
the returned runtime version only as non-sensitive diagnostic identity. The
leading user-agent product name may reflect `clientInfo.name` or a process-level
originator, so it is not treated as Provider identity. There is no CLI version
allowlist. Malformed required structures fail with `provider_api_incompatible`,
while unknown events remain observable through the bounded raw channel.

The upstream runtime and generated Schema are Apache-2.0 licensed. Harapter does
not redistribute either one; see the
[license record](../../licenses/openai-codex.md).

## Public entrypoints

- `CODEX_PROVIDER_ID` is `openai.codex`.
- `createCodexProviderFactory()` returns a dynamically registrable Provider
  factory.
- `CODEX_USER_INPUT_PART` names the explicit `openai.codex.userInput` native
  input escape hatch.
- `CodexNativeClient` exposes initialized native requests, notifications, the
  non-sensitive runtime identity, and bounded redacted unknown-event
  observation.

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  CODEX_PROVIDER_ID,
  createCodexProviderFactory,
} from '@harapter/adapter-codex';

const registry = new HarnessRegistry();
registry.register(createCodexProviderFactory());

const client = await registry.connect({
  profileId: profileId('codex-local'),
  providerId: CODEX_PROVIDER_ID,
  displayName: 'Local Codex',
  connection: {
    kind: 'process',
    command: 'codex',
    args: ['app-server', '--stdio'],
    ownership: 'adapter',
  },
});

const session = await client.createSession();
const run = await session.start({
  parts: [{ type: 'text', text: 'Describe the current project.' }],
});

for await (const event of run.events()) {
  // Render or persist according to the host's data policy.
}

const result = await run.result();
await session.close();
await client.close();
```

## Profile and process ownership

The Adapter currently accepts only `process` connections with
`ownership: "adapter"`. The Profile supplies the complete command, arguments,
and optional process working directory. Harapter never appends installation or
authentication commands and never invokes a shell. This package has no host
Secret Store resolver. `envRefs` are rejected. The child otherwise inherits the
environment selected by the host process.

`HarnessProfile.providerOptions` accepts these positive integer limits:

- `maxMessageBytes`, `maxBufferedMessages`, `maxPendingRequests`,
  `maxPendingInboundRequests`, and `maxPendingWrites` configure the shared JSONL
  RPC transport;
- `requestTimeoutMs` bounds each App Server request wait;
- `cancelSettlementTimeoutMs` bounds the wait for an authoritative terminal
  notification after `turn/interrupt` acknowledges a request;
- `maxRunEvents` bounds unread portable events and must be at least two so a
  terminal event always has reserved space.

An unread Run that exhausts its event bound closes the connection and settles as
`connection_aborted`; it does not silently drop events or claim native
cancellation.

## Session, Run, and input mapping

Codex Thread is a Harapter Session, and Codex Turn is a Harapter Run. A
`SessionRef` stores the native Thread id and remains bound to the creating
Provider, Profile, stable App Server interface, and Provider-owned state. Resume
checks those fields before sending `thread/resume`, and it rejects a response
that identifies another Thread. Ephemeral Threads declare Session resume as
unsupported and are rejected before Provider traffic.

`CreateSessionInput` maps workspace file URIs, system context, and model id to
stable `thread/start` fields. Its `providerOptions` accepts `approvalPolicy`,
`sandbox`, `modelProvider`, `serviceTier`, `personality`, `config`, and
`ephemeral`. Omitting these fields preserves the active Codex configuration; the
Adapter does not choose a weaker approval or sandbox policy.

Runs accept text and image references. Arbitrary file references are
unsupported. `RunOptions.providerOptions` accepts the stable turn overrides
`approvalPolicy`, `effort`, `model`, `outputSchema`, `personality`,
`sandboxPolicy`, `serviceTier`, and `summary`. Unknown options fail instead of
being silently ignored. A positive `timeoutMs` requests native `turn/interrupt`;
an authoritative `interrupted` terminal result is returned as `cancelled` with a
timeout reason.

The Adapter enforces one active Turn per Thread and rejects any Turn identifier
reused during the connection lifetime. Reuse aborts the connection so late
traffic cannot be reassigned to a later Run. `turn/completed` is the only
authoritative Run terminal notification:

- `completed` → `run.completed`;
- `interrupted` → `run.cancelled`;
- `failed` → `run.failed` with only a safe Provider error code;
- an unknown status in a structurally complete terminal → a redacted `provider`
  event and `run.failed`, never success;
- a malformed terminal → a redacted `provider` event while the Run remains
  active.

Closing the Client or losing the process settles active Runs as
`connection_aborted`. Only a successful `turn/interrupt` followed by the
authoritative `interrupted` terminal status reports native cancellation. An
acknowledged interrupt without a terminal notification closes the owning
connection after `cancelSettlementTimeoutMs` and reports `connection_aborted`.

## Events and interactions

Agent message, reasoning, Tool lifecycle, Tool update, usage, interaction, and
terminal notifications map to the portable event vocabulary. Completed agent
message items are authoritative for `finalMessage`. Known message, reasoning,
Tool, and interaction content remains application data and must follow the
host's normal privacy and persistence policy.

Unknown notifications during a Run remain observable as `provider` events. Their
`raw` value is a bounded structural summary: string values and unsafe keys are
redacted, numeric scalar values are redacted, nesting and collections are
capped, and the method name is length-limited.
`CodexNativeClient.onUnknownEvent()` observes the same safe summary even when no
portable Run can own it. Unknown values are never reinterpreted as terminal
success.

Stable command and file-change requests map to portable approvals. App Server
user-input requests belong to the experimental API and remain explicit
`provider` interactions; the portable `interaction.user_input` capability is
unsupported. A host that needs a native Codex decision such as
`acceptForSession`, permission subsets, MCP elicitation, or another
Provider-specific response uses `InteractionResponse.kind: "provider"`
explicitly. Server requests that cannot be associated with an active Run are
denied instead of changing state invisibly.

## Capabilities and native access

The current stable Schema declares native Session creation and resume,
streaming, Turn interrupt, text and image input, approvals, generic Provider
interactions, and native client access. Session close, connection abort, and
bounded raw observation are Adapter-controlled. Session fork, portable file
input, and portable user input are explicitly unsupported.

Capability values are selected only after the stable App Server handshake is
validated. They are not inferred from `openai.codex` identity.

`CodexNativeClient` is an explicit escape hatch and can issue methods outside
the portable lifecycle. Callers own the resulting Provider semantics and must
not use it to bypass host authorization, Session ownership, or data policy.

## Errors, evidence, and limitations

Errors contain fixed Harapter messages, stable categories, safe numeric or
transport codes, Schema-declared Codex error categories, and no Provider message
bodies, prompts, file contents, credentials, environment values, or local paths.
Runtime absence is `runtime_not_found`; handshake and method incompatibility is
`provider_api_incompatible`; request wait expiry is `timeout`; unexpected stream
or process termination is `connection_aborted` after connect; and an
operation-local transport rejection on an open connection is `provider_error`.

Evidence for the supported interface includes:

- the generated stable Schema fingerprint and synthetic JSONL traces in
  [`fixtures/codex/app-server-stable`](../../fixtures/codex/app-server-stable/manifest.json);
- a synthetic initialize response with the client-selected originator used by
  the official App Server;
- mapping, malformed-input, redaction, interaction, timeout, cancellation,
  process-exit, ownership, and cleanup tests;
- the shared portable Provider conformance suite;
- a local live test against the current Codex release using a read-only,
  ephemeral Session/Run that performs no Tool calls and logs no Provider
  traffic.

The live test is opt-in and requires an authenticated Codex installation:

```bash
HARAPTER_CODEX_LIVE=1 pnpm vitest run providers/codex/test/live.test.ts
```

The trusted scheduled live-canary workflow can install the current stable Codex
release on an ephemeral runner and execute the same lifecycle with an isolated
configuration. It is enabled independently from pull request CI, records the
installed package version, and requires a configured model service that supports
the Responses interface used by Codex. Before the job receives the real model
credential, the current Codex feature inventory must match the reviewed
tool-disabled surface. The lifecycle fails if a tool or interaction event is
observed.

Experimental App Server APIs, Session fork, paginated history, direct account or
authentication management, and host-owned process streams are not supported by
this release.
