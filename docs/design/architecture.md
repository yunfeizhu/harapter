[English](./architecture.md) · [简体中文](./architecture.zh-CN.md) ·
[日本語](./architecture.ja.md)

# Harapter architecture

## 1. Architecture goals

Harapter solves one problem: allow upper-layer applications to connect to and
use the published machine interfaces of several different Harnesses through a
stable API.

It is not another Harness and does not maintain a second agent execution loop
above existing Harnesses. Each Harness continues to own its Graph, Agent Loop,
Tool, Skill, Plugin, Session Store, Checkpoint, and internal security controls.

The design must satisfy all of these requirements:

- one application can register and connect to multiple Harnesses;
- one Provider can have multiple connection Profiles;
- Portable Core does not depend on a specific Provider;
- a unified abstraction does not discard Provider-specific behavior;
- an upstream breaking change remains isolated to one Provider Adapter; and
- behavior absent from an official machine interface is not simulated as
  supported behavior.

## 2. Logical architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Host Application                                            │
│ UI · Task Store · Product Policy · Artifact Index           │
└──────────────────────────────┬──────────────────────────────┘
                               │ Stable Harness API
┌──────────────────────────────▼──────────────────────────────┐
│ Core                                                        │
│ registry · profiles · contracts · capabilities · errors     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Provider Adapter Contract
┌──────────────────────────────▼──────────────────────────────┐
│ Provider Adapters                                           │
│ session mapping · event mapping · extensions · probes       │
└───────────────┬────────────────┬────────────────┬───────────┘
                │                │                │
        Official SDK      stdio / JSON-RPC    HTTP / ACP
                │                │                │
┌───────────────▼────────────────▼────────────────▼───────────┐
│ User-provided Harness Runtimes                              │
│ Qwen · OpenCode · Codex · Goose · Crush · DSH · ...         │
└─────────────────────────────────────────────────────────────┘
```

Core, Provider Adapters, and Harness Runtimes form three independent boundaries.
Shared transport libraries can reuse ACP, JSONL, JSON-RPC, HTTP, SSE, or process
hosting, but a transport handles communication only and does not decide Provider
semantics.

## 3. Core

Core contains only Provider-agnostic behavior:

- Provider Registry and Adapter Factory;
- Harness Profile and connection-configuration contracts;
- `HarnessClient`, `HarnessSession`, and `HarnessRun` interfaces;
- Input, Event, Interaction, Capability, and Error types;
- Provider Extension Registry; and
- a shared Conformance Test Kit.

Core does not contain:

- Harness SDK dependencies;
- a Provider-name enum or Provider-specific conditional branch;
- Provider-native API fields;
- a Runtime installer or third-party account-login implementation;
- Graph State, Checkpoint, or internal Tool objects; or
- host-product database, task, or UI types.

## 4. Provider Registry and Profiles

A Provider Adapter registers dynamically through the Registry. A Provider ID
identifies an adapter implementation, such as `qwen.code`; a Profile ID
identifies an actual host connection configuration, such as `qwen-local`.

```text
Provider: qwen.code
    ├── Profile: qwen-local
    └── Profile: qwen-team-account

Provider: opencode
    ├── Profile: opencode-local
    └── Profile: opencode-remote
```

Profiles allow one application to connect to different Harnesses at the same
time and allow one Harness to use different accounts, workspaces, or deployment
endpoints. Core does not choose a default Profile; that belongs to host settings
and task creation.

## 5. Provider Adapter

Each Provider Adapter maps the published interface of one Harness:

- validate and establish an SDK, process, socket, or service connection;
- read Runtime identity, protocol characteristics, and observed capabilities;
- map a portable Session to a Thread, Conversation, Agent Session, or Provider
  Session;
- map a portable Run to a Turn, Prompt, Graph Run, or Agent Prompt;
- convert Provider streaming messages to portable Events;
- map native cancellation, approval, user input, and close semantics;
- classify Provider errors into portable error categories;
- expose Provider Extensions, a Native Client, and raw Events; and
- pass the shared Conformance Test and Provider-specific tests.

An Adapter does not copy the target Harness's internal implementation. It may
use an official SDK or implement a client for an officially published RPC or
HTTP protocol.

## 6. Connection forms

### 6.1 Embedded SDK

```text
Host Process ──▶ Provider Adapter ──▶ Official Harness SDK
```

This form suits a Harness with an official SDK. The host can inject the SDK
object, or the Provider Adapter can create it from non-sensitive configuration
supplied by the host.

### 6.2 Managed process

```text
Host Process ──▶ Provider Adapter ──▶ official stdio/RPC ──▶ Harness Process
```

This form suits Codex App Server, ACP Server, and a headless JSONL CLI. An
Adapter may start a command explicitly selected by the host, but does not
download, upgrade, or discover an executable.

Process ownership must be explicit:

- `adapter`: the Adapter starts, health-checks, and closes the process;
- `host`: the host owns the process, and the Adapter closes only its
  communication channel; or
- `external`: a user or external service manages the process, and the Adapter
  does not control its lifecycle.

### 6.3 Service endpoint

```text
Host Process ──▶ Provider Adapter ──▶ HTTP / SSE / WebSocket ──▶ Harness Service
```

This form suits OpenCode Server, OpenHands Agent Server, and other long-running
services. The host owns deployment, authentication, the network boundary, and
the service lifecycle.

### 6.4 Local socket

```text
Host Process ──▶ Provider Adapter ──▶ Unix Socket / Named Pipe ──▶ Harness Service
```

This form suits a Harness with a published local control API. The socket path,
access permissions, and process ownership must be configured explicitly; an
Adapter does not scan user directories to guess which service is active.

## 7. Multi-Harness runtime topology

When one client connects to Qwen Code and OpenCode at the same time, use this
topology:

```text
Application
    │
    ├── HarnessClient(profile=qwen-local)
    │       └── Session q-123 ──▶ Qwen Code
    │
    └── HarnessClient(profile=opencode-local)
            └── Session o-456 ─▶ OpenCode
