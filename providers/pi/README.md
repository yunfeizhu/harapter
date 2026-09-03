# `@harapter/adapter-pi`

`@harapter/adapter-pi` maps the official Pi Agent RPC mode to the portable
Harapter lifecycle.

The host installs, configures, authenticates, and operates Pi Agent. Harapter
starts only the exact adapter-owned command selected by the Profile. It does not
install a Pi Runtime or SDK, select models, manage credentials, read Session
files, or change host security policy.

## Installation

```bash
pnpm add @harapter/core@next @harapter/adapter-pi@next
```

## Runtime prerequisites and compatibility

Connection requires the current documented `pi --mode rpc` strict LF-delimited
JSONL interface. The Adapter probes the supplied command with `--version`,
validates the semantic version response, and fails closed when required RPC
responses or events are incompatible. The Runtime release is not pinned; a
non-sensitive version hash participates in diagnostics and capability evidence.

The fixture manifest records the upstream source revision inspected for the
evidence baseline. That revision and Runtime version are provenance, not an
allowlist. Pi Agent is MIT licensed; Harapter does not redistribute it. See the
[license record](../../licenses/pi-agent.md).

## Profile and process ownership

A Pi Profile uses an adapter-owned process. The host provides the base command:

```ts
import { HarnessRegistry, profileId } from '@harapter/core';
import { PI_PROVIDER_ID, createPiProviderFactory } from '@harapter/adapter-pi';

const registry = new HarnessRegistry();
registry.register(createPiProviderFactory());

const client = await registry.connect({
  profileId: profileId('pi-local'),
  providerId: PI_PROVIDER_ID,
  displayName: 'Pi Agent',
  connection: {
    kind: 'process',
    command: '/opt/harapter-runtimes/bin/pi',
    args: [],
    ownership: 'adapter',
  },
});
```

The Adapter appends
`--no-extensions --no-skills --no-prompt-templates --mode rpc` for each Session.
The host must provide an absolute executable path. Shell execution, unresolved
`envRefs`, external process ownership, explicit extensions, and arguments that
override RPC mode, Session ownership, credentials, system prompts, or resource
discovery policy are rejected. The Adapter does not inspect or interpolate
environment entries, but the child process inherits the host-controlled
environment that Pi may use for model configuration and authentication.

Profile `providerOptions` accepts positive bounded values for
`operationTimeoutMs`, `cancelSettlementTimeoutMs`, `maxRunEvents`,
`maxPendingInteractions`, `maxPendingRequests`, `maxBufferedMessages`,
`maxMessageBytes`, `maxPendingWrites`, and `writeTimeoutMs`. `persistSessions`
defaults to `true`; `false` adds `--no-session` and disables resume. Unknown
options are rejected. `maxRunEvents` must be between 2 and 4096 so an unread Run
queue always reserves terminal capacity.

## Session and Run lifecycle

Each Harapter Session owns a separate Pi RPC process. This permits parallel
Sessions without sharing Pi's mutable current-Session state, while each Session
allows one active Run. The child always uses the Profile working directory, so
version probing and Session execution interpret all Runtime arguments in the
same directory. The Adapter resolves an omitted or relative Profile working
directory once before probing. Portable per-Session Workspace selection is
unsupported.

After startup, the Adapter validates `get_state` and binds the native Session
identifier, persistence mode, Provider, Profile, and compatibility family in
`SessionRef`. Persisted resume starts a new process with `--session <native-id>`
and requires the opened Session to report the same identifier. Harapter does not
store or expose Pi Session-file paths and never implies that a Session reference
is portable to another Provider or Profile.

Session Workspace, system context, model selection, Session Provider options,
and metadata are unsupported. Portable Runs accept non-empty text only; multiple
text parts are joined with a newline. Input whose first non-whitespace character
is `/` is rejected because Pi can interpret it as a slash command or Session
mutation instead of an Agent Run. Extension, skill, and prompt-template
discovery are disabled so ordinary portable text cannot be intercepted and
reported as handled without an Agent lifecycle. Image, file, Provider-native
input parts, Run metadata, and Run Provider options remain unsupported.

Message, reasoning, tool lifecycle, usage, and extension UI observations map to
portable events. Tool identifiers are hashed, and tool arguments or results are
never retained in portable events. A successful `prompt` response proves only
that Pi accepted the command. `agent_end` can precede retry activity and is not
a stable terminal boundary. The Adapter waits for `agent_settled` and then uses
the most recent validated Assistant `message_end` as terminal authority:

- `stop` maps to `run.completed`;
- `aborted` maps to `run.cancelled` only after a correlated successful `abort`
  response; an unsolicited aborted terminal fails the Run;
- `error`, `length`, `toolUse`, `deferred`, or `pending` maps to `run.failed`;
- a missing or malformed Assistant outcome fails closed;
- EOF, process loss, Client close, queue overflow, or unconfirmed cancellation
  maps to `connection.aborted`.

Events received after the terminal boundary cannot append to or rewrite the
finished Run. Client and Session close reject with `connection_aborted` when
child-process exit cannot be confirmed after bounded termination. The Client
retains ownership records until cleanup succeeds, so a later close cannot report
success for an unconfirmed child.

## Cancellation, timeout, and interactions

