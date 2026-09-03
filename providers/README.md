# Providers

Each Provider Adapter is independently testable and maps one harness's
documented machine interface to Harapter contracts. It owns its compatibility
probes, redacted fixtures, extensions, and native escape hatch. Public Adapters
share Harapter's synchronized pre-1.0 release version.

## Implemented adapters

| Adapter                            | Provider ID         | Verified interface          | Status                 |
| ---------------------------------- | ------------------- | --------------------------- | ---------------------- |
| [`codex`](./codex/README.md)       | `openai.codex`      | Stable Codex App Server     | Supported in source    |
| [`dsh`](./dsh/README.md)           | `deepseek.harness`  | Current SDK stdio JSON-RPC  | Experimental in source |
| [`hermes`](./hermes/README.md)     | `nous.hermes-agent` | Current API Server HTTP/SSE | Experimental in source |
| [`opencode`](./opencode/README.md) | `opencode`          | Stable HTTP/OpenAPI and SSE | Supported in source    |
| [`openclaw`](./openclaw/README.md) | `openclaw`          | Stable ACP v1 stdio bridge  | Supported in source    |
| [`pi`](./pi/README.md)             | `pi.agent`          | Current strict JSONL RPC    | Experimental in source |

“Supported in source” means implementation, redacted fixtures, Provider
negatives, shared conformance, a declared compatibility range, and recorded
live-runtime evidence exist. Published pre-alpha packages use the opt-in npm
`next` dist-tag.

“Experimental in source” has implementation, redacted fixtures, Provider
negatives, shared conformance, and an explicit compatibility boundary, but
either live-runtime evidence is outstanding or the connected Runtime cannot be
matched safely to the verified evidence. It is not a supported Provider claim.
