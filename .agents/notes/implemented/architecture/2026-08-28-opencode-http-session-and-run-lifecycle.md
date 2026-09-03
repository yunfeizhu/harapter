# Agent Note: OpenCode HTTP Session and Run lifecycle

Status: implemented

## Problem

OpenCode exposes a long-running HTTP service with directory-scoped Sessions,
Server-Sent Events, synchronous and asynchronous prompt routes, a Session-level
abort route, and a destructive Session DELETE route. Harapter must preserve
portable Session, Run, streaming, interaction, cancellation, and disposal
semantics without managing the service or treating an event-stream state change
as a successful terminal result.

Endpoint authentication may contain credentials and remains host policy. Unknown
upstream events must remain observable without retaining prompts, paths, tokens,
permission metadata, or other Provider content.

## Decision

[`@harapter/adapter-opencode`](../../../../providers/opencode/README.md) uses
the documented stable HTTP/OpenAPI interface and directory event stream. It
accepts only a host-owned or external HTTP endpoint Profile. A host callback may
resolve an `authRef` into request headers; the Adapter passes those headers
directly to the bounded transport and never places them in a Profile, Session
reference, error, event, fixture, or native response.

Connection validates the stable health response and records the returned runtime
version as non-sensitive identity. Compatibility and capabilities come from the
validated stable interface and observed responses, not a runtime version
allowlist or Provider identity inference.

An OpenCode Session maps directly to a Harapter Session. The directory returned
by OpenCode, portable system context, and model selection remain in the
provider-bound Session state. Resume performs a remote Session lookup using the
same directory and rejects a different ID, directory, Provider, Profile, or
stable interface identity. Resume also checks the directory-scoped status map
and accepts only an idle Session. Portable Session close releases the local
handle only; it never calls the destructive OpenCode DELETE route.

Each Session permits one active Run. The Adapter establishes SSE before sending
the synchronous message request. SSE supplies ordered text, reasoning, tool,
artifact, usage, and permission observations, while the synchronous assistant
response is the authoritative terminal result. `session.idle` is only an event
drain signal. A clean or malformed event-stream end cannot prove success.

The documented Session abort route implements native cancellation. A native
cancel result requires both a true abort acknowledgement and an authoritative
assistant error named `MessageAbortedError`. Local timeout, Session close,
Client close, request abort, stream loss, or event-buffer overflow does not
become native cancellation.

When stream loss, buffer overflow, or an uncertain message-request failure
leaves remote settlement unproven, the Adapter quarantines the Session handle
and its ID within the Client. A fresh connection may resume only after the
documented status map reports the Session idle. This prevents stale work and
events from being attributed to a subsequent Run.

Permission events map to portable approvals and the documented `once`, `always`,
and `reject` responses. One host response atomically claims a pending request,
and terminal settlement resolves any remaining portable interaction before the
terminal event. Unknown routeable events use a bounded Provider event whose raw
field retains only structural markers and a safe event type. Unrouteable events
are available through the same redacted native listener. Known tool and
reasoning events expose only portable summaries plus bounded, structurally
redacted native detail. Event queues reserve terminal capacity and abort locally
on overflow.

The host owns installation, configuration, authentication, endpoint lifecycle,
and intentional remote data deletion. Closing the Adapter aborts local HTTP and
SSE work but never invokes OpenCode instance disposal.

## Alternatives considered

### Use asynchronous prompt plus `session.idle` as the terminal result

The asynchronous route returns before an assistant result exists, and idle
events are not guaranteed to carry terminal output or error authority. Status
polling can help recovery but cannot turn idle into a successful result. The
synchronous message response supplies a documented, validated terminal object
while SSE remains the streaming channel.

### Delete the OpenCode Session on portable close

OpenCode DELETE removes the Session and all its data. Portable close is a local
handle lifecycle operation and must preserve native resume state. Intentional
deletion remains an explicit Provider-native call.

### Select behavior from the OpenCode runtime version

A release allowlist would turn maintenance lag into false incompatibility and
would not prove that a required route still has the expected shape. Runtime
health and every used response or event structure provide direct evidence. The
runtime version remains diagnostic identity.

### Share one callback-driven event queue for the whole Client

A Client-wide pump must route multiple directory instances and can accumulate
events while consumers stall. One pull-driven SSE subscription per active Run,
combined with a small bounded Run queue, preserves directory ownership and local
backpressure without making the generic transport Provider-aware.

## Consequences

- OpenCode validates the service-shaped Provider path needed alongside SDK and
  process-based Adapters without adding Provider knowledge to Core.
- Session references remain Provider/Profile/directory bound and preserve native
  resume data, but they are not portable checkpoints.
- Hosts can use server authentication without exposing credentials to
  Harapter-owned diagnostics or fixtures.
- Successful completion has one authoritative source even when SSE ordering or
  idle delivery varies.
- Native abort and local connection abortion remain distinguishable under races
  and disposal.
- A Run uses one SSE stream and one long-lived message request. Hosts must size
  endpoint capacity and configured bounds for their intended concurrency.
- Unknown events remain structurally observable, while raw Provider content is
  deliberately unavailable through the portable channel.
- Support evidence requires synthetic fixtures, shared conformance, Provider
  negatives, and applicable live-runtime execution; a skipped live test is not
  evidence.
- A trusted current-release
  [live canary](https://github.com/yunfeizhu/harapter/actions/runs/33747923398)
  passed on 2026-09-03 with `opencode-ai@1.18.27`. It established exact text
  completion, fresh-Client resume of the same directory-bound Session, native
  abort, authoritative completed and cancelled terminals, and bounded Server
  cleanup without turning the Runtime version into an allowlist.
