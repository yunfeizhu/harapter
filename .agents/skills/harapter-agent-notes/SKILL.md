---
name: harapter-agent-notes
description:
  Create, update, transition, reject, or archive Harapter Agent Notes for
  durable architecture, feature, compatibility, security, testing, and process
  decisions. Do not use for mechanical edits with no durable rationale.
---

# Harapter Agent Notes

Follow the [Agent Note standard](../../notes/README.md). Preserve one owner for
each decision and do not manufacture rationale after the fact.

## Find the owner

Search active notes, design documents, and current code for the decision. Update
the existing note if it already owns the problem. Create a new note only for a
distinct decision; cross-link partial supersessions.

## Choose lifecycle and class

- Use `proposed` when the decision needs review before implementation.
- Use `implemented` when recording a decision already present in the same change
  or repository.
- Use `rejected` only when retaining the proposal prevents a plausible repeated
  mistake; include the concise verdict on the status line.
- Archive only an implemented note whose rationale is no longer active guidance,
  after repairing every current inbound reference.

Choose exactly one class: `architecture`, `feature`, `compatibility`,
`security`, `testing`, or `process`.

## Write the record

Start from `TEMPLATE.md`. State the problem without assuming the answer. Record
the actual proposal or present-tense decision, genuine alternatives and why they
lost, and the accepted risks or consequences. Link current API details to their
owning design or README instead of copying them.

For a proposed-to-implemented transition, move the file without changing its
date, set `Status: implemented`, rewrite future proposal language as current
decision language, and replace acceptance-plan sections with consequences and
current verification facts. Do not edit an archived note.

Run `pnpm check`. The Agent Note validator must pass before review; a green
format check does not establish that the alternatives or consequences are
truthful.
