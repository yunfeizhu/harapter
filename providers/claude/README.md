# `@harapter/adapter-claude`

`@harapter/adapter-claude` maps the official
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) `query()`
streaming-input interface to the portable Harapter lifecycle. It does not parse
the interactive Claude Code terminal interface. The package is private and
versioned `0.0.0` during pre-alpha.

## Runtime, authentication, and compatibility

The Claude Agent SDK is a host-installed optional peer. The default Harapter
workspace install does not resolve the SDK or its platform-specific Claude Code
runtime. The host owns runtime installation, authentication, account policy,
workspace access, and every credential source. Harapter does not read, retain,
or return API keys, tokens, environment values, account identifiers, or SDK
configuration files. Hosts embedding this Adapter for other users must provide
an Anthropic-supported API-key or cloud-provider authentication flow; Harapter
does not expose a consumer login flow.

The Adapter targets the current public `query()` interface in
`@anthropic-ai/claude-agent-sdk` with the package compatibility range
`>=0.3.250 <0.4.0`. Required initialization, event, interaction, Session, and
result structures are validated when used. Additional optional fields and
unknown message types do not require an executable version allowlist. A missing
or malformed required structure fails with `provider_api_incompatible`.

The SDK package and its managed Claude Code runtime are governed by Anthropic's
Commercial Terms. Harapter does not bundle or publish them; see the
[license record](../../licenses/claude.md).

## Public entrypoints

- `CLAUDE_PROVIDER_ID` is `anthropic.claude-code`.
- `createClaudeProviderFactory()` creates the independently registrable Provider
  factory.
- `ClaudeSdkBinding` is the narrow injectable boundary used for a host-owned SDK
  connection, isolated live verification, and deterministic tests.
- `ClaudeNativeClient` exposes the Provider-bound SDK binding, non-sensitive
  runtime identity, and the structurally typed official functions when the
  Adapter dynamically loads the optional peer.

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  CLAUDE_PROVIDER_ID,
  createClaudeProviderFactory,
} from '@harapter/adapter-claude';

const registry = new HarnessRegistry();
registry.register(createClaudeProviderFactory());

const client = await registry.connect({
  profileId: profileId('claude-local'),
  providerId: CLAUDE_PROVIDER_ID,
  displayName: 'Local Claude Agent SDK',
  connection: { kind: 'sdk', ownership: 'adapter' },
});

const session = await client.createSession({
  workspace: { uri: 'file:///absolute/workspace' },
  providerOptions: { permissionMode: 'default' },
});
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

## Profile and SDK ownership

The Adapter accepts only `sdk` connections.

- `ownership: "adapter"` dynamically imports the optional peer supplied by the
  host, validates its public `query()` and `getSessionInfo()` functions, and
  fails with `runtime_not_found` when it is unavailable. Harapter does not
  install the peer or its managed runtime.
- `ownership: "host"` requires `connection.factory` to be a `ClaudeSdkBinding`.
  Harapter never closes or mutates an unrelated host SDK object; each `Query`
  created for a Run still has deterministic local cleanup.

`HarnessProfile.providerOptions` accepts `cancelSettlementTimeoutMs`,
`initializationTimeoutMs`, and `maxRunEvents`. All are positive bounded
integers. The event bound is between 2 and 4096 and reserves capacity for one
terminal event.

Every SDK Query receives `settingSources: []`. The Adapter therefore does not
silently load user, project, or machine settings through the SDK. Explicit
Session options remain the source of Harapter-owned behavior.

## Session and Run lifecycle

A Claude Agent SDK Session is a Harapter Session. `createSession()` allocates a
UUID that is supplied to the first SDK Query. Before the first authoritative
result, the Session reference is a Provider/Profile-bound logical reference and
can be reopened without claiming that native transcript state exists. Resume
first probes `getSessionInfo()` so a retained pre-Run reference discovers a
Session that materialized after the snapshot was taken. An authoritative result
marks the current reference materialized. Native resume validates the Provider,
Profile, stable `query()` interface, opaque Session state, native Session ID,
and workspace before using `resume`.

