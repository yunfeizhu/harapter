# Examples

- [`single-provider`](single-provider/README.md) demonstrates one complete
  portable Client, Session, Run, event, result, and cleanup lifecycle. Provider
  selection stays in the composition root.
- [`multi-provider-client`](multi-provider-client/README.md) connects
  semantically different Provider shapes, routes tasks by Profile, consumes
  concurrent event streams through one renderer, gates controls by observed
  capabilities, preserves Session ownership, and isolates typed extensions.
