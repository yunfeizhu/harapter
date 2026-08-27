# Harapter Agent Notes

Agent Notes are durable decision records written for maintainers and coding
agents. They preserve the problem, decision or proposal, real alternatives, and
consequences that source code and reference documentation cannot explain on
their own.

## When a note is required

Every non-trivial change adds or updates an Agent Note in the same pull request
when it changes one or more of the following:

- portable API, schema, or error semantics;
- session, run, event, interaction, cancellation, or disposal lifecycle;
- package, transport, provider, or host ownership boundaries;
- provider acceptance, compatibility range, protocol detection, or capability
  evidence;
- authentication, redaction, process, filesystem, network, or data security;
- conformance, fixture, live-test, or compatibility-testing strategy;
- contributor workflow, release policy, publication, or repository governance.

Update an existing note when it already owns the decision. Do not create a
second record just because the implementation changed location. Mechanical
formatting, typo correction, dependency refresh, and local refactoring are
exempt only when they do not alter a durable decision or its consequences.

## Path and lifecycle

Each note path is:

```text
.agents/notes/<lifecycle>/<class>/YYYY-MM-DD-short-kebab-title.md
```

Lifecycle is a closed set:

- `proposed`: reviewed before implementation; may describe future behavior and
  acceptance criteria;
- `implemented`: describes a decision that is present in the repository or
  shipped behavior and remains current with it;
- `rejected`: preserves a considered proposal only while its rationale prevents
  a plausible repeated mistake;
- `archived`: a frozen implemented record whose rationale is no longer active
  guidance but remains useful history.

Class is a closed set:

- `architecture`: source structure, ownership, and package relationships;
- `feature`: product- or model-visible capability decisions;
- `compatibility`: provider ranges, protocol behavior, migrations, and support
  evidence;
- `security`: trust, permissions, isolation, redaction, and data handling;
- `testing`: test strategy, fixtures, conformance, and evidence policy;
- `process`: development, automation, release, publication, and governance.

The filename date is the date the topic was first recorded. Moving a note
between lifecycle directories does not change the date or class.

## Required format

The first lines are:

```markdown
# Agent Note: Concise title

Status: proposed
```

Every note begins its body with `## Problem` and contains
`## Alternatives considered`.

A proposed note uses:

```text
## Problem
## Proposal
## Alternatives considered
## Acceptance criteria
## Risks
```

An implemented note uses present-tense language and:

```text
## Problem
## Decision
## Alternatives considered
## Consequences
```

A rejected note keeps its proposal sections and uses:

```text
Status: rejected — concise reason
```

An archived note keeps `Status: implemented`, adds `Archived: YYYY-MM-DD`
immediately below it, and is never edited again. Current documentation must not
treat an archived note as authority.

## Content rules

- State the problem without assuming the chosen solution.
- Record only alternatives that were genuinely considered. Explain why each
  lost; do not invent straw alternatives after implementation.
- An implemented note describes current reality, not an implementation plan or
  pull request chronology.
- Consequences cover both benefits and costs, including capability given up,
  compatibility impact, and required verification.
- Keep detailed current API definitions in design documents or package READMEs.
  Link them rather than duplicating them in the note.
- Cross-reference repository files with relative Markdown links so link checks
  can verify them.
- A fully superseded note may move to `archived` only after current guidance and
  inbound links point to the new owner.

Start from [TEMPLATE.md](TEMPLATE.md), choose the correct lifecycle and class,
then run `pnpm check`. The
[Harapter Agent Notes skill](../skills/harapter-agent-notes/SKILL.md) owns the
creation and transition workflow.
