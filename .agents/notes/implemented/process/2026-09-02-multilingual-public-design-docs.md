# Agent Note: Maintain public entry documentation in three languages

Status: implemented

## Problem

Harapter serves application developers through its repository landing page and
the README embedded in each published npm package. A multilingual repository
overview is insufficient when an npm user lands on a package guide that has no
language choice, practical installation path, or package-specific example. The
repository also needs one stable rule for filenames, package contents, language
navigation, and synchronized semantic changes.

## Decision

The root README and every published package README use synchronized triads:

- the unsuffixed `topic.md` file is English;
- `topic.zh-CN.md` is Simplified Chinese; and
- `topic.ja.md` is Japanese.

Every variant links to its two siblings. Each package triad is distributed in
the npm tarball, and package metadata links directly to that package's guide.
Package variants remain useful entry documents: they cover purpose, selection,
installation, a minimal public-API example, lifecycle, safety, and limitations.
Public API identifiers, protocol fields, package names, commands, and code
remain in their canonical form in every language.

A semantic change to a localized README or design topic updates all three
variants in one pull request. Technical design topics may remain English unless
they already have a language triad. The repository documentation and package
rules own the ongoing authoring and publication requirements.

## Alternatives considered

### Localize only the root README

This preserves a small maintenance surface, but the language experience ends as
soon as a reader follows a design link. It does not meet the purpose of the
language selector, and npm users still arrive at English-only package pages.

### Link localized package summaries outside the tarball

One shared translation page is smaller, but it separates installation and API
examples from the package version a user installed. Shipping each triad and
linking package metadata to its own guide keeps the entry point discoverable and
versioned with the implementation.

### Rely on browser or machine translation

Automatic translation is useful as a reader-side fallback, but it cannot own the
exact meaning of lifecycle states, capability modes, security boundaries, or
canonical identifiers.

### Put all languages in one file

One file avoids sibling-link maintenance, but triples page length, makes anchor
navigation ambiguous, and prevents language-specific links from the root README.

### Require every technical design topic to be translated

Full translation would cover internal architecture and maintenance material that
package consumers do not need, while tripling the review surface for every
technical change. English remains the common language for technical documents;
existing translated design triads stay synchronized.

## Consequences

- Repository and npm package entry points have predictable English, Simplified
  Chinese, and Japanese paths.
- Maintaining a public README costs three synchronized edits and requires link,
  formatting, example, and semantic-parity review for all variants.
- Release verification rejects a public package that omits either localized
  README, and each package Homepage resolves to its own guide.
- New terminology must distinguish translated prose from canonical public
  identifiers.
- Technical design documents may remain English. A topic already described as
  localized retains all three complete variants and sibling links.
