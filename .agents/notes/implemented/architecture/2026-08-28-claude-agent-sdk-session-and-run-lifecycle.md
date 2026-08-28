# Agent Note: Claude Agent SDK Session and Run lifecycle

Status: implemented

## Problem

The Claude Agent SDK exposes a TypeScript `query()` interface whose streaming
input owns a managed Claude Code process, emits partial and complete messages,
pauses for permission callbacks, supports Session identifiers and resume, and
provides separate `interrupt()` and `close()` controls. Harapter must map that
interface without treating process disposal as native cancellation, loading
undeclared host settings, exposing Tool input through portable approval or raw
events, or reporting success from stream completion.

The SDK persists native Session data during a Query. Harapter needs a stable
Session reference before the first Run without implying that a native transcript
already exists.

## Decision

[`@harapter/adapter-claude`](../../../../providers/claude/README.md) uses the
official Agent SDK `query()` interface in streaming-input mode. The SDK remains
a host-installed peer dependency governed by Anthropic's terms. Adapter-owned
connections use the installed official functions; host-owned connections supply
the narrow `ClaudeSdkBinding`. Core has no SDK import or Claude-specific branch.

Session creation allocates an SDK-compatible UUID and binds the workspace,
model, system context, allowed tools, permission mode, Provider, Profile, and
stable interface identity into opaque Session state. Before an authoritative
result, the reference is marked unmaterialized and can be reopened as the same
logical Session without claiming persisted native state. An authoritative result
marks it materialized. Materialized resume calls `getSessionInfo()` and rejects
a missing or different native ID or workspace before starting work. Resume also
probes an unmaterialized snapshot: an absent native Session reopens the logical
configuration, while a native match upgrades the snapshot and uses `resume`.
This prevents a retained pre-Run reference from reusing a Session ID as new
after the original Session has materialized.

Every Run creates one streaming-input Query, sends one portable text message,
and enforces one active Run per Session. The Adapter supplies
`settingSources: []`; user, project, and machine settings are never loaded as an
implicit Harapter configuration source. Host-selected Session and Run options
are validated before Query creation.

The SDK `ResultMessage` is the sole successful terminal authority. Required
initialization and terminal shapes, including exact Session identity, are
validated at runtime. Successful initialization gates every Provider event and
interaction callback. An early permission callback waits inside the Adapter for
a bounded initialization deadline and is denied without reaching the host if
validation cannot complete; any other pre-initialization Provider activity fails
closed. EOF, iteration failure, malformed messages, local timeout, Session
close, Client close, and event-buffer overflow report failure or
`connection_aborted` and quarantine uncertain Session state within the Client.
Unknown messages remain observable as Provider events through a bounded
structural raw summary. String values and object keys become type-and-length
markers, other scalar values become type markers, traversal stops at fixed
depth, key, and collection limits, and accessors are never invoked. Raw SDK
exceptions are not attached to portable errors.

`interrupt()` is the native cancellation request. Harapter reports native
cancellation only after `interrupt()` acknowledges and the authoritative result
uses `aborted_streaming` or `aborted_tools`. `close()` disposes the Query and
its managed process or connection; it cannot prove native Run cancellation. A
failed interrupt or missing terminal result uses `close()` and settles as
`connection_aborted` within one bounded deadline covering the interrupt request
and terminal settlement.

The SDK `canUseTool` callback maps ordinary Tool requests to portable approval
and `AskUserQuestion` to portable user input. Pending requests are claimed once,
resolved before the terminal event, and denied when their Run is no longer
available. Portable approval contains only a generic Tool name and safe
identifiers, not Tool arguments, paths, file bodies, prompts, or credentials.

Capability claims come from the reviewed SDK schema, explicit configuration, and
the initialization handshake. The Client descriptor remains experimental until
the managed runtime supplies a valid initialization identity. Source-level
Provider status remains experimental until the documented API-key live test is
recorded for the declared interface.

The current SDK and its platform artifacts use exact-version minimum-release-age
exceptions so the reviewed upstream baseline can be installed while retaining
the repository policy for every other version. Those entries are removed once
that exact release satisfies the repository waiting period.

## Alternatives considered

### Use the single-message Query form

The single-message form is simpler but does not provide the streaming-input
control surface required for real-time interruption and external interaction
callbacks. It cannot establish the intended cancellation and permission
lifecycle.

### Treat Query close as cancellation

`close()` forcefully ends the SDK-managed process or connection. It does not
provide an authoritative native turn outcome and would collapse local disposal,
transport loss, and Provider cancellation into one misleading result.

### Load the SDK's default settings sources

Implicit settings can change tools, permissions, hooks, plugins, and host
security policy without appearing in the Harapter Profile or Session state.
Explicit empty setting sources preserve host control and reproducible Session
binding.

### Copy unknown SDK payloads into raw events

SDK messages can contain prompts, file paths, Tool arguments, errors, and other
Provider data. A structural summary preserves event type, field presence,
collection shape, and scalar type while bounding memory and preventing raw
Provider content from bypassing host data policy.

## Consequences

- Claude validates the SDK-shaped Provider path alongside process and HTTP
  Adapters without adding Provider knowledge to Core.
- A pre-materialized SessionRef is resumable as logical configuration, while a
  materialized reference additionally requires validated native state. Neither
  is a portable checkpoint.
- One SDK Query maps to one Harapter Run. Multiple queued SDK turns and native
  features outside the portable lifecycle remain available only through explicit
  native access or later reviewed contracts.
- Native cancellation, local timeout, and process/connection disposal remain
  observably distinct under errors and races.
- Event-buffer pressure aborts the connection when an interaction lifecycle
  event cannot be delivered, so the SDK callback cannot wait invisibly.
- Disabling implicit setting sources gives up automatic project and user SDK
  configuration; hosts must select supported Session options explicitly.
- Portable raw observation deliberately loses string values and detailed native
  payloads. Hosts needing full Provider data must use native access under their
  own authorization, storage, and redaction policy.
- Support evidence consists of public SDK types and documentation, synthetic
  fixtures, Provider negatives, shared conformance, and a credential-gated live
  runtime test. A skipped live test does not establish supported status.
