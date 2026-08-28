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
