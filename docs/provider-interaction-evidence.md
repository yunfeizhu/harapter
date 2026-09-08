# Provider interaction evidence

The
[official Runtime interaction suite](../tests/provider-interaction-live.test.ts)
exercises Harapter's existing public adapters and the
[host interaction observer](../examples/multi-provider-client/interactions.md).
It starts official Runtime processes and uses their real machine interfaces.
Only the model service is synthetic: a bounded loopback HTTP server returns one
fixed tool call followed by a fixed text response. No Provider protocol message
is injected, and no hosted model credential is required.

## Recorded scope

Local evidence on 2026-09-08 uses the following official installations. The
versions identify observations, not an admission allowlist or a newly negotiated
compatibility range.

| Provider | Official Runtime                                                         | Exercised interface                            | Cases |
| -------- | ------------------------------------------------------------------------ | ---------------------------------------------- | ----- |
| Codex    | `@openai/codex` 0.153.4                                                  | App Server command approval                    | 6     |
| OpenCode | `opencode-ai` 1.18.29                                                    | Server permission request/reply                | 6     |
| Hermes   | `hermes-agent` 0.21.0, source `29112bef099274229cadff79cdff7bf7b99c4b77` | Gateway API Server approval route              | 6     |
| OpenClaw | `openclaw` 2026.9.2                                                      | Gateway execution approval relayed through ACP | 6     |
| Pi       | `@earendil-works/pi-coding-agent` 0.85.1                                 | RPC extension UI                               | 12    |

Each Provider exercises acceptance, rejection, concurrent duplicate answers,
cancellation while waiting, a Harapter Run timeout while waiting, and Client
close while waiting. Every case requires an actual `interaction.requested`, UI
signal disposal, one terminal Event matching the Result, and rejection of a late
direct response. An unresolved callback is released after terminal settlement to
check that a late answer cannot execute the action. Concurrent responses must
produce exactly one accepted attempt and one rejection.

Codex, OpenCode, Hermes, and OpenClaw attempt to remove only a newly created
empty directory in the isolated test Workspace. The directory must exist when
approval is requested, disappear after acceptance, and remain after denial or
interruption. A denial can finish the overall Run normally; it does not mean the
Run was cancelled. OpenCode does not make another model call after its rejected
permission in this observed path.

Pi uses a test-owned executable wrapper to explicitly load one synthetic
extension through the official `--extension` option. The adapter still appends
`--no-extensions`, disabling automatic discovery, and does not gain an extension
loading API. The extension calls official `confirm`, `select`, `input`, and
`editor` methods. All four exercise acceptance and rejection; the confirmation
also exercises duplicate and terminal scenarios. Tool-result sentinels checked
only in memory prove that the answer reached the extension.

**Pi limitation:** interrupting a pending confirmation in this setup produces
`stopReason: error`, so Harapter conservatively returns `failed`; an explicit
`run.cancel()` returns `already_terminal`. This path does not prove native
cancellation, although other Pi lifecycle paths already have separate native
cancellation evidence. Closing the Client reports `connection_aborted`. The
suite checks these exact outcomes rather than accepting any non-success status.

DSH is not selected because its current adapters do not expose host interaction
responses. The suite does not establish portable user-input support for every
Provider, authenticated model behavior, or arbitrary extension compatibility.
Protocol fixtures and shared conformance remain the deterministic PR evidence.

## Reproduce locally

Use an isolated installation of one official Runtime and this checkout's
Node/pnpm versions. Commands must be absolute; a selected missing installation
fails. For example:

```sh
pnpm install --frozen-lockfile
HARAPTER_INTERACTION_LIVE_PROVIDER=codex \
HARAPTER_INTERACTION_LIVE_COMMAND=/opt/harapter-test/bin/codex \
pnpm vitest run tests/provider-interaction-live.test.ts
```

Replace the Provider and command with `opencode`, `hermes`, `openclaw`, or `pi`.
Alternatively, `HARAPTER_INTERACTION_LIVE_BIN` points to a directory containing
those five command names and `HARAPTER_INTERACTION_LIVE_PROVIDER=all` selects
all five. A single command override cannot be combined with `all`. Omitting the
selection skips this opt-in suite; skipped tests are not live evidence.

Each scenario creates a temporary home, configuration, state and Workspace.
Child environments use an allowlist and fixed local dummy credentials. Provider
stdout/stderr and model request bodies are not retained as evidence. The only
permitted tool operation targets the test-created empty directory. Cleanup
closes Clients, stops directly owned server processes with bounded termination,
closes the local model server, and removes temporary state. This is process and
filesystem isolation, not an operating-system network sandbox; use trusted
Runtime installations and an ephemeral runner.

## GitHub Actions

The existing
[Provider live canary workflow](../.github/workflows/provider-live-canary.yml)
has a separate `interactions` matrix. Weekly runs reuse the existing enabled
Provider flags; manual dispatch reuses the Provider selector. The default-branch
selection gate precedes these jobs, checkout uses the immutable trigger SHA,
permissions are read-only, and no model Secrets enter the interaction jobs. The
original credential-backed no-tools lifecycle jobs remain separate.

The interaction jobs install the current official npm releases, or the current
Hermes GitHub release into an isolated Python environment. They record resolved
package versions, Hermes source revision, Harapter revision and the selected
suite's result. Installation and execution have job deadlines; the test command
also has a 240-second process deadline. No Runtime home, traffic or log artifact
is uploaded. An installation or selected test failure fails the job.

The recorded results above are local Runtime evidence. This change's trusted
Actions execution remains pending until the workflow is delivered to the default
branch and a selected run succeeds. Neither fixture CI nor local success is a
substitute for that Actions result.

## Official interface references

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenCode v1 permission configuration](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/core/src/v1/config/permission.ts)
- [Hermes approval implementation](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/platforms/api_server_runs.py)
- [OpenClaw execution approvals](https://docs.openclaw.ai/tools/exec-approvals)
- [Pi RPC interface](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
