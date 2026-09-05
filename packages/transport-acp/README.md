<!-- markdownlint-disable MD033 MD041 -->

<h1 align="center"><code>@harapter/transport-acp</code></h1>

<p align="center"><strong>A strict, Provider-neutral client for the stable Agent Client Protocol v1.</strong></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="../../README.md">Harapter</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@harapter/transport-acp"><img src="https://img.shields.io/npm/v/%40harapter%2Ftransport-acp/next?style=flat-square&amp;label=npm%20next" alt="npm next version"></a>
  <a href="https://www.npmjs.com/package/@harapter/transport-acp"><img src="https://img.shields.io/npm/dm/%40harapter%2Ftransport-acp?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/yunfeizhu/harapter/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/yunfeizhu/harapter/ci.yml?branch=main&amp;style=flat-square&amp;label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white" alt="Node.js 24 or newer">
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-0B7285?style=flat-square" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/status-pre--alpha-EA580C?style=flat-square" alt="Pre-alpha status">
</p>

<!-- markdownlint-enable MD033 -->

`@harapter/transport-acp` is Harapter's Provider-neutral client for the stable
Agent Client Protocol v1 wire contract. It composes
[`@harapter/transport-jsonrpc-stdio`](../transport-jsonrpc-stdio/README.md) and
adds ACP negotiation, runtime validation, capability gates, bidirectional
permission handling, typed Session updates, and bounded unknown-message
observation.

The package does not spawn an ACP Agent, select a Provider, map ACP events into
portable Harapter lifecycle events, or infer capabilities from an Agent name.
The consuming Provider Adapter owns process policy, Provider meaning, Session
ownership, compatibility, and portable event and error mapping.

## Use this package when

- an Adapter connects to an Agent that implements stable ACP v1;
- you need negotiated Session methods, typed updates, permission requests, and
  bounded unknown-message observation; or
- you want ACP validation without importing Provider identity or process policy
  into a reusable transport layer.

## Installation

```bash
pnpm add @harapter/transport-acp@next
```

## Stable profile

The client sends and requires JSON-RPC `"2.0"` and negotiates
`protocolVersion: 1`. String, integer numeric, and `null` request identifiers
are accepted; fractional numeric identifiers fail closed. It implements the
stable client-side path needed by ACP Provider Adapters:

- `initialize` with normalized Agent capability validation;
- `session/new` and capability-gated `session/load`, `session/list`,
  `session/delete`, `session/resume`, and `session/close`;
- `session/prompt` with negotiated content and MCP transport checks;
- `session/cancel` as an explicit ACP notification;
- `session/update` for every stable v1 update discriminator;
- `session/request_permission` through a caller-supplied handler;
- extension requests and notifications whose methods begin with `_`.

The initial client profile advertises filesystem, terminal, and terminal-auth
client services as unsupported. It does not implement authentication, logout,
terminal, filesystem, elicitation, Session mode, or Session configuration
methods. Supplying a client capability that claims an unimplemented service is
rejected instead of silently advertising support.

ACP v2 messages are outside this stable profile. A peer that selects another
protocol version or omits the required JSON-RPC version fails negotiation or
transport validation; it is never treated as a compatible v1 peer.

## Public API

- `AcpClient` owns one negotiated ACP connection over caller-owned streams.
- `AcpInitializeResult` exposes normalized Agent capabilities plus validated
  implementation identity and untrusted authentication-method metadata.
- `AcpContentBlock`, Session mode and configuration types, tool content and
  location types, plan and command types, `AcpSessionUpdate`, and
  `AcpPermissionRequest` describe the implemented stable message surface.
- `AcpClientError` provides fixed, content-free protocol and configuration
  errors.
- `AcpEvent` preserves ordered typed Session updates and bounded, redacted
  observations of future or unknown traffic.
- `requestExtension()` and `notifyExtension()` are explicit native protocol
  escape hatches; extension handlers receive untrusted values and remain outside
  portable Harapter semantics.

## Connection and lifecycle

The caller injects Node readable and writable streams and may provide a cleanup
callback. The ACP client never starts, kills, or restarts the process that owns
those streams. Closing the client closes the composed logical transport and
invokes the caller's cleanup callback at most once without ending or destroying
the streams itself.

Initialization is attempted once per connection. All Session and extension
operations require successful negotiation. Optional Session methods and
additional directories are enabled only by the corresponding handshake
capability. HTTP and SSE MCP configurations require the matching Agent MCP
capability; stdio MCP remains the baseline.

