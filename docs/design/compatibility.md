[English](./compatibility.md) · [简体中文](./compatibility.zh-CN.md) ·
[日本語](./compatibility.ja.md)

# Compatibility design

## 1. Basic judgment

Core should be independent of specific Harness versions, but a Provider Adapter
cannot ignore versions entirely.

An Adapter calls a third-party SDK or API. Whenever methods, fields, Events,
Errors, or lifecycles can change, the mapping layer must recognize whether the
current interface remains compatible. Ignoring versions does not remove a
breaking change. It delays the failure until a user task is running, where it
appears as an empty Event, incorrect Error mapping, or lost state.

The correct boundary is:

- Core knows no specific Qwen, Codex, DSH, or other Harness version;
- each Provider Adapter owns its protocol compatibility independently;
- a host may choose the latest Runtime but cannot automatically equate “latest”
  with “verified compatible”; and
- compatibility relies primarily on handshake, Schema, and behavior probes, with
  version numbers as only one form of evidence.

## 2. Three versions

Distinguish these versioning responsibilities:

| Object           | Version responsibility                               |
| ---------------- | ---------------------------------------------------- |
| Core             | Stable portable contracts and Provider Adapter SPI   |
| Provider Adapter | Target Harness mapping and compatibility Strategy    |
| Harness Runtime  | Actual SDK, CLI, service, or protocol implementation |

The three can be released independently. Updating the Qwen Code Adapter should
not require a new Core release; fixing Cursor Event parsing should not affect
the OpenCode Adapter.

## 3. Compatibility probes at connection time

Before creating a user Session, `connect()` performs the side-effect-free or
low-side-effect validation permitted by the interface:

1. confirm that the Runtime or Endpoint exists;
2. read published protocol compatibility promises, handshake data, and available
   Runtime Schema;
3. select a compatibility Strategy backed by Fixtures and Conformance evidence;
4. validate probeable required structures during the handshake;
5. produce the Client Descriptor and Capability Manifest; and
6. return `provider_api_incompatible` for a known incompatible interface.

Response and Event structures that cannot be enumerated during the handshake
undergo structural validation when the corresponding operation first appears. A
missing required field returns `provider_api_incompatible`. A new optional field
follows the upstream's published forward-compatibility rules. Capability probing
cannot execute a real user task. When a safe determination is impossible, mark
the behavior `experimental` or `unknown`, or fail closed.

## 4. Schema first

When a Provider can generate or publish a machine-readable Schema, prefer it:

- Codex App Server generates TypeScript or JSON Schema from the current Runtime
  for Fixture, Mapping, and Conformance evidence;
- OpenCode publishes OpenAPI;
- ACP Providers follow the base ACP protocol and additionally probe Provider
  notifications and Extensions;
- JSONL CLIs use a published Event Schema and recorded Fixtures; and
- SDK Providers use official exported types and minimal Runtime feature probes.

A version range establishes only possible compatibility. Official stable
protocol promises, current Schema, operation-time structural validation, and
Conformance jointly define the interface supported by an Adapter.

## 5. Compatibility Strategy

A Provider package can retain independent Strategies for different protocol
families:

```text
adapter-qwen
    ├── strategy-sdk
    ├── strategy-acp
    ├── strategy-daemon
    └── strategy-stream-json

adapter-opencode
    ├── strategy-http-openapi
    └── strategy-acp
```

Different Strategies share portable Provider semantic tests but may produce
different Capabilities. A Strategy is an internal implementation detail of the
Provider package and does not enter a Core enum.

When an upstream makes a breaking change, the usual response is to:

1. retain an old Strategy still used by users;
2. add or replace the new protocol Strategy;
3. update Event, Error, and Capability mappings;
4. add old and new Fixtures and Live Conformance;
5. release that Provider Adapter; and
6. leave Core and other Provider packages unchanged.

This makes replacement fast enough, but it cannot guarantee that every unknown
future change requires no code update.

## 6. Must a Runtime version be pinned?

Adapter design does not require users to pin one Harness version forever, but a
production deployment needs reproducibility.

Support three host policies:

### 6.1 Verified

Run only Runtime versions or protocol fingerprints verified by Adapter CI.
Suitable for enterprise and stable clients.

### 6.2 Compatible Range

