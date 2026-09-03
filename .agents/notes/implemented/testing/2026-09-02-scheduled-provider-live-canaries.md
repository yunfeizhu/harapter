# Agent Note: Scheduled Provider live canaries

Status: implemented

## Problem

Fixtures and Conformance Tests prove Harapter's checked-in mappings but cannot
detect that a newly published Runtime changed its installation, handshake, or
live lifecycle. Requiring maintainers to keep every Runtime installed locally
would mix host state with repository evidence and would not provide recurring
drift detection.

Credential-backed automation also creates a separate trust boundary. A live test
that executes pull request code, exposes a general-purpose credential to model
tools, logs Provider traffic, or reports a skipped test as passing would create
misleading or unsafe evidence.

## Decision

Harapter has a separate Provider live-canary workflow triggered only by a weekly
schedule or manual dispatch. It verifies that the workflow runs from the default
branch before any model-facing job receives Secrets, checks out the immutable
trigger commit without persisting Git credentials, and uses read-only repository
permissions. Pull requests and ordinary pushes cannot invoke the trusted live
path.

Each Provider is enabled independently for scheduled runs through a repository
variable. An enabled or manually selected model-facing job fails explicitly when
the shared model-service Secret set is incomplete; an unconfigured Run is not
passing evidence. Runtime packages are installed only in an ephemeral
GitHub-hosted job from their current release channel. The workflow records the
installed package identity and the scoped live lifecycle result without
retaining Prompts, Provider traffic, credentials, configuration files, Runtime
homes, or private paths.

The canary config disables Runtime sharing, telemetry, and model-facing tools.
Before receiving a real credential, the Codex job verifies the complete feature
inventory against a reviewed fail-closed allowlist, and the DSH job verifies the
complete effective `sdk-minimal` composition against its reviewed rows and
disabled states. An unknown enabled Codex feature or any DSH composition drift
stops that job before the credential-bearing step. OpenCode combines an empty
plugin list, explicit tool disabling, and a wildcard permission denial. Every
model-facing minimal Run test also fails if it observes a tool or interaction
event. Hermes Agent runs from its official container without a repository mount,
publishes its API Server only on host loopback, and receives a generated API
Server credential. Its authenticated inventory must report every configurable
toolset disabled, and the Runtime's full Agent-side resolver must return no
enabled toolsets before the synthetic Prompt is submitted. The Harapter test
process does not inherit the model credential. OpenClaw replaces its model
catalog with one generated text-only entry, marks that model as unable to use
tools through the Runtime's official model-compatibility control, and starts an
isolated loopback Gateway with an environment-backed SecretRef. The key is
removed from the Harapter test process before it starts the ACP bridge; only the
already-running Gateway retains the credential required for the model request.
The ACP bridge is also told not to prefix the synthetic Prompt with the
ephemeral runner path. Pi uses one generated `models.json` entry whose API key
is an environment reference, and the current published CLI must expose
`--no-tools` and `--no-context-files` before the credential-bearing test starts.
The Pi process inherits the dedicated model credential only for the bounded RPC
test because it owns the model request; extensions, skills, prompt templates,
tools, and context-file discovery are disabled.

The credential must be dedicated, revocable, and limited to the smallest useful
test budget. Jobs that do not require a model call do not receive it. The
synthetic task uses an empty temporary workspace and produces no repository
mutation. Network readiness probes have per-request connection and total
deadlines. Each live-test process has a hard deadline shorter than its job
timeout, and the job timeout remains the final containment boundary.

A passing canary is current live evidence only for its exercised path. Codex,
OpenCode, DSH, Hermes Agent, and OpenClaw exercise Session, Run, Event, and
terminal behavior. The configured Pi path exercises installation, version
probing, RPC handshake, a completed text Run with exact final content, persisted
Session resume, native cancellation, Session close, and cleanup. OpenClaw and Pi
reject any observed tool or interaction event. A configured path becomes
evidence only after its trusted execution passes. A passing result does not
promote every capability or convert an unnegotiated Runtime protocol into a
negotiated compatibility range. A newly published Runtime failure means that
release needs investigation or Adapter work; it does not make an older recorded
live result false.

The DSH lifecycle requires the exact synthetic response, `run.started`,
`message.completed`, and a final authoritative `run.completed` Event. It rejects
every observed tool or interaction Event. Failure diagnostics remain
content-free so the credential-backed job cannot expose Provider output.

DSH follows the current SDK Profile prerelease channel without an exact version
allowlist. Each run records the DSH CLI, `@deepseek-ai/dsh-sdk-minimal`, and
`@deepseek-ai/dsh-sdk-app` versions. Codex and OpenCode follow their current
stable package channels. OpenClaw follows its current official package channel,
uses isolated per-job state, and disables model catalog refresh, plugins,
browser automation, MCP, channels, cron, heartbeat, telemetry, auditing, and
shell environment loading. It submits one synthetic text Prompt through the
Gateway with Runtime-level tool support disabled and retains no state, logs,
Prompt, response, or Provider traffic artifact. Pi follows the current official
package channel, uses isolated configuration, Session storage, and Workspace
paths, and submits one exact-response Prompt before resuming the persisted
Session and requesting cancellation of a second Run. It retains no state,
Prompt, response, credential, or Provider traffic artifact after the ephemeral
job. A Provider that needs a different model interface or cannot safely isolate
its Runtime stays disabled until its own canary configuration is reviewed.

Hermes Agent follows its current official container channel. A run records the
resolved package version, immutable image digest, and Harapter revision. Its
temporary data mount contains only canary configuration and Runtime-created
state; bundled skills, plugins, MCP servers, memory, compression, checkpoints,
automatic title generation, and background review are disabled. The API Server
is reachable only through a host-loopback published port. The job submits one
synthetic text Prompt only after both the public inventory and the complete
Agent-side tool resolver pass their fail-closed checks. It retains no container,
data volume, logs, Prompt, response, or Provider traffic artifact.

## Alternatives considered

### Pin every Runtime to one exact version

This would make the job reproducible but would stop detecting new upstream
drift. Exact versions remain useful as historical evidence and as an optional
production-host choice, not as Harapter's runtime admission rule.

### Run credential-backed tests in pull request CI

This would expose Secrets to code under review or require a privileged workflow
to execute an untrusted head. Deterministic fixtures and conformance remain the
pull request gate; live canaries run only from the trusted default branch.

### Treat every successful canary as full Provider support

One minimal lifecycle cannot prove cancellation, resume, approval, or every
extension. Capability claims continue to require their own interface, fixture,
conformance, and live evidence.

## Consequences

- New Runtime drift becomes visible without long-lived local installations.
- Missing Secret configuration is distinguishable from a passing lifecycle.
- Runtime identities remain diagnostic evidence rather than an allowlist.
- The workflow is not a required pull request check and does not weaken the
  deterministic merge gates.
- Additional Providers require an isolated install, a bounded live test, and a
  reviewed credential/tool boundary before their schedule flag is enabled.
