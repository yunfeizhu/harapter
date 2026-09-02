[English](./provider-adapter-guide.md) ·
[简体中文](./provider-adapter-guide.zh-CN.md) ·
[日本語](./provider-adapter-guide.ja.md)

# Provider Adapter development guide

## 1. Responsibilities

A Provider Adapter calls a published SDK or API of one Harness and maps its
external semantics to Harapter Core.

It must:

- use an official SDK, RPC, HTTP API, or documented machine protocol;
- establish Client, Session, and Run mappings;
- translate streaming Events, Interaction requests, and Errors;
- probe the Capabilities actually supported by the current connection;
- distinguish Provider-native behavior from Adapter connection control;
- expose Provider Extensions, a Native Client, and optional Raw Events only when
  observed Capabilities support them, otherwise keep them absent and document
  the limitation; and
- pass the shared Conformance Test Kit.

It must not:

- copy the target Harness's Agent Loop;
- scrape TUI text or operate a graphical interface;
- download, select, or update a third-party Runtime automatically;
- take ownership of Harness plugins, Tools, Skills, Checkpoints, or sandbox;
- add Provider-specific types to Core;
- fabricate a compatibility implementation for behavior that does not exist; or
- describe process termination as Provider-confirmed native Run Cancel.

## 2. Package structure

```text
providers/<provider-id>/
├── adapter
├── manifest
├── connections
├── compatibility
├── session-mapper
├── event-mapper
├── error-mapper
├── capabilities
├── extensions
├── native
├── fixtures
├── conformance
└── README
```

- `adapter`: implements the Provider Adapter SPI;
- `manifest`: stable Provider ID, display metadata, and connection kinds;
- `connections`: wraps SDK, process, ACP, RPC, Socket, or service connections;
- `compatibility`: Runtime probes and Strategy selection;
- `session-mapper`: SessionRef, RunRef, and resume mapping;
- `event-mapper`: native Event to portable Event mapping;
- `error-mapper`: portable Error classification and redaction;
- `capabilities`: produces the current connection's Capability Manifest;
- `extensions`: typed Provider-specific interfaces;
- `native`: escape hatch to an official SDK or protocol Client;
- `fixtures`: redacted protocol and Event samples; and
- `conformance`: shared behavior and Provider-specific behavior tests.

## 3. Selecting an integration interface

Preferred order:

1. an official, documented SDK suitable for embedding;
2. an official bidirectional machine protocol or Agent Server;
3. an official HTTP/OpenAPI, ACP, JSON-RPC, or local Socket API;
4. an official Headless JSON/JSONL CLI;
5. a stable Shim published by the Provider maintainer; and
6. never use interactive terminal text or UI automation as a formal interface.

Before selecting an interface, establish:

- how a connection is opened and closed;
- how Runtime identity and protocol are discovered;
- how a Session is created, resumed, and referenced;
- how one input is submitted;
- how streaming Events are received and the one terminal state is determined;
- whether native Cancel, Approval, and User Input are supported;
- whether concurrent Sessions or Runs are permitted;
- how native Provider Errors and specific behavior are accessed; and
- the interface's license and distribution requirements.

One Provider may implement several Connection Strategies. Each Strategy must
share the portable semantic tests and declare its Capabilities separately.

## 4. Provider Manifest

```ts
const manifest = {
  providerId: 'vendor.harness',
  displayName: 'Vendor Harness',
  connectionKinds: ['sdk', 'process'],
  documentationUrl: 'https://example.com/provider-adapter',
};
```

A public Provider ID remains stable. Core adds no corresponding enum or
conditional branch. A derived Harness with different protocol, version
governance, or Extension semantics registers an independent Provider ID instead
of impersonating its underlying framework.

## 5. Connection implementation

### SDK

- State whether the host or Adapter creates the SDK Client.
- An SDK that carries a Provider Runtime must be an optional Peer supplied by
  the host. It cannot enter default Workspace dependencies or the lockfile; the
  Adapter uses dynamic loading or an explicit Binding.
- Do not read undeclared global configuration or environment variables.
- Do not dispose an SDK Client owned by the host when closing.
- When an official SDK starts a child process internally, describe the actual
  Runtime topology in the Descriptor.

### Process

- Use structured `command` and `args` without Shell concatenation.
- Parse only the official protocol on stdout and treat stderr as a bounded
  diagnostic stream.
- Implement startup timeout, health checks, backpressure, unexpected exit, and
  idempotent close.
- Terminate a process proactively only when its ownership is `adapter`.
- A nonzero exit or truncated protocol settles every affected Run.

### Endpoint and Socket

- Validate the URL, Socket kind, authentication reference, and connection
  timeout.
- Do not log Authorization, Cookie, or a complete sensitive query.
- State whether reconnection can resume an Event cursor.
- Do not scan unknown local ports or user directories to guess a service.
- When a host or external system manages the service, `close()` closes only the
  Client connection.

## 6. Session mapping

| Core           | Possible Provider concept                         |
| -------------- | ------------------------------------------------- |
| HarnessClient  | SDK Client, App Server Connection, Service Client |
| HarnessSession | Thread, Session, Conversation, Agent Session      |
| HarnessRun     | Turn, Prompt, Graph Run, Agent Prompt             |
| Interaction    | Approval Request, Interrupt, Server Request       |

Mapping requirements:

