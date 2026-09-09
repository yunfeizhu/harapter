# Packages

The application entry, portable Core, canonical schemas, transports, and shared
verification live here. The `harapter` entry composes Provider implementations;
Core, schemas, transports and conformance stay Provider-agnostic.

Public entry and private implementation modules:

- [`harapter`](./harapter/README.md) exposes one application API, bundles the
  maintained protocol implementations and loads only the selected ones. Runtime
  preparation remains host-owned; its first npm release is pending.

- [`core`](./core/README.md) owns the provider-agnostic TypeScript contracts,
  dynamic Registry, capability requirements, ownership checks, errors, and
  extension lookup.
- [`conformance`](./conformance/README.md) owns the reusable portable behavior
  suite and deterministic Fake Provider.
- [`transport-jsonrpc-stdio`](./transport-jsonrpc-stdio/README.md) owns bounded
  bidirectional JSONL framing, request correlation, ordered inbound delivery,
  backpressure, and stream lifecycle without Provider semantics.
- [`transport-jsonl-process`](./transport-jsonl-process/README.md) owns strict
  LF-delimited JSON object framing, bounded ordered delivery, serialized writes,
  local write waits, and stream lifecycle for Provider-owned process protocols
  that are not JSON-RPC.
- [`transport-http-sse`](./transport-http-sse/README.md) owns endpoint-bound,
  bounded HTTP requests and pull-driven Server-Sent Events parsing without
  Provider semantics.
- [`transport-acp`](./transport-acp/README.md) composes the JSON-RPC stdio
  transport with stable ACP v1 negotiation, capability validation, bidirectional
  permission handling, typed Session updates, and bounded unknown observations
  without Provider or process semantics.

Additional packages remain unimplemented. Their target boundaries are defined in
the [implementation guide](../docs/design/implementation-guide.md).

Only `harapter` is listed in
[`scripts/public-packages.json`](../scripts/public-packages.json) and published
to npm `latest`. Other packages are private Workspace modules bundled into that
SDK. Their build versions do not form separate release trains.
