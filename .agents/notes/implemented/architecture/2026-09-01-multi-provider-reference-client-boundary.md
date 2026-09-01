# Agent Note: Multi-provider reference client boundary

Status: implemented

## Problem

Harapter needs an executable reference client that proves one portable task and
event path can coordinate more than one semantically different Harness. The
example must demonstrate Profile selection, concurrent streams, capability
differences, Session ownership, Provider extensions, and cleanup without adding
Provider identity branches to the portable path or treating an unimplemented
Provider as supported.

A runnable composition also crosses process, network, filesystem, credential,
and model-cost boundaries. Constructing an example must not discover or install
Provider runtimes, weaken a host security policy, or make live-runtime evidence
part of the default repository test suite.

## Decision

The
[multi-provider reference client](../../../../examples/multi-provider-client/README.md)
has two explicit layers:

- the default entrypoint imports only `@harapter/core`, registers unique
  Provider/Profile pairs, routes tasks by `profileId`, consumes Run streams
  concurrently through one serialized renderer, and derives visible controls
  from each active Session's observed capabilities while preserving their modes;
- the `codex-opencode` subpath constructs the current process and external
  HTTP/SSE reference combination without connecting either runtime. The host
  supplies commands, endpoints, isolated Workspaces, authentication, security
  policy, and cleanup around real execution.

The portable client validates Session ownership before resume traffic. It
returns opaque Session references to the host but never renders them. Its
Provider-specific connection hook may use a guarded typed extension and return a
disposer; that type and data remain outside the portable event renderer.
Sessions, extension disposers, and Clients close deterministically on success
and failure.

Codex and OpenCode are the concrete composition in the
[implementation guide](../../../../docs/design/implementation-guide.md). They
exercise Adapter-owned process RPC and a host-owned HTTP/SSE service using
implemented packages with fixture, conformance, and compatibility evidence.
Deterministic tests use two independently identified Fake Providers and do not
count as live Provider evidence.

## Alternatives considered

### Use Qwen Code and OpenCode before the Qwen Adapter exists

Qwen Code has no Harapter Adapter, fixtures, conformance, compatibility range,
or package documentation. Using it in the executable reference composition would
advertise support without evidence.

### Put Codex and OpenCode branches in the portable client

This would make task routing, capability visibility, and Session ownership
depend on Provider identity. A host-selected factory and Profile already carry
those boundaries, so Provider-specific construction stays in a separate
composition subpath.

### Discover or install local runtimes from the example

Automatic discovery makes a default command touch host executables and
credentials. Installation would also add Provider runtime packages to the
Workspace. The composition is inert until the host explicitly passes it to the
portable runner.

### Render controls without their capability modes

A boolean `cancel` control cannot distinguish native cancellation from
Adapter-controlled behavior or connection abort. The renderer retains the
observed mode while hiding `unsupported` and `unknown` operations.

## Consequences

- The same portable renderer handles Codex and OpenCode records without seeing
  prompts, messages, raw events, native state, Provider results, errors,
  credentials, environment values, or local paths.
- A task changes Harness by selecting another Profile; a retained Session
  reference cannot be routed through the wrong Provider or Profile.
- Concurrent tasks settle before shared Clients close, and one task failure does
  not leave the other task's Session cleanup running in the background.
- Session controls reflect the created or resumed Session rather than a broader
  connection-level claim, so an ephemeral Session does not advertise resume.
- Typed extensions remain available at an explicit Provider-bound hook and must
  provide their own guard, redaction policy, observer failure handling, and
  disposer.
- The Codex setup selects an ephemeral read-only Session with no approvals. The
  OpenCode setup applies a host-supplied disabled Tool map, but the external
  server's policy remains authoritative for omitted Tools and every other side
  effect.
- Real execution may incur Provider cost and requires host-installed or
  host-operated runtimes. It is not run by default and does not expand either
  Adapter's declared compatibility range.
