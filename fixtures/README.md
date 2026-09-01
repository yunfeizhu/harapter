# Fixtures

Fixtures must be synthetic or redacted. Never commit prompts, file bodies,
credentials, authorization headers, cookies, environment values, or private
provider traffic.

## Recorded sets

- [`codex/app-server-stable`](./codex/app-server-stable/manifest.json) records a
  generated stable Schema fingerprint plus synthetic completed, failed, and
  unknown-terminal App Server traces. Provider tests load these files without
  treating them as live traffic.
- [`opencode/http-openapi-stable`](./opencode/http-openapi-stable/manifest.json)
  records a published stable OpenAPI fingerprint plus synthetic completed,
  cancelled, permission, and unknown-event payloads. Provider tests load these
  files without treating them as live traffic.
- [`dsh/sdk-jsonrpc-current`](./dsh/sdk-jsonrpc-current/manifest.json) records
  the inspected current SDK protocol revision plus synthetic completed, failed,
  missing-terminal, and unknown-terminal JSONL traces. The recorded package
  version identifies fixture provenance; it is not a runtime version pin.
- [`hermes/api-server-current`](./hermes/api-server-current/manifest.json)
  records the inspected current API Server source revision plus synthetic
  capability, completed, failed, cancelled, approval, late-child, and unknown
  event payloads. The revision identifies fixture provenance; it is not a
  runtime version pin.
- [`acp/v1-stable`](./acp/v1-stable/manifest.json) records the inspected stable
  ACP v1 schema revision plus synthetic unknown-notification and future-update
  payloads used to prove bounded structural redaction. The schema revision is
  evidence provenance, not a Provider runtime version pin.
- [`openclaw/acp-current`](./openclaw/acp-current/manifest.json) records the
  inspected current OpenClaw ACP bridge revision plus synthetic completed,
  permission, and unknown-update payloads. The recorded Runtime and ACP SDK
  versions identify fixture provenance; they are not Runtime version pins.
- [`pi/rpc-current`](./pi/rpc-current/manifest.json) records the inspected
  current Pi Agent RPC source revision plus synthetic completed, cancelled,
  failed, interaction, and unknown-event payloads. The recorded Runtime version
  identifies fixture provenance; it is not a Runtime version pin.
