import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findForbiddenTextViolations,
  findProviderRuntimeLockfileViolations,
  findWorkspaceDirectories,
  listRepositoryFiles,
  validateProviderRuntimeBoundary,
  validateProviderRuntimePolicy,
  validateReleaseAutomation,
  validateToolchain,
  validateWorkspacePackageManifest,
} from './lib/repository-policy.mjs';
import { validateWorkflowActionPins } from './lib/workflow-actions.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'harapter-policy-checks-'));

const pinnedSha = '0123456789abcdef0123456789abcdef01234567';
const pinnedDigest = 'a'.repeat(64);
assert.deepEqual(
  validateWorkflowActionPins(
    `on:
  workflow_dispatch:
    inputs:
      uses:
        description: Select a backend
env:
  uses: ordinary-environment-value
jobs:
  test:
    steps:
      - uses: actions/checkout@${pinnedSha}
        with:
          uses: ordinary-step-input
      - uses:
          actions/setup-node@${pinnedSha}
      - uses: ./local-action
      - uses: docker://alpine@sha256:${pinnedDigest}
`,
    '.github/workflows/pinned.yml',
  ),
  [],
);
assert.deepEqual(
  validateWorkflowActionPins(
    `jobs:
  direct:
    uses: organization/repository/.github/workflows/reusable.yml@main
  test:
    steps:
      - uses: actions/checkout@main
      - uses:
          actions/setup-node@v6
      - uses: owner@unexpected/repository@${pinnedSha}
      - uses: docker://alpine:3.22
`,
    '.github/workflows/mutable.yml',
  ),
  [
    '.github/workflows/mutable.yml must pin organization/repository/.github/workflows/reusable.yml to a full commit SHA.',
    '.github/workflows/mutable.yml must pin actions/checkout to a full commit SHA.',
    '.github/workflows/mutable.yml must pin actions/setup-node to a full commit SHA.',
    '.github/workflows/mutable.yml contains an invalid third-party action reference.',
    '.github/workflows/mutable.yml must pin Docker step actions to an immutable SHA-256 digest.',
  ],
);
assert.deepEqual(
  validateWorkflowActionPins(
    `jobs:
  - steps:
      - uses: actions/checkout@main
`,
    '.github/workflows/jobs-array.yml',
  ),
  ['.github/workflows/jobs-array.yml must define jobs as a mapping.'],
);
assert.deepEqual(
  validateWorkflowActionPins(
    `jobs:
  test:
    steps:
      uses: actions/checkout@main
`,
    '.github/workflows/steps-mapping.yml',
  ),
  [
    '.github/workflows/steps-mapping.yml contains a job whose steps are not a sequence.',
  ],
);
const malformedYamlFailure = validateWorkflowActionPins(
  `jobs:
  test:
    secret-value: must-not-appear-in-errors
    steps: [
`,
  '.github/workflows/malformed.yml',
);
assert.equal(malformedYamlFailure.length, 1);
assert.match(malformedYamlFailure[0], /at line 5, column 1/u);
assert.doesNotMatch(malformedYamlFailure[0], /must-not-appear/u);

const ciWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/ci.yml'),
  'utf8',
);
assert.doesNotMatch(ciWorkflow, / {2}all-checks:/u);
assert.match(ciWorkflow, /inputs\.pr_branch != ''/u);
assert.match(ciWorkflow, /base-ref: .*inputs\.base_sha/u);
assert.match(ciWorkflow, /head-ref: .*inputs\.head_sha/u);
assert.match(ciWorkflow, / {2}pull_request:\n(?:.|\n)*? {6}- edited\n/u);
assert.equal(
  (ciWorkflow.match(/- name: Verify dispatched pull request head/gu) ?? [])
    .length,
  3,
);
assert.equal(
  (ciWorkflow.match(/test "\$ACTUAL_HEAD_SHA" = "\$EXPECTED_HEAD_SHA"/gu) ?? [])
    .length,
  3,
);

const releaseWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/release-please.yml'),
  'utf8',
);
assert.match(releaseWorkflow, /--repo "\$GITHUB_REPOSITORY"/u);
assert.match(releaseWorkflow, /-f pr_author="\$pr_author"/u);
assert.match(releaseWorkflow, /-f base_sha="\$base_sha"/u);
assert.match(releaseWorkflow, /-f head_sha="\$head_sha"/u);
assert.match(releaseWorkflow, /^\s{2}workflow_dispatch:/mu);
assert.doesNotMatch(releaseWorkflow, /^\s{2}push:/mu);
assert.match(releaseWorkflow, /if: github\.ref == 'refs\/heads\/main'/u);
assert.match(releaseWorkflow, /target-branch: main/u);

function write(path, content) {
  const absolutePath = resolve(fixtureRoot, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function run(script, argumentsList = []) {
  return spawnSync(process.execPath, [script, ...argumentsList], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: process.env,
  });
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(
      `${label} unexpectedly failed:\n${result.stderr}${result.stdout}`,
    );
  }
}

function requireFailure(result, expected, label) {
  const output = `${result.stderr}${result.stdout}`;
  if (result.status === 0 || !output.includes(expected)) {
    throw new Error(
      `${label} did not fail with ${JSON.stringify(expected)}:\n${output}`,
    );
  }
}

assert.deepEqual(
  validateToolchain({
    nodeVersion: '24.19.0\n',
    packageJson: {
      engines: { node: '>=24' },
      packageManager: 'pnpm@11.23.0',
    },
  }),
  [],
);
assert.deepEqual(
  validateToolchain({
    nodeVersion: '22\n',
    packageJson: {
      engines: { node: '>=22' },
      packageManager: 'pnpm@11.1.1',
    },
  }),
  [
    '.node-version must pin 24.19.0.',
    'package.json engines.node must be >=24.',
    'package.json must pin pnpm@11.23.0.',
  ],
);

assert.deepEqual(
  validateReleaseAutomation({
    prettierIgnore: 'node_modules\nCHANGELOG.md\n',
    releasePleaseConfig: {
      packages: { '.': { 'initial-version': '0.1.0' } },
    },
  }),
  [],
);
assert.deepEqual(
  validateReleaseAutomation({
    prettierIgnore: 'node_modules\n',
    releasePleaseConfig: {
      packages: { '.': { 'initial-version': '1.0.0' } },
    },
  }),
  [
    'release-please-config.json must set packages["."].initial-version to 0.1.0.',
    '.prettierignore must exclude Release Please-owned CHANGELOG.md.',
  ],
);

assert.deepEqual(
  findWorkspaceDirectories([
    'examples/basic/package.json',
    'packages/README.md',
    'packages/core/src/index.ts',
    'packages/core/test/index.test.ts',
    'providers/dsh/src/index.ts',
  ]),
  ['examples/basic', 'packages/core', 'providers/dsh'],
);
assert.deepEqual(
  validateWorkspacePackageManifest({
    manifestPath: 'packages/core/package.json',
    packageJson: { scripts: { build: 'tsc --build' } },
  }),
  [],
);
assert.deepEqual(
  validateWorkspacePackageManifest({
    manifestPath: 'providers/dsh/package.json',
    packageJson: { scripts: { build: '  ' } },
  }),
  ['providers/dsh/package.json must define a non-empty build script.'],
);