Only one prompt may be active for a Session through one client. A prompt result
becomes authoritative only after a validated `session/prompt` response with one
of the closed stable stop reasons. EOF, malformed input, an unknown stop reason,
or a future update never becomes success.

When `events()` has a consumer, prompt settlement also waits until that consumer
finishes every ACP event received before the prompt response. The composed
JSON-RPC inbound barrier fixes the wire boundary, and the ACP event checkpoint
fixes the consumer boundary. Events received after the response do not delay or
mutate the settled prompt. The original prompt deadline and `AbortSignal` remain
active through both barriers, and event-checkpoint waiters are bounded.

`cancelSession()` sends the ACP `session/cancel` notification. Before doing so,
it answers every pending permission request for that Session with the required
`cancelled` outcome, including requests that race while the prompt is settling.
The Session remains cancelling until both the local cancel write and the prompt
wait settle, so an old cancellation cannot target a newly started prompt. A
permission handler that remains pending after local settlement is detached from
client task tracking; its late outcome or rejection is ignored.

`closeSession()` similarly answers pending and racing permission requests as
cancelled before requesting authoritative Session closure. A locally aborted or
timed-out close wait leaves the Session blocked because the remote close result
is unknown; only connection closure can clear that uncertainty.

A request timeout or `AbortSignal` only stops the local prompt wait; it sends no
cancellation notification and proves no remote cancellation. When it ends before
a terminal response is validated, that Session remains blocked from another
prompt because the remote turn may still be active. The caller may still send
explicit cancellation, but reuse requires an advertised `session/close`
operation or closing the connection because the aborted local wait can no longer
validate the late prompt response.

## Events, extensions, and sensitive data

`events()` has one consumer and a finite queue, defaulting to 128 unread events.
Exhausting it fails the connection. Known `session/update` notifications retain
their validated protocol fields for the Provider Adapter, including content
annotations and nested tool, plan, command, mode, and configuration structures.
Future update discriminators, unknown notifications, and unknown requests become
structural `AcpRawObservation` values bounded by depth, node count, collection
size, and hashed unknown names. Prompt text, file content, paths, identifiers,
credentials, headers, booleans, numbers, and arbitrary string values are not
retained in that raw observation.

Unknown requests receive JSON-RPC `Method not found`; unknown notifications are
observed and otherwise ignored. Synchronous throws and rejected Promises from an
extension notification observer are contained and cannot alter connection
lifecycle. Extension callbacks are an explicit unredacted native boundary. Their
payloads, negotiated `_meta`, known tool `rawInput` and `rawOutput`, remote
errors, and authentication-method values must not be logged or attached to
portable errors without Adapter-owned validation and redaction.

## Quick start

```ts
import { AcpClient } from '@harapter/transport-acp';

const client = new AcpClient({
  readable: controlledProcess.stdout,
  writable: controlledProcess.stdin,
  cleanup: () => stopControlledProcess(controlledProcess),
  requestPermission: async (request) =>
    decidePermissionWithoutLoggingRawFields(request),
});

const initialized = await client.initialize({
  clientInfo: { name: 'harapter-provider', version: 'current' },
});

const session = await client.newSession({
  cwd: controlledWorkspace,
  mcpServers: [],
});

const events = client.events();
const eventTask = (async () => {
  for await (const event of events) {
    handleValidatedAcpEvent(event);
  }
})();

await client.prompt({
  sessionId: session.sessionId,
  prompt: [{ type: 'text', text: controlledPrompt }],
});

await client.close();
await eventTask;
```

The example names host-owned values symbolically. Applications must not log
prompt, workspace, process, extension, or permission payloads by default.

## Compatibility evidence

The implemented profile follows the official stable ACP v1 schema and
extensibility rules. Synthetic fixtures record the inspected schema revision in
[`fixtures/acp/v1-stable`](../../fixtures/acp/v1-stable/manifest.json) for
reproducible protocol evidence; the revision is evidence provenance, not a
Provider runtime version pin.

Unit evidence covers exact JSON-RPC framing, negotiation, capability defaults
and gates, MCP and content validation, every stable Session update family,
Session lifecycle methods, terminal reasons, permission settlement and races,
unknown-message redaction, queue exhaustion, local wait abort, malformed input,
EOF, cleanup, and extension behavior. No Provider support claim follows from
this package alone.
