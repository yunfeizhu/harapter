# Multi-provider reference client

This example connects two independently selected Harapter Providers, routes new
tasks by Profile, consumes both event streams concurrently through one portable
renderer, and returns Provider-bound Session references without rendering their
opaque state.

[`src/index.ts`](src/index.ts) imports only `@harapter/core`. It does not branch
on Provider identity. [`src/codex-opencode.ts`](src/codex-opencode.ts) is an
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