Allow versions that match known Schema and behavior probes. Suitable for
ordinary desktop products.

### 6.3 Latest Canary

Allow users to follow the latest Runtime, but reprobe the first connection and
show Experimental status explicitly. Suitable for developer previews; it does
not automatically expand stable support claims.

An Adapter package version such as `adapter-dsh 0.4.1` therefore does not pin
the Harness Runtime permanently to the same version. The Adapter declares and
probes the protocol families it understands, while the host decides whether to
pin the deployed Runtime.

## 7. Capability is a Runtime result

A Capability cannot live only in a static table. It is affected by at least:

- Runtime version and protocol;
- Connection Strategy;
- startup arguments;
- account and license;
- enabled plugins, Skills, Apps, or MCP;
- server-side feature flags; and
- operating system and deployment topology.

The same `github.copilot-cli` Provider can produce different Capabilities with
different Server startup arguments. The same OpenCode Provider can differ
between HTTP and ACP.

A Capability cache is keyed by Runtime Identity and a digest of critical
nonsensitive configuration, not only by Provider ID.

Capability results distinguish `native`, evidence-backed `emulated`,
`adapter_controlled`, `unsupported`, and `unknown`. A missing name means the
current Adapter does not recognize that Capability, while explicit `unknown`
means the name is recognized but evidence is insufficient. Neither satisfies a
host requirement that accepts only `native` by default.

## 8. Runtime Identity

Diagnostics and compatibility caches can use this nonsensitive identity:

```text
Runtime Identity =
  Provider ID
  + Adapter Version
  + Connection Strategy
  + Runtime Version or Protocol Fingerprint
  + Extension/Profile Fingerprint when relevant
```

The identity contains no Secret, complete environment variable, user Prompt,
file contents, or local credential path.

For a plugin-based Harness, the plugin set can change Events, Tools, and Agent
behavior. When the Provider can read an Extension fingerprint, include it in the
Capability cache and Session Compatibility Ref. When it cannot, document the
limitation.

## 9. Unknown fields and Events

- When documentation explicitly permits added fields, ignore unknown optional
  fields.
- A missing required field is protocol incompatibility, never a misleading
  default value.
- Preserve an unknown Event as a `provider` Event with its `providerEventType`
  and a safe bounded summary. Optional Raw data is bounded in size and
  structure, redacted, and rate-limited.
- Never infer success from an unknown terminal state.
- A nonzero CLI exit without an authoritative terminal result maps to
  `connection.aborted`. It maps to `run.failed` only when the official interface
  defines that exit as an authoritative Provider failure.
- Redact and bound the native Provider Error while retaining its original Error
  code.

## 10. Rollback and coexistence

A Provider Adapter package should allow compatible Strategies to coexist. When
an upgrade fails, the host can:

- roll back one Provider Adapter;
- switch to an older Strategy;
- continue using an older Runtime;
- mark a new Runtime Profile unavailable without affecting other Providers; or
- select another Harness Profile for new tasks.

An existing Session remains bound to its original Provider, Profile, and
compatibility identity. A rollback cannot let another Provider or Profile take
over that Session and does not guarantee that a new Runtime can resume an old
Checkpoint.

## 11. Support claims

Every Provider release states:

- supported Connection Strategies;
- verified Runtime or protocol range;
- required and optional Capabilities;
- known incompatible versions or features;
- authentication and Runtime installation prerequisites;
- Experimental behavior;
- Fixture and Live Conformance coverage; and
- stability boundaries of Provider Extensions and the Native Client.

Static documentation explains the range. The Runtime Capability Manifest decides
what the current connection can do. Neither can be replaced by a brand name.

## 12. Compatibility tests

Every Provider covers at least:

- the oldest supported interface;
- the current mainstream interface;
- unknown added fields;
- removed or renamed required fields;
- new Event types and changed terminal states;
- changed Error structures;
- connection loss and unexpected process exit;
- agreement between Capabilities and actual behavior;
- resume results for an old SessionRef on compatible and incompatible Runtimes;
- Provider Extensions do not affect Portable Core; and
- Secrets and sensitive native information do not enter Fixtures, logs, or
  Errors.

The latest upstream can enter scheduled Canary tests, but stable compatibility
does not expand automatically before that Canary passes.
