import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findForbiddenTextViolations,
  findWorkspaceDirectories,
  listRepositoryFiles,
  validateReleaseAutomation,
  validateToolchain,
  validateWorkspacePackageManifest,
} from './lib/repository-policy.mjs';
import { validateWorkflowActionPins } from './lib/workflow-actions.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredPaths = [
  '.agents/AGENTS.md',
  '.agents/notes/AGENTS.md',
  '.agents/notes/README.md',
  '.agents/notes/TEMPLATE.md',
  '.agents/skills/harapter-agent-notes/SKILL.md',
  '.agents/skills/harapter-code-review/SKILL.md',
  '.agents/skills/harapter-pre-push/SKILL.md',
  '.agents/skills/harapter-provider-implementation/SKILL.md',
  '.agents/skills/harapter-release/SKILL.md',
  '.agents/skills/AGENTS.md',
  '.github/AGENTS.md',
  '.github/ISSUE_TEMPLATE/bug-report.yml',
  '.github/ISSUE_TEMPLATE/design-proposal.yml',
  '.github/ISSUE_TEMPLATE/provider-request.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/release-please.yml',
  '.prettierignore',
  'eslint.config.mjs',
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'RELEASING.md',
  'SECURITY.md',
  'SUPPORT.md',
  'docs/AGENTS.md',
  'docs/design/README.md',
  'docs/development.md',
  'examples/AGENTS.md',
  'fixtures/AGENTS.md',
  'packages/AGENTS.md',
  'providers/AGENTS.md',
  'release-please-config.json',
  'scripts/AGENTS.md',
  'scripts/check-agent-guidance.mjs',
  'scripts/check-agent-notes.mjs',
  'scripts/check-doc-budgets.mjs',
  'scripts/check-pr-metadata.mjs',
  'scripts/doc-budgets.json',
  'scripts/lib/repository-policy.mjs',
  'scripts/lib/workflow-actions.mjs',
  'scripts/test-policy-checks.mjs',
  'tsconfig.base.json',
  'tsconfig.json',
  'version.txt',
  'vitest.config.ts',
];

const failures = [];

for (const path of requiredPaths) {
  if (!existsSync(resolve(repositoryRoot, path))) {
    failures.push(`Missing required repository file: ${path}`);
  }
}

for (const path of [
  'package.json',
  'release-please-config.json',
  '.release-please-manifest.json',
  'scripts/doc-budgets.json',
]) {
  try {
    JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8'));
  } catch (error) {
    failures.push(`Invalid JSON in ${path}: ${error.message}`);
  }
}

const packageJson = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
);
const releasePleaseConfig = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'release-please-config.json'), 'utf8'),
);
failures.push(
  ...validateToolchain({
    nodeVersion: readFileSync(resolve(repositoryRoot, '.node-version'), 'utf8'),
    packageJson,
  }),
);
failures.push(
  ...validateReleaseAutomation({
    prettierIgnore: readFileSync(
      resolve(repositoryRoot, '.prettierignore'),
      'utf8',
    ),
    releasePleaseConfig,
  }),
);

for (const script of [
  'build',
  'check',
  'check:agents',
  'check:code',
  'check:agent-guidance',
  'check:agent-notes',
  'check:doc-budgets',
  'check:links',
  'check:pr-metadata',
  'check:policy-tests',
  'check:repository',
  'lint',
  'lint:fix',
  'test',
  'test:coverage',
  'test:watch',
  'typecheck',
]) {
  if (typeof packageJson.scripts?.[script] !== 'string') {
    failures.push(`package.json is missing required script: ${script}`);
  }
}

function collectFiles(path, predicate, output) {
  if (!existsSync(path)) {
    return;
  }
  const entries = readdirSync(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      collectFiles(child, predicate, output);
    } else if (entry.isFile() && predicate(entry.name)) {
      output.push(child);
    }
  }
}

const repositoryFiles = listRepositoryFiles(repositoryRoot);
failures.push(...findForbiddenTextViolations(repositoryRoot, repositoryFiles));

for (const directory of findWorkspaceDirectories(repositoryFiles)) {
  const manifestPath = `${directory}/package.json`;
  const absoluteManifestPath = resolve(repositoryRoot, manifestPath);
  if (!existsSync(absoluteManifestPath)) {
    failures.push(`${directory} must define package.json.`);
    continue;
  }

  try {
    const workspacePackageJson = JSON.parse(
      readFileSync(absoluteManifestPath, 'utf8'),
    );
    failures.push(
      ...validateWorkspacePackageManifest({
        manifestPath,
        packageJson: workspacePackageJson,
      }),
    );
  } catch (error) {
    failures.push(`Invalid JSON in ${manifestPath}: ${error.message}`);
  }
}

const workflowFiles = [];
collectFiles(
  resolve(repositoryRoot, '.github/workflows'),
  (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
  workflowFiles,
);

for (const file of workflowFiles) {
  const content = readFileSync(file, 'utf8');
  failures.push(
    ...validateWorkflowActionPins(content, relative(repositoryRoot, file)),
  );
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  'Repository structure, documentation, and workflow pins are consistent.',
);