const providerRuntimePolicy = {
  hostOwnedRuntimePackages: [
    {
      packageName: '@deepseek-ai/dsh-sdk-client',
      lockfileFamilyPrefix: '@deepseek-ai/dsh',
    },
  ],
};
assert.deepEqual(validateProviderRuntimePolicy(providerRuntimePolicy), []);
assert.deepEqual(
  validateProviderRuntimePolicy({
    hostOwnedRuntimePackages: [
      {
        packageName: '',
        lockfileFamilyPrefix: '',
        unexpected: true,
      },
    ],
    unexpected: true,
  }),
  [
    'scripts/provider-runtime-policy.json contains unknown key unexpected.',
    'scripts/provider-runtime-policy.json hostOwnedRuntimePackages[0] contains unknown key unexpected.',
    'scripts/provider-runtime-policy.json hostOwnedRuntimePackages[0].packageName must be a non-empty string.',
    'scripts/provider-runtime-policy.json hostOwnedRuntimePackages[0].lockfileFamilyPrefix must be a non-empty string.',
  ],
);
assert.deepEqual(
  validateProviderRuntimeBoundary({
    manifestPath: 'providers/dsh/package.json',
    packageJson: {
      peerDependencies: {
        '@deepseek-ai/dsh-sdk-client': '>=0.1.0',
      },
      peerDependenciesMeta: {
        '@deepseek-ai/dsh-sdk-client': { optional: true },
      },
    },
    policy: providerRuntimePolicy,
  }),
  [],
);
assert.deepEqual(
  validateProviderRuntimeBoundary({
    manifestPath: 'providers/dsh/package.json',
    packageJson: {
      devDependencies: { '@deepseek-ai/dsh-sdk-client': '0.1.0' },
      peerDependencies: {
        '@deepseek-ai/dsh-sdk-client': '>=0.1.0',
      },
    },
    policy: providerRuntimePolicy,
  }),
  [
    'providers/dsh/package.json must not install host-owned runtime package @deepseek-ai/dsh-sdk-client through devDependencies.',
    'providers/dsh/package.json must mark host-owned runtime peer @deepseek-ai/dsh-sdk-client as optional.',
  ],
);
assert.deepEqual(
  findProviderRuntimeLockfileViolations({
    lockfile: `packages:\n\n  '@deepseek-ai/dsh-sdk-client@0.1.0':\n    resolution: {}\n`,
    lockfilePath: 'pnpm-lock.yaml',
    policy: providerRuntimePolicy,
  }),
  [
    'pnpm-lock.yaml must not resolve host-owned runtime family @deepseek-ai/dsh.',
  ],
);
assert.deepEqual(
  findProviderRuntimeLockfileViolations({
    lockfile: `packages:\n\n  "@deepseek-ai/dsh-sdk-client@0.1.0":\n    resolution: {}\n`,
    lockfilePath: 'pnpm-lock.yaml',
    policy: providerRuntimePolicy,
  }),
  [
    'pnpm-lock.yaml must not resolve host-owned runtime family @deepseek-ai/dsh.',
  ],
);
assert.deepEqual(
  findProviderRuntimeLockfileViolations({
    lockfile: `importers:\n\n  providers/dsh:\n    devDependencies:\n      dsh-runtime:\n        specifier: npm:@deepseek-ai/dsh-sdk-client@0.1.0\n        version: npm:@deepseek-ai/dsh-sdk-client@0.1.0\n`,
    lockfilePath: 'pnpm-lock.yaml',
    policy: providerRuntimePolicy,
  }),
  [
    'pnpm-lock.yaml must not resolve host-owned runtime family @deepseek-ai/dsh.',
  ],
);
assert.deepEqual(
  findProviderRuntimeLockfileViolations({
    lockfile: 'packages:\n\n  eslint@10.9.1:\n    resolution: {}\n',
    lockfilePath: 'pnpm-lock.yaml',
    policy: providerRuntimePolicy,
  }),
  [],
);
const malformedLockfileFailures = findProviderRuntimeLockfileViolations({
  lockfile: 'packages:\n  secret-value: [\n',
  lockfilePath: 'pnpm-lock.yaml',
  policy: providerRuntimePolicy,
});
assert.equal(malformedLockfileFailures.length, 1);
assert.match(malformedLockfileFailures[0], /at line 3, column 1/u);
assert.doesNotMatch(malformedLockfileFailures[0], /secret-value/u);

