# Agent Note: Codex Turn start and cancellation ordering

Status: implemented

## Problem

The stable Codex App Server returns an initial Turn from `turn/start` before the
Turn is necessarily running. The later `turn/started` notification is the
authoritative signal that the Turn is active. Sending `turn/interrupt` before
that signal can be rejected even though Harapter already has the native Turn
identifier.

Harapter must allow cancellation as soon as it returns a Run without racing the
Provider lifecycle, waiting without a bound, or reporting connection cleanup as
native cancellation.

## Decision

Each Codex Run owns a one-shot native-start signal. A matching `turn/started`
notification resolves it as active. Any authoritative terminal result or
connection abort resolves it as not active.

`cancel()` starts the configured cancellation watchdog before waiting for that
signal. It sends `turn/interrupt` only after the matching native start is
observed and the Run is still active. Native cancellation still requires both a
successful interrupt request and a matching `turn/completed` notification with
status `interrupted`. If native start or the terminal notification does not
arrive within `cancelSettlementTimeoutMs`, the owning connection closes and the
Run settles as `connection_aborted`.

The same watchdog covers an interrupt request that never settles. Transport
closure from that watchdog is reported as `connection_aborted`; an explicit
Provider rejection remains an error and is not converted into a cancellation
result.

An interrupted terminal that arrives before Harapter sends an interrupt still
settles the Run as cancelled, but a concurrent `cancel()` reports
`already_terminal`; the Adapter does not claim that its request caused the
Provider outcome.

The synthetic App Server fixture can delay or omit `turn/started`. Adapter tests
prove that immediate cancellation waits through the delay and that a missing
start aborts the connection without sending an interrupt. A third ordering test
proves that an interrupted terminal without an acknowledged Harapter interrupt
cannot claim native cancellation.

## Alternatives considered

### Send interrupt as soon as `turn/start` returns

The response provides an identifier but does not establish the running state
required by `turn/interrupt`. This leaves cancellation timing dependent on
notification scheduling.

### Retry every rejected interrupt

A rejection can represent an invalid request, incompatible Runtime, or a Turn
that has already terminated. Retrying without an authoritative state signal can
duplicate traffic and hide a real Provider error.

### Treat a missing start signal as cancellation

No Provider cancellation method has succeeded in that path. Reporting native
cancellation would conflate bounded connection cleanup with Provider lifecycle
evidence.

## Consequences

- Callers may request cancellation immediately after receiving a Codex Run; the
  Adapter orders the native interrupt after Provider readiness.
- The cancellation timeout now bounds readiness, interrupt, and terminal
  settlement as one operation.
- A missing native start signal sacrifices the owning connection rather than
  leaving cancellation pending or overstating its outcome.
- The stable `run.cancel` capability remains native because success still
  requires the documented start, interrupt, and interrupted-terminal sequence.
- A trusted current-release
  [live canary](https://github.com/yunfeizhu/harapter/actions/runs/33745075649)
  passed on 2026-09-03 with `@openai/codex@0.153.0`. Its second synthetic Turn
  was cancelled immediately after Run creation and settled only after native
  start, an acknowledged interrupt, and authoritative `run.cancelled`.
- Fixture, conformance, and trusted current-release live evidence remain
  required when the cancellation contract changes.
