import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  executeRegistryPublication,
  parseRegistryDistTagListing,
  validatePackedFiles,
  validatePublicPackagePolicy,
  validateRegistryAudit,
  waitForRegistryAvailability,
  validateRegistryDistribution,
  validateRegistryDistTag,
  validateReleaseVersion,
} from './lib/package-publication.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...argumentsList] = process.argv.slice(2);
if (!['publish', 'verify'].includes(command)) {
  fail(
    'Usage: publish-packages.mjs <verify|publish> --version X.Y.Z [--artifacts-dir PATH] [--bootstrap].',
  );
}
const options = parseArguments(argumentsList);
const version = options.get('version');
const bootstrap = options.has('bootstrap');
const artifactsDirectoryOption = options.get('artifacts-dir');
if (command === 'publish' && typeof artifactsDirectoryOption !== 'string') {
  fail('--artifacts-dir is required for publication.');
}
if (command === 'verify' && artifactsDirectoryOption !== undefined) {
  fail('--artifacts-dir is only valid for publication.');
}
const artifactsDirectory =
  typeof artifactsDirectoryOption === 'string'
    ? resolve(repositoryRoot, artifactsDirectoryOption)
    : undefined;
const bootstrapToken = bootstrap ? process.env.NODE_AUTH_TOKEN : undefined;
const childEnvironment = { ...process.env };
delete childEnvironment.NODE_AUTH_TOKEN;
delete childEnvironment.NPM_AUTH_TOKEN;
delete childEnvironment.NPM_TOKEN;
const versionFailures = validateReleaseVersion(version, { bootstrap });
if (versionFailures.length > 0) {
  fail(versionFailures.join('\n'));
}

const policy = readJson(
  resolve(repositoryRoot, 'scripts/public-packages.json'),
);
const policyFailures = validatePublicPackagePolicy(policy);
if (policyFailures.length > 0) {
  fail(policyFailures.join('\n'));
}
const entries = policy.packages;
const registryQueryTimeoutMilliseconds =
  policy.registryAvailability.queryTimeoutSeconds * 1_000;
const rootVersion = readFileSync(
  resolve(repositoryRoot, 'version.txt'),
  'utf8',
).trim();
if (rootVersion !== version) {
  fail(`version.txt does not match release ${version}.`);
}
for (const entry of entries) {
  const packageJson = readJson(
    resolve(repositoryRoot, entry.path, 'package.json'),
  );
  if (packageJson.version !== version) {
    fail(`${entry.name} does not match release ${version}.`);
  }
}
if (command === 'verify') {
  console.log(
    `Verified ${String(entries.length)} package manifests for release ${version}.`,
  );
  process.exit(0);
}
if (
  bootstrap &&
  (bootstrapToken === undefined || bootstrapToken.length === 0)
) {
  fail('The npm bootstrap credential is missing.');
}

