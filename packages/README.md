# Packages

Portable Core, canonical schemas, transports, and shared verification live here.
A package must not import provider-specific SDK types unless its explicit
purpose is a provider-neutral transport.

Implemented packages:

- [`core`](./core/README.md) owns the provider-agnostic TypeScript contracts,
  dynamic Registry, capability requirements, ownership checks, errors, and
  extension lookup.
- [`conformance`](./conformance/README.md) owns the reusable portable behavior
  suite and deterministic Fake Provider.
- [`transport-jsonrpc-stdio`](./transport-jsonrpc-stdio/README.md) owns bounded
  bidirectional JSONL framing, request correlation, ordered inbound delivery,
  backpressure, and stream lifecycle without Provider semantics.
- [`transport-http-sse`](./transport-http-sse/README.md) owns endpoint-bound,
  bounded HTTP requests and pull-driven Server-Sent Events parsing without
  Provider semantics.
- [`transport-acp`](./transport-acp/README.md) composes the JSON-RPC stdio
  transport with stable ACP v1 negotiation, capability validation, bidirectional
  permission handling, typed Session updates, and bounded unknown observations
  without Provider or process semantics.

Additional packages remain unimplemented. Their target boundaries are defined in
the [implementation guide](../docs/design/implementation-guide.md).
