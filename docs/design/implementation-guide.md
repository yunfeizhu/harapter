[English](./implementation-guide.md) ·
[简体中文](./implementation-guide.zh-CN.md) ·
[日本語](./implementation-guide.ja.md)

# Harapter implementation guide

This document describes the target repository shape and delivery sequence; some
entries may precede implementation. Current behavior is defined by package and
Provider READMEs, exports, source, tests, and released artifacts. A directory or
Provider listed here is not evidence that it is implemented or supported.

## 1. Independent repository structure

```text
harapter/
├── docs/
├── packages/
│   ├── core/
│   ├── schema/
│   ├── conformance/
│   ├── transport-acp/
│   ├── transport-jsonrpc-stdio/
│   ├── transport-jsonl-process/
│   ├── transport-http-sse/
│   └── transport-local-socket/
├── providers/
│   ├── claude/
│   ├── codex/
│   ├── opencode/
│   ├── goose/
│   ├── qwen/
│   ├── crush/
│   ├── copilot/
│   ├── cursor/
│   ├── dsh/
│   ├── hermes/
│   ├── openclaw/
│   └── pi/
├── examples/
│   ├── single-provider/
│   └── multi-provider-client/
├── fixtures/
└── licenses/
```

Core, Transport, and Provider packages are independent. A Transport implements
only framing, connections, backpressure, and lifecycle, without Provider
semantics. A Provider package can reuse a Transport but independently owns its
Session, Event, Capability, and Error mappings.

A single Schema or equivalent Canonical Types should define the portable
contract. If Harapter later offers SDKs in several programming languages,
generate language bindings from the portable Schema where possible instead of
hand-writing inconsistent contracts.

## 2. Build order

### 2.1 Portable contracts and Fake Provider

Implement first:

- Provider Registry;
- Harness Profile;
- HarnessClient, HarnessSession, and HarnessRun;
- HarnessInput and HarnessEvent;
- Interaction;
- Capability Manifest;
- HarnessError;
- Provider Extension Registry; and
- Native Escape Hatch.

Use a Fake Provider to fix the behavior of:

- registering and selecting multiple Profiles;
- binding a Session to a Provider and Profile;
- Event ordering and unique terminality;
- native Cancel versus connection abort;
- Capability rejection;
- unknown Events and Raw; and
- Extensions and Error classification.

### 2.2 First reference Providers

Prefer Providers that cover different connection topologies rather than
accumulating brand names:

1. **Codex**: verify bidirectional process RPC, Session/Turn, Approval,
   Interrupt, and Schema-driven compatibility;
2. **OpenCode**: verify HTTP/OpenAPI, SSE, a long-running service, and external
   lifecycle ownership; and
3. **Claude Code**: verify an official SDK, SDK-managed processes, and streaming
   Tool Events.

The portable API is suitable for stabilization only when SDK, process, and
service topologies can all implement it naturally.

### 2.3 Next vertical slices

After the first reference Providers, implement the following modules
independently in this order:

1. **DeepSeek Harness**: validate a constrained process Harness through the
   official SDK stdio JSON-RPC interface. Without evidence of native in-progress
   cancellation, close only the connection and report connection abort;
2. **Hermes Agent**: use an API Server supplied by the host to verify Session
   REST, Run status, SSE, Stop, and Approval control planes;
3. **ACP Transport**: compose the existing JSON-RPC stdio Transport into a
   Provider-neutral implementation of ACP Schema, methods, negotiation, and
   Capability validation;
4. **OpenClaw**: reuse ACP Transport through `openclaw acp` supplied by the host
   and preserve ownership mapping between ACP Session and Gateway Session;
5. **JSONL Process Transport**: provide strict LF framing, bounded queues,
   serialized writes, backpressure, and connection cleanup for non-JSON-RPC
   bidirectional process protocols; and
6. **Pi Agent**: reuse JSONL Process Transport through `pi --mode rpc` supplied
   by the host and establish Run terminality through `agent_settled` and the
   authoritative Assistant result.

