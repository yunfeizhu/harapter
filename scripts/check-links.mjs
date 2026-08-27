import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);
const markdownFiles = [];
const anchorsByFile = new Map();

function collectMarkdownFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(path);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      markdownFiles.push(path);
    }
  }
}

function githubSlug(heading) {
  return heading
    .replace(/<[^>]+>/gu, '')
    .replace(/\[(.+?)\]\([^)]+\)/gu, '$1')
    .replace(/[`*_~]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/gu, '-');
}

function anchorsFor(file) {
  if (anchorsByFile.has(file)) {
    return anchorsByFile.get(file);
  }

  const anchors = new Set();
  const slugCounts = new Map();
  let fence = null;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (!fence && fenceMatch) {
      fence = { marker: fenceMatch[1][0], width: fenceMatch[1].length };
      continue;
    }
    if (fence) {
      const closingFence = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/u)?.[1];
      if (
        closingFence?.[0] === fence.marker &&
        closingFence.length >= fence.width
      ) {
        fence = null;
      }
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/u)?.[1];
    if (!heading) {
      continue;
    }
    const baseSlug = githubSlug(heading);
    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);
    anchors.add(count === 0 ? baseSlug : `${baseSlug}-${count}`);
  }

  anchorsByFile.set(file, anchors);
  return anchors;
}

collectMarkdownFiles(repositoryRoot);

const failures = [];
const markdownLinkPattern = /!?\[.*?\]\(([^)]+)\)/gu;

function decodeLinkComponent(value, file, target) {
  try {
    return decodeURIComponent(value);
  } catch {
    failures.push(
      `${relative(repositoryRoot, file)}: malformed percent-encoding in link target ${target}`,
    );
    return null;
  }
}

for (const file of markdownFiles) {
  const content = readFileSync(file, 'utf8');

  for (const match of content.matchAll(markdownLinkPattern)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) {
      target = target.slice(1, -1);
    }
    target = target.split(/\s+["']/u, 1)[0];

    if (target === '' || /^(?:https?:|mailto:|data:)/iu.test(target)) {
      continue;
    }

    const [rawPathPart, rawFragment] = target.split('#', 2);
    const pathPart = decodeLinkComponent(
      rawPathPart.split(/[?]/u, 1)[0],
      file,
      target,
    );
    if (pathPart === null) {
      continue;
    }
    const resolvedTarget =
      pathPart === ''
        ? file
        : pathPart.startsWith('/')
          ? resolve(repositoryRoot, `.${pathPart}`)
          : resolve(dirname(file), pathPart);

    if (!existsSync(resolvedTarget)) {
      failures.push(
        `${relative(repositoryRoot, file)}: missing local link target ${target}`,
      );
      continue;
    }

    if (pathPart.endsWith('/') && !statSync(resolvedTarget).isDirectory()) {
      failures.push(
        `${relative(repositoryRoot, file)}: expected directory for ${target}`,
      );
    }

    if (rawFragment && statSync(resolvedTarget).isFile()) {
      const decodedFragment = decodeLinkComponent(rawFragment, file, target);
      if (decodedFragment === null) {
        continue;
      }
      const fragment = decodedFragment.toLowerCase();
      if (!anchorsFor(resolvedTarget).has(fragment)) {
        failures.push(
          `${relative(repositoryRoot, file)}: missing anchor #${rawFragment} in ${relative(repositoryRoot, resolvedTarget)}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Checked local links and anchors in ${markdownFiles.length} Markdown files.`,
);
