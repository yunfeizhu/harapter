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
compatibility range. Separate [Actions results](#recorded-actions-results) below
record the installations and Harapter revisions used on trusted runners.

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
Hermes GitHub release as an editable source installation in an isolated Python
environment. They record resolved package versions, Hermes source revision,
Harapter revision and the selected suite's result. Installation and execution
have job deadlines; the test command also has a 240-second process deadline. No
Runtime home, traffic or log artifact is uploaded. An installation or selected
test failure fails the job.

### Recorded Actions results

On 2026-09-08, five manual runs from `main` passed both the selected official
Runtime interaction job and its separate credential-backed lifecycle job. The 36
interaction cases use the synthetic model service described above; the lifecycle
suite counts are separate. Each lifecycle suite's two passing tests consist of
one credential-backed Runtime lifecycle test and one offline safety-guard test.
Versions and test counts below were read from the linked Actions summaries.
Unselected, skipped jobs are not passing evidence.

| Provider | Interaction Runtime                      | Interaction cases passed | Lifecycle suite tests passed | Harapter revision | Actions                                                                       |
| -------- | ---------------------------------------- | ------------------------ | ---------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| Codex    | `@openai/codex` 0.153.4                  | 6                        | 2                            | `2a9bac0`         | [34196266283](https://github.com/yunfeizhu/harapter/actions/runs/34196266283) |
| OpenCode | `opencode-ai` 1.18.29                    | 6                        | 2                            | `2a9bac0`         | [34196346230](https://github.com/yunfeizhu/harapter/actions/runs/34196346230) |
| Hermes   | `hermes-agent` 0.21.1                    | 6                        | 2                            | `b55db3e`         | [34198210659](https://github.com/yunfeizhu/harapter/actions/runs/34198210659) |
| OpenClaw | `openclaw` 2026.9.2                      | 6                        | 2                            | `2a9bac0`         | [34196680068](https://github.com/yunfeizhu/harapter/actions/runs/34196680068) |
| Pi       | `@earendil-works/pi-coding-agent` 0.85.1 | 12                       | 2                            | `2a9bac0`         | [34196866951](https://github.com/yunfeizhu/harapter/actions/runs/34196866951) |

The full Harapter revisions are `2a9bac0d088b775124b6de5336170fd9ef49fc11` and
`b55db3e49baf628e71dc54efe1f2bd45ed2d1541`. Between them, only the Hermes
installation mode, its policy checks and the owning Agent Note changed. The four
earlier Provider results are retained with their original revision; only Hermes
was rerun at `b55db3e`.

The Hermes interaction job used official source revision
`2237be355906fbe6065ce1815711eee52b2d646e`. Its separate lifecycle job used
`nousresearch/hermes-agent@sha256:5aa20e4fd299c4f0b3e5de91992fba8d677aa9625feb544a83cfb76fe2b1d7f8`.
These cloud identities are distinct from the local Hermes observation above.

The Pi limitation in the recorded scope also applies to its Actions result:
passing the interrupted-confirmation cases verifies their expected failure and
connection-abort outcomes, without establishing native cancellation for that
path. These dated results cover the exercised paths and recorded installations;
they do not expand capability declarations or guarantee later Runtime releases.

## Official interface references

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenCode v1 permission configuration](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/core/src/v1/config/permission.ts)
- [Hermes approval implementation](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/platforms/api_server_runs.py)
- [OpenClaw execution approvals](https://docs.openclaw.ai/tools/exec-approvals)
- [Pi RPC interface](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
