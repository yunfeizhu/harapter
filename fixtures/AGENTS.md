# Harapter Fixture Agent Guide

These rules supplement the repository-wide [Agent Guide](../AGENTS.md) for files
under `fixtures/`.

- Fixtures contain only synthetic or irreversibly redacted data. Never commit a
  real prompt, file body, path, credential, token, cookie, authorization header,
  environment value, account identifier, or session identifier.
- Preserve protocol structure and ordering needed to reproduce behavior. Replace
  sensitive values with stable typed placeholders rather than deleting fields
  that affect parsing.
- Record provider, machine interface, fixture format version, upstream runtime
  or protocol fingerprint, capture method, and redaction method in fixture
  metadata.
- Keep fixtures deterministic: stable timestamps, IDs, ordering, line endings,
  and terminal results. Nondeterministic fields must be normalized by the
  fixture producer, not hidden by broad test matchers.
- Separate inbound, outbound, and expected canonical events when the transport
  can produce the same field names in both directions.
- Bound raw messages and include malformed or unknown examples only when they
  are safe and required by a specific test.
- Every fixture is exercised by a test. Delete obsolete fixtures with the tests
  and compatibility claim they supported.
- Live capture tools must redact before writing to disk and fail closed when a
  required redaction cannot be proven.
