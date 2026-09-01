# `@harapter/adapter-pi`

`@harapter/adapter-pi` maps the official Pi Agent RPC mode to the portable
Harapter lifecycle. The package is private and versioned `0.0.0` during
pre-alpha.

The host installs, configures, authenticates, and operates Pi Agent. Harapter
starts only the exact adapter-owned command selected by the Profile. It does not
install a Pi Runtime or SDK, select models, manage credentials, read Session
files, or change host security policy.

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
- an opt-in live connection test for a host-installed Pi Runtime.

Run live verification only when starting and closing an isolated Pi RPC Session
is acceptable to the host:

```bash
HARAPTER_PI_LIVE=1 \
HARAPTER_PI_COMMAND=/opt/harapter-runtimes/bin/pi \
pnpm vitest run providers/pi/test/live.test.ts
```

The live test sends no prompt and logs no Provider traffic. A skipped or
unrecorded live test is not support evidence, so the Adapter remains
experimental in source.

Image and file input, portable model selection, system-context overrides,
generic approvals, per-Session Workspace selection, Runtime extension loading,
skills, prompt templates, shared-process Session multiplexing, automatic process
restart, Session-file access, arbitrary native mutations, and live authenticated
Run evidence are outside the current compatibility boundary.
