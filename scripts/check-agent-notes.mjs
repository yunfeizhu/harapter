import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const notesRoot = resolve(repositoryRoot, '.agents/notes');
const lifecycles = new Set(['proposed', 'implemented', 'rejected', 'archived']);
const classes = new Set([
  'architecture',
  'feature',
  'compatibility',
  'security',
  'testing',
  'process',
]);
const failures = [];
const noteFiles = [];
const titles = new Map();
let validatedNotes = 0;

function collectMarkdown(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      collectMarkdown(path);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      noteFiles.push(path);
    }
  }
}

function sectionsIn(content) {
  const headings = [...content.matchAll(/^## (.+)$/gmu)];
  return headings.map((match, index) => ({
    name: match[1].trim(),
    body: content
      .slice(match.index + match[0].length, headings[index + 1]?.index)
      .trim(),
    index: match.index,
  }));
}

function requireOrderedSections(path, sections, names) {
  let previousIndex = -1;
  for (const name of names) {
    const section = sections.find((candidate) => candidate.name === name);
    if (!section) {
      failures.push(`${path} is missing required section: ## ${name}`);
      continue;
    }
    if (section.body.length === 0) {
      failures.push(`${path} has an empty section: ## ${name}`);
    }
    if (section.index < previousIndex) {
      failures.push(`${path} has ## ${name} out of order.`);
    }
    previousIndex = section.index;
  }
}

if (!existsSync(notesRoot)) {
  failures.push('Missing .agents/notes directory.');
} else {
  collectMarkdown(notesRoot);
}

for (const file of noteFiles) {
  const path = relative(notesRoot, file);
  if (path === 'AGENTS.md' || path === 'README.md' || path === 'TEMPLATE.md') {
    continue;
  }

  const parts = path.split('/');
  if (parts.length !== 3) {
    failures.push(`${path} must use <lifecycle>/<class>/<filename>.`);
    continue;
  }

  const [lifecycle, noteClass, filename] = parts;
  if (!lifecycles.has(lifecycle)) {
    failures.push(`${path} uses unknown lifecycle: ${lifecycle}`);
  }
  if (!classes.has(noteClass)) {
    failures.push(`${path} uses unknown class: ${noteClass}`);
  }

  const filenameMatch = filename.match(
    /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u,
  );
  if (!filenameMatch) {
    failures.push(`${path} must use YYYY-MM-DD-short-kebab-title.md.`);
  } else {
    const parsedDate = new Date(`${filenameMatch[1]}T00:00:00Z`);
    if (
      Number.isNaN(parsedDate.valueOf()) ||
      parsedDate.toISOString().slice(0, 10) !== filenameMatch[1]
    ) {
      failures.push(`${path} contains an invalid calendar date.`);
    }
  }

  const content = readFileSync(file, 'utf8');
  const header = content.match(
    /^# Agent Note: ([^\n]+)\n\nStatus: ([^\n]+)(?:\nArchived: (\d{4}-\d{2}-\d{2}))?\n/u,
  );
  if (!header) {
    failures.push(`${path} has an invalid Agent Note header.`);
    continue;
  }

  validatedNotes += 1;

  const [, title, status, archivedDate] = header;
  if (titles.has(title)) {
    failures.push(`${path} duplicates title from ${titles.get(title)}.`);
  } else {
    titles.set(title, path);
  }

  if (lifecycle === 'proposed' && status !== 'proposed') {
    failures.push(`${path} must use Status: proposed.`);
  }
  if (lifecycle === 'implemented' && status !== 'implemented') {
    failures.push(`${path} must use Status: implemented.`);
  }
  if (lifecycle === 'rejected' && !/^rejected — .+/u.test(status)) {
    failures.push(`${path} must use Status: rejected — <reason>.`);
  }
  if (lifecycle === 'archived') {
    if (status !== 'implemented') {
      failures.push(`${path} must retain Status: implemented when archived.`);
    }
    if (!archivedDate) {
      failures.push(`${path} must include Archived: YYYY-MM-DD.`);
    }
  } else if (archivedDate) {
    failures.push(`${path} has Archived metadata outside archived/.`);
  }

  const sections = sectionsIn(content);
  if (lifecycle === 'proposed') {
    requireOrderedSections(path, sections, [
      'Problem',
      'Proposal',
      'Alternatives considered',
      'Acceptance criteria',
      'Risks',
    ]);
  } else if (lifecycle === 'implemented' || lifecycle === 'archived') {
    requireOrderedSections(path, sections, [
      'Problem',
      'Decision',
      'Alternatives considered',
      'Consequences',
    ]);
    for (const forbidden of [
      'Proposal',
      'Plan',
      'Acceptance criteria',
      'Risks',
    ]) {
      if (sections.some((section) => section.name === forbidden)) {
        failures.push(`${path} uses proposal-only section: ## ${forbidden}`);
      }
    }
  } else if (lifecycle === 'rejected') {
    requireOrderedSections(path, sections, [
      'Problem',
      'Proposal',
      'Alternatives considered',
    ]);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${validatedNotes} active or archived Agent Notes.`);
