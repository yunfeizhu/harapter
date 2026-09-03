# `@harapter/adapter-opencode`

`@harapter/adapter-opencode` maps the current documented stable `opencode serve`
HTTP/OpenAPI and Server-Sent Events interface to Harapter Core. The package is
private and versioned `0.0.0` during pre-alpha.

The host installs, configures, authenticates, starts, and stops OpenCode. The
Adapter connects only to a host-selected HTTP endpoint and never invokes a
runtime installation, server disposal, or Session deletion route implicitly.

## Profile and authentication

OpenCode uses an `endpoint` Profile with `transport: 'http'` and
`ownership: 'host'` or `ownership: 'external'`:

```ts
import { profileId } from '@harapter/core';
import {
  OPENCODE_PROVIDER_ID,
  createOpenCodeProviderFactory,
} from '@harapter/adapter-opencode';

const factory = createOpenCodeProviderFactory({
  resolveAuthHeaders: async (reference) => headersFor(reference),
});

const client = await factory.connect({
  profileId: profileId('opencode-local'),
  providerId: OPENCODE_PROVIDER_ID,
  displayName: 'OpenCode',
  connection: {
    kind: 'endpoint',
    url: 'http://127.0.0.1:4096/',
    transport: 'http',
    ownership: 'external',
    authRef: { scheme: 'host-secret-store', id: 'opencode-server' },
  },
});
```

`authRef` is optional. When present, the host must provide `resolveAuthHeaders`;
Harapter never resolves, logs, persists, or returns the header values.
OpenCode's server password, username, and other authentication configuration
remain outside the Adapter.

Profile `providerOptions` accepts positive bounded values for
`requestTimeoutMs`, `sseConnectTimeoutMs`, `runRequestTimeoutMs`,
`cancelSettlementTimeoutMs`, `eventDrainTimeoutMs`, and `maxRunEvents`. Unknown
options are rejected. `maxRunEvents` must be between 2 and 4096 so the bounded
queue always reserves terminal capacity.

## Session lifecycle

- `createSession()` calls the documented Session creation route. A portable file
  workspace URI becomes the OpenCode `directory` query.
- OpenCode selects an instance by directory. The returned directory, portable
  system context, and model selection are retained in the provider-bound
  `SessionRef` so resume and subsequent prompts use the same configuration.
- A model selection uses the native model ID plus
  `model.providerOptions.providerId`.
- `resumeSession()` validates Provider, Profile, stable interface identity,
  directory state, directory-scoped runtime status, remote Session ID, and
  returned directory before exposing an idle resumed Session. Busy or retrying
  Sessions are not resumed.
- `session.close()` releases only the local handle. It does not call OpenCode's
  DELETE route, which deletes the Session and its data.

## Run and event lifecycle

One Run may be active per OpenCode Session. The Adapter opens the directory
event stream before posting a synchronous Session message, then maps assistant
text, reasoning, tool, artifact, usage, and permission events. A bounded queue
prevents a stalled consumer from accumulating unbounded Provider events.

The synchronous message response is the only successful terminal authority.
`session.idle` may help drain already-sent SSE events, but it never proves
success by itself. Malformed events, stream loss, HTTP failure, and unknown
terminal shapes cannot become `run.completed`.

`run.cancel()` calls the documented Session abort route. Harapter reports
`native` only after OpenCode acknowledges the abort and the authoritative
message response reports `MessageAbortedError`. A local request, event stream,
Session, or Client abort remains `connection_aborted`. An uncertain remote
settlement quarantines that Session handle and its Session ID within the Client;
it cannot start or resume work until the host performs explicit recovery through
a new connection whose status probe observes the Session as idle.

OpenCode permission events map to portable approval interactions. Portable
approval sends `once`, denial sends `reject`, and an explicit approval
`providerOptions: { scope: 'always' }` sends `always`.

## Inputs and native access

Portable text is native. `file_ref` and `image_ref` map to documented file parts
and require an absolute URI plus `mediaType`; image media types must start with
`image/`. `opencode.part` accepts validated native text, file, agent, and
subtask parts.

Run `providerOptions` accepts `agent`, `system`, `tools`, and a native model
object containing `providerId` and `modelId`. Unsupported fields are rejected
instead of being ignored.

`client.native()` returns an `OpenCodeNativeClient` with bounded JSON requests
inside the configured endpoint and a listener for redacted events that cannot be
routed to an active Run. Native calls are Provider-bound and do not gain
portable lifecycle guarantees.

## Compatibility and evidence

The Adapter targets the current documented stable server interface without
pinning the OpenCode executable to a release number. Connection validates the
health response; every used Session, message, abort, permission, and event shape
is validated at runtime. The runtime version is reported as identity and does
not determine capabilities by itself.

The fixture manifest records the exact upstream release, commit, and stable
OpenAPI fingerprint used for the current evidence baseline. Those values are
evidence metadata, not a runtime allowlist. Capability declarations come from
that reviewed stable schema plus executable conformance and live-runtime
evidence; an incompatible runtime shape fails closed at the boundary where it is
used.

Evidence includes:

- a published stable OpenAPI fingerprint and synthetic redacted fixtures in
  [`fixtures/opencode/http-openapi-stable`](../../fixtures/opencode/http-openapi-stable/manifest.json);
- protocol mapping, authentication, malformed-input, lifecycle, cancellation,
  interaction, unknown-event, and error tests;
- the shared portable Provider conformance suite;
- an opt-in live-runtime test enabled with `HARAPTER_OPENCODE_LIVE=1` and a
  host-operated server URL in `HARAPTER_OPENCODE_ENDPOINT`;
- a trusted scheduled live canary that installs the current stable OpenCode
  release on an ephemeral runner, starts an isolated local server with no
  plugins, denied permissions, and disabled tools, records the installed package
  version, and executes a lifecycle that rejects any tool or interaction event.

The last repository-recorded
[trusted live canary](https://github.com/yunfeizhu/harapter/actions/runs/33747923398)
passed on 2026-09-03 with `opencode-ai@1.18.27`. It proved the stable health
interface, an exact completed text response with `run.completed`, resume of the
same directory-bound native Session through a fresh Client connection, native
abort with `run.cancelled`, and orderly Session, Client, and Server cleanup. The
canary submitted two synthetic Prompts with no Tool or interaction Event.

A production host may pin the recorded release for a reproducible deployment.
Harapter continues to admit newer stable releases and validates their observed
health, Session, Event, and terminal structures instead of using the recorded
version as an executable allowlist. The run does not establish automatic SSE
reconnection, experimental routes, permission interactions, Tool execution,
commands, plugins, process management, or remote Session deletion.

The package does not claim support for experimental routes, automatic SSE
reconnection, OpenCode process management, remote Session deletion through
portable close, or commands and plugins as portable Core capabilities.