const npmVersion = runCapture(
  'npm',
  ['--version'],
  repositoryRoot,
  'npm version',
);
if (!isSupportedNpmVersion(npmVersion.trim())) {
  fail('npm 11.5.1 or newer is required for package publication.');
}
const expectedReleaseSha = process.env.EXPECTED_RELEASE_SHA;
if (!/^[a-f0-9]{40}$/u.test(expectedReleaseSha ?? '')) {
  fail('EXPECTED_RELEASE_SHA must identify the immutable release commit.');
}
if (
  runCapture('git', ['rev-parse', 'HEAD'], repositoryRoot, 'release checkout')
    .trim()
    .toLowerCase() !== expectedReleaseSha
) {
  fail('The publication checkout does not match EXPECTED_RELEASE_SHA.');
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'harapter-package-publish-'));
try {
  const artifacts = new Map();
  for (const entry of entries) {
    const packed = runJson(
      pnpmCommand(),
      [
        '--dir',
        entry.path,
        'pack',
        '--pack-destination',
        fixtureRoot,
        '--json',
      ],
      repositoryRoot,
      `${entry.name} pack`,
    );
    const packFailures = validatePackedFiles(entry, packed.files ?? []);
    if (packFailures.length > 0) {
      fail(packFailures.join('\n'));
    }
    if (typeof packed.filename !== 'string') {
      fail(`${entry.name} pack did not report a tarball filename.`);
    }
    const rebuiltTarballPath = resolve(fixtureRoot, basename(packed.filename));
    if (!existsSync(rebuiltTarballPath)) {
      fail(`${entry.name} pack did not create its tarball.`);
    }
    const tarballPath = resolve(artifactsDirectory, basename(packed.filename));
    if (!existsSync(tarballPath)) {
      fail(`${entry.name} is missing its immutable Release tarball.`);
    }
    const rebuiltIntegrity = `sha512-${createHash('sha512')
      .update(readFileSync(rebuiltTarballPath))
      .digest('base64')}`;
    const localIntegrity = `sha512-${createHash('sha512')
      .update(readFileSync(tarballPath))
      .digest('base64')}`;
    if (rebuiltIntegrity !== localIntegrity) {
      fail(`${entry.name} immutable Release tarball is not reproducible.`);
    }
    artifacts.set(entry.name, { localIntegrity, tarballPath });
  }

  const localIntegrities = new Map(
    [...artifacts].map(([name, artifact]) => [name, artifact.localIntegrity]),
  );
  await executeRegistryPublication({
    entries,
    inspectExisting: (entry) => {
      const dist = readRegistryJson(entry.name, version, 'dist');
      if (dist !== undefined) {
        verifyRegistryMetadata(entry, version, artifacts, dist);
        console.log(
          `${entry.name}@${version} is already published and verified.`,
        );
        return 'verified';
      }
      const distTags = readPackageDistTags(entry.name);
      if (distTags?.get(policy.distTag) === version) {
        console.log(
          `${entry.name}@${version} is accepted and awaiting npm availability.`,
        );
        return 'pending';
      }
      return 'missing';
    },
    publishEntry: (entry) => {
      const artifact = artifacts.get(entry.name);
      if (artifact === undefined) {
        fail(`${entry.name} is missing its verified publication artifact.`);
      }
      runVisible(
        'npm',
        [
          'publish',
          artifact.tarballPath,
          '--access',
          'public',
          '--tag',
          policy.distTag,
          '--provenance',
          '--ignore-scripts',
          '--registry',
          'https://registry.npmjs.org/',
        ],
        repositoryRoot,
        `${entry.name} publish`,
        bootstrapToken === undefined
          ? childEnvironment
          : { ...childEnvironment, NODE_AUTH_TOKEN: bootstrapToken },
      );
      console.log(`${entry.name}@${version} was accepted by npm.`);
    },
    verifyAvailableEntries: async (releaseEntries) => {
      await waitForRegistryMetadata(releaseEntries, version, artifacts);
      for (const entry of releaseEntries) {
        console.log(`${entry.name}@${version} published and verified.`);
      }
    },
    verifyProvenanceEntries: (auditEntries) => {
      verifyRegistryProvenance({
        entries: auditEntries,
        expectedCommit: expectedReleaseSha,
        fixtureRoot,
        localIntegrities,
        version,
      });
    },
  });
  for (const entry of entries) {
    const dist = readRegistryJson(entry.name, version, 'dist');
    if (dist === undefined) {
      fail(
        `${entry.name}@${version} disappeared during registry verification.`,
      );
    }
    verifyRegistryMetadata(entry, version, artifacts, dist);
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--bootstrap') {
      parsed.set('bootstrap', true);
      continue;
    }
    if (value === '--artifacts-dir') {
      const next = values[index + 1];
      if (next === undefined) {
        fail('--artifacts-dir requires a value.');
      }
      parsed.set('artifacts-dir', next);
      index += 1;
      continue;
    }
    if (value === '--version') {
      const next = values[index + 1];
      if (next === undefined) {
        fail('--version requires a value.');
      }
      parsed.set('version', next);
      index += 1;
      continue;
    }
    fail(`Unknown publication argument ${String(value)}.`);
  }
  return parsed;
}

function readRegistryJson(
  name,
  packageVersion,
  property,
  {
    timeoutAsUnavailable = false,
    timeoutMilliseconds = registryQueryTimeoutMilliseconds,
  } = {},
) {
  const result = spawnSync(
    'npm',
    [
      'view',
      `${name}@${packageVersion}`,
      property,
      '--json',
      '--registry',
      'https://registry.npmjs.org/',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: childEnvironment,
      maxBuffer: 1024 * 1024,
      timeout: Math.max(1, Math.floor(timeoutMilliseconds)),
    },
  );
  if (result.status === 0) {
    try {
      return JSON.parse(result.stdout);
    } catch {
      fail(`${name}@${packageVersion} returned invalid registry metadata.`);
    }
  }
  if (result.error?.code === 'ETIMEDOUT') {
    if (timeoutAsUnavailable) {
      return undefined;
    }
    fail(`${name}@${packageVersion} registry inspection timed out.`);
  }
  if (`${result.stdout}${result.stderr}`.includes('E404')) {
    return undefined;
  }
  fail(`Unable to inspect ${name}@${packageVersion} in the npm registry.`);
}

function readPackageDistTags(name) {
  const result = spawnSync(
    'npm',
    ['dist-tag', 'ls', name, '--registry', 'https://registry.npmjs.org/'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: childEnvironment,
      maxBuffer: 1024 * 1024,
      timeout: registryQueryTimeoutMilliseconds,
    },
  );
  if (result.status === 0) {
    const distTags = parseRegistryDistTagListing(result.stdout);
    if (distTags === undefined) {
      fail(`${name} returned invalid registry dist-tags.`);
    }
    return distTags;
  }
  if (result.error?.code === 'ETIMEDOUT') {
    fail(`${name} registry dist-tag inspection timed out.`);
  }
  if (`${result.stdout}${result.stderr}`.includes('E404')) {
    return undefined;
  }
  fail(`Unable to inspect ${name} dist-tags in the npm registry.`);
}

