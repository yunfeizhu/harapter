# Host interaction reference

Harapter delivers `interaction.requested` events and accepts explicit responses
through `session.respond()`. The host owns the user interface, access control,
and decision. The [observer](src/interactions.ts) composes this existing public
Core contract for both reference runners; it does not change Provider policies.

## Try the offline terminal demo

From this repository, build the current checkout and run:

```sh
pnpm build
pnpm --filter @harapter/example-multi-provider-client interaction-demo
pnpm --filter @harapter/example-multi-provider-client interaction-demo user_input
pnpm --filter @harapter/example-multi-provider-client interaction-demo provider
```

The first command asks you to type `approve` or `deny`. The other modes accept a
fictional project name, or `confirm` / `cancel` for a synthetic native
extension. Each invocation handles one request. It prints
`interaction.requested`, then `interaction.resolved`, and the authoritative
terminal status. The Fake Provider finishes normally after either an approval or
a denial: denying one action does not mean the whole Run was cancelled. Empty or
invalid decisions fail; no answer is chosen automatically. EOF and the 30-second
Run deadline release the input reader and Client, and the command exits with
failure.

This demo uses `harapter/testing` from the built checkout. It performs no
network request, starts no runtime, invokes no tool, and requires no
credentials. Its fixed fictional questions are safe to show. It never logs the
answer or request payload. Fake behavior is application-test evidence, not a
claim that a real Provider supports all three interaction kinds.

## Connect the host UI

Add `onInteraction` to a `MultiProviderSetup` or `SessionWorkflowSetup`. A
trusted [Session workflow configuration](session-workflow.md) can instead export
a named `onInteraction` function. The CLI forwards it to each selected Provider.

```ts
import type { HostInteractionHandler } from '@harapter/example-multi-provider-client/interactions';

const onInteraction: HostInteractionHandler = async (context) => {
  const { request, signal, sessionRef } = context;
  if (request.kind !== 'approval') {
    return hostNativeInteraction(context);
  }
  const decision = await hostApprovalUI({
    request,
    profileId: sessionRef.profileId,
    signal,
  });
  return { kind: 'approval', decision };
};

const interactiveSetup = { ...existingSetup, onInteraction };
```

`existingSetup`, `hostApprovalUI`, and `hostNativeInteraction` are host code.
The approval UI returns exactly `approve` or `deny` after presenting the action
to an authorized user. The native handler validates the Provider's typed schema
and returns its documented response; an unsupported native method must fail
explicitly. The request can include sensitive titles, prompts, option schemas,
or Provider state. Present only the details needed for a decision in the host's
trusted UI, never in generic logs or the reference client's stdout records. Do
not execute request text or use it to discover or install anything.

The callback receives opaque Session/Run references so concurrent requests can
be routed correctly. Treat request identifiers as scoped to that Run and
Session. Return the response; the observer calls the bound Session's `respond()`
once. There is no portable persistent-approval default. Provider-specific scope
requires an explicit host choice and a documented response option.

## Lifecycle

- Events keep draining while the UI and response acknowledgment are pending.
- Resolution by the Provider, a terminal Result/Event, or observer disposal
  aborts the callback's signal. The host dismisses its UI; late answers and late
  callback rejections cannot affect another request or Run.
- Request data and event ownership are validated at the untyped event boundary.
  At most 64 distinct requests are accepted per Run; duplicate IDs or malformed
  requests fail closed.
- Missing handlers and callback/response failures stop the workflow. The runners
  close owned Clients on failure. Connection teardown does not establish native
  cancellation or prove that external work stopped.
- The six-Provider workflow retains its default 60-second Run deadline. The
  concurrent runner uses the host's `runOptions`; configure a suitable deadline
  there. Callbacks must cooperate with abort to release their own resources even
  though an ignored signal does not block the observer's completion.

## Existing Provider support

| Provider                                       | Current response boundary                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [Codex](../../providers/codex/README.md)       | Portable command/file approvals; native interactions need their documented Provider response. Portable user input remains unsupported. |
| [OpenCode](../../providers/opencode/README.md) | Portable permissions; default approve is `once`, deny is `reject`.                                                                     |
| [Hermes](../../providers/hermes/README.md)     | Portable approval when the runtime advertises the approval route.                                                                      |
| [OpenClaw](../../providers/openclaw/README.md) | Observed ACP permission requests, using only choices offered by the runtime.                                                           |
| [Pi](../../providers/pi/README.md)             | Typed `select`, `confirm`, `input`, and `editor` Provider interactions; generic approval/user input remain unsupported.                |
| [DSH](../../providers/dsh/README.md)           | Current SDK and Gateway adapters do not expose host interaction responses.                                                             |

Adding this callback does not make an unavailable capability native. The
existing isolated runtime configuration remains authoritative; a no-tools Run
may never produce an interaction. The shared interaction suite uses synthetic
protocol fixtures for the five existing response-capable adapters. It does not
extend their declared runtime compatibility ranges or replace live evidence.

The
[official Runtime interaction suite](../../docs/provider-interaction-evidence.md)
adds separate evidence for approval, native Pi dialogs, duplicate/late answers,
and terminal cleanup with a synthetic loopback model. It records the observed Pi
interruption limitation and distinguishes local results from trusted Actions
execution.
