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
branch before any job receives Secrets, checks out the immutable trigger commit
without persisting Git credentials, and uses read-only repository permissions.
Pull requests and ordinary pushes cannot invoke the credential-backed path.

Each Provider is enabled independently for scheduled runs through a repository
variable. An enabled or manually selected job fails explicitly when the shared
model-service Secret set is incomplete; an unconfigured job is not passing
evidence. Runtime packages are installed only in an ephemeral GitHub-hosted job
from their current release channel. The workflow records the installed package
identity and the minimal live lifecycle result without retaining prompts,
Provider traffic, credentials, configuration files, Runtime homes, or private
paths.

The canary config disables Runtime sharing, telemetry, and model-facing tools.
Before receiving a real credential, the Codex job verifies the complete feature
inventory against a reviewed fail-closed allowlist, and the DSH job verifies the
complete effective `sdk-minimal` composition against its reviewed rows and
disabled states. An unknown enabled Codex feature or any DSH composition drift
stops that job before the credential-bearing step. OpenCode combines an empty
plugin list, explicit tool disabling, and a wildcard permission denial. Every
minimal live test also fails if it observes a tool or interaction event.

The credential must be dedicated, revocable, and limited to the smallest useful
test budget. The synthetic task uses an empty temporary workspace and produces
no repository mutation.

A passing canary is current live evidence for the exercised Session, Run, Event,
and terminal path. It does not promote every capability or convert an
unnegotiated Runtime protocol into a negotiated compatibility range. A newly
published Runtime failure means that release needs investigation or Adapter
work; it does not make an older recorded live result false.

DSH follows the current SDK Profile prerelease channel without an exact version
allowlist. Each run records the DSH CLI, `@deepseek-ai/dsh-sdk-minimal`, and
`@deepseek-ai/dsh-sdk-app` versions. Codex and OpenCode follow their current
stable package channels. A Provider that needs a different model interface or
cannot safely isolate its Runtime stays disabled until its own canary
configuration is reviewed.

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
