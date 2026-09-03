# `@harapter/adapter-hermes`

`@harapter/adapter-hermes` maps the official Hermes Agent API Server HTTP and
Server-Sent Events interface to the portable Harapter lifecycle. The package is
private and versioned `0.0.0` during pre-alpha.

The host installs, configures, authenticates, starts, and stops Hermes Agent.
The Adapter connects only to a host-selected endpoint. It does not install the
Hermes Agent Runtime or SDK, start a server, configure models or tools, or own
the host security policy.

## Runtime prerequisites and compatibility

The Adapter targets the current documented API Server interface. Connection
requires a valid `GET /v1/capabilities` document with the Session creation,
Session lookup, Run submission, Run status, and Run event routes used by the
Adapter. Stop and approval support are declared only when the connected server
advertises the corresponding feature and exact route.

Every response and SSE event used for portable lifecycle authority is
structurally validated. A stable diagnostic fingerprint is derived from the
validated capability subset. Harapter does not pin the Hermes executable to a
release number or use its identity to infer capabilities. Incompatible current
or future response shapes fail closed at the boundary where they are used.

The fixture manifest records the upstream source revision inspected for the
evidence baseline. That revision is provenance, not a runtime allowlist. Hermes
Agent is MIT licensed; Harapter does not redistribute it. See the
[license record](../../licenses/hermes-agent.md).

The latest trusted live validation ran on 2026-09-03 against
`hermes-agent@0.21.0` from
`nousresearch/hermes-agent@sha256:023d61b3ec803093827e10999e54abdbd379d1ed6adba59b45a6b89c1b4233b8`.
The [passing workflow run][hermes-live-2026-09-03] verified an exact completed
text response with `run.started`, `message.completed`, and authoritative
`run.completed` Events. It then closed the first local handle, resumed the same
native Session, and verified native cancellation of a second Run with an
authoritative `run.cancelled` terminal. Both local Session handles and the
Client were disposed, and no model-facing toolset was enabled. The API Server
does not negotiate a Runtime compatibility version, so the Adapter remains
`experimental`. Harapter attempts other Runtime releases and rejects
incompatible response or event shapes when they are used; it does not reject a
release by version number alone.

[hermes-live-2026-09-03]:
  https://github.com/yunfeizhu/harapter/actions/runs/33737478620

## Profile and authentication

Hermes Agent uses an `endpoint` Profile with HTTP transport and host or external
ownership:

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import {
  HERMES_PROVIDER_ID,
  createHermesProviderFactory,
} from '@harapter/adapter-hermes';

const registry = new HarnessRegistry();
registry.register(
  createHermesProviderFactory({
    resolveAuthHeaders: async (reference) => headersFor(reference),
  }),
);