async function waitForRegistryMetadata(
  releaseEntries,
  packageVersion,
  artifacts,
) {
  const availability = policy.registryAvailability;
  const pending = await waitForRegistryAvailability({
    entries: releaseEntries,
    inspect: (entry, { remainingMilliseconds }) => {
      const readDuringWait = (property) => {
        const remaining = remainingMilliseconds();
        if (remaining <= 0) {
          return undefined;
        }
        return readRegistryJson(entry.name, packageVersion, property, {
          timeoutAsUnavailable: true,
          timeoutMilliseconds: Math.min(
            registryQueryTimeoutMilliseconds,
            remaining,
          ),
        });
      };
      const dist = readDuringWait('dist');
      if (dist === undefined) {
        return false;
      }
      const distFailures = validateRegistryDistribution({
        dist,
        localIntegrity: artifacts.get(entry.name)?.localIntegrity,
        name: entry.name,
        version: packageVersion,
      });
      if (distFailures.length > 0) {
        fail(distFailures.join('\n'));
      }
      const distTags = readDuringWait('dist-tags');
      return (
        validateRegistryDistTag({
          distTag: policy.distTag,
          distTags,
          name: entry.name,
          version: packageVersion,
        }).length === 0
      );
    },
    pollIntervalMilliseconds: availability.pollIntervalSeconds * 1_000,
    timeoutMilliseconds: availability.timeoutSeconds * 1_000,
  });
  if (pending.length > 0) {
    fail(
      `${pending.map(({ name }) => `${name}@${packageVersion}`).join(', ')} did not become verifiable in npm within ${String(availability.timeoutSeconds)} seconds.`,
    );
  }
}

function verifyRegistryMetadata(entry, packageVersion, artifacts, dist) {
  const failures = validateRegistryDistribution({
    dist,
    localIntegrity: artifacts.get(entry.name)?.localIntegrity,
    name: entry.name,
    version: packageVersion,
  });
  const distTags = readRegistryJson(entry.name, packageVersion, 'dist-tags');
  failures.push(
    ...validateRegistryDistTag({
      distTag: policy.distTag,
      distTags,
      name: entry.name,
      version: packageVersion,
    }),
  );
  if (failures.length > 0) {
    fail(failures.join('\n'));
  }
}

function verifyRegistryProvenance({
  entries: auditEntries,
  expectedCommit,
  fixtureRoot: auditFixtureRoot,
  localIntegrities,
  version: packageVersion,
}) {
  const auditRoot = resolve(
    auditFixtureRoot,
    `audit-${String(auditEntries.length)}`,
  );
  mkdirSync(auditRoot);
  writeFileSync(
    resolve(auditRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'harapter-publication-provenance-audit',
        private: true,
        version: '0.0.0',
        dependencies: Object.fromEntries(
          auditEntries.map(({ name }) => [name, packageVersion]),
        ),
      },
      undefined,
      2,
    )}\n`,
  );
  runCapture(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--package-lock=true',
      '--fund=false',
      '--audit=false',
      '--registry',
      'https://registry.npmjs.org/',
    ],
    auditRoot,
    'npm provenance audit install',
  );
  const audit = runJson(
    'npm',
    [
      'audit',
      'signatures',
      '--json',
      '--include-attestations',
      '--registry',
      'https://registry.npmjs.org/',
    ],
    auditRoot,
    'npm provenance audit',
  );
  const failures = validateRegistryAudit({
    audit,
    entries: auditEntries,
    expectedCommit,
    localIntegrities,
    version: packageVersion,
  });
  if (failures.length > 0) {
    fail(failures.join('\n'));
  }
}

function runJson(commandName, commandArguments, cwd, label) {
  const output = runCapture(commandName, commandArguments, cwd, label);
  try {
    return JSON.parse(output);
  } catch {
    fail(`${label} did not return valid JSON.`);
  }
}

function runCapture(commandName, commandArguments, cwd, label) {
  const result = spawnSync(commandName, commandArguments, {
    cwd,
    encoding: 'utf8',
    env: childEnvironment,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    fail(`${label} failed.`);
  }
  return result.stdout;
}

function runVisible(commandName, commandArguments, cwd, label, environment) {
  const result = spawnSync(commandName, commandArguments, {
    cwd,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error !== undefined || result.status !== 0) {
    fail(`${label} failed.`);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('Publication metadata is invalid.');
  }
}

function isSupportedNpmVersion(value) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/u);
  if (match === null) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return (
    major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)))
  );
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
