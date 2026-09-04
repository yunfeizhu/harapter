import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedReleaseAssetNames,
  renderReleaseChecksums,
  validatePublicPackagePolicy,
  validateReleaseAssetNames,
  validateReleaseChecksums,
  validateReleaseSbom,
  validateReleaseVersion,
  validateRemoteReleaseAssets,
} from './lib/package-publication.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArguments(process.argv.slice(2));
const version = options.get('version');
const releaseSha = options.get('release-sha');
const assetsDirectory = resolvePathOption(options, 'assets-dir');
const failures = validateReleaseVersion(version);
if (!/^[a-f0-9]{40}$/u.test(releaseSha ?? '')) {
  failures.push('--release-sha must identify a full commit SHA.');
}
const policy = readJson(
  resolve(repositoryRoot, 'scripts/public-packages.json'),
);
failures.push(...validatePublicPackagePolicy(policy));
if (!existsSync(assetsDirectory) || !statSync(assetsDirectory).isDirectory()) {
  failures.push('The release assets directory does not exist.');
}
exitWithFailures(failures);

if (
  runCapture('git', ['rev-parse', 'HEAD'], 'release checkout').trim() !==
  releaseSha
) {
  fail('The release asset checkout does not match --release-sha.');
}
const releaseCreated = new Date(
  runCapture(
    'git',
    ['show', '-s', '--format=%cI', releaseSha],
    'release timestamp',
  ).trim(),
).toISOString();

const fileNames = readdirSync(assetsDirectory);
failures.push(...validateReleaseAssetNames({ fileNames, policy, version }));
exitWithFailures(failures);

const expectedNames = expectedReleaseAssetNames(policy, version);
const checksumName = 'SHA256SUMS.txt';
const sbomName = `harapter-${version}.spdx.json`;
const expectedDigests = new Map();
for (const name of expectedNames) {
  if (name !== checksumName) {
    expectedDigests.set(name, fileDigest(resolve(assetsDirectory, name)));
  }
}
const checksumText = readFileSync(
  resolve(assetsDirectory, checksumName),
  'utf8',
);
failures.push(...validateReleaseChecksums({ checksumText, expectedDigests }));
if (checksumText !== renderReleaseChecksums(expectedDigests)) {
  failures.push('SHA256SUMS.txt must use canonical file ordering.');
}
const packageManifests = new Map(
  policy.packages.map((entry) => [
    entry.name,
    readJson(resolve(repositoryRoot, entry.path, 'package.json')),
  ]),
);
const releasePackages = policy.packages.map((entry) => ({
  dependencies: releaseDependencies(
    packageManifests.get(entry.name),
    packageManifests,
  ),
  name: entry.name,
  sha256: expectedDigests.get(releaseTarballName(entry.name, version)),
}));
failures.push(
  ...validateReleaseSbom({
    created: releaseCreated,
    packages: releasePackages,
    releaseSha,
    sbom: readJson(resolve(assetsDirectory, sbomName)),
    version,
  }),
);

const releaseJsonPath = options.get('release-json');
if (releaseJsonPath !== undefined) {
  const release = readJson(resolve(repositoryRoot, releaseJsonPath));
  if (release?.tag_name !== `harapter-v${version}`) {
    failures.push('GitHub Release metadata has the wrong tag.');
  }
  if (release?.target_commitish !== releaseSha) {
    failures.push('GitHub Release metadata has the wrong target commit.');
  }
  const expectedAssets = new Map(
    expectedNames.map((name) => {
      const path = resolve(assetsDirectory, name);
      return [
        name,
        {
          sha256: fileDigest(path),
          size: statSync(path).size,
        },
      ];
    }),
  );
  failures.push(
    ...validateRemoteReleaseAssets({
      assets: release?.assets,
      expectedAssets,
    }),
  );
}

exitWithFailures(failures);
console.log(
  `Verified ${String(policy.packages.length)} package tarballs, an SPDX SBOM, and SHA-256 checksums for Harapter ${version}.`,
);

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (
      ![
        '--assets-dir',
        '--release-json',
        '--release-sha',
        '--version',
      ].includes(name)
    ) {
      fail(`Unknown release asset argument ${String(name)}.`);
    }
    const value = values[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`${name} requires a value.`);
    }
    const key = name.slice(2);
    if (parsed.has(key)) {
      fail(`${name} may be provided only once.`);
    }
    parsed.set(key, value);
    index += 1;
  }
  for (const required of ['assets-dir', 'release-sha', 'version']) {
    if (!parsed.has(required)) {
      fail(`--${required} is required.`);
    }
  }
  return parsed;
}

function resolvePathOption(parsed, name) {
  const value = parsed.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    fail(`--${name} requires a path.`);
  }
  return resolve(repositoryRoot, value);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('Release asset metadata is invalid.');
  }
}

function fileDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function releaseTarballName(name, packageVersion) {
  return `${name.slice(1).replace('/', '-')}-${packageVersion}.tgz`;
}

function releaseDependencies(manifest, manifests) {
  if (!isMapping(manifest)) {
    return [];
  }
  return [
    ...new Set(
      ['dependencies', 'optionalDependencies'].flatMap((section) =>
        Object.keys(manifest[section] ?? {}).filter((name) =>
          manifests.has(name),
        ),
      ),
    ),
  ].sort();
}

function runCapture(command, argumentsList, label) {
  const result = spawnSync(command, argumentsList, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    fail(`${label} failed.`);
  }
  return result.stdout;
}

function exitWithFailures(currentFailures) {
  if (currentFailures.length > 0) {
    fail(currentFailures.join('\n'));
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isMapping(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