- SessionRef stores `providerId`, `profileId`, and the native Session ID.
- When a Provider has no native Run ID, the Adapter may generate a Client-local
  unique ID but cannot claim persistent semantics.
- A Provider without Resume returns `unsupported_capability`.
- Do not fabricate native Resume by silently replaying complete history.
- Before resume, validate the SessionRef's Provider, Profile, and compatibility
  identity.
- Events and Interaction requests cannot cross between Sessions.

## 7. Event mapping

Every native message enters an explicit mapping table:

| Native message         | Core Event              | Nonportable information | Handling                          |
| ---------------------- | ----------------------- | ----------------------- | --------------------------------- |
| Assistant text delta   | `message.delta`         | Provider metadata       | Optional Raw                      |
| Tool begin             | `tool.started`          | Native arguments        | Portable summary and redacted Raw |
| Approval request       | `interaction.requested` | Native Schema           | `providerState`                   |
| Unknown event          | `provider`              | All publishable fields  | `providerEventType` and Raw       |
| Unexpected exit or EOF | `connection.aborted`    | Redacted stderr         | Abort affected non-terminal Runs  |

Event translation requirements:

- preserve original ordering;
- produce exactly one terminal state for one Run;
- never guess an Event type from display text;
- never generate Reasoning that the Provider did not expose;
- keep portable Events independent of whether Raw is enabled;
- preserve unknown Events and never reinterpret them as success;
- use `run.failed` for process exit only when the official interface defines
  that exit as an authoritative Provider failure; otherwise unexpected exit,
  EOF, or missing terminal authority produces `connection.aborted`; and
- redact and bound Raw Events, Tool arguments, and Errors by length and rate.

## 8. Capability mapping

Capabilities come from the current connection and are never inferred from a
Provider brand name. Evidence can include:

- an official handshake and capability list;
- Schema generated by the current Runtime;
- methods and types exposed by the SDK object;
- the current Connection Strategy;
- startup configuration and license state;
- side-effect-free feature probes; and
- a verified compatibility Strategy.

Do not probe Capabilities by executing a real user task.

Cancel requires separate determinations:

```text
run.cancel = native
connection.abort = adapter_controlled
```

An Adapter that only kills a process cannot claim `run.cancel = native`.

## 9. Provider Extension

Provider-specific behavior uses a namespace:

```ts
extensions.register('goose.recipes', gooseRecipes);
extensions.register('qwen.code.goal', qwenGoals);
```

An Extension calls an official interface directly. The Adapter does not
reimplement a plugin marketplace, App system, or Package Manager.

When an official SDK or API supports behavior for which the Adapter does not yet
provide a typed Extension, a caller can access it through the Native Client.

## 10. Error Mapper

An Error Mapper distinguishes:

- Runtime unavailable;
- connection or handshake failure;
- authentication failure;
- incompatible Provider API;
- unsupported Capability;
- invalid input;
- Session unavailable or Provider/Profile mismatch;
- Provider execution failure;
- timeout; and
- connection aborted by the Adapter.

An unknown Provider failure cannot become success, an empty response, or an
ordinary timeout. `providerCode` may be preserved, but the Error body is
redacted first.

## 11. Conformance Tests

### Connection

- successful connection and idempotent close;
- unavailable Runtime, authentication failure, and incompatible protocol;
- Adapter-, host-, and externally owned processes; and
- startup timeout, connection loss, and unexpected exit.

### Session

- creation, multi-turn calls, and close;
- resume when supported and explicit rejection when unsupported;
- Profile and Provider mismatch;
- isolation across Sessions; and
- Provider concurrency limits.

### Streaming

- Text Delta ordering;
- Tools, Interactions, Artifacts, and Usage;
- unknown Events and Raw;
- slow consumers and buffer limits;
- unique terminality; and
- truncated Event streams.

### Cancel and Interaction

- native Cancel, connection abort, and Cancel after terminality;
- Approval, Deny, User Input, and invalid Request IDs;
- agreement between Capabilities and Errors when unsupported; and
- no reporting of auto-approval mode as an Interaction capability.

### Extension and Native

- Extension Registry and namespaces;
- Extensions call the official interface directly;
- Native Client provenance is explicit; and
- Extensions do not change Portable Core semantics.

### Redaction

- Secrets, Authorization, Cookies, and environment-variable values do not enter
  logs, Errors, or Fixtures;
- Raw Events and Provider Errors do not leak when Raw is disabled; and
- user Prompts, file contents, and large Tool output do not enter public
  Fixtures.

## 12. Completion criteria

Before release, a Provider Adapter must have:

- clear official interface, license, and Runtime prerequisites;
- documented Connection Strategy, Session, Run, Event, Capability, and Error
  mappings;
- passing shared Conformance Tests;
- passing Live Tests against the target Runtime;
- independently typed and tested Provider Extensions for every Extension the
  Adapter claims;
- a usable Native Escape Hatch or an explicit statement that none is provided;
- explicit known limitations and Experimental behavior;
- no silent degradation for connection failure or unsupported behavior; and
- no need for Core to add a Provider-name branch.

## 13. Official references

The machine interfaces and limitations for the initial Providers are recorded in
the [Provider integration matrix](./provider-matrix.md). An implementation also
pins its target official documentation, protocol Schema, license, and Live Test
environment in the Provider package README.