const repositoryFiles = listRepositoryFiles(repositoryRoot);
assert(repositoryFiles.includes('.github/dependabot.yml'));
assert(repositoryFiles.includes('scripts/check-repository.mjs'));

const repositoryCheckerFixtureRoot = mkdtempSync(
  join(repositoryRoot, '.harapter-repository-checks-'),
);
try {
  mkdirSync(resolve(repositoryCheckerFixtureRoot, 'scripts/lib'), {
    recursive: true,
  });
  for (const path of [
    'scripts/check-repository.mjs',
    'scripts/lib/repository-policy.mjs',
    'scripts/lib/workflow-actions.mjs',
  ]) {
    copyFileSync(
      resolve(repositoryRoot, path),
      resolve(repositoryCheckerFixtureRoot, path),
    );
  }

  const fixtureChecker = resolve(
    repositoryCheckerFixtureRoot,
    'scripts/check-repository.mjs',
  );
  requireFailure(
    spawnSync(process.execPath, [fixtureChecker], {
      cwd: repositoryCheckerFixtureRoot,
      encoding: 'utf8',
      env: process.env,
    }),
    'Missing required repository file: scripts/provider-runtime-policy.json',
    'Missing provider runtime policy case',
  );

  writeFileSync(
    resolve(
      repositoryCheckerFixtureRoot,
      'scripts/provider-runtime-policy.json',
    ),
    '{"hostOwnedRuntimePackages": [',
    'utf8',
  );
  requireFailure(
    spawnSync(process.execPath, [fixtureChecker], {
      cwd: repositoryCheckerFixtureRoot,
      encoding: 'utf8',
      env: process.env,
    }),
    'Invalid JSON in scripts/provider-runtime-policy.json:',
    'Malformed provider runtime policy case',
  );
} finally {
  rmSync(repositoryCheckerFixtureRoot, { recursive: true, force: true });
}

write(
  'src/provider.ts',
  `export const formerName = '${['Hi', 'Work'].join('')}';\n`,
);
assert.deepEqual(
  findForbiddenTextViolations(fixtureRoot, ['src/provider.ts']),
  ['src/provider.ts contains a forbidden former host-product name.'],
);

