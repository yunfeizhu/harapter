# Harapter Repository Script Agent Guide

These rules supplement the repository-wide [Agent Guide](../AGENTS.md) for files
under `scripts/`.

- Repository checks are deterministic, cross-platform Node.js programs with no
  network requirement unless the command explicitly documents one.
- Fail closed with actionable file paths and reasons. Print one success summary;
  do not dump file contents or environment values.
- Resolve paths from the repository root rather than the caller's working
  directory. Use UTF-8 and stable ordering.
- Keep policy data in a reviewed manifest when maintainers must change it
  without rewriting the checker.
- Exercise each new validator with at least one valid and one intentionally
  invalid case before relying on it in CI.
- Do not silently skip missing required files, malformed configuration, or an
  unknown policy value.
