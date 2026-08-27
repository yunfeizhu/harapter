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

Schema and additional transport packages remain unimplemented. Their target
boundaries are defined in the
[implementation guide](../docs/design/implementation-guide.md).
