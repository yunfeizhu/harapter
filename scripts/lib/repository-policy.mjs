import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { JSON_SCHEMA, load } from 'js-yaml';

const expectedNodeVersion = '24.19.0';
const expectedNodeRange = '>=24';
const expectedPackageManager = 'pnpm@11.23.0';

const forbiddenTextPatterns = [
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

export function validateReleaseAutomation({
  prettierIgnore,
  publicPackagePolicy,
  releasePleaseConfig,
}) {
  const failures = [];
  const rootRelease = releasePleaseConfig.packages?.['.'];

  if (rootRelease?.['initial-version'] !== '0.1.0') {
    failures.push(
      'release-please-config.json must set packages["."].initial-version to 0.1.0.',
    );
  }
  if (rootRelease?.['release-type'] !== 'simple') {
    failures.push(
      'release-please-config.json must keep one simple root release train.',
    );
  }
  const expectedVersionFiles = new Set([
    'package.json',
    ...(Array.isArray(publicPackagePolicy?.packages)
      ? publicPackagePolicy.packages
          .filter(isMapping)
          .filter(({ path }) => typeof path === 'string')
          .map(({ path }) => `${path}/package.json`)
      : []),
  ]);
  const actualVersionFiles = new Set();
  if (Array.isArray(rootRelease?.['extra-files'])) {
    for (const entry of rootRelease['extra-files']) {
      if (
        isMapping(entry) &&
        entry.type === 'json' &&
        entry.jsonpath === '$.version' &&
        typeof entry.path === 'string'
      ) {
        actualVersionFiles.add(entry.path);
      }
    }
  }
  for (const path of expectedVersionFiles) {
    if (!actualVersionFiles.has(path)) {
      failures.push(
        `release-please-config.json must update ${path} on every release.`,
      );
    }
  }
  for (const path of actualVersionFiles) {
    if (!expectedVersionFiles.has(path)) {
      failures.push(
        `release-please-config.json contains unknown release version file ${path}.`,
      );
    }
  }

  const ignoredPaths = new Set(
    prettierIgnore
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  );
  if (!ignoredPaths.has('CHANGELOG.md')) {
    failures.push(
      '.prettierignore must exclude Release Please-owned CHANGELOG.md.',
    );
  }

  return failures;
}

export function findWorkspaceDirectories(paths) {
  return [
    ...new Set(
      paths.flatMap((path) => {
        const match = path.match(/^(examples|packages|providers)\/([^/]+)\//u);
        return match ? [`${match[1]}/${match[2]}`] : [];
      }),
    ),
  ].sort();
}

export function validateWorkspacePackageManifest({
  manifestPath,
  packageJson,
}) {
  if (
    typeof packageJson.scripts?.build !== 'string' ||
    packageJson.scripts.build.trim() === ''
  ) {
    return [`${manifestPath} must define a non-empty build script.`];
  }

  return [];
}

export function validateProviderRuntimePolicy(policy) {
  const failures = [];
  if (
    typeof policy !== 'object' ||
    policy === null ||
    Array.isArray(policy) ||
    !Array.isArray(policy.hostOwnedRuntimePackages)
  ) {
    return [
      'scripts/provider-runtime-policy.json must define hostOwnedRuntimePackages as an array.',
    ];
  }

  const allowedRootKeys = new Set(['hostOwnedRuntimePackages']);
  for (const key of Object.keys(policy)) {
    if (!allowedRootKeys.has(key)) {
      failures.push(
        `scripts/provider-runtime-policy.json contains unknown key ${key}.`,
      );
    }
  }

  const packageNames = new Set();
  for (const [index, entry] of policy.hostOwnedRuntimePackages.entries()) {
    const label = `scripts/provider-runtime-policy.json hostOwnedRuntimePackages[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      failures.push(`${label} must be an object.`);
      continue;
    }
    const allowedEntryKeys = new Set(['lockfileFamilyPrefix', 'packageName']);
    for (const key of Object.keys(entry)) {
      if (!allowedEntryKeys.has(key)) {
        failures.push(`${label} contains unknown key ${key}.`);
      }
    }
    if (
      typeof entry.packageName !== 'string' ||
      entry.packageName.length === 0
    ) {
      failures.push(`${label}.packageName must be a non-empty string.`);
    } else if (packageNames.has(entry.packageName)) {
      failures.push(`${label}.packageName must be unique.`);
    } else {
      packageNames.add(entry.packageName);
    }
    if (
      typeof entry.lockfileFamilyPrefix !== 'string' ||
      entry.lockfileFamilyPrefix.length === 0
    ) {
      failures.push(
        `${label}.lockfileFamilyPrefix must be a non-empty string.`,
      );
    }
  }

  return failures;
}

export function validateProviderRuntimeBoundary({
  manifestPath,
  packageJson,
  policy,
}) {
  const failures = [];
  const installSections = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ];
  const bundled = new Set([
    ...(Array.isArray(packageJson.bundleDependencies)
      ? packageJson.bundleDependencies
      : []),
    ...(Array.isArray(packageJson.bundledDependencies)
      ? packageJson.bundledDependencies
      : []),
  ]);

  for (const { packageName } of policy.hostOwnedRuntimePackages) {
    for (const section of installSections) {
      if (Object.hasOwn(packageJson[section] ?? {}, packageName)) {
        failures.push(
          `${manifestPath} must not install host-owned runtime package ${packageName} through ${section}.`,
        );
      }
    }
    if (bundled.has(packageName)) {
      failures.push(
        `${manifestPath} must not bundle host-owned runtime package ${packageName}.`,
      );
    }
    const peerDeclared = Object.hasOwn(
      packageJson.peerDependencies ?? {},
      packageName,
    );
    const peerMetadata = packageJson.peerDependenciesMeta?.[packageName];
    if (peerDeclared && peerMetadata?.optional !== true) {
      failures.push(
        `${manifestPath} must mark host-owned runtime peer ${packageName} as optional.`,
      );
    }
    if (!peerDeclared && peerMetadata !== undefined) {
      failures.push(
        `${manifestPath} must not define metadata for undeclared runtime peer ${packageName}.`,
      );
    }
  }

  return failures;
}

export function findProviderRuntimeLockfileViolations({
  lockfile,
  lockfilePath,
  policy,
}) {
  let parsedLockfile;
  try {
    parsedLockfile = load(lockfile, { schema: JSON_SCHEMA });
  } catch (error) {
    const location =
      Number.isInteger(error?.mark?.line) &&
      Number.isInteger(error?.mark?.column)
        ? ` at line ${String(error.mark.line + 1)}, column ${String(error.mark.column + 1)}`
        : '';
    return [`Invalid YAML in ${lockfilePath}${location}.`];
  }

  if (!isMapping(parsedLockfile)) {
    return [`${lockfilePath} must contain a lockfile mapping.`];
  }

  const lockfileReferences = [];
  for (const sectionName of ['packages', 'snapshots']) {
    const section = parsedLockfile[sectionName];
    if (section === undefined) {
      continue;
    }
    if (!isMapping(section)) {
      return [`${lockfilePath} ${sectionName} must be a mapping.`];
    }
    lockfileReferences.push(...Object.keys(section));
  }
  collectLockfileAliases(parsedLockfile.importers, lockfileReferences);

  return policy.hostOwnedRuntimePackages.flatMap(({ lockfileFamilyPrefix }) =>
    lockfileReferences.some((reference) =>
      matchesRuntimeFamily(reference, lockfileFamilyPrefix),
    )
      ? [
          `${lockfilePath} must not resolve host-owned runtime family ${lockfileFamilyPrefix}.`,
        ]
      : [],
  );
}

function collectLockfileAliases(importers, output) {
  if (!isMapping(importers)) {
    return;
  }

  for (const importer of Object.values(importers)) {
    if (!isMapping(importer)) {
      continue;
    }
    for (const sectionName of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ]) {
      const section = importer[sectionName];
      if (!isMapping(section)) {
        continue;
      }
      for (const [dependencyName, resolution] of Object.entries(section)) {
        output.push(dependencyName);
        if (typeof resolution === 'string') {
          output.push(resolution);
          continue;
        }
        if (isMapping(resolution)) {
          for (const field of ['specifier', 'version']) {
            if (typeof resolution[field] === 'string') {
              output.push(resolution[field]);
            }
          }
        }
      }
    }
  }
}

function matchesRuntimeFamily(reference, familyPrefix) {
  const normalized = reference.replace(/^\//u, '').replace(/^npm:/u, '');
  return (
    normalized.startsWith(`${familyPrefix}@`) ||
    normalized.startsWith(`${familyPrefix}-`)
  );
}

function isMapping(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
