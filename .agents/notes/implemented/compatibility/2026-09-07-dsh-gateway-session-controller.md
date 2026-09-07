# Agent Note: DSH Gateway Session Controller strategy

Status: implemented

## Problem

The [DSH Adapter](../../../../providers/dsh/README.md) already reaches the
Runtime through SDK stdio. Its
[SDK decision](2026-08-31-deepseek-harness-sdk-protocol.md) covers an interface
without requested native cancellation, resume, or fork. Those limitations belong
to that connection strategy; the Runtime also exposes a broader public Gateway.
Harapter needs these native operations without owning the Agent Loop, native
storage, plugin composition, or host security policy.

## Decision

### Connection and evidence boundary

The existing Provider factory selects SDK process or Gateway endpoint transport
from the Profile connection kind. Core remains unchanged and provider-agnostic.
Gateway uses the official MIT-licensed HTTP and WebSocket machine interfaces at
[`d347e703908d0406b7a7ef80e3a0e594d86b2215`](https://github.com/deepseek-ai/deepseek-harness/tree/d347e703908d0406b7a7ef80e3a0e594d86b2215).
The Session Controller source identifies itself as `0.1.3-alpha.1`; matching npm
publication is not assumed. The exact protocol fingerprint, limits, public
controls, errors, and host obligations belong to the
[Gateway contract](../../../../providers/dsh/README.md#gateway-endpoint-strategy).

A successful `session/modelCatalog` probe establishes that the configured
Gateway exports that validated surface. It cannot attest the Runtime version,
store, exclusive access, installed plugins, or security policy. The host must
explicitly supply the fixed protocol and native-store identity, and attest
exclusive Session ownership. The descriptor remains experimental. Structural
validation and independent evidence are necessary even with this attestation.

The host installs and starts DSH. Harapter connects only to a root HTTPS
authority or loopback HTTP endpoint and rejects redirects and credential-bearing
URLs. A host resolver owns the signed browser-session cookie and renewal. The
[official Connection](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/connection/README.md)
uses a root-page launch-token exchange; a bearer key cannot authenticate RPC.
Both carriers send the same resolved cookie and configured Origin. Harapter does
not access browser profiles, Runtime credentials, or global Session feeds.

The DSH-local transport uses `ws` for authenticated Node upgrades, unary HTTP
`client-request` / `server-response` envelopes with exact RPC correlation, and
`/api/remote.mux` logical streams. It bounds requests, bytes, listeners, Session
streams, queues, and deadlines. A malformed stream error must fail its waiting
consumer before removing the stream. Close disposes only local observation and
requests. No Runtime package enters the Harapter dependency graph.

### Ownership and native operations

Create allocates a fresh native Session using host defaults. Resume opens
`session/follow` against an existing identity and never falls back to create.
References bind Provider, Profile, endpoint authority, protocol, host store, and
a one-way hash of stable Session-header fields. No private path or credential is
serialized into the reference. A reused URL alone is not proof of identity.
Subagent-owned Sessions and incomplete bounded history are rejected.

Follow subscribes before snapshot delivery and can asynchronously activate a
persisted Agent; a snapshot is not proof of successful activation. Prompt
admission and durable events establish actual execution. A complete opening
history reconstructs the inbox and turn state but is never emitted as a new
Run's output. Harapter permits one active Run per Client and requires an idle,
empty target inbox before submitting queue-mode text. `source.rpcId` correlates
the exact inserted inbox message with Harapter's request; transport RPC IDs are
separate. The non-cancelled deletion that claims that exact message binds the
turn even before a user message is appended. Consequently early pre-step
cancellation, rejection, and errors retain their native terminal meaning. Actual
user messages must still match the claimed ID. Official dynamic context from
`@deepseek-ai/dsh-system-prompt` is permitted only inside that owned step; it
cannot establish request ownership, and arbitrary plugin input remains
unsupported. Competing activity and gaps fail closed.

A recognized, correlated `turn/end` is the terminal authority. Completed text
comes from validated durable Assistant messages, not transient token deltas.
Results arriving before the HTTP receipt remain provisional; new turn or inbox
activity in that interval cannot turn uncertain admission into success. Known
asynchronous title events may continue with contiguous sequence numbers without
invalidating an already validated terminal. Local serialized prompt limits are
checked before Run ownership, and definite precondition rejection releases the
provisional Run without quarantining its Client. Uncertain write receipts
quarantine the Client without replay. A definite precondition rejection remains
recoverable. Local Session mutations are serialized, and a new Run cannot cross
an outstanding cancellation request. Repeated close of a stale handle cannot
remove a later attachment to the same native Session.

The typed extension forks the latest completed-turn prefix. Arbitrary `atSeq`
anchors are omitted because upstream selects the next completed boundary rather
than an exact inclusive cut. Returned child identity and parent lineage are
validated. Native Session cancellation has `keepInbox: true`; acceptance is
separate from a cancelled terminal. The operation cannot condition on a Run ID
and a local mutex cannot exclude an external writer. Portable `run.cancel` and
`session.fork` remain unsupported. The native escape hatch exposes these narrow
controls rather than unconstrained RPC that could violate owned intervals.

Client close, local deadline, stream loss, protocol failure, and unread-event
capacity end active Runs as connection abort. The host Agent may continue.
Closing never deletes native state or terminates the external Runtime. Automatic
reconnect, prompt replay, transparent Run recovery, history pagination,
images/files, interactions, and host plugin management are deferred.

Unknown events remain observable in bounded redacted Run/provider observations
and the attached-Session notification extension, including idle activity.
Unknown required events then abort the connection. Observers receive detached
redacted data, have bounded registration, and cannot break lifecycle processing
through synchronous exceptions or asynchronous rejections. Error codes are
allowlisted; upstream failure bodies and arbitrary terminal error codes never
reach portable diagnostics.

### Verification

[Gateway fixtures](../../../../fixtures/dsh/gateway-session-v2/manifest.json)
contain authored synthetic Session v2 traffic, not captured user data. Tests
exercise mapping, inbox restoration, terminal reasons, correlation, malformed
frames and responses, authentication, limits, timeouts, teardown races,
uncertain mutations, fork lineage, resume ownership, and shared conformance.
Existing SDK behavior retains its separate tests and compatibility evidence.

On 2026-09-07 the exact official source was built outside the Harapter workspace
with `build:lib:host` and `build:lib:client`; the `fs-ext` native file-lock
module was compiled for Node 24.19.0. The compiled official CLI booted an
isolated custom Profile with Gateway, Session Controller, Agent Loop, JSONL
persistence, workspace/storage services, an empty tool registry, and no tool
plugins. The model endpoint was the official local `dsh-llm-mock-server`,
producing scripted text and a stalled turn. Authentication used the official
signed-cookie exchange in memory, with an explicit owner-only temporary
credential file for the repository live test. No maintainer Session, real model
credential, external model, or Runtime install in Harapter was used.

The same live lifecycle was rerun successfully with the official dynamic Runtime
context enabled after the initial review corrections. The cancellation check
waits for a durable step-start checkpoint: cancelling before any turn starts
legitimately need not produce a cancelled terminal, which the fixture suite
covers separately. Tests also cover context injection, early claim-based
terminals, local request rejection, definite remote preconditions, and title
notifications racing admission receipts.

The repository's
[opt-in Gateway live test](../../../../providers/dsh/test/gateway-live.test.ts)
passed create, completed text, native fork, Client reconnect/resume, independent
child continuation, and Session cancellation. A separate host check persisted a
fork reference, stopped the official CLI process, booted a new process against
the same isolated JSONL store, renewed its cookie, resumed that exact reference,
and completed a new child turn. These are actual Runtime results with a
synthetic model. They do not establish compatibility with arbitrary plugins,
published npm ranges, shared writers, or real external models.

The live test accepts only explicit host endpoint/store/test-cookie settings; it
neither installs nor starts the Runtime. Its documented fixture requires two
successful responses followed by a stalled response. A skipped test provides no
compatibility evidence. The full Runtime restart check is distinguished from the
repository test's Client reconnect.

## Alternatives considered

### Retain only SDK stdio

This remains a valid isolated process strategy and preserves its existing
contract, but cannot expose native persistence or fork through its current
public machine interface.

### Embed Runtime services

Direct Session Controller access offers more operations but makes Harapter own
Agent composition, native persistence, plugins, and policy. These remain host
responsibilities; official services are composed only in isolated verification.

### Assemble the generated Cordis Client in Harapter

The official Client supplies codecs and richer recovery, but its plugin and
browser Connection dependencies do not establish a standalone Node SDK. A
bounded DSH-local wire adapter keeps the host boundary explicit at the cost of
maintaining the pinned protocol mapping. A generic transport package is deferred
until another supported consumer demonstrates a common contract.

### Add portable fork and precise cancellation first

Completed-prefix fork, exact checkpoint copying, Session cancellation, and
conditional Run cancellation differ. Typed native controls preserve those
semantics until additional Providers and upstream ownership evidence justify a
portable contract.

## Consequences

- Existing SDK Profiles and references keep their prior behavior. Gateway is an
  explicit new strategy; references never migrate between strategies or stores.
- Gateway is a moving application protocol with host-attested compatibility. New
  protocol fingerprints or compositions require fixtures, conformance, live
  evidence, and synchronized contracts before support expands.
- Cookies grant the server's control plane authority. Narrow Adapter operations
  do not reduce that server grant, and local close does not revoke credentials.
- Resume/fork can invoke native composition and workspace effects. Failed or
  uncertain writes can leave durable state; local disposal cannot roll it back.
- The first strategy intentionally gives up shared Session writers, transparent
  recovery, arbitrary history windows, token deltas, and precise portable
  cancellation. Large or incompatible histories fail instead of guessing.
