import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const expectedNodeVersion = '24.19.0';
const expectedNodeRange = '>=24';
const expectedPackageManager = 'pnpm@11.23.0';

const forbiddenTextPatterns = [
  { pattern: /\x48\x69\x57\x6f\x72\x6b/iu, label: 'former host-product name' },
  { pattern: /Harness[ -]Adapter/iu, label: 'former project name' },
  { pattern: /\/Users\//u, label: 'local absolute path' },
];

export function validateToolchain({ nodeVersion, packageJson }) {
  const failures = [];

  if (nodeVersion.trim() !== expectedNodeVersion) {
    failures.push(`.node-version must pin ${expectedNodeVersion}.`);
  }
  if (packageJson.engines?.node !== expectedNodeRange) {
    failures.push(`package.json engines.node must be ${expectedNodeRange}.`);
  }
  if (packageJson.packageManager !== expectedPackageManager) {
    failures.push(`package.json must pin ${expectedPackageManager}.`);
  }

  return failures;
}

export function listRepositoryFiles(repositoryRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );

  return output.split('\0').filter(Boolean).sort();
}

export function findForbiddenTextViolations(repositoryRoot, paths) {
  const failures = [];

  for (const path of paths) {
    const absolutePath = resolve(repositoryRoot, path);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const buffer = readFileSync(absolutePath);
    if (buffer.includes(0)) {
      continue;
    }

    const content = buffer.toString('utf8');
    for (const { pattern, label } of forbiddenTextPatterns) {
      if (pattern.test(content)) {
        const displayPath = relative(repositoryRoot, absolutePath)
          .split(sep)
          .join('/');
        failures.push(`${displayPath} contains a forbidden ${label}.`);
      }
    }
  }

  return failures;
}