Each item is one independent module and Pull Request. A Provider Adapter ships
with its documentation, redacted Fixtures, Conformance Tests, and compatibility
evidence. The host installs, authenticates, and manages third-party SDKs, CLIs,
Gateways, and Runtimes; they do not enter Harapter's default Workspace
dependencies. The rationale for this sequence and these interfaces is recorded
in the
[corresponding Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-next-provider-integration-sequence.md).

### 2.4 Shared ACP Transport

Implement ACP Transport outside Provider semantic layers, then integrate it
separately with:

- OpenClaw;
- Goose;
- GitHub Copilot CLI;
- an OpenCode ACP Strategy; and
- a Qwen Code ACP Strategy.

These Providers share protocol communication and base ACP types, but not a
Provider ID, startup arguments, Capabilities, Commands, or Extensions. The first
OpenClaw Adapter uses the official ACP bridge and does not implement a Gateway
WebSocket Client directly.

The ACP layer reuses the framing, request correlation, backpressure, bounded
queues, wait timeouts, and connection cleanup from
`@harapter/transport-jsonrpc-stdio`. It does not implement a second JSON-RPC
Transport. The Provider Connection owns bridge-process creation, termination,
restart, and ownership. The ACP layer does not interpret process exit as
Provider-native cancellation.

### 2.5 Headless JSONL and local services

- `@harapter/transport-jsonl-process` provides strict LF framing, bounded
  queues, serialized writes, backpressure, and connection cleanup for
  bidirectional non-JSON-RPC Headless JSONL protocols. The Provider Adapter
  retains request correlation, Event classification, and terminality. The Pi
  Agent Adapter uses this Transport and independently owns RPC Commands,
  Sessions, Retry, Interactions, Cancel, and terminal semantics;
- Qwen Code verifies consistency across SDK, Daemon, and Stream JSON Strategies;
- Cursor Agent CLI verifies its constrained Headless interface, nonzero exits,
  and incomplete terminal states; and
- Crush verifies Unix Socket, Windows Named Pipe, shared Workspace, and service
  version probes.

This group proves that Core can express a constrained Provider accurately,
without forcing every Adapter to fabricate a complete control plane.

### 2.6 Other Harnesses

LangGraph, OpenHands, and derived Pi-based Harnesses add Adapters through the
same SPI. They can reuse Transports and test utilities without requiring a Core
change.

## 3. Test structure

```text
conformance/
├── registry
├── profile
├── connection
├── session
├── streaming
├── interaction
├── cancellation
├── errors
├── extensions
├── native
└── redaction
```

### Fake Provider Tests

Without a real Harness, validate Core itself:

- dynamic Provider registration and removal;
- several Profiles for one Provider;
- parallel Sessions across Providers;
- Session Provider/Profile mismatch;
- Event ordering and unique terminality;
- Capability modes;
- connection abort; and
- Provider Events, Raw, Extensions, and Error classification.

### Recorded Fixture Tests

Use redacted native messages to validate Provider mappings:

- ordinary Events;
- unknown Events and fields;
- missing required fields;
- Error Responses;
- connection loss;
- Interaction Requests; and
- a nonzero CLI exit without terminal JSON.

### Live Provider Tests

Call the real official SDK or API in a user-supplied test environment:

- connection and Capability probes;
- Session creation;
- multi-turn Runs;
- Streaming;
- Tools and Interactions;
- native Cancel or explicit unsupported behavior;
- Resume;
- Provider Extensions claimed by the Adapter;
- a Native Client when the Adapter claims one; and
- concurrency limits and resource close.

A Live Test records Runtime Identity and nonsensitive test configuration. One
local success cannot be expanded into support for every version.

### Latest Canary

For a fast-moving upstream, scheduled tests can install the latest Runtime and
run Live Conformance. A Canary failure affects only new-version support for the
corresponding Provider and does not block Core or other Providers. A passing
Canary still requires a compatibility-range update under the release policy.

