# Harapter Example Agent Guide

These rules supplement the repository-wide [Agent Guide](../AGENTS.md) for files
under `examples/`.

- Examples demonstrate supported public Harapter APIs and documented provider
  setup. They must not import private source paths or depend on unpublished
  internals.
- Keep reusable behavior in `packages/` or `providers/`; examples contain only
  composition, minimal application code, and explanatory comments.
- Every example uses fictional inputs and safe defaults. Credentials come from
  documented environment variables and are never printed or committed.
- An example that makes network calls or starts a process must document cost,
  authentication, cleanup, and expected side effects.
- Test examples through their real entrypoints when practical. At minimum, type
  check or build them against the same public exports users consume.
- Do not present a provider, capability, or compatibility range as supported
  unless the corresponding package and conformance evidence exist.
