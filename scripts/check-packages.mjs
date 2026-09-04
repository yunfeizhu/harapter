import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePackageOrder,
  validatePackedFiles,
  validatePublicPackageManifest,
  validatePublicPackagePolicy,
} from './lib/package-publication.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = readJson(
  resolve(repositoryRoot, 'scripts/public-packages.json'),
);
const failures = validatePublicPackagePolicy(policy);
const entries = Array.isArray(policy.packages) ? policy.packages : [];
exitWithFailures(failures);
const knownPackageNames = new Set(entries.map(({ name }) => name));
const manifests = new Map();

const declaredPaths = new Set(entries.map(({ path }) => path));
for (const path of findPackageDirectories()) {
  if (!declaredPaths.has(path)) {
    failures.push(
      `${path}/package.json must be listed in scripts/public-packages.json.`,
    );
  }
}

for (const entry of entries) {
  const manifestPath = resolve(repositoryRoot, entry.path, 'package.json');
  if (!existsSync(manifestPath)) {
    failures.push(`${entry.path}/package.json does not exist.`);
    continue;
  }
  const packageJson = readJson(manifestPath);
  manifests.set(entry.path, packageJson);
  failures.push(
    ...validatePublicPackageManifest({
      entry,
      knownPackageNames,
      packageJson,
    }),
  );
}
failures.push(...validatePackageOrder(entries, manifests));

const rootPackageJson = readJson(resolve(repositoryRoot, 'package.json'));
if (rootPackageJson.private !== true) {
  failures.push('package.json must keep the Workspace root private.');
}
const versionFile = readFileSync(
  resolve(repositoryRoot, 'version.txt'),
  'utf8',
).trim();
if (rootPackageJson.version !== versionFile) {
  failures.push('package.json and version.txt must use the same version.');
}
for (const entry of entries) {
  if (manifests.get(entry.path)?.version !== rootPackageJson.version) {
    failures.push(
      `${entry.path}/package.json must follow the synchronized release version.`,
    );
  }
}
for (const name of readdirSync(resolve(repositoryRoot, 'examples'))) {
  const manifestPath = resolve(
    repositoryRoot,
    'examples',
    name,
    'package.json',
  );
  if (existsSync(manifestPath) && readJson(manifestPath).private !== true) {
    failures.push(`examples/${name}/package.json must remain private.`);
  }
}

exitWithFailures(failures);

