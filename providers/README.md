# Providers

Each provider adapter is independently testable and versioned. It maps one
harness's documented machine interface to Harapter contracts and owns its
compatibility probes, redacted fixtures, extensions, and native escape hatch.

## Implemented adapters

| Adapter                            | Provider ID             | Verified interface          | Status                 |
| ---------------------------------- | ----------------------- | --------------------------- | ---------------------- |
| [`claude`](./claude/README.md)     | `anthropic.claude-code` | Agent SDK `query()`         | Experimental in source |
| [`codex`](./codex/README.md)       | `openai.codex`          | Stable Codex App Server     | Supported in source    |
| [`dsh`](./dsh/README.md)           | `deepseek.harness`      | Current SDK stdio JSON-RPC  | Experimental in source |
| [`hermes`](./hermes/README.md)     | `nous.hermes-agent`     | Current API Server HTTP/SSE | Experimental in source |
| [`opencode`](./opencode/README.md) | `opencode`              | Stable HTTP/OpenAPI and SSE | Supported in source    |

“Supported in source” means implementation, redacted fixtures, Provider
negatives, shared conformance, a declared compatibility range, and local live
evidence exist. Packages remain private during pre-alpha and are not published
to a registry.

“Experimental in source” has implementation, redacted fixtures, Provider
negatives, shared conformance, and an explicit compatibility boundary, while a
required live-runtime evidence run is still outstanding. It is not a supported
Provider claim.