Session state retains the workspace, model, system context, allowed tools, and
permission mode that created it. The Adapter accepts `default`, `acceptEdits`,
`dontAsk`, `plan`, and `auto`. It does not expose the permission-bypass mode.
SDK initialization must report the bound workspace, requested model, and
permission mode before the Run can continue. Stream events or interaction
callbacks cannot reach the host before validation. An early permission callback
waits inside the Adapter for the bounded initialization deadline and is denied
if validation cannot complete; other pre-initialization activity fails closed.
Portable Session close releases the local handle and aborts its active Query; it
does not delete the native transcript.

Each Harapter Run sends one text-only user message through streaming input and
waits for one authoritative SDK `ResultMessage`. `RunOptions.providerOptions`
accepts positive `maxTurns` and `maxBudgetUsd`; positive `timeoutMs` is a local
connection deadline. The Adapter permits one active Run per Session.

Partial text and thinking, Tool lifecycle, usage, permission callbacks, and
unknown SDK messages map to portable events. Unknown values use a bounded raw
structural summary: strings and object keys become type-and-length markers,
numbers and booleans become type markers, collections and nesting are capped,
and no Provider value is copied into the raw channel.

`ResultMessage` is the only successful terminal authority. EOF, SDK iteration
failure, malformed messages, a local deadline, event-buffer overflow, Session
close, and Client close cannot become `run.completed`. Uncertain native state
quarantines that Session within the Client.

## Interactions and cancellation

The SDK `canUseTool` callback maps ordinary Tool requests to portable approvals.
Only an `approve` for the current request returns temporary allow; denial
returns the SDK's explicit deny result. `AskUserQuestion` maps to portable user
input. One text answer is accepted for one question, while multiple answers use
the explicit `anthropic.claude-agent-sdk.answers` Provider part. Tool inputs,
paths, and argument values are not copied into the portable approval prompt.

`run.cancel()` calls the Query's documented `interrupt()` control. Harapter
reports `native` only when that call acknowledges and the authoritative result
uses `aborted_streaming` or `aborted_tools`. A failed interrupt or missing
terminal result closes the Query and reports `connection_aborted` within the
configured deadline, which covers both interrupt acknowledgement and terminal
settlement. Query `close()` is process/connection disposal and never proves
native cancellation.

## Capabilities and native access

The public SDK schema provides native Session creation and resume, workspace
selection, streaming, interrupt, text input, reasoning, Tool and usage events,
approval, user input, and native access. Session close, Run timeout, connection
abort, and bounded raw observation are Adapter-controlled. Session fork,
concurrent Runs on one Session, portable file input, and portable image input
are unsupported.

Before the first SDK initialization the Client descriptor is `experimental` and
reports an unobserved-runtime warning. A valid initialization records the
managed Claude Code runtime identity and makes the connected descriptor
`supported`. Capability values come from the reviewed SDK schema, configuration,
and initialization handshake, not the Provider ID.

`ClaudeNativeClient` is an explicit escape hatch. Native calls do not gain
portable ordering, lifecycle, redaction, authorization, or Session-ownership
guarantees.

## Evidence and limitations

Evidence for this Adapter includes:

- deterministic synthetic fixtures in
  [`fixtures/claude/agent-sdk-query-stable`](../../fixtures/claude/agent-sdk-query-stable/manifest.json);
- official-binding, protocol mapping, malformed-input, redaction, interaction,
  timeout, cancellation, resume, race, overflow, and cleanup tests;
- the shared portable Provider conformance suite;
- an opt-in API-key live test that uses an empty temporary workspace, disables
  Tool access, stores no Provider traffic, and emits no credential diagnostics.

Run the live test only in a host environment that supplies the documented API
key and a file URL for its installed SDK module:

```bash
HARAPTER_CLAUDE_LIVE=1 \
HARAPTER_CLAUDE_SDK_MODULE_URL=file:///host/sdk/sdk.mjs \
pnpm vitest run providers/claude/test/live.test.ts
```

The default workspace test command does not install that module. A skipped live
test is not compatibility evidence.

This source baseline remains experimental until the opt-in live test is recorded
against the declared interface. Portable file/image input, Session fork, native
transcript deletion, account management, settings-file loading, SDK plugins,
hooks, MCP configuration, and multiple queued turns inside one Harapter Run are
outside the current contract.