const client = await registry.connect({
  profileId: profileId('hermes-local'),
  providerId: HERMES_PROVIDER_ID,
  displayName: 'Hermes Agent',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:8642/',
    transport: 'http',
    ownership: 'host',
    authRef: { scheme: 'host-secret-store', id: 'hermes-api-key' },
  },
});
```

`authRef` is optional. When it is present, the host must provide
`resolveAuthHeaders`. Harapter does not resolve, log, persist, or expose the
header values.

Profile `providerOptions` accepts positive bounded values for
`requestTimeoutMs`, `sseConnectTimeoutMs`, `reconcileTimeoutMs`,
`reconcilePollIntervalMs`, `cancelSettlementTimeoutMs`,
`lateEventDrainTimeoutMs`, and `maxRunEvents`. Unknown options are rejected.
`maxRunEvents` must be between 2 and 4096 so the unread event queue always
reserves terminal capacity.

## Session and Run lifecycle

`createSession()` uses the documented Session creation route. Portable system
context and model selection are sent at creation and retained as bounded,
non-secret provider state. Native model settings use
`model.providerOptions.provider` and `model.providerOptions.modelOptions`;
credential-shaped option keys are rejected. Native `modelOptions` are applied to
the creating Session handle but omitted from `SessionRef.providerState`; a
resumed handle relies on the native Hermes Session state.

`resumeSession()` validates the Provider, Profile, compatibility reference,
native Session identifier, retained state, and remote Session response before
returning a handle. Session state is bound to the connection Profile that
created it and does not imply checkpoint portability. Portable workspace
selection is unsupported. `session.close()` releases the local handle and aborts
active local observation; it does not delete the upstream Session.

One Run may be active per Session. Portable Runs accept text parts only. Run
submission returns an acknowledgement. Before opening SSE, the Adapter validates
that the acknowledged Run status belongs to the submitting Session. It then
consumes the bounded stream and reconciles lifecycle evidence against
`GET /v1/runs/{run_id}`. Non-empty Session, input, and Run metadata are rejected
because the current API mapping has no documented portable destination for them.
The status route is the terminal authority:

- `completed` maps to `run.completed` only with matching Run and Session
  ownership plus `last_event: "run.completed"`;
- `failed` maps to `run.failed` without exposing the Provider failure body;
- `cancelled` maps to `run.cancelled` only from authoritative Provider status;
- `queued`, `running`, `waiting_for_approval`, and `stopping` remain
  nonterminal;
- SSE EOF, disconnect, malformed data, duplicate terminals, or contradictory
  evidence never become success.

After terminal evidence, the Adapter drains only for a bounded interval to
detect contradictory or duplicate lifecycle events. A terminal portable event is
always the last event in the parent Run trace. Malformed or uncertain settlement
quarantines the Session handle within the Client until the host performs
explicit recovery through a new connection.

Run submission, stop, and approval are non-idempotent mutations. A malformed
success response, server failure, response loss, or ownership mismatch after
possible execution quarantines the affected Session instead of reopening it for
an unsafe retry.

## Stop, timeout, and approval

When the capability handshake advertises the official stop route, `run.cancel()`
posts to it. A `stopping` response is only an acknowledgement; Harapter reports
native cancellation after authoritative `cancelled` evidence. If settlement
remains uncertain, the result is `connection_aborted`, not `run.cancelled`.
Without the advertised route, portable cancellation is unsupported.

A positive `RunOptions.timeoutMs` uses native stop when available. Otherwise it
aborts only the Adapter connection. Client close, Session close, HTTP abort, and
SSE loss are connection lifecycle events and never proof of native cancellation.

Advertised approval requests map to portable approval interactions. Approval
supports `once`, `session`, and `always`; denial maps to `deny`. Overlapping
requests, an approval event without advertised support, or a mismatched
acknowledgement fails closed. Matching HTTP acknowledgement and SSE resolution
evidence is accepted in either arrival order and produces one portable
resolution.

## Events, extensions, and native access

Message deltas, Tool lifecycle, reasoning, usage, approval, and terminal events
map to portable events. Unknown upstream events remain observable through a
bounded, content-free `provider` event and
`HermesNativeClient.onUnknownEvent()`. Raw observation limits depth, node count,
array length, and object fields; arbitrary scalar content and unknown fields are
not exposed.

`nous.hermes-agent.subagents` is a typed observer for bounded child-Session
events. The current capability document does not advertise this event family, so
its capability status remains `unknown`. A child event received before the
parent terminal boundary can also appear as a parent Provider event. A late
child event is delivered only to the extension and cannot append to, delay, or
rewrite the terminated parent Run.

`client.native()` returns a `HermesNativeClient` with endpoint-bound JSON
requests, the non-sensitive compatibility identity, and unknown-event
observation. Native requests remain Provider-specific and do not gain portable
ordering, ownership, lifecycle, redaction, or authorization guarantees.

## Evidence and limitations

Evidence for this experimental Adapter includes:

- deterministic synthetic capability, completed, failed, cancelled, approval,
  late-child, and unknown-event fixtures in
  [`fixtures/hermes/api-server-current`](../../fixtures/hermes/api-server-current/manifest.json);
- mapping, ownership, malformed-input, authentication, timeout, stop,
  disconnect, terminal reconciliation, event-bound, approval, observer, and
  native-access tests;
- the shared portable Provider conformance suite;
- an opt-in live-runtime test for a host-operated endpoint;
- a trusted live-canary path that pulls the current official container, records
  its package version and immutable image digest, and exercises Session, Run,
  SSE, terminal-result, and disposal behavior.

Run live verification only against an isolated endpoint whose work and cost are
acceptable to the host:

```bash
HARAPTER_HERMES_LIVE=1 \
HARAPTER_HERMES_ENDPOINT=http://127.0.0.1:8642/ \
pnpm vitest run providers/hermes/test/live.test.ts
```

Set `HARAPTER_HERMES_API_KEY` when the endpoint requires bearer authentication.
The live test logs no Provider traffic. A skipped or unrecorded live test is not
support evidence.

The repository live canary mounts only an isolated temporary data directory and
publishes the API Server on host loopback. It disables bundled skills, plugins,
MCP servers, memory, compression, checkpoints, title generation, background
review, and every API Server toolset. An authenticated toolset inventory must
confirm that every configurable toolset is disabled, and the Runtime's full
Agent-side resolver must return no enabled toolsets, before the canary submits
two synthetic Prompts. The first requires one exact text response and validates
the completed lifecycle. After closing and resuming the same native Session, the
second requests a deliberately long response so the canary can require native
cancellation and an authoritative cancelled terminal. The weekly schedule is
enabled after the passing manual run recorded above.

Portable workspace selection, file and image input, Server lifecycle, Session
deletion, automatic SSE reconnection, and strict child-Session capability claims
are outside the current compatibility boundary.
