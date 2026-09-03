# Agent Note: Hermes API Server lifecycle boundary

Status: implemented

## Problem

Hermes Agent exposes Session and Run HTTP resources plus an SSE event stream,
but stream completion is not authoritative Run completion, a stop response is
only an acknowledgement, and background child Sessions can continue after the
parent Run terminates. A portable Adapter needs deterministic terminal,
cancellation, and child-event ownership without installing the Provider Runtime
or inferring behavior from its identity.

## Decision

[`@harapter/adapter-hermes`](../../../../providers/hermes/README.md) connects to
a host-operated API Server. It validates the current capability document and the
exact required routes, derives a diagnostic fingerprint from that validated
surface, and declares stop and approval only when the handshake advertises the
corresponding feature and route. No Hermes Agent package or Runtime is a
Harapter Workspace dependency.

Sessions retain only bounded non-secret model and system defaults. Resume
validates Provider, Profile, compatibility reference, native identifier,
retained state, and remote Session ownership. One Run may be active per Session.
The Client reserves that slot before submitting the Run, and Session or Client
close aborts an in-flight reservation. A submission with uncertain acceptance
quarantines the Session instead of reopening the slot. An accepted submission
must resolve to a Run status owned by the submitting Session before the Adapter
opens SSE. The Adapter maps bounded SSE events but accepts terminal authority
only from the matching Run status resource and its matching `last_event`
evidence. EOF, disconnect, duplicate terminals, and contradictory status cannot
produce success and quarantine uncertain Session state. Failure closes the
active stream so a quarantined Session cannot retain an observation slot.

Run stop is native only after a documented `stopping` acknowledgement is
followed by authoritative `cancelled` evidence. A timeout uses that route when
advertised; otherwise it aborts the connection. Connection, Session, Client, or
request aborts never become native cancellation.

Each approval binds the exact choices advertised by its upstream event. Harapter
rejects a broader choice before HTTP traffic, validates Provider resolution
evidence, and accepts matching HTTP and SSE evidence in either arrival order as
one resolution. Contradictory evidence fails closed. Uncertain approval-response
delivery is unsafe Session state rather than a retryable authorization. The same
fail-closed rule applies to malformed or uncertain Run submission and stop
responses because those mutations may already have executed.

Retained model settings are bounded, JSON-safe, and reject separator-delimited
or camel-case credential-shaped keys. Arbitrary native model option values are
not persisted in `SessionRef.providerState`; a resumed handle relies on the
provider-bound native Session state.

Unknown events remain observable after content-free bounded redaction. Child
Session events use the `nous.hermes-agent.subagents` typed extension. Events
before the terminal boundary may also appear as parent Provider events; events
after it cannot append to, delay, or alter the parent Run. The current handshake
does not advertise child events, so the extension capability remains unknown.

A trusted live canary on 2026-09-03 validated the current lifecycle against
`hermes-agent@0.21.0` from the immutable image digest
`nousresearch/hermes-agent@sha256:6212c35b6dab6366b016c2a316fa3dc2af42c2315b83a2b0ce6f9fe72cc0fb27`.
The passing path covered Session creation and close, Run submission, SSE event
streaming, authoritative terminal reconciliation, and Client disposal. The API
Server does not negotiate a Runtime compatibility version, so this evidence is
not a version allowlist and does not promote the Adapter beyond `experimental`.
Other releases are attempted and remain subject to the same fail-closed
structural validation.

## Alternatives considered

### Install or embed Hermes Agent

Embedding the Runtime would give Harapter control of models, tools, credentials,
and process lifecycle, but those belong to the host and Provider. The official
API Server already supplies the required machine boundary without adding a
Provider dependency to the Workspace.

### Treat SSE terminal events or EOF as final

SSE delivery can end early, duplicate terminal events, or race background
activity. The pollable Run resource provides stronger ownership and terminal
evidence, so stream observations must reconcile with it.

### Keep late child activity in the parent Run

This would make the parent terminal non-final and allow background work to
rewrite an already settled portable trace. A separate typed observer preserves
visibility without violating parent lifecycle ordering.

## Consequences

- Harapter can create and resume Provider-bound Sessions, stream text Runs,
  respond to approvals, and request native stop without owning the Runtime.
- The compatibility boundary follows the validated current interface rather than
  an executable release allowlist; incompatible shapes require synchronized
  fixtures, mappings, tests, documentation, and review.
- Session state with uncertain acceptance or settlement is not silently reused.
- Background child activity remains observable, but its runtime capability
  cannot be claimed as native until handshake or live evidence supports that
  declaration.
- Portable workspace selection, attachments, Server lifecycle, Session deletion,
  and automatic SSE reconnection remain unsupported.
