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
event.

The credential must be dedicated, revocable, and limited to the smallest useful
test budget. Jobs that do not require a model call do not receive it. The
synthetic task uses an empty temporary workspace and produces no repository
mutation. Network readiness probes have per-request connection and total
deadlines. Each live-test process has a hard deadline shorter than its job
timeout, and the job timeout remains the final containment boundary.

A passing canary is current live evidence only for its exercised path. Codex,
OpenCode, and DSH exercise Session, Run, Event, and terminal behavior. Pi
exercises package installation, version probing, RPC handshake, non-persistent
Session open and close, and the absence of persisted Session content. OpenClaw
exercises installation, version probing, an isolated loopback-only Gateway, the
ACP handshake, Session open and close, and Client disposal without submitting a
Prompt. A passing result does not promote every capability or convert an
unnegotiated Runtime protocol into a negotiated compatibility range. A newly
published Runtime failure means that release needs investigation or Adapter
work; it does not make an older recorded live result false.

DSH follows the current SDK Profile prerelease channel without an exact version
allowlist. Each run records the DSH CLI, `@deepseek-ai/dsh-sdk-minimal`, and
`@deepseek-ai/dsh-sdk-app` versions. Codex and OpenCode follow their current
stable package channels. OpenClaw follows its current official package channel,
uses isolated per-job state, and disables model catalog refresh, plugins,
browser automation, MCP, channels, cron, heartbeat, telemetry, auditing, and
shell environment loading. The current Gateway may still read its public plugin
catalog during startup; the job carries no Provider credential or user content,
and none of its files or logs are retained. Pi follows the current official
package channel and opens a non-persistent isolated RPC Session with extensions,
skills, and prompt templates disabled. Neither OpenClaw nor Pi submits a Prompt,
performs a model call, or receives a model credential. A Provider that needs a
different model interface or cannot safely isolate its Runtime stays disabled
until its own canary configuration is reviewed.

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
