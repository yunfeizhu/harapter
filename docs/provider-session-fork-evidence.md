# Native Session fork evidence

Evidence date: 2026-09-07. This record covers the native Session operations in
the existing five Adapters; the DSH Gateway slice has its own
[contract and evidence](../providers/dsh/README.md#gateway-endpoint-strategy).

## Verified runtime boundary

| Adapter                                                                       | Official runtime                                                        | Native operation                                        | Observed history and parent behavior                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Codex](../providers/codex/README.md#native-session-history-operations)       | `@openai/codex@0.153.4`                                                 | `thread/read`, `thread/fork`                            | Persisted child inherits source history; parent remains independent                         |
| [OpenCode](../providers/opencode/README.md#native-session-history-operations) | `opencode-ai@1.18.29`                                                   | `POST /session/{id}/fork`                               | Child inherits history and directory; parent remains independent                            |
| [Hermes](../providers/hermes/README.md#native-session-history-operations)     | Git tag `v2026.8.31`, commit `29112bef099274229cadff79cdff7bf7b99c4b77` | `POST /api/sessions/{id}/fork`                          | Child inherits history; parent becomes `branched` and Harapter refuses further use          |
| [OpenClaw](../providers/openclaw/README.md#native-session-history-operations) | `openclaw@2026.9.2`                                                     | Gateway `sessions.create` followed by ACP `session/new` | Last completed assistant boundary is copied; child and parent ACP routes remain independent |
| [Pi](../providers/pi/README.md#native-session-history-operations)             | `@earendil-works/pi-coding-agent@0.85.1`                                | RPC `clone` then `get_state`                            | Active branch is copied in a separate process; parent process retains its Session           |

These versions are reproducible observations, not executable allowlists. Each
Adapter still validates its existing runtime handshake and the responses it
uses. Hermes additionally requires the advertised fork endpoint. OpenClaw
requires a host-bound Gateway with observed `sessions.list` and
`sessions.create` methods. Pi requires persisted Sessions. Unsupported versions
and malformed responses fail closed; presence of a native extension is not a
promise that an arbitrary older Runtime implements the operation.

The [official-runtime tests](../tests/provider-session-fork-live.test.ts) run
actual provider processes, persistence and machine interfaces against a local
synthetic model endpoint. Model traffic is never logged or retained; only
boolean history-marker evidence leaves the mock handler. This is stronger than
an adapter fixture, but it does not verify hosted model authentication,
production credentials, external tools or multi-host storage.

Every tested child has a distinct identity, inherits source history, completes a
Run, resumes and confirms native cancellation. Codex, OpenCode, OpenClaw and Pi
also prove that child history does not appear when continuing the parent. Hermes
proves parent retirement and child resume after opening a fresh Client. OpenClaw
uses an ephemeral device identity and the authenticated Gateway hello method
inventory; the production Adapter does not implement that test connection.

## Deterministic evidence

Synthetic `fork.json` receipts and their provenance live alongside each existing
provider's fixtures. The corresponding `sessions.test.ts` files exercise them.
`fork.test.ts` covers ownership, source constraints, lineage, child lifecycle,
reservation conflicts, malformed receipts, rejection and disposal behavior.
OpenClaw negatives verify exact canonical routes, the native `status` and
`hasActiveRun` fields, and rejection of unpreserved `sendPolicy` before any
creation request. Codex verifies that long histories are excluded from the fork
response, keeping the connection within its existing message-size bound.
Existing provider conformance tests continue to exercise the portable lifecycle.
Portable `session.fork` remains unsupported; Core does not imply common
checkpoint or parent-retirement semantics.

The host must serialize every writer to a source Session. A status read followed
by a mutation is not a cross-process lock. Source-specific restrictions belong
to the linked Provider READMEs, including OpenCode permission/revert state,
Hermes stored model configuration and OpenClaw execution/access boundaries.

## Reproduction

Install the versions above into an isolated directory outside Harapter. Allow
the reviewed OpenCode installer to link its platform executable. For Hermes,
check out the recorded tag and install its locked Python dependencies and
`messaging` extra; the test expects `.venv/bin/hermes` in that checkout.
Harapter does not install these runtimes as package dependencies.

```bash
HARAPTER_FORK_LIVE_BIN=/absolute/isolated/node_modules/.bin \
HARAPTER_HERMES_FORK_LIVE_DIR=/absolute/isolated/hermes-agent \
pnpm vitest run tests/provider-session-fork-live.test.ts
```

The harness creates temporary workspaces, runtime settings and native stores,
starts loopback services, and disposes its processes and files. Missing opt-in
variables skip the corresponding tests and are not passing live evidence.
Ordinary `pnpm check` runs deterministic tests, conformance, coverage, builds
and package-consumer checks; it does not install or start these official
runtimes.

## Official references

- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [OpenCode Session fork implementation](https://github.com/anomalyco/opencode/blob/57ef3828431790c53f8f333c7ffbfe88770a1812/packages/opencode/src/session/session.ts)
- [Hermes API Session resources](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/platforms/api_server.py)
- [OpenClaw Gateway Session creation](https://github.com/openclaw/openclaw/blob/66381fba99d081329c86e2e9ed2c9bd27d98799d/src/gateway/server-methods/sessions-create.ts)
- [Pi RPC clone contract](https://github.com/earendil-works/pi/blob/e687434a60174db1a9c961d973881a7a851a0597/packages/coding-agent/docs/rpc.md)
