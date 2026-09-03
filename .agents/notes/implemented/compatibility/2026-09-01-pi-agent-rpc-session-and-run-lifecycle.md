# Agent Note: Pi Agent RPC Session and Run lifecycle

Status: implemented

## Problem

The official Pi Agent RPC mode exposes Session state, prompts, streamed Agent
events, abort, extension UI requests, and read commands over strict JSONL stdio.
Its process has one mutable current Session, a prompt response is only command
acceptance, `agent_end` can precede retry activity, and extension UI methods do
not establish a generic approval contract. Harapter must preserve those
semantics without installing Pi Agent, importing its packages, reading native
Session files, or guessing a successful terminal result.

## Decision

[`@harapter/adapter-pi`](../../../../providers/pi/README.md) starts the exact
absolute adapter-owned Pi command supplied by the host. The Workspace contains
no Pi Runtime or SDK dependency. Session processes keep the Profile working
directory resolved once before the version probe, and portable per-Session
Workspace selection is unsupported, so relative Runtime arguments cannot change
meaning between probe and execution. Connection probes the same command with
`--version`, reaps the probe process on every failure, validates the current
documented RPC family at use sites, and composes the Provider-neutral strict
JSONL process transport for framing, bounds, backpressure, serialized writes,
and cleanup.

Each Harapter Session owns a separate Pi RPC process. The native Session ID,
persistence mode, Provider, Profile, and RPC compatibility family remain bound
in `SessionRef`. Persisted resume starts a new process with the native ID and
requires `get_state` to return the same idle Session. Ephemeral Sessions disable
native persistence and resume. The Adapter never stores a Pi Session-file path
or transfers a Session reference between Providers or Profiles.

One Run may be active per Session process. The prompt response establishes
preflight acceptance only. The Adapter continues through any retry sequence and
waits for `agent_settled`, then uses the most recent validated Assistant
`message_end` as terminal authority. `stop` completes, `aborted` cancels only
after a correlated successful abort response, and other known stop reasons fail.
A missing or unknown Assistant outcome, unsolicited aborted terminal, EOF,
process loss, queue overflow, or unconfirmed abort fails closed. Native
cancellation requires both the abort response and the authoritative cancelled
terminal; a local Run timer remains emulated control. Session processes append
`--no-extensions`, `--no-skills`, and `--no-prompt-templates`, and Profiles
cannot explicitly load those resources. Portable text beginning with a slash is
rejected. These boundaries prevent input from being reported as handled by a
command or extension without an Agent terminal lifecycle.

Pi extension UI requests map to typed Provider interactions and make
`interaction.provider` observable at runtime. They do not imply portable
approval or user-input support. Unknown messages remain visible through bounded,
structurally redacted Provider events and observations. Native access permits
only ownership-preserving read commands for active Sessions. A bounded command
tombstone consumes a matching late response after a local native-read wait ends;
exhausting that bound closes the connection instead of losing correlation.
Arbitrary numeric values in unknown observations are hashed like strings and
identifiers. Client and Session close fail when bounded child termination cannot
confirm process exit, and Client ownership records remain until cleanup
succeeds.

## Alternatives considered

### Import the Pi coding-agent package directly

The package exposes useful internal types and Session objects, but a direct
dependency would install Provider Runtime code into the default Workspace and
bind Harapter to package internals. The official RPC mode supplies the required
host-owned machine interface without that dependency.

### Share one Pi process across multiple Harapter Sessions

Pi RPC commands operate on one mutable current Session. Switching that state
would weaken Session ownership, complicate event routing, and make concurrent
Run cancellation ambiguous. One process per Session preserves isolation at the
cost of additional process resources.

### Treat prompt response or `agent_end` as the terminal result

The prompt response confirms command handling rather than Run outcome, and
`agent_end` can be followed by retry work. Either boundary could publish success
before the Runtime settles. `agent_settled` plus the validated Assistant outcome
provides a stable terminal rule.

## Consequences

- Harapter can create, resume, close, prompt, cancel, stream events, and answer
  observed extension UI requests through a host-operated Pi Runtime.
- Parallel Sessions consume separate Pi processes, while each Session serializes
  Runs to preserve ownership and event routing.
- The Adapter follows the current documented RPC family instead of pinning one
  Pi release; breaking upstream structures require synchronized mappings,
  fixtures, tests, documentation, and review.
- Synthetic fixtures and shared conformance establish deterministic source
  evidence. A trusted live canary passed on 2026-09-03 with
  `@earendil-works/pi-coding-agent@0.84.4`, proving the configured text Run,
  Event, terminal, persisted resume, native cancellation, and cleanup path. The
  Adapter remains experimental because the RPC family does not negotiate a
  protocol version that can bind any connected Runtime to that evidence before
  use.
- Text input, typed extension UI interactions, and read-only native access are
  supported within the documented boundary. Images, files, per-Session Workspace
  selection, system-context overrides, portable model selection, generic
  approvals, Runtime extension loading, skills, prompt templates, Session-file
  access, arbitrary native mutations, and automatic process restart remain
  outside it.