try {
  mkdirSync(resolve(fixtureRoot, 'scripts'), { recursive: true });
  for (const name of ['check-agent-notes.mjs', 'check-links.mjs']) {
    copyFileSync(
      resolve(repositoryRoot, 'scripts', name),
      resolve(fixtureRoot, 'scripts', name),
    );
  }

  const notePath =
    '.agents/notes/implemented/architecture/2026-08-26-test-decision.md';
  write(
    notePath,
    `# Agent Note: Test decision

Status: implemented

## Problem

The validator needs a valid fixture.

## Decision

The fixture uses the implemented format.

## Alternatives considered

### No fixture

That would not exercise the validator.

## Consequences

The positive path is deterministic.
`,
  );
  requireSuccess(
    run(resolve(fixtureRoot, 'scripts/check-agent-notes.mjs')),
    'Agent Note positive case',
  );

  write(notePath, readInvalidAgentNote());
  requireFailure(
    run(resolve(fixtureRoot, 'scripts/check-agent-notes.mjs')),
    'must use Status: implemented',
    'Agent Note negative case',
  );

  write('README.md', '[Target](target.md#target-heading)\n');
  write('target.md', '# Target Heading\n');
  requireSuccess(
    run(resolve(fixtureRoot, 'scripts/check-links.mjs')),
    'Link positive case',
  );

  write('README.md', '[Target](target.md#missing-heading)\n');
  requireFailure(
    run(resolve(fixtureRoot, 'scripts/check-links.mjs')),
    'missing anchor #missing-heading',
    'Link negative case',
  );

  write(
    'README.md',
    '[Missing](#not-a-real-heading)\n\n~~~text\n# Not a real heading\n~~~\n',
  );
  requireFailure(
    run(resolve(fixtureRoot, 'scripts/check-links.mjs')),
    'missing anchor #not-a-real-heading',
    'Tilde fence anchor negative case',
  );

  write('README.md', '[Malformed](target.md#bad%ZZ)\n');
  requireFailure(
    run(resolve(fixtureRoot, 'scripts/check-links.mjs')),
    'README.md: malformed percent-encoding in link target target.md#bad%ZZ',
    'Malformed link escape negative case',
  );

  const prChecker = resolve(repositoryRoot, 'scripts/check-pr-metadata.mjs');
  requireSuccess(
    run(prChecker, [
      '--title',
      'feat(dsh): add JSON-RPC client',
      '--body',
      'Implements the provider. Closes #12',
      '--branch',
      'feat/12-dsh-client',
      '--author',
      'contributor',
    ]),
    'Pull request metadata positive case',
  );
  requireFailure(
    run(prChecker, [
      '--title',
      'feat(dsh): add JSON-RPC client',
      '--body',
      'No linked issue.',
      '--branch',
      'feature/dsh-client',
      '--author',
      'contributor',
    ]),
    'Invalid task branch name',
    'Pull request metadata negative case',
  );
  requireFailure(
    run(prChecker, [
      '--title',
      'feat(dsh): add JSON-RPC client',
      '--body',
      'This remains unresolved #12.',
      '--branch',
      'feat/12-dsh-client',
      '--author',
      'contributor',
    ]),
    'feat and fix pull requests must close an issue',
    'Embedded issue keyword negative case',
  );
  requireSuccess(
    run(prChecker, [
      '--title',
      'chore(deps): bump actions/checkout',
      '--body',
      '',
      '--branch',
      'dependabot/npm_and_yarn/prettier-4',
      '--author',
      'dependabot[bot]',
    ]),
    'Dependabot metadata case',
  );
  requireSuccess(
    run(prChecker, [
      '--title',
      'feat(core)!: replace session identifiers',
      '--body',
      'Closes #24\n\n## Migration and breaking changes\n\nConsumers must store the new versioned session reference.',
      '--branch',
      'feat/24-versioned-session-reference',
      '--author',
      'contributor',
    ]),
    'Breaking metadata positive case',
  );
  requireFailure(
    run(prChecker, [
      '--title',
      'feat(core)!: replace session identifiers',
      '--body',
      'Closes #24\n\n## Migration and breaking changes\n\nNone.\n\n## Release impact\n\nMajor.',
      '--branch',
      'feat/24-versioned-session-reference',
      '--author',
      'contributor',
    ]),
    'Breaking pull requests must complete',
    'Breaking metadata negative case',
  );
  requireFailure(
    run(prChecker, [
      '--title',
      'feat(core): replace session identifiers',
      '--body',
      'Closes #24\n\n## Migration and breaking changes\n\nNone.\n\nBREAKING CHANGE: session identifiers are replaced.',
      '--branch',
      'feat/24-versioned-session-reference',
      '--author',
      'contributor',
    ]),
    'Breaking pull requests must complete',
    'Breaking footer metadata negative case',
  );
  requireSuccess(
    run(prChecker, [
      '--title',
      'chore(main): release harapter 0.1.0',
      '--body',
      '',
      '--branch',
      'release-please--branches--main',
      '--author',
      'github-actions[bot]',
    ]),
    'Release Please metadata case',
  );
  requireSuccess(
    run(prChecker, [
      '--title',
      'chore(main): release harapter 0.1.0',
      '--body',
      '',
      '--branch',
      'release-please--branches--main--components--harapter',
      '--author',
      'app/github-actions',
    ]),
    'Release Please GitHub App metadata case',
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('Policy validator self-tests passed.');

function readInvalidAgentNote() {
  return `# Agent Note: Test decision

Status: proposed

## Problem

The validator needs an invalid fixture.

## Decision

The lifecycle and status disagree.

## Alternatives considered

### No fixture

That would not exercise the negative path.

## Consequences

The validator must reject this file.
`;
}
