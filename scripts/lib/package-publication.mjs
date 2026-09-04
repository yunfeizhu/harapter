const repositoryUrl = 'git+https://github.com/yunfeizhu/harapter.git';
const repositoryHomepage = 'https://github.com/yunfeizhu/harapter#readme';
const repositoryIssues = 'https://github.com/yunfeizhu/harapter/issues';
const registryUrl = 'https://registry.npmjs.org/';

export function validatePublicPackagePolicy(policy) {
  const failures = [];
  if (!isMapping(policy)) {
    return ['scripts/public-packages.json must contain an object.'];
  }
  validateExactKeys(
    policy,
    new Set(['distTag', 'packages', 'schemaVersion']),
    'scripts/public-packages.json',
    failures,
  );
  if (policy.schemaVersion !== 1) {
    failures.push('scripts/public-packages.json schemaVersion must be 1.');
  }
  if (policy.distTag !== 'next') {
    failures.push('scripts/public-packages.json distTag must be next.');
  }
  if (!Array.isArray(policy.packages) || policy.packages.length === 0) {
    failures.push(
      'scripts/public-packages.json packages must be a non-empty array.',
    );
    return failures;
  }

  const paths = new Set();
  const names = new Set();
  for (const [index, entry] of policy.packages.entries()) {
    const label = `scripts/public-packages.json packages[${String(index)}]`;
    if (!isMapping(entry)) {
      failures.push(`${label} must be an object.`);
      continue;
    }
    validateExactKeys(
      entry,
      new Set(['name', 'path', 'smokeExport']),
      label,
      failures,
    );
    if (
      typeof entry.path !== 'string' ||
      !/^(?:packages|providers)\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.path)
    ) {
      failures.push(`${label}.path must identify one package directory.`);
    } else if (paths.has(entry.path)) {
      failures.push(`${label}.path must be unique.`);
    } else {
      paths.add(entry.path);
    }
    if (
      typeof entry.name !== 'string' ||
      !/^@harapter\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.name)
    ) {
      failures.push(`${label}.name must be an @harapter package name.`);
    } else if (names.has(entry.name)) {
      failures.push(`${label}.name must be unique.`);
    } else {
      names.add(entry.name);
    }
    if (
      typeof entry.smokeExport !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9]*$/u.test(entry.smokeExport)
    ) {
      failures.push(`${label}.smokeExport must be a public identifier.`);
    }
  }
  return failures;
}

export function validatePublicPackageManifest({
  entry,
  knownPackageNames,
  packageJson,
}) {
  const manifestPath = `${entry.path}/package.json`;
  const failures = [];
  if (!isMapping(packageJson)) {
    return [`${manifestPath} must contain an object.`];
  }
  if (packageJson.name !== entry.name) {
    failures.push(`${manifestPath} name must be ${entry.name}.`);
  }
  if (!isReleaseVersion(packageJson.version, { allowZero: true })) {
    failures.push(`${manifestPath} version must be a valid SemVer release.`);
  }
  if (Object.hasOwn(packageJson, 'private')) {
    failures.push(`${manifestPath} must not set private.`);
  }
  if (packageJson.license !== 'Apache-2.0') {
    failures.push(`${manifestPath} license must be Apache-2.0.`);
  }
  if (packageJson.type !== 'module') {
    failures.push(`${manifestPath} type must be module.`);
  }
  if (packageJson.sideEffects !== false) {
    failures.push(`${manifestPath} sideEffects must be false.`);
  }
  if (!arraysEqual(packageJson.files, ['dist'])) {
    failures.push(`${manifestPath} files must contain only dist.`);
  }
  if (packageJson.main !== './dist/index.js') {
    failures.push(`${manifestPath} main must be ./dist/index.js.`);
  }
  if (packageJson.types !== './dist/index.d.ts') {
    failures.push(`${manifestPath} types must be ./dist/index.d.ts.`);
  }
  const rootExport = packageJson.exports?.['.'];
  if (
    !isMapping(rootExport) ||
    rootExport.types !== './dist/index.d.ts' ||
    rootExport.default !== './dist/index.js'
  ) {
    failures.push(`${manifestPath} must export the built ESM and types entry.`);
  }
  if (packageJson.engines?.node !== '>=24') {
    failures.push(`${manifestPath} engines.node must be >=24.`);
  }
  if (
    packageJson.repository?.type !== 'git' ||
    packageJson.repository?.url !== repositoryUrl ||
    packageJson.repository?.directory !== entry.path
  ) {
    failures.push(`${manifestPath} repository metadata must match its source.`);
  }
  if (packageJson.homepage !== repositoryHomepage) {
    failures.push(`${manifestPath} homepage must match the repository.`);
  }
  if (packageJson.bugs?.url !== repositoryIssues) {
    failures.push(`${manifestPath} bugs URL must match the repository.`);
  }
  const publishConfig = packageJson.publishConfig;
  if (
    !isMapping(publishConfig) ||
    publishConfig.access !== 'public' ||
    publishConfig.provenance !== true ||
    publishConfig.registry !== registryUrl ||
    publishConfig.tag !== 'next'
  ) {
    failures.push(
      `${manifestPath} publishConfig must require public next releases with npm provenance.`,
    );
  }
  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, range] of Object.entries(packageJson[section] ?? {})) {
      if (!name.startsWith('@harapter/')) {
        continue;
      }
      if (!knownPackageNames.has(name)) {
        failures.push(
          `${manifestPath} ${section} contains unknown public package ${name}.`,
        );
      }
      if (range !== 'workspace:*') {
        failures.push(
          `${manifestPath} ${section}.${name} must use workspace:* before packing.`,
        );
      }
    }
  }
  if (
    Array.isArray(packageJson.bundleDependencies) ||
    Array.isArray(packageJson.bundledDependencies)
  ) {
    failures.push(`${manifestPath} must not bundle dependencies.`);
  }
  return failures;
}