`run.cancel()` sends the official `abort` command, waits for its response, and
reports `{ mode: 'native' }` only after an authoritative Assistant
`stopReason: 'aborted'` followed by `agent_settled`. An abort acknowledgement,
process termination, or connection loss alone is not cancellation evidence.

A positive `RunOptions.timeoutMs` invokes the same abort operation but remains
an emulated Harapter timer capability. If Pi does not establish the required
terminal result within the bounded settlement window, the owning connection is
aborted rather than reopened in an uncertain state.

Pi extension UI requests for `select`, `confirm`, `input`, and `editor` map to
portable Provider interactions. Their responses use the exported
`PiProviderInteractionResponse` union. This capability starts as `unknown` and
becomes `native` only after the connected Runtime emits a valid request.
Portable approval and user-input capabilities remain unsupported because the
official RPC surface exposes these calls as extension-owned UI methods rather
than a general permission contract.

## Unknown events, extension, and native access

Unknown RPC events remain observable as bounded `provider` events and through
`pi.agent.rpc.observations`. The observation channel limits nesting and
collection sizes, hashes arbitrary strings, numbers, and identifiers, and does
not retain prompts, paths, credentials, environment values, tool arguments, tool
results, or Provider errors. Unknown events never establish success.

`client.native()` returns a `PiNativeClient` that exposes the non-sensitive
Runtime identity, observation subscription, and ownership-preserving read
commands for an active Session. Arbitrary Run or Session mutation commands are
rejected. A bounded correlation tombstone consumes a matching late response
after a local read wait times out or is aborted; exhaustion closes the
connection rather than accepting an unmatched response. Native access remains
outside portable lifecycle and compatibility guarantees.

## Evidence and limitations

Evidence for this experimental Adapter includes:

- deterministic synthetic completion, cancellation, failure, interaction, and
  unknown-event fixtures in
  [`fixtures/pi/rpc-current`](../../fixtures/pi/rpc-current/manifest.json);
- mapping, ownership, resume, cancellation, retry, timeout, interaction,
  disconnect, malformed-input, event-bound, process cleanup, version-probe,
  native-access, and Provider-negative tests;
- the shared portable Provider conformance suite;
- an opt-in live lifecycle test for a host-installed Pi Runtime;
- a trusted live-canary path that installs the current official release on an
  ephemeral runner and exercises a completed text Run, streamed Events, the
  authoritative terminal, persisted Session resume, native cancellation, Session
  close, and Client disposal.

The last repository-recorded live lifecycle run passed on 2026-09-03 with
`@earendil-works/pi-coding-agent@0.84.4` in
[Provider live canary run 33732602596](https://github.com/yunfeizhu/harapter/actions/runs/33732602596).
It verified current-package installation, version probing, the model-facing CLI
safety surface, RPC handshake, an exact completed text response, streamed
`message.completed` and authoritative `run.completed` Events, persisted Session
resume, correlated native cancellation with authoritative `run.cancelled`,
Session close, Client disposal, isolated-state cleanup, and the absence of tool
or interaction Events. It did not prove image or file input, extension UI
interactions, or other capabilities outside that path. A production host may pin
that release for reproducibility. Harapter continues to admit newer releases and
validates their observed structures instead of using the recorded version as an
executable allowlist. The Adapter remains experimental because the current RPC
family does not negotiate a protocol version that can bind an arbitrary
connected Runtime to this evidence before use.

Run live verification only when two synthetic text Prompts, one completed model
request, and one native cancellation attempt are acceptable to the host. The
isolated config must define a `harapter-live` model and reference
`HARAPTER_LIVE_MODEL_API_KEY` rather than storing the credential:

```bash
pi_live_home="$(mktemp -d)"
trap 'rm -rf "$pi_live_home"' EXIT
mkdir -p "$pi_live_home/sessions"

HARAPTER_LIVE_MODEL_ID=... \
HARAPTER_LIVE_MODEL_URL=https://model.example/v1 \
node scripts/prepare-live-canary.mjs \
  write-pi-config "$pi_live_home/config/models.json"

PI_CODING_AGENT_DIR="$pi_live_home/config" \
PI_CODING_AGENT_SESSION_DIR="$pi_live_home/sessions" \
PI_OFFLINE=1 \
PI_SKIP_VERSION_CHECK=1 \
PI_TELEMETRY=0 \
HARAPTER_LIVE_MODEL_API_KEY=... \
HARAPTER_PI_LIVE=1 \
HARAPTER_PI_COMMAND=/opt/harapter-runtimes/bin/pi \
HARAPTER_PI_MODEL=... \
pnpm vitest run providers/pi/test/live.test.ts
```

The live test requires the exact completed response, a completed message Event,
and the authoritative completed Run Event. It resumes the same native Session,
then requires a correlated native cancellation and authoritative cancelled Run.
The Pi Runtime starts with tools, extensions, skills, prompt templates, and
context-file discovery disabled; any tool or interaction Event fails the test.
The test logs no Provider traffic and deletes its isolated Session state. A
skipped or failed live test is not support evidence. Passing trusted manual and
scheduled runs refresh evidence for the installed release without creating a
version allowlist or changing the unnegotiated compatibility boundary.

Image and file input, portable model selection, system-context overrides,
generic approvals, per-Session Workspace selection, Runtime extension loading,
skills, prompt templates, shared-process Session multiplexing, automatic process
restart, Session-file access, arbitrary native mutations, and live authenticated
extension-interaction evidence are outside the current compatibility boundary.
