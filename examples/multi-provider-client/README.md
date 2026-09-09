# Multi-provider reference client

For an application installed from npm, start with the
[standalone SDK application](../sdk-application/README.md). This directory is a
repository reference built as part of the Harapter Workspace.

This example connects two independently selected Harapter Providers, routes new
tasks by Profile, consumes both event streams concurrently through one portable
renderer, and returns Provider-bound Session references without rendering their
opaque state.

For the six-Provider **create → run → reconnect → resume → native fork/branch →
continue → cancel → cleanup** flow, use the
[Session workflow guide](session-workflow.md). It uses the public Harapter 0.2.0
APIs and keeps the original concurrent, single-task entrypoint intact.

[`src/index.ts`](src/index.ts) imports only `harapter`. It does not branch on
Provider identity. [`src/codex-opencode.ts`](src/codex-opencode.ts) is an
explicit composition boundary for a Codex process and an externally managed
OpenCode HTTP endpoint. Constructing those setups does not connect, discover,
install, authenticate, or invoke either runtime.

## Portable behavior

- connected Profiles are selected by `profileId`;
- tasks run concurrently while one serialized renderer receives every safe
  record;
- after each Session is created or resumed, `cancel` and `resume` controls are
  derived from that Session's capability manifest; controls are visible only
  when the active mode is neither `unsupported` nor `unknown`, and each visible
  control retains that mode so connection abort cannot masquerade as native
  cancellation;
- a resumed task checks the Session reference's Provider and Profile ownership
  before calling the selected Adapter;
- `onConnected` is the explicit boundary for a typed Provider extension and may
  return a disposer;
- every Session, extension disposer, and Client is closed on success or failure.

The renderer receives only Provider/Profile identity, compatibility,
Session-level visible control names and modes, portable event types and sequence
numbers, and terminal status. It never receives prompts, message bodies, raw
events, Provider results, native state, errors, credentials, environment values,
or local paths.

## Host interactions

Both runners accept `setup.onInteraction`. It receives the private request,
Session/Run references, and an `AbortSignal`, and returns an explicit
`InteractionResponse`. The example relays it through the same Session's
`respond()` while continuing to drain events. The callback must dismiss its UI
on abort; late answers are discarded even if it ignores the signal. Each Run
accepts at most 64 distinct requests. Duplicate IDs and malformed requests fail
closed. A missing handler fails explicitly when a live interaction is observed;
there is no automatic approval or provider-policy change. The first failed task
triggers Client cleanup and invalidates other pending interactions before the
runner returns.

The safe renderer still receives only metadata. Request details, input answers,
and native Provider payloads belong to the host's separate, access-controlled
presentation callback. See the [interaction guide](interactions.md) for an
offline terminal demo, host composition, and the current Provider boundaries.

## Codex and OpenCode composition

The host creates two isolated temporary directories, installs and authenticates
Codex, and operates the OpenCode endpoint before calling
`createCodexOpenCodeSetups()`. It then supplies fictional task inputs and
removes both directories after `runMultiProviderClient()` settles.

The Codex setup uses an Adapter-owned App Server process, an ephemeral Session,
`approvalPolicy: "never"`, and the read-only sandbox. The OpenCode setup uses an
external endpoint, supplies its isolated Workspace, and applies the non-empty
disabled Tool map supplied by the host for that runtime. The external OpenCode
server's own security policy remains authoritative, including omitted or plugin
Tools; the Tool map is not a replacement for host sandboxing.

Real execution sends one request to each configured model, may use Provider
tokens, and may incur cost. The example package contains no runtime, SDK,
credential, or automatic installation dependency. Live execution is therefore
host-operated and is not part of the default test suite.

```ts
import { runMultiProviderClient } from '@harapter/example-multi-provider-client';
import { createCodexOpenCodeSetups } from '@harapter/example-multi-provider-client/codex-opencode';

const providers = createCodexOpenCodeSetups({
  codexCommand,
  codexWorkspacePath,
  openCodeEndpoint,
  openCodeTools,
  openCodeWorkspacePath,
});

const outcomes = await runMultiProviderClient({
  providers,
  tasks: providers.map(({ profile }) => ({
    profileId: profile.profileId,
    input: {
      parts: [{ type: 'text', text: 'Reply with exactly READY.' }],
    },
  })),
  write: renderPortableRecord,
});
```

The host defines the setup values, `renderPortableRecord`, Workspace creation
and deletion, authentication, and the external OpenCode security policy.
`outcomes` retains the opaque Session references for host storage; it must not
be logged wholesale.

## Typed extension boundary

Portable rendering remains Provider-agnostic. Provider-specific code may use the
connected hook without leaking its type into the task or event path:

```ts
await runMultiProviderClient({
  providers,
  tasks,
  write: renderPortableRecord,
  onConnected: ({ client, profile }) => {
    if (profile.providerId !== extensionProviderId) return;
    const extension = client
      .extensions()
      .get(extensionName, isExpectedExtension);
    return extension?.onEvent(observeRedactedProviderEvent);
  },
});
```

The guard, observer, and data policy belong to that Provider-specific
composition. Unknown upstream events continue through each Adapter's bounded,
redacted raw channel; the shared renderer never guesses them into success.