export function validatePackageOrder(entries, manifests) {
  const failures = [];
  const published = new Set();
  const known = new Set(entries.map(({ name }) => name));
  for (const entry of entries) {
    const packageJson = manifests.get(entry.path);
    if (!isMapping(packageJson)) {
      continue;
    }
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const dependencyName of Object.keys(packageJson[section] ?? {})) {
        if (known.has(dependencyName) && !published.has(dependencyName)) {
          failures.push(
            `scripts/public-packages.json must list ${dependencyName} before ${entry.name}.`,
          );
        }
      }
    }
    published.add(entry.name);
  }
  return failures;
}

export function validatePackedFiles(entry, files) {
  const failures = [];
  const paths = files.map(({ path }) => path);
  for (const required of [
    'LICENSE',
    'README.md',
    'package.json',
    'dist/index.js',
    'dist/index.d.ts',
  ]) {
    if (!paths.includes(required)) {
      failures.push(`${entry.name} tarball is missing ${required}.`);
    }
  }
  for (const path of paths) {
    if (
      path !== 'LICENSE' &&
      path !== 'README.md' &&
      path !== 'package.json' &&
      !path.startsWith('dist/')
    ) {
      failures.push(`${entry.name} tarball contains unexpected path ${path}.`);
    }
    if (path.endsWith('.tsbuildinfo')) {
      failures.push(`${entry.name} tarball must not contain ${path}.`);
    }
  }
  return failures;
}

export function validateReleaseVersion(version, { bootstrap = false } = {}) {
  if (!isReleaseVersion(version, { allowZero: false })) {
    return [`Release version ${String(version)} is not publishable.`];
  }
  if (bootstrap && version !== '0.1.1') {
    return ['The npm bootstrap path is restricted to release 0.1.1.'];
  }
  return [];
}

export function normalizeRegistryIntegrity(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().replace(/^"|"$/gu, '');
  return /^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(normalized)
    ? normalized
    : undefined;
}

export function validateRegistryDistribution({
  dist,
  localIntegrity,
  name,
  version,
}) {
  const label = `${name}@${version}`;
  const failures = [];
  if (!isMapping(dist)) {
    return [`${label} returned invalid npm distribution metadata.`];
  }
  const registryIntegrity = normalizeRegistryIntegrity(dist.integrity);
  if (registryIntegrity === undefined) {
    failures.push(`${label} is missing a valid SHA-512 registry integrity.`);
  } else if (registryIntegrity !== localIntegrity) {
    failures.push(`${label} has different immutable registry content.`);
  }

  const attestations = dist.attestations;
  if (
    !isMapping(attestations) ||
    attestations.provenance?.predicateType !== 'https://slsa.dev/provenance/v1'
  ) {
    failures.push(`${label} is missing npm provenance metadata.`);
  }
  if (!isExpectedAttestationUrl(attestations?.url, name, version)) {
    failures.push(`${label} returned an unexpected npm attestation URL.`);
  }
  return failures;
}

export function validateRegistryDistTag({ distTag, distTags, name, version }) {
  if (!isMapping(distTags) || distTags[distTag] !== version) {
    return [`${name}@${version} must own the npm ${distTag} dist-tag.`];
  }
  return [];
}

