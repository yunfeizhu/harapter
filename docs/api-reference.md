# Harapter API reference

[English](./api-reference.md) · [简体中文](./api-reference.zh-CN.md) ·
[日本語](./api-reference.ja.md)

Look up the implemented application API exported from `harapter` here. For a
first working call, use the [SDK tutorial](../packages/harapter/README.md). This
reference follows the [SDK exports](../packages/harapter/src/index.ts) and
[portable type declarations](../packages/core/src/contracts.ts); it does not
turn the [target design](./design/api-design.md) into a support claim. The
[SDK guide](../packages/harapter/README.md) and
[Core guide](../packages/core/README.md) own runtime semantics; each Provider
guide owns its supported options, event payloads and compatibility range.

For one task, call `run()`. For explicit Session ownership, use `createHarapter`
→ `connect` → `createSession` → `start` → `events` / `result` → `close`.

| Look up                                    | Section                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Run one task and release its handles       | [run](#run)                                                                                     |
| Select harnesses and supply authentication | [createHarapter](#createharapter)                                                               |
| Configure a Runtime connection             | [HarnessProfile](#harnessprofile)                                                               |
| Connect, create or resume a Session        | [HarnessRegistry](#harnessregistry), [HarnessClient](#harnessclient)                            |
| Send input, handle interactions            | [HarnessSession](#harnesssession), [HarnessInput](#harnessinput), [Interactions](#interactions) |
| Stream, cancel and read the final answer   | [HarnessRun](#harnessrun), [RunResult](#runresult), [HarnessEvent](#harnessevent)               |
| Check optional support and failures        | [Capabilities](#capabilities), [HarnessError](#harnesserror)                                    |
| Access Provider-specific behavior          | [Extensions and native access](#extensions-and-native-access)                                   |

## run

`run(request: RunRequest): Promise<RunResult>`

`run()` is an additive API introduced after `harapter@1.0.0`. Version 1.0.0 does
not contain it; use a release or source build that includes this API.

The single-call facade selects an existing Adapter outside Core. It returns the
Provider’s terminal result after consuming events and releasing owned handles.
It neither installs a Runtime nor logs in or changes permission policy.

| Field        | Meaning                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness`    | `HarnessName`: `codex`, `dsh`, `pi`, `openclaw`, `opencode` or `hermes`.                                                                                                            |
| `input`      | Non-empty text for one new task.                                                                                                                                                    |
| `cwd?`       | Local process workspace; defaults to `process.cwd()`. OpenCode accepts an absolute server-side directory; omission keeps its server default. Hermes does not support this override. |
| `model?`     | `RunModel`: `{ id: string; provider?: string }`. Selection rules below.                                                                                                             |
| `command?`   | Local executable path or name on absolute `PATH` entries. No shell, installation or implicit current-directory search.                                                              |
| `args?`      | Replaces the preset machine-interface arguments. Protocol-required Adapter flags still apply.                                                                                       |
| `url?`       | OpenCode or Hermes HTTP base URL. Defaults below. Do not embed credentials in the URL.                                                                                              |
| `headers?`   | HTTP headers from host secret storage; snapshotted into a private resolver, never stored in the Profile or SessionRef.                                                              |
| `timeoutMs?` | Whole-call deadline, default `60000`, positive safe integer up to `2147483647`. Includes connecting and async callbacks; cleanup can take longer.                                   |
| `onEvent?`   | `(event: HarnessEvent) => void \| Promise<void>`. Consumed sequentially; rejection fails the call with a redacted `provider_error`.                                                 |

### Defaults and model selection

| Harness    | Connection                            | Model                                                            |
| ---------- | ------------------------------------- | ---------------------------------------------------------------- |
| `codex`    | `codex app-server --stdio`            | Optional `model.id`; configure the model provider in Codex.      |
| `dsh`      | `dsh --profile sdk`                   | Both `model.provider` and `model.id` are required.               |
| `pi`       | `pi` with Adapter RPC/isolation flags | Uses Runtime settings; `run.model` is unsupported.               |
| `openclaw` | `openclaw acp`                        | Uses Runtime settings; `run.model` is unsupported.               |
| `opencode` | `http://127.0.0.1:4096`               | Optional override requires both `model.provider` and `model.id`. |
| `hermes`   | `http://127.0.0.1:8642`               | Optional `model.id` and `model.provider`.                        |

Process calls reject HTTP options, and HTTP calls reject process options.
Unsupported model/workspace overrides reject with `unsupported_capability`;
malformed or incomplete options use `invalid_request`. Missing local executables
use `runtime_not_found`.

A deadline rejects with `timeout` and aborts connections, not a proven native
cancellation. No automatic interaction response is sent; an interaction fails
with `unsupported_capability`. Each call uses a fresh Session. Native state may
persist after handles close; use the Session API for continuation or
cancellation. See the SDK guide for cleanup and ownership details.

[RunRequest / RunModel](../packages/harapter/src/run-types.ts) ·
[SDK](../packages/harapter/README.md)

## openSession

`openSession(options: RuntimeOptions): Promise<ChatSession>`

Use `openSession()` once, then call `send()` for each message. The same native
Session keeps the conversation history. This API is added after 1.0.0 and is not
yet in that release.

`RuntimeOptions = Omit<RunRequest, 'input' | 'onEvent'>`.
`ChatSession extends HarnessSession`, with
`send(input: string, options?: SendOptions): Promise<RunResult>` and
`readonly client: HarnessClient`.

A chat permits one active Run at a time. `send()` consumes events and accepts
`{ timeoutMs, onEvent }`; its default deadline is the value supplied to
`openSession()` (60000 ms otherwise). Observer, deadline and interaction
failures close the owned connection. This is not proof of native cancellation.
Use inherited `start()` / `respond()` for interactions and `run.cancel()` for
capability-supported cancellation. `chat.client` exposes the same connection’s
capabilities, extensions, resume and native controls. Closing the chat also
closes that Client; keep the Client/Session API for independently owned or
resumed Sessions.

### runtime

`run()` and `openSession()` accept the same `RuntimeOptions`. Omit `runtime` for
the documented CLI or HTTP defaults. You do not need a separate Harapter adapter
import.

- `PiSdkRuntime`:
  `{ kind: 'pi-sdk', version: '0.85.1', createSession: PiSdkSessionFactory }`.
- `DshGatewayRuntime`: `DshGatewayProfileOptions` +
  `{ kind: 'dsh-gateway', url, resolveCookie(signal) }`.
- `OpenClawAcpRuntime`:
  `{ kind: 'openclaw-acp', gateway: OpenClawGatewayBinding }`.

OpenCode uses HTTP/SSE and Hermes uses HTTP/SSE; neither requires a
Harapter-managed SDK subprocess. Codex keeps App Server stdio. OpenClaw keeps
ACP as its Run transport and accepts
`runtime: { kind: "openclaw-acp", gateway }` for an existing
`OpenClawGatewayBinding`; its profileId is preserved. The Gateway only adds
supported native Session controls and is never disposed by Harapter.

[RuntimeOptions](../packages/harapter/src/run-types.ts) ·
[Runtime bindings](../packages/harapter/src/runtime-types.ts) ·
[SDK guide](../packages/harapter/README.md)

## createHarapter

`openClawGateway?: OpenClawGatewayBinding` forwards an existing host binding to
the matching ACP Profile.

`createHarapter(options?: HarapterOptions): Promise<HarnessRegistry>`

Loads the selected built-in protocol mappings. It neither installs Runtimes nor
opens connections. Omitting `options` returns an empty Registry. Supplying an
options object requires `harnesses`; duplicate selections load once.

| HarapterOptions field   | Type / purpose                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `harnesses`             | `readonly HarnessName[]`. Select from the names below.                                                                                                       |
| `resolveAuthHeaders?`   | `(reference: SecretRef) => Readonly<Record<string, string>> \| Promise<Readonly<Record<string, string>>>`. Host authentication for OpenCode and Hermes HTTP. |
| `resolveGatewayCookie?` | `(reference: SecretRef, signal: AbortSignal) => string \| Promise<string>`. Host authentication for DSH Gateway.                                             |

A `SecretRef` has `scheme: string` and `id: string`. Resolvers authorize the
exact reference before returning credentials. Harapter does not read a universal
set of model-key environment variables; each Runtime owns model authentication.

| HarnessName | Profile providerId  | Runtime setup and limitations               |
| ----------- | ------------------- | ------------------------------------------- |
| `codex`     | `openai.codex`      | [Codex](../providers/codex/README.md)       |
| `dsh`       | `deepseek.harness`  | [DSH](../providers/dsh/README.md)           |
| `hermes`    | `nous.hermes-agent` | [Hermes](../providers/hermes/README.md)     |
| `openclaw`  | `openclaw`          | [OpenClaw](../providers/openclaw/README.md) |
| `opencode`  | `opencode`          | [OpenCode](../providers/opencode/README.md) |
| `pi`        | `pi.agent`          | [Pi](../providers/pi/README.md)             |

Invalid selection rejects with `invalid_request`; an unusable bundled mapping
rejects with `provider_api_incompatible`.

## HarnessProfile

A Profile identifies one configured connection. Switching Profiles chooses a
Runtime for a new Client; it does not move existing Sessions.

| Field                   | Type / purpose                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `profileId`             | `ProfileId`, created with `profileId('local-dsh')`. Host-assigned connection identity.         |
| `providerId`            | `ProviderId`, created with `providerId('deepseek.harness')`. Must match a registered Provider. |
| `displayName`           | `string`. Display label.                                                                       |
| `connection`            | `ProviderConnection`. One variant below.                                                       |
| `providerOptions?`      | `Readonly<Record<string, unknown>>`. Options accepted by the selected mapping.                 |
| `requiredCapabilities?` | `readonly CapabilityRequirement[]`. Checked before `connect` returns.                          |
| `metadata?`             | `Readonly<Record<string, string>>`. Host metadata.                                             |

`ProviderConnection` is a discriminated union. These are the portable types, not
a promise that every mapping accepts every variant:

| kind           | Fields                                                                                                         | ownership                       |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `process`      | `command: string`, `args?: readonly string[]`, `cwd?: string`, `envRefs?: Readonly<Record<string, SecretRef>>` | `host`, `adapter` or `external` |
| `endpoint`     | `url: string`, `transport?: 'http' \| 'sse' \| 'websocket' \| 'acp'`, `authRef?: SecretRef`                    | `host` or `external`            |
| `local_socket` | `path: string`, `transport: 'http' \| 'jsonrpc' \| 'acp'`, `authRef?: SecretRef`                               | `host` or `external`            |
| `sdk`          | `client?: unknown`, `factory?: unknown`                                                                        | `host` or `adapter`             |

`ownership` is required. Follow the selected Runtime guide for supported values,
process arguments, authentication and cleanup. An arbitrary `sdk.client` object
is not automatically detected or adapted.

## HarnessRegistry

| Method                                      | Returns                           | Behavior                                                                                                                         |
| ------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `connect(profile: HarnessProfile)`          | `Promise<HarnessClient>`          | Connects a registered Provider, validates connection kind and descriptor/capability identity, then checks required capabilities. |
| `listProviders()`                           | `readonly ProviderDescriptor[]`   | Registered metadata in registration order.                                                                                       |
| `getProvider(id: ProviderId)`               | `ProviderDescriptor \| undefined` | Metadata for one registered mapping.                                                                                             |
| `register(factory: ProviderAdapterFactory)` | `void`                            | Adds a custom mapping; duplicate Provider IDs fail with `invalid_request`.                                                       |
| `unregister(id: ProviderId)`                | `void`                            | Removes registration; existing Clients are not closed.                                                                           |

Built-in composition uses `createHarapter`. Custom composition can use
`new HarnessRegistry()`; a factory implements `descriptor()` and
`connect(profile)`. A `ProviderDescriptor` contains `providerId`, `displayName`,
`connectionKinds`, and optional `documentationUrl`.

## HarnessClient

| Method                                           | Returns                       | Behavior                                                                                         |
| ------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `descriptor()`                                   | `Promise<ClientDescriptor>`   | Active Provider/Profile identity, connection kind, runtime metadata, compatibility and warnings. |
| `capabilities(options?: CapabilityProbeOptions)` | `Promise<CapabilityManifest>` | Observed support; options may request `refresh: true`.                                           |
| `createSession(input?: CreateSessionInput)`      | `Promise<HarnessSession>`     | Creates a Session on this connection.                                                            |
| `resumeSession(ref: SessionRef)`                 | `Promise<HarnessSession>`     | Resumes state where supported, with owner and compatibility validation.                          |
| `extensions()`                                   | `ProviderExtensionRegistry`   | Provider-specific extension lookup.                                                              |
| `native<T = unknown>(guard?)`                    | `T \| undefined`              | Explicit native escape hatch, described below.                                                   |
| `close()`                                        | `Promise<void>`               | Idempotent Client cleanup according to connection ownership.                                     |

`ClientDescriptor.compatibility` is `supported`, `experimental` or
`unsupported`. Method presence alone does not establish resume or interaction
support. Check capabilities and the owning Runtime guide. Closing a handle does
not imply deleting stored native history.

## HarnessSession

| Method                                                      | Returns                       | Behavior                                                             |
| ----------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `ref()`                                                     | `SessionRef`                  | Opaque reference to the owning Provider, Profile and native Session. |
| `capabilities()`                                            | `Promise<CapabilityManifest>` | Session capability observations.                                     |
| `start(input: HarnessInput, options?: RunOptions)`          | `Promise<HarnessRun>`         | Starts a task on this Session.                                       |
| `respond(requestId: string, response: InteractionResponse)` | `Promise<void>`               | Responds to a supported pending interaction.                         |
| `close()`                                                   | `Promise<void>`               | Idempotent Session cleanup.                                          |

`CreateSessionInput` fields are all optional:

| Field             | Type / purpose                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `workspace`       | `WorkspaceRef`: `{ uri: string }`. Workspace in the Runtime's location.                                                 |
| `systemContext`   | `string`. Context when supported by the mapping.                                                                        |
| `model`           | `ModelSelection`: `{ id: string; providerOptions?: Readonly<Record<string, unknown>> }`. Runtime-owned model selection. |
| `providerOptions` | `Readonly<Record<string, unknown>>`. Native Session options.                                                            |
| `metadata`        | `Readonly<Record<string, string>>`. Host metadata.                                                                      |

`SessionRef` contains `providerId`, `profileId`, `providerSessionId`, optional
`compatibilityRef` and opaque `providerState`. Preserve it in authorized host
storage if needed for resume. Do not edit it to switch Providers or print it in
generic logs. Multi-turn calls start later Runs on the same Session; concurrent
Runs may fail with `run_conflict`. Forking and native history operations use
Provider extensions where supported, not portable `session.fork()` methods.

## HarnessInput

`HarnessInput` requires `parts: readonly InputPart[]` and optionally accepts
`metadata: Readonly<Record<string, string>>`.

| InputPart.type | Required fields                  | Optional fields     |
| -------------- | -------------------------------- | ------------------- |
| `text`         | `text: string`                   | —                   |
| `file_ref`     | `uri: string`                    | `mediaType: string` |
| `image_ref`    | `uri: string`                    | `mediaType: string` |
| `provider`     | `name: string`, `value: unknown` | —                   |

Text input has the form `{ parts: [{ type: 'text', text: 'Hello!' }] }`. File,
image and native parts require mapping support; type membership is not proof
that a Runtime accepts them.

`RunOptions` optionally contains `timeoutMs: number`,
`providerOptions: Readonly<Record<string, unknown>>`, and
`metadata: Readonly<Record<string, string>>`. It has no portable `signal` field.
A deadline does not establish native cancellation.

## HarnessRun

| Method     | Returns                       | Behavior                                                              |
| ---------- | ----------------------------- | --------------------------------------------------------------------- |
| `ref()`    | `RunRef`                      | Provider/Profile/Session identity, `runId`, optional `providerRunId`. |
| `events()` | `AsyncIterable<HarnessEvent>` | Consume continuously with `for await` while the Run executes.         |
| `result()` | `Promise<RunResult>`          | Authoritative terminal outcome.                                       |
| `cancel()` | `Promise<CancelResult>`       | Requests cancellation and reports its actual mode.                    |

`CancelResult.mode` is `native`, `emulated`, `connection_aborted` or
`already_terminal`. Check the returned mode and final result. Connection abort
is distinct from stopping work natively at the Runtime. See the
[cancellation recipe](../examples/sdk-application/README.md#recipes) for host
composition.

## RunResult

| Field             | Type / purpose                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `status`          | `completed`, `cancelled`, `failed` or `connection_aborted`. Only `completed` denotes successful completion.      |
| `finalMessage?`   | `string`. Final text when exposed by the Provider; not guaranteed even on success.                               |
| `usage?`          | `UsageSummary`, with optional numeric `inputTokens`, `outputTokens`, `totalTokens`. Missing values are not zero. |
| `providerResult?` | `unknown`. Provider-owned result, handled within an authorized host boundary.                                    |

Handle non-completed results as well as thrown errors. EOF or a closed event
stream alone does not prove success.

## HarnessEvent

Each event has `id`, `type`, `providerId`, `profileId`, `sessionId`, `runId`,
`sequence`, `timestamp`, and `data`. Optional `providerEventType` and `raw`
preserve Provider context. `sequence` orders events within a Run.

| Category    | HarnessEventType values                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| Lifecycle   | `run.started`, `run.completed`, `run.cancelled`, `run.failed`, `connection.aborted` |
| Message     | `message.delta`, `message.completed`                                                |
| Reasoning   | `reasoning.delta`, `reasoning.completed`                                            |
| Tool        | `tool.started`, `tool.updated`, `tool.completed`                                    |
| Interaction | `interaction.requested`, `interaction.resolved`                                     |
| Other       | `artifact.created`, `usage.updated`, `provider`                                     |

`HarnessEvent<T = unknown>` types `data` as `T`; the default is `unknown`. The
envelope and vocabulary are shared, while payloads follow each mapping. Do not
assume `event.data.text` exists. Unknown upstream events use a bounded, redacted
Provider channel and do not imply successful completion. Use the Provider guide
before rendering payloads; generic logs should retain metadata.

## Interactions

`InteractionRequest` describes `requestId`, `kind` (`approval`, `user_input` or
`provider`), and optional `title`, `prompt`, `schema`, `providerState`. Validate
the active mapping's event payload before handling it.

| InteractionResponse.kind | Response fields                                                      |
| ------------------------ | -------------------------------------------------------------------- |
| `approval`               | `decision: 'approve' \| 'deny'`, optional `providerOptions: unknown` |
| `user_input`             | `parts: readonly InputPart[]`                                        |
| `provider`               | `value: unknown`                                                     |

Pass the matching request ID and response to `session.respond`. Support and
correlation rules belong to the Provider. The host owns its approval UI and
policy; a generic title is not evidence that a tool action is safe. See the
[interaction recipes](../examples/sdk-application/README.md#recipes).

## Capabilities

`CapabilityManifest` identifies `providerId`, `profileId`, `observedAt`,
optional `runtimeIdentity`, and
`capabilities: Readonly<Record<string, CapabilityStatus>>`.

| CapabilityStatus.mode | Meaning                                         |
| --------------------- | ----------------------------------------------- |
| `native`              | The Runtime provides the capability natively.   |
| `emulated`            | The Adapter emulates the behavior.              |
| `adapter_controlled`  | Behavior is controlled at the Adapter boundary. |
| `unsupported`         | The active mapping reports no support.          |
| `unknown`             | Support has not been established.               |

A missing key means the Adapter does not recognize that capability name; it is
distinct from `unknown`. Status may also include `reason`, `limits` and `source`
(`handshake`, `schema`, `version_profile`, `configuration`). Read those limits
before using a capability.

A `CapabilityRequirement` has `name` and optional `acceptedModes`.
`profile.requiredCapabilities` makes `connect` enforce requirements before
returning the Client. Omitted `acceptedModes` accepts only `native`.

## HarnessError

Use `isHarnessError(error: unknown): error is HarnessError` to narrow a caught
value. `HarnessError` extends `Error` with `code`, `retryable`, and optional
Provider/Profile identity, `providerCode` and `details`. `retryable` is an
explicit diagnostic, not automatic retry or proof that replaying a task is safe.

| HarnessErrorCode            | Category                                                             |
| --------------------------- | -------------------------------------------------------------------- |
| `provider_not_found`        | No matching registered Provider.                                     |
| `profile_invalid`           | Invalid connection Profile.                                          |
| `runtime_not_found`         | Required Runtime unavailable.                                        |
| `connection_failed`         | Connection or cleanup failure.                                       |
| `authentication_failed`     | Authentication rejected or unavailable.                              |
| `provider_api_incompatible` | Unsupported Runtime/protocol or unusable mapping.                    |
| `unsupported_capability`    | Required operation or capability unavailable.                        |
| `invalid_request`           | Invalid API input.                                                   |
| `session_not_found`         | Native Session unavailable.                                          |
| `session_provider_mismatch` | Wrong Provider, Profile or compatibility identity.                   |
| `run_conflict`              | Conflicting active execution.                                        |
| `timeout`                   | Operation deadline exceeded.                                         |
| `provider_error`            | Provider failure.                                                    |
| `connection_aborted`        | Transport/process connection ended without a native terminal result. |

Adapters own the precise mapping of upstream failures. When constructing an
error, use `new HarnessError(code, message, options)` with required
`options.retryable`; optional fields are `providerId`, `profileId`,
`providerCode`, `details`, `cause`. Messages, details and causes must be
redacted before construction. The constructor does not sanitize arbitrary
values. Log safe categories instead of dumping caught errors.

## Extensions and native access

`client.extensions()` returns `ProviderExtensionRegistry`:

| Method                                                         | Returns                                  |
| -------------------------------------------------------------- | ---------------------------------------- |
| `list()`                                                       | `readonly ProviderExtensionDescriptor[]` |
| `has(name: string)`                                            | `boolean`                                |
| `get<T>(name: string, guard?: (value: unknown) => value is T)` | `T \| undefined`                         |

Descriptors identify `name`, `providerId`, `displayName` and optional
`description`, `documentationUrl`, `stability` (`stable` or `experimental`). Use
the Provider guide for extension names and methods. An absent entry or failed
guard returns `undefined`. A generic type argument alone does not validate a
value at runtime.

`client.native<T = unknown>(guard?: (value: unknown) => value is T)` likewise
returns `T | undefined`. This is explicitly Provider-bound. Neither access path
makes native state portable.

## Adapter-author utilities

These exports are also available from `harapter`; normal built-in setup does not
require them:

| Export                                                                              | Purpose                                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providerId(value)`, `profileId(value)`, `providerSessionId(value)`, `runId(value)` | Brand a nonempty string without surrounding whitespace; they do not parse native identifiers.                                                                 |
| `assertSessionOwnership(ref, expectedProviderId, expectedProfileId)`                | Reject mismatched owners with `session_provider_mismatch`.                                                                                                    |
| `assertSessionCompatibility(ref, expectedCompatibilityRef)`                         | Reject a mismatched compatibility fingerprint with `session_provider_mismatch`.                                                                               |
| `new ExtensionRegistry(ownerProviderId)`                                            | Implements extension lookup plus `register(descriptor, value)`, returning an idempotent disposer. Wrong owner or duplicate name fails with `invalid_request`. |

Exact declarations live in the [Core exports](../packages/core/src/index.ts),
[identifiers](../packages/core/src/identifiers.ts),
[ownership checks](../packages/core/src/ownership.ts) and
[extension registry](../packages/core/src/extensions.ts). Advanced SDK subpaths
are indexed in the [SDK guide](../packages/harapter/README.md); they belong to
the same npm package.