```

The host may execute both Sessions concurrently or select any Profile for a new
task. Portable Events can enter one UI rendering layer, while Sessions, Runs,
raw Events, authentication, and errors retain Provider identity.

## 8. Session binding and migration

A `SessionRef` binds at least:

- `providerId`;
- `profileId`;
- the Provider-native Session ID; and
- a compatibility identity summary captured when the reference is created.

Resume must use the same Provider Adapter and a compatible Profile. Core does
not pass a Qwen `SessionRef` to OpenCode and does not replay chat history to
imitate native resume.

Continuing a task across Harnesses is a host-level export and recreation. The
host may pass a task description, a user-approved message summary, file
references, and artifacts as new input, but the new Harness creates a new
Session and does not receive the original Harness's internal state.

## 9. Three-layer capability model

### 9.1 Portable Core

The minimum portable semantics include:

- establish a Client;
- create a Session;
- submit text input;
- receive ordered Events;
- obtain an explicit terminal state such as completion, failure, or connection
  abort; and
- close the Session and Client.

### 9.2 Optional Capability

The following behavior has Provider semantics only when its Capability is
declared `native`:

- Session Resume or Fork;
- Run Cancel or Interrupt;
- Approval and User Input;
- Reasoning, Tool, Artifact, and Usage Events; and
- dynamic model, mode, or permission changes.

Terminating a process owned by an Adapter is `connection.abort`; it is not
automatically Provider-native `run.cancel`.

`emulated` means only that evidence proves an equivalent portable result; it
does not inherit Provider-native state. `adapter_controlled` means only that the
Adapter controls its connection. `unsupported` confirms that behavior cannot be
implemented reliably. `unknown` means evidence is insufficient. A name absent
from a Manifest is not recognized by the current connection and is not merged
with `unknown`.

### 9.3 Provider Extension

Provider-specific behavior such as a DSH plugin marketplace, Goose Recipe, Qwen
Goal, Codex App, or Copilot Slash Command enters a Provider namespace. Core does
not interpret these interfaces and does not promise that code using an Extension
can switch Providers.

## 10. State ownership

| State                     | Owner                    | Adapter behavior                                  |
| ------------------------- | ------------------------ | ------------------------------------------------- |
| Agent Loop / Graph State  | Harness                  | Does not read or copy internal structures         |
| Provider Session / Thread | Harness                  | Returns an opaque Provider-bound reference        |
| Checkpoint                | Harness                  | Does not convert or migrate it                    |
| Tool / Skill / Plugin     | Harness                  | Observes public behavior or uses native access    |
| Raw Provider Event        | Harness                  | Optionally preserves it after redaction           |
| Profile configuration     | Host                     | Core consumes it but is not a configuration store |
| Product Task/Message/Run  | Host                     | Adapter does not persist it                       |
| User files and artifacts  | Host or Harness          | Adapter passes references and Events              |
| Secret                    | Host Secret Store or SDK | Adapter does not log plaintext                    |

## 11. Event boundary

Native messages with stable interpretations map to portable Events:

```text
run.started
message.delta
message.completed
reasoning.delta
tool.started
tool.updated
tool.completed
interaction.requested
interaction.resolved
artifact.created
usage.updated
run.completed
run.cancelled
run.failed
connection.aborted
provider
```

The Sequence of each Run's Event stream increases monotonically, and the stream
produces exactly one terminal state. An unknown Event maps to `provider` and
preserves `providerEventType` plus an optional redacted Raw Payload. An Adapter
does not infer an Event type from TUI display text.

## 12. Security and trust boundary

- An Adapter does not accept serializable plaintext Secrets; configuration
  stores only a Secret Reference.
- Raw Provider errors, environment variables, request headers, and raw Events
  are redacted by default.
- Runtime tool permissions and sandboxes remain under Runtime or host-product
  control.
- A unified interface does not make Harapter endorse the security of a
  third-party Runtime or plugin.
- An Adapter starts processes with structured commands and arguments and does
  not interpolate user input through a shell.
- The host decides which Profiles, working directories, network endpoints, and
  Runtimes a user may select.

## 13. Relationship to a host product

The host product continues to own its Task, Message, Run, database, Artifact,
settings, Secret Store, approval experience, and security policy. Harapter
Events can be projected one way into host-product Events but cannot replace the
host product's source of truth.

When integrating or replacing a production Harness, the host records the
cross-process contract, resume semantics, security boundary, and regression
tests in its own architecture decisions. Harapter does not decide these
product-level boundaries for the host.

## 14. Extending a new Provider

Adding a Harness requires:

1. create an independent Provider package and register a stable Provider ID;
2. select an official machine interface of the target Harness;
3. implement connection, Session, Run, Event, and Error mappings;
4. probe and declare observed capabilities;
5. expose necessary Provider Extensions and a Native Client; and
6. pass shared Conformance Tests and real-Runtime tests.

Adding a Provider does not require changing Core or upgrading other Providers.
