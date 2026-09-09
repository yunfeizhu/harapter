# Use Harapter in your application

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

Use the single `harapter` SDK in your own Node.js 24+ / TypeScript application.
This private sample uses a Workspace dependency during development. Its first
single-package release is pending. After release, copy this directory, remove
the `harapter: "workspace:*"` dependency from package.json, and run
`npm install harapter` to use the public package. The standalone build uses
`tsconfig.build.json`; the source-checking `tsconfig.json` is only for
repository development.

## Create and run the project

For a single-file start, follow the
[root Quick start](../../README.md#quick-start). For the service-based
application, copy this directory into your own project (or save the linked files
below). Run these commands inside that independent directory:

```sh
npm install harapter
npm run build
npm run offline
```

## Prepare the Runtime

Install and authenticate Codex using its
[official setup](https://developers.openai.com/codex/cli/). Run `codex` once and
finish sign-in before starting the application. Create an empty test Workspace,
then set these variables in the terminal that runs your app. On Windows, set the
same names in PowerShell. Harapter launches the configured process; it does not
install or sign in to it.

```sh
mkdir -p /tmp/harapter-example-workspace
export HARAPTER_CODEX_COMMAND=codex
export HARAPTER_WORKSPACE=/tmp/harapter-example-workspace
npm start
```

Expected: event types followed by `{"status":"completed","hasText":true}`. The
model may fail or omit text; failures remain visible. Ctrl+C requests native
cancellation and a non-completed result exits unsuccessfully. `npm run offline`
requires no Runtime or model credential and prints `offline application passed`.

## Project files

| File                                       | Role                                               |
| ------------------------------------------ | -------------------------------------------------- |
| [package.json](package.json)               | Workspace dependency and application scripts       |
| [tsconfig.build.json](tsconfig.build.json) | Independent strict ESM build                       |
| [src/main.ts](src/main.ts)                 | One live Codex task, SIGINT and safe status output |
| [src/service.ts](src/service.ts)           | Business operation, resume, timeout and result     |
| [src/interactions.ts](src/interactions.ts) | Asynchronous host interaction observer             |
| [src/codex.ts](src/codex.ts)               | Codex connection and read-only Session settings    |
| [src/endpoints.ts](src/endpoints.ts)       | HTTP and DSH Gateway compositions                  |
| [src/processes.ts](src/processes.ts)       | DSH SDK, OpenClaw and Pi compositions              |
| [src/recipes.ts](src/recipes.ts)           | Resume, native Codex fork, concurrent Providers    |
| [src/approval.ts](src/approval.ts)         | Explicit terminal approval handler                 |
| [src/offline.ts](src/offline.ts)           | Offline application smoke                          |

## Integrate with a business module

Import `runTask` from your local service module. Pass user input from your
authenticated application boundary and return `result.finalMessage` to its
authorized UI. The SDK is used on your Node.js server or desktop main process,
not directly in an untrusted browser. The caller closes each Client in
`finally`; task errors close that Client and preserve the primary error. Do not
reuse it after an error.

```ts
import { connectCodex } from './codex.js';
import { runTask } from './service.js';

export async function answerUser(
  text: string,
  command: string,
  workspace: string,
) {
  const { client, session } = await connectCodex(command, workspace);
  try {
    const { result } = await runTask(client, text, { session });
    return { status: result.status, text: result.finalMessage };
  } finally {
    await client.close();
  }
}
```

## Results, state and cancellation

Continuously drain events; `result.finalMessage` is the optional final text, and
`result.status` is authoritative. Payloads are not a universal text-delta
schema: inspect the owning Adapter mapping before using `event.data`. The sample
prints event types/status only; it does not discard the text returned to the
application. Do not serialize the complete Result into generic logs.

Keep returned Session references in access-controlled application storage,
indexed by the authenticated user and the original Provider/Profile. The
reference contains private native state. Resume needs a retained native store, a
compatible Runtime, a supported Session capability and the same Profile
configuration. Saving JSON does not migrate a Session between Providers. The
sample retains references in memory; durable storage and multi-tenant
authorization belong to your app.

Pass an AbortSignal for explicit user cancellation. This service requires
observed native cancellation for that option and rejects weaker/unknown modes
before starting. A timeout is a separate Run deadline and may produce `failed`
or `connection_aborted` according to the Adapter. Inspect the authoritative
result; never turn connection closure into a successful native cancellation.

## Recipes

| Scenario                  | Entry                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Single request and stream | `runTask(client, text, { onEvent })` → `result.finalMessage`           |
| Resume after reconnect    | `runTask(client, text, { resume: savedRef })`                          |
| Fork and continue         | `forkCodexConversation(client, savedRef, text)`                        |
| Cancel or set a deadline  | `runTask(client, text, { signal, timeoutMs: 60_000 })`                 |
| Concurrent Providers      | `runAcrossProviders(first, second, text)`                              |
| Approvals                 | `runTask(client, text, { onInteraction: terminalApproval(describe) })` |

## Run the recipes

After `npm run build`, each command has a complete entrypoint:

| Command            | What runs                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `npm start`        | One real Codex Run with event consumption; Ctrl+C requests native cancellation.             |
| `npm run sessions` | Three real Codex Runs: create, close/reconnect/resume, then native fork and continue.       |
| `npm run multi`    | One Codex Run and one OpenCode Run concurrently; each outcome is handled independently.     |
| `npm run cancel`   | Offline Fake cancellation and deadline, printing `cancelled` and `connection_aborted`.      |
| `npm run approval` | Offline Fake approval in a TTY; type exactly `approve` or `deny`. No real command executes. |

The session recipe uses the same Codex configuration as `npm start`, retains
native Session data (`ephemeral: false`) and keeps its private reference only in
memory. Its three calls can incur model charges. The multi-provider recipe also
needs `HARAPTER_OPENCODE_URL`, `HARAPTER_OPENCODE_WORKSPACE` (an existing
absolute directory on the server), `OPENCODE_SERVER_PASSWORD`, and optionally
`OPENCODE_SERVER_USERNAME` (default `opencode`). Prepare the authenticated
server and disable tools using the
[OpenCode guide](../../providers/opencode/README.md). The application closes its
connections; the external server stays running.

Sources: [session-main.ts](src/session-main.ts),
[multi-main.ts](src/multi-main.ts), [cancel-demo.ts](src/cancel-demo.ts),
[approval-demo.ts](src/approval-demo.ts). The Fake approval has a known
fictional action. Replace its fixed description with your host's
request-specific verification when integrating a real approval. A denied Fake
request still completes its echo Run; denial is not cancellation.

## Approval UI

`terminalApproval` opens a TTY only when your host can supply a verified, safe
description for that exact request. An unknown description is denied;
unsupported interaction kinds fail explicitly. The host must not approve a
command based only on a generic title or redacted schema. The callback signal
dismisses the UI after resolution, timeout or terminal settlement. This terminal
implements portable approval only; Pi needs its typed native
`select`/`confirm`/`input`/`editor` responses, and DSH currently has no
host-response path. The default Codex configuration is read-only with approvals
disabled; opt into a host-reviewed policy explicitly to exercise an approval.

## Choose another Provider

The six `quick-*.ts` files are independent single-file entrypoints using only
public SDK imports. Their full configuration instructions live in each Adapter
README. `endpoints.ts` and `processes.ts` offer application composition
functions; no Runtime starts until you call a connection function. DSH Gateway
is a separate endpoint composition: its stable store identity and
exclusive-Session attestation must describe the actual host deployment. OpenClaw
history operations require the additional host-owned Gateway binding described
by its Adapter.

- [codex](../../providers/codex/README.md): [quick-codex.ts](src/quick-codex.ts)
- [opencode](../../providers/opencode/README.md):
  [quick-opencode.ts](src/quick-opencode.ts)
- [dsh](../../providers/dsh/README.md): [quick-dsh.ts](src/quick-dsh.ts)
- [hermes](../../providers/hermes/README.md):
  [quick-hermes.ts](src/quick-hermes.ts)
- [openclaw](../../providers/openclaw/README.md):
  [quick-openclaw.ts](src/quick-openclaw.ts)
- [pi](../../providers/pi/README.md): [quick-pi.ts](src/quick-pi.ts)

## What is verified

The application is compiled and exercised outside the Workspace against the
single freshly packed SDK tarball. Offline tests cover application behavior;
they do not establish real Provider compatibility. Existing
[official Runtime evidence](../../docs/provider-interaction-evidence.md) owns
that boundary. Live entrypoints use your existing authentication, may consume
tokens and can create native Session data. Use an empty test Workspace and the
Runtime's own tool/sandbox policy. An external HTTP server or Gateway remains
running after Client cleanup.

Before this packaging migration, on 2026-09-08, a consumer of the scoped
Harapter 0.3.0 packages ran `quick-codex`, `main`, and `session-main` against
official Codex CLI 0.153.4: five real Runtime Runs completed, including
reconnect/resume and native fork. An isolated loopback synthetic model served
the requests; no tool calls or model credentials were used. This is application
integration evidence, not a new compatibility claim for every Provider or a
paid-model canary.

## For repository contributors

Only contributors need the complete Workspace. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter harapter-sdk-application build
pnpm --filter harapter-sdk-application offline
```
