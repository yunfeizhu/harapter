# Harapter Skill Authoring Guide

These rules supplement the repository-wide [Agent Guide](../../AGENTS.md) for
versioned Skills under `.agents/skills/`.

- Give each Skill a narrow, discriminating name and description that states when
  it applies and prevents likely misrouting.
- Assume the agent is capable. Include Harapter-specific decisions, fragile
  mechanics, evidence selection, safety boundaries, and stopping conditions;
  omit generic coding tutorials.
- Keep `SKILL.md` concise. Put substantial conditional detail in a referenced
  resource only when progressive disclosure reduces irrelevant context.
- Link repository authority instead of copying architecture, provider, fixture,
  release, or Agent Note rules into every Skill.
- Preserve user scope and authorization. Skills that can lead to commit, push,
  merge, publish, tag, or settings changes require authorization immediately
  before the mutation.
- Keep `agents/openai.yaml` consistent with the Skill name and behavior. Default
  prompts mention `$<skill-name>` explicitly.
- Validate every new or materially changed Skill with the repository Agent
  checks and the available `skill-creator` validator. Test deterministic helper
  scripts through observable positive and negative cases.
