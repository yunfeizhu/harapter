[English](./README.md) · [简体中文](./README.zh-CN.md) ·
[日本語](./README.ja.md)

# Harapter

## Project positioning

Harapter is an independent adapter layer for agent harnesses. It gives desktop
clients, web services, CLIs, and other agent products a stable, stateful agent
API, while independent Provider Adapters call each Harness through its published
SDK, RPC, HTTP API, or machine protocol.

It borrows the Provider Adapter idea from LiteLLM, but the adapted unit is not a
single model request. It is a stateful Agent Runtime with Sessions, Runs,
streaming Events, tool calls, and human interactions.

```text
Host Application
        │
        │ Stable Harness API
        ▼
Harapter Core
        │
        ├── adapter-qwen ──────▶ Qwen Code
        ├── adapter-opencode ──▶ OpenCode
        ├── adapter-codex ─────▶ Codex Harness
        ├── adapter-claude ────▶ Claude Code
        ├── adapter-dsh ───────▶ DeepSeek Harness
        ├── adapter-hermes ────▶ Hermes Agent
        ├── adapter-openclaw ──▶ OpenClaw
        ├── adapter-pi ────────▶ Pi Agent
        └── other adapters ────▶ Other Harnesses
```

Harapter is a fully independent open-source project. It does not depend on a
host product's UI, database, task model, security implementation, or local
runtime.

> This documentation describes target design. It does not mean every listed
> Provider is implemented. Released packages, Capability Manifests, Conformance
> Tests, and Provider READMEs define actual support.

## Problems addressed

An application that integrates multiple Harnesses should not have to handle
every SDK, process protocol, and Event format separately. Harapter provides one
path to:

- register and discover Provider Adapters;
- configure one or more Harness Profiles;
- establish a Client and probe observed capabilities;
- create or resume a Session;
- submit a Run and consume streaming Events;
- respond to approval or user-input requests exposed by the Provider;
- receive structured errors, usage, artifacts, and raw Provider Events; and
- access Provider Extensions or a Native Client for behavior that cannot be
  unified.

One application can connect to several Harnesses at the same time instead of
selecting one global Provider. For example, a client can register `qwen-local`
and `opencode-local`, then choose a Harness per task:

```text
Task A ──▶ profile: qwen-local ─────▶ Qwen Code
Task B ──▶ profile: opencode-local ─▶ OpenCode
```

The upper-layer task list, message storage, and UI can be shared, but every
Harness Session remains bound to the Profile that created it.

## Harapter responsibilities

- Define Registry, Profile, Client, Session, Run, Event, Interaction, and Error
  contracts.
- Translate portable calls to the target Harness's official machine interface.
- Map native streaming messages to stable Events while preserving information
  that cannot be unified.
- Describe behavior observed on the current connection through a Capability
  Manifest.
- Distinguish Provider-native capability, Adapter connection control, and
  unsupported behavior.
- Expose typed Extensions and a Native Escape Hatch for Provider-specific
  behavior.
- Add a Harness through an independent Provider package without changing Core's
  execution model.

## Responsibilities outside an Adapter

Harapter does not:

- implement or copy an Agent Loop, Graph, Planner, Tool Loop, or Checkpoint;
- package, download, update, or distribute a third-party Harness Runtime;
- log in to third-party accounts, purchase licenses, or configure a Runtime for
  the user;
- reimplement the Tool, Skill, Plugin, App, MCP, sandbox, or permission system
  of each Harness;
- convert internal state or Checkpoints between Harnesses;
- give one Provider's Session ID to another Provider for resume;
- persist a host product's tasks, full conversations, user profiles, or
  artifacts;
- parse interactive TUI text or operate a graphical interface to imitate a
  supported API; or
- claim behavior that the Provider has not exposed through an official machine
  interface.

The preferred delivery model is for the user or host to supply a Runtime that is
already installed and authenticated. A Provider Adapter may connect to a
host-supplied SDK instance, executable, or service endpoint, but it does not
embed the third-party distribution in its own package.

## Capability model

Adapters do not force every Harness into an identical feature set. Harapter uses
three capability layers:

1. **Portable Core**: stable common semantics such as creating a Session,
   submitting input, receiving Events, and obtaining an explicit terminal
   result.
2. **Optional Capability**: runtime-probed common behavior such as Resume, Fork,
   native Cancel, Approval, Artifact, and Usage.
3. **Provider Extension**: Provider-specific interfaces such as a plugin
   marketplace, Recipe, Goal, App, or Slash Command.

Each capability also declares how it is implemented:

- `native`: the target Harness directly supports it through an official
  interface;
- `emulated`: the Adapter has evidence that an equivalent implementation
  satisfies the portable semantics, without claiming Provider-native state or
  lifecycle;
- `adapter_controlled`: the Adapter controls only its own connection or process
  and does not present that control as Provider-native behavior;
- `unsupported`: the current Provider, version, or connection cannot implement
  it reliably; and
- `unknown`: the current connection recognizes the capability name but lacks
  enough evidence to determine support.

A missing Capability field means the current Manifest does not recognize that
Capability name; it is different from an explicit `unknown`. Callers choose the
modes they accept, and the default accepts only `native`.

Therefore, “multiple Harnesses can be integrated” means they can enter the same
portable task lifecycle. It does not mean they all support Fork, approvals,
plugin marketplaces, or in-run mode changes.

## Session and switching boundary

- An application may select any Profile when creating a new Session.
- Several independent tasks may use the same Profile.
- One Provider may have multiple Profiles for different accounts, working
  directories, or service endpoints.
- A created Session stores its `providerId` and `profileId` and returns to a
  compatible Adapter.
- An active Session cannot switch Harnesses transparently.
- Continuing work across Harnesses creates a new Session and explicitly passes a
  portable task description, message summary, files, and artifacts.

## Documentation index

- [Architecture](./architecture.md): components, runtime topologies, state
  ownership, and multi-Provider relationships.
- [Portable API](./api-design.md): Profile, Client, Session, Run, Event,
  Capability, and Error contracts.
- [Provider matrix (Simplified Chinese)](./provider-matrix.md): official machine
  interfaces, evidence levels, and limitations for target Harnesses.
- [Provider-specific capabilities (Simplified Chinese)](./provider-extensions.md):
  the three-layer capability model, Extension interfaces, and Native Escape
  Hatch.
- [Provider Adapter guide (Simplified Chinese)](./provider-adapter-guide.md):
  requirements for implementing a new Provider package.
- [Compatibility (Simplified Chinese)](./compatibility.md): upstream changes,
  runtime probes, support ranges, and replacement strategy.
- [Implementation guide (Simplified Chinese)](./implementation-guide.md):
  independent repository structure, build order, and acceptance requirements.

## Independent project constraints

- Core imports no Harness SDK.
- Core contains no Provider-name enum or Provider-specific conditional branch.
- Provider IDs and Profile IDs are stable strings registered dynamically.
- A Provider Adapter contains the target Harness's native types and version
  differences.
- Public types reference no host-product Task ID, database schema, or UI type.
- Each Provider document owns the license, authentication, and runtime
  requirements of its official SDK or API.
- Behavior without a published machine interface is not claimed as supported.
- Adding a Provider does not require changing Core source.

## Terminology

- **Harness**: a framework or runtime that owns an agent execution loop, state,
  and tool orchestration.
- **Core**: stable public interfaces, public data types, the capability model,
  and Provider Registry.
- **Provider Adapter**: an implementation that translates portable interfaces to
  one Harness's official machine interface.
- **Harness Profile**: one selectable connection configuration stored by the
  host, such as `qwen-local`.
- **Harness Client**: one active connection established from a Profile.
- **Harness Session**: a portable reference to a Provider-native Thread,
  Session, or Conversation.
- **Run**: one execution produced by submitting input to a Session.
- **Capability**: behavior actually supported by the current Client, version,
  and configuration.
- **Provider Extension**: a typed, Provider-specific additional interface.
- **Native Escape Hatch**: an explicit way to access an official SDK Client,
  protocol client, or raw Event.
