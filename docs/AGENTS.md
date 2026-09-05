# Harapter Documentation Agent Guide

These rules supplement the repository-wide [Agent Guide](../AGENTS.md) for files
under `docs/`.

## Documentation ownership

Each durable fact has one owning location. Other documents link to the owner
instead of restating it.

- `docs/design/` defines reviewed target architecture and portable contracts
  that may precede implementation.
- `.agents/notes/` records why a non-trivial decision was made, alternatives
  that lost, and the consequences accepted.
- `docs/development.md` owns contributor workflow and local development
  procedures.
- A package README owns the implemented package's public API, configuration,
  semantics, errors, and limitations.
- A provider README owns its runtime prerequisites, compatibility range,
  capability mapping, extensions, native access, and known limitations.
- Generated reference content must identify its generator and must not be edited
  by hand.

Keep current behavior, target design, and historical rationale visibly separate.
Do not present a design table as shipped support.

## Design document rules

- Define ownership, lifecycle, terminal states, failure semantics, and unknown
  behavior for every portable abstraction.
- Distinguish normative requirements from examples and provider observations.
- Keep the canonical contract language-neutral even when TypeScript and Node are
  the first reference implementation.
- Provider comparisons cite official machine interfaces and state the evidence
  date or compatibility range when upstream behavior can change.
- Describe cancellation precisely: native cancellation, cooperative request,
  connection abort, and unsupported cancellation are different capabilities.
- Document forward-compatibility behavior for unknown fields, event kinds, and
  capability values. Never normalize an unknown value into success.
- Security documentation names trust, redaction, authentication, process,
  filesystem, and network ownership explicitly.

## Writing rules

- Maintain the root README and every published package README as synchronized
  language triads: the unsuffixed file is English, `.zh-CN.md` is Simplified
  Chinese, and `.ja.md` is Japanese. Every variant links to its two siblings.
  Package READMEs remain complete, practical user guides rather than translated
  stubs. Keep public identifiers and code exact in every language.
- A topic under `docs/design/` may remain English when it serves a technical
  audience. Once a design topic has a language triad, a semantic edit updates
  all three variants in the same pull request and internal links stay in the
  reader's language where a localized target exists.
- Write direct current-state prose. Put review history and rejected alternatives
  in an Agent Note rather than narrating them in reference documents.
- Prefer exact nouns such as `event field`, `JSON-RPC message`, `session owner`,
  or `process exit` over vague words such as `shape` or `magic`.
- Comments and documentation state contracts, failure behavior, timing,
  ownership, limitations, and safe use. Do not restate obvious code flow.
- Code examples must be minimal, internally consistent, and use fictional,
  redacted data. Never paste a real user path, token, prompt, or provider trace.
- Relative repository links are required for repository files. External
  technical claims link to primary sources.
- Update all affected links and owning documents in the same change. Run
  `pnpm check` before review.

## Change classification

A documentation-only correction that does not alter a contract is mechanical. A
change to API semantics, lifecycle, compatibility, security policy, provider
acceptance, or development process is non-trivial and updates or creates the
owning [Agent Note](../.agents/notes/README.md).