export function validateRegistryAudit({
  audit,
  entries,
  expectedCommit,
  localIntegrities,
  version,
}) {
  const failures = [];
  if (!isMapping(audit)) {
    return ['npm provenance audit returned invalid output.'];
  }
  if (!Array.isArray(audit.invalid) || audit.invalid.length > 0) {
    failures.push('npm provenance audit reported invalid signatures.');
  }
  if (!Array.isArray(audit.missing) || audit.missing.length > 0) {
    failures.push('npm provenance audit reported missing signatures.');
  }
  if (!Array.isArray(audit.verified)) {
    failures.push('npm provenance audit did not report verified packages.');
    return failures;
  }

  for (const entry of entries) {
    const verified = audit.verified.find(
      (candidate) =>
        isMapping(candidate) &&
        candidate.name === entry.name &&
        candidate.version === version,
    );
    if (!isMapping(verified)) {
      failures.push(
        `${entry.name}@${version} was not verified by npm provenance audit.`,
      );
      continue;
    }
    const provenance = Array.isArray(verified.attestationBundles)
      ? verified.attestationBundles.find(
          (attestation) =>
            isMapping(attestation) &&
            attestation.predicateType === 'https://slsa.dev/provenance/v1',
        )
      : undefined;
    const statement = decodeProvenanceStatement(provenance);
    if (statement === undefined) {
      failures.push(
        `${entry.name}@${version} has no readable verified provenance statement.`,
      );
      continue;
    }
    failures.push(
      ...validateProvenanceStatement({
        expectedCommit,
        localIntegrity: localIntegrities.get(entry.name),
        name: entry.name,
        statement,
        version,
      }),
    );
  }
  return failures;
}

export function validateProvenanceStatement({
  expectedCommit,
  localIntegrity,
  name,
  statement,
  version,
}) {
  const label = `${name}@${version}`;
  const failures = [];
  if (!isMapping(statement)) {
    return [`${label} provenance statement must be an object.`];
  }
  if (statement.predicateType !== 'https://slsa.dev/provenance/v1') {
    failures.push(`${label} provenance uses an unexpected predicate.`);
  }
  const workflow =
    statement.predicate?.buildDefinition?.externalParameters?.workflow;
  if (
    workflow?.repository !== 'https://github.com/yunfeizhu/harapter' ||
    workflow?.path !== '.github/workflows/publish-npm.yml' ||
    workflow?.ref !== 'refs/heads/main'
  ) {
    failures.push(`${label} provenance identifies an unexpected workflow.`);
  }
  if (
    statement.predicate?.runDetails?.builder?.id !==
    'https://github.com/actions/runner/github-hosted'
  ) {
    failures.push(`${label} provenance identifies an unexpected builder.`);
  }
  const resolvedDependencies =
    statement.predicate?.buildDefinition?.resolvedDependencies;
  if (
    !Array.isArray(resolvedDependencies) ||
    !resolvedDependencies.some(
      (dependency) => dependency?.digest?.gitCommit === expectedCommit,
    )
  ) {
    failures.push(`${label} provenance does not resolve the release commit.`);
  }
  const expectedDigest = integrityHex(localIntegrity);
  if (
    expectedDigest === undefined ||
    !Array.isArray(statement.subject) ||
    !statement.subject.some(
      (subject) => subject?.digest?.sha512 === expectedDigest,
    )
  ) {
    failures.push(`${label} provenance does not identify the packed tarball.`);
  }
  return failures;
}

function isReleaseVersion(version, { allowZero }) {
  if (
    typeof version !== 'string' ||
    !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version)
  ) {
    return false;
  }
  return allowZero || version !== '0.0.0';
}

function arraysEqual(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function decodeProvenanceStatement(attestation) {
  const payload = attestation?.bundle?.dsseEnvelope?.payload;
  if (typeof payload !== 'string') {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
}

function integrityHex(integrity) {
  const normalized = normalizeRegistryIntegrity(integrity);
  if (normalized === undefined) {
    return undefined;
  }
  return Buffer.from(normalized.slice('sha512-'.length), 'base64').toString(
    'hex',
  );
}

function isExpectedAttestationUrl(value, name, version) {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    const encodedIdentity = url.pathname.slice(
      '/-/npm/v1/attestations/'.length,
    );
    return (
      url.origin === 'https://registry.npmjs.org' &&
      url.pathname.startsWith('/-/npm/v1/attestations/') &&
      decodeURIComponent(encodedIdentity) === `${name}@${version}`
    );
  } catch {
    return false;
  }
}

function validateExactKeys(value, allowedKeys, label, failures) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      failures.push(`${label} contains unknown key ${key}.`);
    }
  }
}

function isMapping(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