const fixtureRoot = mkdtempSync(join(tmpdir(), 'harapter-package-check-'));
try {
  const tarballRoot = resolve(fixtureRoot, 'tarballs');
  const consumerRoot = resolve(fixtureRoot, 'consumer');
  const tarballs = new Map();
  mkdirSync(tarballRoot);
  mkdirSync(consumerRoot);

  for (const entry of entries) {
    const packed = runJson(
      pnpmCommand(),
      [
        '--dir',
        entry.path,
        'pack',
        '--pack-destination',
        tarballRoot,
        '--json',
      ],
      repositoryRoot,
      `${entry.name} pack`,
    );
    failures.push(...validatePackedFiles(entry, packed.files ?? []));
    if (typeof packed.filename !== 'string') {
      failures.push(`${entry.name} pack did not report a tarball filename.`);
      continue;
    }
    const tarballPath = resolve(tarballRoot, basename(packed.filename));
    if (!existsSync(tarballPath)) {
      failures.push(`${entry.name} pack did not create its reported tarball.`);
      continue;
    }
    tarballs.set(entry.name, tarballPath);
  }

  const firstEntry = entries[0];
  if (firstEntry !== undefined) {
    const repeatRoot = resolve(fixtureRoot, 'repeat-pack');
    mkdirSync(repeatRoot);
    const repeatedPack = runJson(
      pnpmCommand(),
      [
        '--dir',
        firstEntry.path,
        'pack',
        '--pack-destination',
        repeatRoot,
        '--json',
      ],
      repositoryRoot,
      `${firstEntry.name} repeat pack`,
    );
    const originalTarball = tarballs.get(firstEntry.name);
    const repeatedTarball =
      typeof repeatedPack.filename === 'string'
        ? resolve(repeatRoot, basename(repeatedPack.filename))
        : undefined;
    if (
      originalTarball === undefined ||
      repeatedTarball === undefined ||
      !existsSync(repeatedTarball) ||
      fileSha(originalTarball) !== fileSha(repeatedTarball)
    ) {
      failures.push(`${firstEntry.name} tarball must pack deterministically.`);
    }
  }

  exitWithFailures(failures);
  const fileDependencies = Object.fromEntries(
    entries.map(({ name }) => {
      const tarballPath = tarballs.get(name);
      if (tarballPath === undefined) {
        throw new Error(`${name} is missing its verified tarball.`);
      }
      return [name, toFileSpecifier(relative(consumerRoot, tarballPath))];
    }),
  );
  writeFileSync(
    resolve(consumerRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'harapter-package-consumer-smoke',
        private: true,
        type: 'module',
        packageManager: rootPackageJson.packageManager,
        dependencies: fileDependencies,
      },
      undefined,
      2,
    )}\n`,
  );
  writeFileSync(
    resolve(consumerRoot, 'pnpm-workspace.yaml'),
    `${JSON.stringify(
      { autoInstallPeers: false, overrides: fileDependencies },
      undefined,
      2,
    )}\n`,
  );
  const runtimeSmoke = entries
    .map(
      ({ name, smokeExport }) =>
        `if (!("${smokeExport}" in await import("${name}"))) throw new Error("${name} is missing its smoke export.");`,
    )
    .join('\n');
  writeFileSync(resolve(consumerRoot, 'smoke.mjs'), `${runtimeSmoke}\n`);
  const typeSmoke = entries
    .map(
      ({ name, smokeExport }, index) =>
        `import { ${smokeExport} as smoke${String(index)} } from '${name}';\nvoid smoke${String(index)};`,
    )
    .join('\n');
  writeFileSync(resolve(consumerRoot, 'smoke.ts'), `${typeSmoke}\n`);

  run(
    pnpmCommand(),
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--lockfile=false',
      '--store-dir',
      resolve(fixtureRoot, 'store'),
    ],
    consumerRoot,
    'tarball consumer install',
  );

  for (const entry of entries) {
    const installedManifest = readJson(
      resolve(
        consumerRoot,
        'node_modules',
        ...entry.name.split('/'),
        'package.json',
      ),
    );
    if (JSON.stringify(installedManifest).includes('workspace:')) {
      failures.push(
        `${entry.name} packed manifest contains an unresolved workspace dependency.`,
      );
    }
    if (installedManifest.version !== manifests.get(entry.path)?.version) {
      failures.push(`${entry.name} packed manifest has the wrong version.`);
    }
  }
  exitWithFailures(failures);

  symlinkSync(
    resolve(repositoryRoot, 'node_modules/vitest'),
    resolve(consumerRoot, 'node_modules/vitest'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  run(process.execPath, ['smoke.mjs'], consumerRoot, 'runtime consumer smoke');
  run(
    resolve(repositoryRoot, 'node_modules/.bin/tsc'),
    [
      '--noEmit',
      '--strict',
      '--target',
      'ES2024',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--types',
      'node',
      '--typeRoots',
      resolve(repositoryRoot, 'node_modules/@types'),
      'smoke.ts',
    ],
    consumerRoot,
    'type consumer smoke',
  );

  const releaseAssetsRoot = resolve(fixtureRoot, 'release-assets');
  const repeatedReleaseAssetsRoot = resolve(
    fixtureRoot,
    'release-assets-repeat',
  );
  const releaseSha = run(
    'git',
    ['rev-parse', 'HEAD'],
    repositoryRoot,
    'release commit resolution',
  ).stdout.trim();
  run(
    process.execPath,
    [
      'scripts/build-release-assets.mjs',
      '--version',
      versionFile,
      '--output-dir',
      releaseAssetsRoot,
      '--release-sha',
      releaseSha,
    ],
    repositoryRoot,
    'release asset build',
  );
  run(
    process.execPath,
    [
      'scripts/build-release-assets.mjs',
      '--version',
      versionFile,
      '--output-dir',
      repeatedReleaseAssetsRoot,
      '--release-sha',
      releaseSha,
    ],
    repositoryRoot,
    'repeated release asset build',
  );
  const releaseAssetNames = readdirSync(releaseAssetsRoot).sort();
  const repeatedReleaseAssetNames = readdirSync(
    repeatedReleaseAssetsRoot,
  ).sort();
  if (
    JSON.stringify(releaseAssetNames) !==
      JSON.stringify(repeatedReleaseAssetNames) ||
    releaseAssetNames.some(
      (name) =>
        fileSha(resolve(releaseAssetsRoot, name)) !==
        fileSha(resolve(repeatedReleaseAssetsRoot, name)),
    )
  ) {
    failures.push('Release assets must be reproducible for one commit.');
  }
  exitWithFailures(failures);
  run(
    process.execPath,
    [
      'scripts/verify-release-assets.mjs',
      '--version',
      versionFile,
      '--assets-dir',
      releaseAssetsRoot,
      '--release-sha',
      releaseSha,
    ],
    repositoryRoot,
    'release asset verification',
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log(
  `Validated ${String(entries.length)} public package tarballs and a clean consumer install.`,
);

function findPackageDirectories() {
  const paths = [];
  for (const group of ['packages', 'providers']) {
    for (const name of readdirSync(resolve(repositoryRoot, group))) {
      const manifestPath = resolve(repositoryRoot, group, name, 'package.json');
      if (existsSync(manifestPath)) {
        paths.push(`${group}/${name}`);
      }
    }
  }
  return paths.sort();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function runJson(command, argumentsList, cwd, label) {
  const result = run(command, argumentsList, cwd, label);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

function run(command, argumentsList, cwd, label) {
  const result = spawnSync(command, argumentsList, {
    cwd,
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
    throw new Error(
      `${label} failed${diagnostic.length > 0 ? `:\n${diagnostic}` : '.'}`,
    );
  }
  return result;
}

function toFileSpecifier(path) {
  return `file:${path.split(sep).join('/')}`;
}

function fileSha(path) {
  return createHash('sha512').update(readFileSync(path)).digest('hex');
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function exitWithFailures(currentFailures) {
  if (currentFailures.length > 0) {
    console.error(currentFailures.join('\n'));
    process.exit(1);
  }
}
