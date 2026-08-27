import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredGuides = [
  '.agents/AGENTS.md',
  '.agents/notes/AGENTS.md',
  '.agents/skills/AGENTS.md',
  '.github/AGENTS.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/AGENTS.md',
  'examples/AGENTS.md',
  'fixtures/AGENTS.md',
  'packages/AGENTS.md',
  'providers/AGENTS.md',
  'scripts/AGENTS.md',
];
const requiredSkills = new Set([
  'harapter-agent-notes',
  'harapter-code-review',
  'harapter-pre-push',
  'harapter-provider-implementation',
  'harapter-release',
]);
const failures = [];

for (const path of requiredGuides) {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    failures.push(`Missing required Agent guide: ${path}`);
    continue;
  }

  const content = readFileSync(absolutePath, 'utf8');
  if (!content.endsWith('\n') || content.endsWith('\n\n')) {
    failures.push(`${path} must end with exactly one trailing newline.`);
  }
  if (/\[TODO|TODO:|REPLACE_ME/u.test(content)) {
    failures.push(`${path} contains unfinished guidance.`);
  }
}

const skillRoot = resolve(repositoryRoot, '.agents/skills');
if (!existsSync(skillRoot)) {
  failures.push('Missing .agents/skills directory.');
} else {
  const skillDirectories = readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const requiredSkill of requiredSkills) {
    if (!skillDirectories.includes(requiredSkill)) {
      failures.push(`Missing required Agent skill: ${requiredSkill}`);
    }
  }

  for (const skillName of skillDirectories) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skillName)) {
      failures.push(`Invalid skill directory name: ${skillName}`);
      continue;
    }

    const skillDirectory = resolve(skillRoot, skillName);
    const skillPath = resolve(skillDirectory, 'SKILL.md');
    const metadataPath = resolve(skillDirectory, 'agents/openai.yaml');

    if (!existsSync(skillPath)) {
      failures.push(`Missing ${relative(repositoryRoot, skillPath)}.`);
      continue;
    }
    if (!existsSync(metadataPath)) {
      failures.push(`Missing ${relative(repositoryRoot, metadataPath)}.`);
      continue;
    }

    const skill = readFileSync(skillPath, 'utf8');
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/u)?.[1];
    if (!frontmatter) {
      failures.push(
        `${relative(repositoryRoot, skillPath)} has invalid frontmatter.`,
      );
      continue;
    }

    const declaredName = frontmatter.match(/^name:\s*([^\n]+)$/mu)?.[1].trim();
    const description = frontmatter
      .match(/^description:\s*([^\n]+)$/mu)?.[1]
      .trim()
      .replace(/^['"]|['"]$/gu, '');

    if (declaredName !== skillName) {
      failures.push(
        `${relative(repositoryRoot, skillPath)} declares ${declaredName ?? 'no name'} instead of ${skillName}.`,
      );
    }
    if (
      !description ||
      description.length < 50 ||
      /\[TODO|TODO:|REPLACE_ME/u.test(description)
    ) {
      failures.push(
        `${relative(repositoryRoot, skillPath)} needs a discriminating description of at least 50 characters.`,
      );
    }

    const metadata = readFileSync(metadataPath, 'utf8');
    if (!/^interface:\n/mu.test(metadata)) {
      failures.push(
        `${relative(repositoryRoot, metadataPath)} is missing interface metadata.`,
      );
    }
    if (!metadata.includes(`$${skillName}`)) {
      failures.push(
        `${relative(repositoryRoot, metadataPath)} default_prompt must mention $${skillName}.`,
      );
    }
    if (
      /\[TODO|TODO:|REPLACE_ME/u.test(skill) ||
      /\[TODO|TODO:|REPLACE_ME/u.test(metadata)
    ) {
      failures.push(
        `${relative(repositoryRoot, skillDirectory)} contains scaffold text.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${requiredGuides.length} Agent guides and ${requiredSkills.size} required skills.`,
);
