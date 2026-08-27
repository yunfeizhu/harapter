# Harapter Agent Resource Guide

These rules supplement the repository-wide [Agent Guide](../AGENTS.md) for
versioned resources under `.agents/`.

- `.agents/notes/` owns durable project decisions and their lifecycle. It is not
  a scratchpad, task log, or replacement for current API documentation.
- `.agents/skills/` owns reusable Harapter-specific workflows that materially
  change an agent's decisions. It is not a collection of generic coding advice.
- Keep resources portable across contributors and checkouts. Do not include
  personal paths, local tool state, credentials, or assumptions about one
  maintainer's installed plugins.
- Agent resources never expand task authority. A Skill may describe commit,
  push, merge, release, or publication mechanics but must still require explicit
  user authorization before the external mutation.
- Update links, budgets, validators, and the owning decision record in the same
  change when this governance structure changes.
