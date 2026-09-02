# Agent Note: Maintain public design documentation in three languages

Status: implemented

## Problem

The root project overview links readers into detailed design documentation. A
multilingual root README does not provide a multilingual documentation
experience when the linked design topics are available in only one language. It
also leaves contributors without a stable rule for filenames, language
navigation, or synchronized semantic changes.

## Decision

User-facing topics under [`docs/design/`](../../../../docs/design/README.md)
migrate one complete topic at a time into synchronized triads. For every
migrated topic:

- the unsuffixed `topic.md` file is English;
- `topic.zh-CN.md` is Simplified Chinese; and
- `topic.ja.md` is Japanese.

Every migrated variant links to its two siblings. Internal documentation links
stay in the reader's language when the target topic has a localized variant.
Public API identifiers, protocol fields, package names, commands, and code
remain in their canonical form in every language.

A semantic change to a localized topic updates all three variants in one pull
request. Existing single-language topics migrate one complete topic at a time so
that review can compare the three versions without mixing unrelated design
areas. The repository documentation rules own the ongoing authoring requirement.

## Alternatives considered

### Localize only the root README

This preserves a small maintenance surface, but the language experience ends as
soon as a reader follows a design link. It does not meet the purpose of the
language selector.

### Rely on browser or machine translation

Automatic translation is useful as a reader-side fallback, but it cannot own the
exact meaning of lifecycle states, capability modes, security boundaries, or
canonical identifiers.

### Put all languages in one file

One file avoids sibling-link maintenance, but triples page length, makes anchor
navigation ambiguous, and prevents language-specific links from the root README.

### Migrate every design topic in one pull request

One migration would finish sooner but would create a review surface spanning the
portable API, provider compatibility, implementation workflow, and architecture
at once. Topic-sized pull requests keep semantic comparison and correction
bounded.

## Consequences

- Migrated design topics have a predictable English, Simplified Chinese, and
  Japanese path.
- Maintaining a design topic costs three synchronized edits and requires link,
  formatting, and semantic-parity review for all variants.
- New terminology must distinguish translated prose from canonical public
  identifiers.
- A topic is not described as localized until all three complete variants and
  their sibling links are present.
