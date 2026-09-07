# Session workflow reference client

This example composes the public Harapter **0.2.0** APIs for Codex, DSH Gateway,
Hermes, OpenClaw, OpenCode, and Pi. It does not install runtimes or extend their
declared compatibility ranges. Select only runtimes the host has already
installed or started, authenticated, and isolated for this demonstration.

The [workflow](src/session-workflow.ts) imports only Core. The
[Provider composition](src/session-providers.ts) binds each guarded typed
extension. These are example-local controls: portable `session.fork` remains
unsupported. The [command entrypoint](src/session-main.ts) runs configured
Providers sequentially, emitting JSON lines identified by their one-based
configuration order.

## What runs

1. Create a persisted source Session and complete one fictional text request.
2. Capture its opaque reference, close the local Session and Client, connect a
   fresh Client with the same Profile, and resume the source.
3. Bind the new Client's native history extension and derive a child.
4. Continue in the child with a question about the original fictional input.
5. Start a third request and attempt native cancellation when its checkpoint
   appears. A fast model may already have completed. The receipt and terminal
   Run status are separate records; neither is inferred from the other.
6. Close acquired Session handles and Clients on success or failure. A busy
   Session may reject close; Client cleanup still releases its connection.

There are up to **three model requests per selected Provider**, with a default
60-second deadline per Run. Native resume and a history extension are required.
If the child does not advertise native Run cancellation and has no explicit
Session cancellation binding, the third request is skipped and the record says
`unavailable`. Unknown events remain `provider` events and never establish
success. An unsuccessful source or continuation stops subsequent steps.

