# Examples

Start with the [standalone SDK application](sdk-application/README.md). It uses
published npm dependencies and includes real-runtime entrypoints,
business-module integration, streaming, resume/fork, cancellation, approvals and
concurrent calls. Its [Chinese](sdk-application/README.zh-CN.md) and
[Japanese](sdk-application/README.ja.md) guides cover the same workflows.

The following repository references are useful when exploring or contributing to
the implementation:

- [`single-provider`](single-provider/README.md) demonstrates one complete
  portable Client, Session, Run, event, result, and cleanup lifecycle. Provider
  selection stays in the composition root.
- [`multi-provider-client`](multi-provider-client/README.md) connects
  semantically different Provider shapes, routes tasks by Profile, consumes
  concurrent event streams through one renderer, gates controls by observed
  capabilities, preserves Session ownership, and isolates typed extensions.