## 4. Multi-Provider reference application

The independent project must include a Core-only reference Client that connects
to at least two semantically different Harnesses:

```text
Reference Client
    ├── codex-local ────▶ adapter-codex ────▶ Codex
    └── opencode-local ─▶ adapter-opencode ─▶ OpenCode
```

The reference application demonstrates at least:

- configuring and selecting two Profiles;
- creating separate Sessions;
- consuming two Event Streams concurrently;
- using one UI Event Renderer;
- hiding unsupported actions based on Capabilities;
- keeping a SessionRef bound to its original Provider and Profile;
- switching Harnesses for a new task;
- rejecting an attempt to resume a Codex Session through OpenCode; and
- using one Provider Extension without contaminating the Portable Core example.

This is the central acceptance scenario for the Adapter's value.

## 5. Example configuration

```json
{
  "harnessProfiles": [
    {
      "profileId": "codex-local",
      "displayName": "Codex",
      "providerId": "openai.codex",
      "connection": {
        "kind": "process",
        "command": "/usr/local/bin/codex",
        "args": ["app-server", "--stdio"],
        "ownership": "adapter"
      }
    },
    {
      "profileId": "opencode-local",
      "displayName": "OpenCode",
      "providerId": "opencode",
      "connection": {
        "kind": "endpoint",
        "url": "http://127.0.0.1:4096",
        "transport": "http",
        "ownership": "external"
      }
    }
  ],
  "defaultHarnessProfile": "opencode-local"
}
```

This configuration references only user-supplied Runtimes; it does not mean an
Adapter installs them automatically. A production implementation obtains
commands, Endpoints, and Secret References from a controlled settings system and
never trusts an arbitrary project file to launch an executable.

## 6. Host integration example

```text
Host Application Control Plane
        │
        ▼
Harapter Core
        │
        ├── Selected Provider Adapter A
        └── Selected Provider Adapter B
```

The host application continues to own:

- Task, Run, Message, and product Events;
- SQLite and filesystem data;
- Artifact indexes and previews;
- settings and user interface;
- Secret Store; and
- product permissions and security boundaries.

The host projects SessionRefs and Events from Harapter one-way into product
data. They do not replace the host database.

Before entering a production execution path, a host separately:

- updates its Harness architecture ADR;
- defines cross-process Profile, SessionRef, Event, and Capability Schema;
- designs old-task resume and Provider-unavailable behavior;
- verifies that switching Harnesses cannot bypass Tool Policy, sandbox, or
  network boundaries;
- uses a LangGraph Adapter to prove existing behavior has not regressed; and
- adds real-task and failure regressions for every new Provider.

## 7. Independent repository requirements

- Documentation is understandable without any host-product source.
- Core imports neither host-product code nor a Harness SDK.
- Provider packages import no host-product types.
- Public Fixtures contain no user Prompt, file contents, or Secrets.
- Third-party licenses and official SDK requirements are recorded separately.
- Core, Transports, Providers, and examples can build and test independently.
- A host consumes Harapter as a formal package dependency instead of copying
  implementation source indefinitely.
- Provider packages can be released, rolled back, and disabled independently.

## 8. Acceptance criteria

The core design is established when:

- one reference application connects to Codex and OpenCode concurrently;
- a new task selects a Harness by changing only its Profile;
- Core contains no Provider-name branch;
- a Provider Adapter calls only a published SDK or API;
- Sessions, Inputs, Events, terminal Results, and Errors have stable portable
  semantics;
- a SessionRef cannot resume across Providers or Profiles;
- Optional behavior is checked through Capabilities;
- native Cancel is not confused with connection abort;
- Provider-specific behavior is accessible through an Extension or Native Client
  when supported;
- an unknown Provider Event is not lost;
- Runtime installation, plugin marketplaces, and framework-internal execution do
  not enter Core;
- every released Provider passes shared Conformance and real-Runtime Tests; and
- adding a third-party Provider does not change Core source.