| Provider                                                               | Native operation and history                                          | Parent afterward                         | Cancellation                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| [Codex](../../providers/codex/README.md)                               | `CodexSessions.fork`: persisted thread history                        | Preserved                                | Run cancellation                                                                 |
| [DSH Gateway](../../providers/dsh/README.md#gateway-endpoint-strategy) | `DshGatewaySessions.fork`: completed-turn prefix                      | Preserved                                | Session-wide request after `step/start`; `accepted` is not terminal confirmation |
| [Hermes](../../providers/hermes/README.md)                             | `HermesSessions.branch`: stored messages and system prompt            | Retired; omitted from resumable outcomes | Run cancellation when the stop route is advertised                               |
| [OpenClaw](../../providers/openclaw/README.md)                         | `OpenClawSessions.fork`: through the last completed assistant message | Preserved                                | Run cancellation                                                                 |
| [OpenCode](../../providers/opencode/README.md)                         | `OpenCodeSessions.fork`: stored history                               | Preserved                                | Run cancellation                                                                 |
| [Pi](../../providers/pi/README.md)                                     | `PiSessions.fork`: active branch, not the entire history tree         | Preserved                                | Run cancellation                                                                 |

Cancellation can finish as `cancelled`, `completed`, `failed`, or
`connection_aborted`; the example prints the authoritative result. On request
failure it closes the connection and reports a fixed workflow error. Closing a
connection does not prove native work stopped, especially for DSH's retained
inbox. The host must reconcile uncertain work in its runtime before retrying.

## Run from this repository

Build once from the repository root:

```sh
pnpm build
```

Create an explicitly trusted `.mjs` file inside this example directory. It is
ordinary executable host code; it must not log credentials or private content.
This minimal configuration selects Codex:

```js
import { profileId, providerId } from '@harapter/core';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error('Required host configuration is missing.');
  return value;
}

function processProfile(owner, name, command, args) {
  return {
    providerId: providerId(owner),
    profileId: profileId(name),
    displayName: name,
    connection: {
      kind: 'process',
      command,
      args,
      cwd: required('HARAPTER_DEMO_WORKSPACE'),
      ownership: 'adapter',
    },
  };
}

function endpointProfile(owner, name, url, authRef) {
  return {
    providerId: providerId(owner),
    profileId: profileId(name),
    displayName: name,
    connection: { kind: 'endpoint', url, ownership: 'external', authRef },
  };
}

export default {
  codex: {
    profile: processProfile(
      'openai.codex',
      'codex-demo',
      required('HARAPTER_CODEX_COMMAND'),
      ['app-server', '--stdio'],
    ),
    sessionInput: {
      providerOptions: {
        ephemeral: false,
        approvalPolicy: 'never',
        sandbox: 'read-only',
      },
    },
  },
};
```

`HARAPTER_CODEX_COMMAND` is the host-installed executable;
`HARAPTER_DEMO_WORKSPACE` is an absolute, isolated directory created by the
host. Unlike the original one-shot example, this Session must persist to support
resume and fork. Run with the absolute path to the trusted file:

```sh
pnpm --filter @harapter/example-multi-provider-client session-workflow /absolute/trusted-config.mjs
```

Add any of the following entries to the default configuration object. Keep
Profile IDs unique. Configuration construction performs no I/O; executing the
workflow starts processes and makes network and model requests.

```js
// DSH: also import DSH_GATEWAY_PROTOCOL from '@harapter/adapter-dsh'.
dsh: {
  profile: {
    ...endpointProfile('deepseek.harness', 'dsh-demo', required('HARAPTER_DSH_ENDPOINT'), { scheme: 'host-vault', id: 'dsh-demo-cookie' }),
    providerOptions: { protocol: DSH_GATEWAY_PROTOCOL, storeId: required('HARAPTER_DSH_STORE_ID'), exclusiveSessions: true },
  },
  factoryOptions: { resolveGatewayCookie: resolveCookie },
},

hermes: {
  profile: endpointProfile('nous.hermes-agent', 'hermes-demo', required('HARAPTER_HERMES_ENDPOINT'), { scheme: 'host-vault', id: 'hermes-demo-key' }),
  factoryOptions: { resolveAuthHeaders: resolveHermesHeaders },
},

openclaw: {
  profile: processProfile('openclaw', 'openclaw-demo', required('HARAPTER_OPENCLAW_COMMAND'), ['acp']),
  factoryOptions: { gateway },
},

opencode: {
  profile: endpointProfile('opencode', 'opencode-demo', required('HARAPTER_OPENCODE_ENDPOINT'), { scheme: 'host-vault', id: 'opencode-demo-key' }),
  factoryOptions: { resolveAuthHeaders: resolveOpenCodeHeaders },
  runOptions: { providerOptions: { tools: disabledTools } },
},

pi: {
  profile: {
    ...processProfile('pi.agent', 'pi-demo', required('HARAPTER_PI_COMMAND'), []),
    providerOptions: { persistSessions: true },
  },
},
```

The host defines `resolveCookie`, `resolveHermesHeaders`,
`resolveOpenCodeHeaders`, `gateway`, and `disabledTools` using the linked
Provider contracts. Authentication values come from the host secret store or its
documented environment, never from inline literals or browser discovery. Process
runtimes use their existing host authentication and model configuration. Pi
requires an absolute executable path. Hermes branching requires no per-Session
model configuration. OpenCode must use an explicit map disabling every Tool in
this isolated server; server policy remains authoritative.

DSH requires the assessed Gateway protocol, a stable host-assigned native store
identity, and **real exclusive Session ownership**. Set
`exclusiveSessions: true` only when the host can prevent competing writers,
including the UI and plugins. Use an authenticated HTTPS endpoint or loopback
HTTP authority with no embedded credentials. SDK process RPC cannot provide this
workflow.

OpenClaw requires an authenticated `OpenClawGatewayBinding` whose `profileId` is
`profileId('openclaw-demo')` and whose observed methods, native store, and
Gateway match the ACP Profile. The host owns that connection, its
authentication, reconnection, and exclusive writers. The example does not create
a Gateway transport or guess that two connections share a store. If the config
acquires host resources, export `dispose()` to close them; the CLI awaits it
after success or failure. Config initialization must clean up its own partial
failures.

## Embed using published npm packages

This private example is not an npm package. Copy the `src/` directory and
compile it in an ESM TypeScript project with Node 24, `module` and
`moduleResolution` set to `NodeNext`, and Node types. Install the public
dependencies at one version:

```sh
pnpm add @harapter/core@0.2.0 @harapter/adapter-codex@0.2.0 @harapter/adapter-dsh@0.2.0 @harapter/adapter-hermes@0.2.0 @harapter/adapter-openclaw@0.2.0 @harapter/adapter-opencode@0.2.0 @harapter/adapter-pi@0.2.0
```

Call `createSessionWorkflowSetups(config)` and pass each setup to
`runSessionWorkflow({ setup, write })`. A host may supply `sourceRef` to resume
an existing Session and `inputs` to replace the three fictional inputs. The
returned `sourceRef` and `childRef` are opaque private data: retain them only in
host-controlled storage. Hermes outcomes omit the retired source. A reference
cannot move between Providers, Profiles, connection configurations, or stores.

The renderer receives only phase, Session action, native history semantics,
portable event type/sequence, cancellation receipt, and terminal status. It does
not render prompts, responses, native IDs, reference state, raw events,
credentials, paths, or error details. The CLI uses ordinal Provider labels so
even host Profile names stay private. Host renderers and trusted config code
remain responsible for their own output policy.

## Side effects and evidence

Use isolated runtimes with tools disabled and host-enforced permissions. The
fictional prompt's request to avoid tools is not a security boundary. This
example does not answer approval or user-input requests automatically. Native
history remains after local cleanup; the host must remove demo history and
temporary directories and stop external services according to its own policy.
Abrupt process termination requires host cleanup as well. A failed fork may have
mutated upstream state; Hermes can retire its parent before a later error. Do
not blindly rerun against an existing Session.

The focused workflow and binding tests exercise composition with synthetic
Providers, including reconnect ownership, retired parents, cancellation races,
redaction, and cleanup. Before building, development checks resolve all six
Providers from source. After building, the package consumer checker runs four
CLI cases against freshly packed and installed public packages. Separate
public-consumer validation builds against released npm 0.2.0 exports. These
checks do not add live-runtime evidence; the existing
[Provider history evidence](../../docs/provider-session-fork-evidence.md) and
each Provider README remain the authority for actual runtime compatibility.
