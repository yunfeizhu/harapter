# Providers

Each provider adapter is independently testable and versioned. It maps one
harness's documented machine interface to Harapter contracts and owns its
compatibility probes, redacted fixtures, extensions, and native escape hatch.

## Implemented adapters

| Adapter                            | Provider ID    | Verified interface          | Status              |
| ---------------------------------- | -------------- | --------------------------- | ------------------- |
| [`codex`](./codex/README.md)       | `openai.codex` | Stable Codex App Server     | Supported in source |
| [`opencode`](./opencode/README.md) | `opencode`     | Stable HTTP/OpenAPI and SSE | Supported in source |

“Supported in source” means implementation, redacted fixtures, Provider
negatives, shared conformance, a declared compatibility range, and local live
evidence exist. Packages remain private during pre-alpha and are not published
to a registry.
