import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createReleaseSbom,
  expectedReleaseAssetNames,
  renderReleaseChecksums,
  validatePackedFiles,
  validatePublicPackagePolicy,
  validateReleaseAssetNames,
  validateReleaseChecksums,
  validateReleaseSbom,
  validateReleaseVersion,
} from './lib/package-publication.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArguments(process.argv.slice(2));
const version = options.get('version');
const outputDirectory = resolvePathOption(options, 'output-dir');
const releaseSha = options.get('release-sha');
const failures = validateReleaseVersion(version);
if (!/^[a-f0-9]{40}$/u.test(releaseSha ?? '')) {
  failures.push('--release-sha must identify a full commit SHA.');
}
if (failures.length > 0) {
  fail(failures.join('\n'));
}
if (outputDirectory === repositoryRoot) {
  fail('The release asset output directory must not be the repository root.');
}

const policy = readJson(
  resolve(repositoryRoot, 'scripts/public-packages.json'),
);
failures.push(...validatePublicPackagePolicy(policy));
const packageManifests = new Map();
const rootVersion = readFileSync(
  resolve(repositoryRoot, 'version.txt'),
  'utf8',
).trim();
if (rootVersion !== version) {
  failures.push(`version.txt does not match release ${version}.`);
}
for (const entry of policy?.packages ?? []) {
  const manifest = readJson(
    resolve(repositoryRoot, entry.path, 'package.json'),
  );
  packageManifests.set(entry.name, manifest);
  if (manifest?.version !== version) {
    failures.push(`${entry.name} does not match release ${version}.`);
  }
}
const checkoutSha = runCapture(
  'git',
  ['rev-parse', 'HEAD'],
  'release checkout',
).trim();
if (checkoutSha !== releaseSha) {
  failures.push('The release asset checkout does not match --release-sha.');
}
const releaseCreated = new Date(
  runCapture(
    'git',
    ['show', '-s', '--format=%cI', releaseSha],
    'release timestamp',
  ).trim(),
).toISOString();
exitWithFailures(failures);

const outputDirectoryExisted = existsSync(outputDirectory);
if (outputDirectoryExisted) {
  if (!statSync(outputDirectory).isDirectory()) {
    fail('The release asset output path must be a directory.');
  }
  if (readdirSync(outputDirectory).length > 0) {
    fail('The release asset output directory must be empty.');
  }
} else {
  mkdirSync(outputDirectory, { recursive: true });
}

let completed = false;
process.once('exit', (code) => {
  if (code !== 0 && !completed) {
    cleanupOutputDirectory(outputDirectory, outputDirectoryExisted);
  }
});

try {
  const expectedNames = expectedReleaseAssetNames(policy, version);
  const packageNames = expectedNames.slice(0, policy.packages.length);

  for (const [index, entry] of policy.packages.entries()) {
    const packed = runJson(
      pnpmCommand(),
      [
        '--dir',
        entry.path,
        'pack',
        '--pack-destination',
        outputDirectory,
        '--json',
      ],
      `${entry.name} pack`,
    );
    const packFailures = validatePackedFiles(entry, packed.files ?? []);
    if (packFailures.length > 0) {
      fail(packFailures.join('\n'));
    }
    const expectedName = packageNames[index];
    if (
      typeof packed.filename !== 'string' ||
      basename(packed.filename) !== expectedName ||
      !existsSync(resolve(outputDirectory, expectedName))
    ) {
      fail(`${entry.name} pack did not create ${String(expectedName)}.`);
    }
  }

  const packageDigests = new Map(
    packageNames.map((name) => [
      name,
      fileDigest(resolve(outputDirectory, name)),
    ]),
  );
  const releasePackages = policy.packages.map((entry, index) => {
    const manifest = packageManifests.get(entry.name);
    const packageFileName = packageNames[index];
    const sha256 = packageDigests.get(packageFileName);
    if (!isMapping(manifest) || typeof sha256 !== 'string') {
      fail(`${entry.name} release metadata could not be resolved.`);
    }
    return {
      dependencies: releaseDependencies(manifest, packageManifests),
      name: entry.name,
      sha256,
    };
  });
  const sbom = createReleaseSbom({
    created: releaseCreated,
    packages: releasePackages,
    releaseSha,
    version,
  });
  const sbomFailures = validateReleaseSbom({
    created: releaseCreated,
    packages: releasePackages,
    releaseSha,
    sbom,
    version,
  });
  if (sbomFailures.length > 0) {
    fail(sbomFailures.join('\n'));
  }
  const sbomName = expectedNames.at(-2);
  if (typeof sbomName !== 'string') {
    fail('The release SBOM name could not be resolved.');
  }
  writeFileSync(
    resolve(outputDirectory, sbomName),
    `${JSON.stringify(sbom, undefined, 2)}\n`,
    { flag: 'wx' },
  );

  const checksumName = expectedNames.at(-1);
  if (checksumName !== 'SHA256SUMS.txt') {
    fail('The release checksum name could not be resolved.');
  }
  const digests = new Map(
    readdirSync(outputDirectory).map((name) => [
      name,
      fileDigest(resolve(outputDirectory, name)),
    ]),
  );
  const checksumText = renderReleaseChecksums(digests);
  writeFileSync(resolve(outputDirectory, checksumName), checksumText, {
    flag: 'wx',
  });

  const assetFailures = validateReleaseAssetNames({
    fileNames: readdirSync(outputDirectory),
    policy,
    version,
  });
  assetFailures.push(
    ...validateReleaseChecksums({ checksumText, expectedDigests: digests }),
  );
  exitWithFailures(assetFailures);
  console.log(
    `Built ${String(policy.packages.length)} package tarballs, an SPDX SBOM, and SHA-256 checksums for Harapter ${version}.`,
  );
  completed = true;
} catch (error) {
  cleanupOutputDirectory(outputDirectory, outputDirectoryExisted);
  throw error;
}

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (!['--output-dir', '--release-sha', '--version'].includes(name)) {
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
  for (const required of ['output-dir', 'release-sha', 'version']) {
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

function runJson(command, argumentsList, label) {
  const result = spawnSync(command, argumentsList, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    const diagnostic = `${result.stdout}${result.stderr}`
      .trim()
      .replaceAll(repositoryRoot, '<repository>')
      .replaceAll(tmpdir(), '<temporary-directory>')
      .replace(/\/Users\/[^/\s]+/gu, '<home>')
      .slice(-4_000);
    fail(`${label} failed${diagnostic.length > 0 ? `:\n${diagnostic}` : '.'}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`${label} did not return valid JSON.`);
  }
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

function fileDigest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function releaseDependencies(manifest, manifests) {
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

function cleanupOutputDirectory(path, existed) {
  if (!existsSync(path)) {
    return;
  }
  for (const name of readdirSync(path)) {
    rmSync(resolve(path, name), { force: true, recursive: true });
  }
  if (!existed) {
    rmSync(path, { force: true, recursive: true });
  }
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function exitWithFailures(currentFailures) {
  if (currentFailures.length > 0) {
    fail(currentFailures.join('\n'));
  }
}

function isMapping(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
