const repositoryUrl = 'git+https://github.com/yunfeizhu/harapter.git';
const repositoryHomepage = 'https://github.com/yunfeizhu/harapter#readme';
const repositoryIssues = 'https://github.com/yunfeizhu/harapter/issues';
const registryUrl = 'https://registry.npmjs.org/';
const releaseRepositoryName = 'harapter';
const releaseRepositoryUrl = 'https://github.com/yunfeizhu/harapter';
const releaseRootSpdxId = 'SPDXRef-Harapter-Release';

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

export function expectedReleaseAssetNames(policy, version) {
  if (
    validatePublicPackagePolicy(policy).length > 0 ||
    validateReleaseVersion(version).length > 0
  ) {
    return [];
  }
  return [
    ...policy.packages.map(({ name }) => releaseTarballFileName(name, version)),
    `harapter-${version}.spdx.json`,
    'SHA256SUMS.txt',
  ];
}

export function validateReleaseAssetNames({ fileNames, policy, version }) {
  const failures = [
    ...validatePublicPackagePolicy(policy),
    ...validateReleaseVersion(version),
  ];
  if (!Array.isArray(fileNames)) {
    return [...failures, 'Release assets must be an array of file names.'];
  }
  if (failures.length > 0) {
    return failures;
  }

  const expected = new Set(expectedReleaseAssetNames(policy, version));
  const actual = new Set();
  for (const name of fileNames) {
    if (typeof name !== 'string') {
      failures.push('Release assets contain a non-string file name.');
      continue;
    }
    if (actual.has(name)) {
      failures.push(`Release assets contain duplicate file ${name}.`);
      continue;
    }
    actual.add(name);
  }
  for (const name of [...expected].sort(compareStrings)) {
    if (!actual.has(name)) {
      failures.push(`Release assets are missing ${name}.`);
    }
  }
  for (const name of [...actual].sort(compareStrings)) {
    if (!expected.has(name)) {
      failures.push(`Release assets contain unexpected file ${name}.`);
    }
  }
  return failures;
}

export function createReleaseSbom({ created, packages, releaseSha, version }) {
  const failures = validateReleaseSbomInput({
    created,
    packages,
    releaseSha,
    version,
  });
  if (failures.length > 0) {
    throw new TypeError(failures.join('\n'));
  }

  const packageComponents = packages.map((entry) => ({
    SPDXID: releasePackageSpdxId(entry.name),
    checksums: [
      {
        algorithm: 'SHA256',
        checksumValue: entry.sha256,
      },
    ],
    copyrightText: 'NOASSERTION',
    downloadLocation: `${releaseRepositoryUrl}/releases/download/harapter-v${version}/${releaseTarballFileName(entry.name, version)}`,
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceLocator: releasePackagePurl(entry.name, version),
        referenceType: 'purl',
      },
    ],
    filesAnalyzed: false,
    licenseConcluded: 'Apache-2.0',
    licenseDeclared: 'Apache-2.0',
    name: entry.name,
    packageFileName: releaseTarballFileName(entry.name, version),
    primaryPackagePurpose: 'LIBRARY',
    versionInfo: version,
  }));
  const relationships = [
    {
      relatedSpdxElement: releaseRootSpdxId,
      relationshipType: 'DESCRIBES',
      spdxElementId: 'SPDXRef-DOCUMENT',
    },
    ...packages.map((entry) => ({
      relatedSpdxElement: releasePackageSpdxId(entry.name),
      relationshipType: 'CONTAINS',
      spdxElementId: releaseRootSpdxId,
    })),
    ...packages.flatMap((entry) =>
      [...entry.dependencies].sort(compareStrings).map((dependency) => ({
        relatedSpdxElement: releasePackageSpdxId(dependency),
        relationshipType: 'DEPENDS_ON',
        spdxElementId: releasePackageSpdxId(entry.name),
      })),
    ),
  ];

  return {
    SPDXID: 'SPDXRef-DOCUMENT',
    creationInfo: {
      created,
      creators: ['Tool: Harapter release asset builder'],
    },
    dataLicense: 'CC0-1.0',
    documentNamespace: `${releaseRepositoryUrl}/releases/tag/harapter-v${version}/sbom-${releaseSha}`,
    name: `Harapter ${version} release`,
    packages: [
      {
        SPDXID: releaseRootSpdxId,
        copyrightText: 'NOASSERTION',
        downloadLocation: `${repositoryUrl}@${releaseSha}`,
        externalRefs: [
          {
            referenceCategory: 'PACKAGE-MANAGER',
            referenceLocator: `pkg:github/yunfeizhu/harapter@${releaseSha}`,
            referenceType: 'purl',
          },
        ],
        filesAnalyzed: false,
        licenseConcluded: 'Apache-2.0',
        licenseDeclared: 'Apache-2.0',
        name: releaseRepositoryName,
        primaryPackagePurpose: 'SOURCE',
        versionInfo: version,
      },
      ...packageComponents,
    ],
    relationships,
    spdxVersion: 'SPDX-2.3',
  };
}

export function validateReleaseSbom({
  created,
  packages,
  releaseSha,
  sbom,
  version,
}) {
  const failures = validateReleaseSbomInput({
    created,
    packages,
    releaseSha,
    version,
  });
  if (!isMapping(sbom)) {
    failures.push('Release SBOM must contain an SPDX document.');
    return failures;
  }
  if (failures.length > 0) {
    return failures;
  }

  const expected = createReleaseSbom({
    created,
    packages,
    releaseSha,
    version,
  });
  if (JSON.stringify(sbom) !== JSON.stringify(expected)) {
    failures.push(
      'Release SBOM must exactly describe the release commit and package artifacts.',
    );
  }
  return failures;
}

export function renderReleaseChecksums(digests) {
  return [...digests]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([name, digest]) => {
      if (!isReleaseAssetName(name) || !/^[a-f0-9]{64}$/u.test(digest)) {
        throw new TypeError('Release checksum input is invalid.');
      }
      return `${digest}  ${name}\n`;
    })
    .join('');
}

export function validateReleaseChecksums({ checksumText, expectedDigests }) {
  const failures = [];
  if (typeof checksumText !== 'string' || !(expectedDigests instanceof Map)) {
    return ['SHA256SUMS.txt validation input is invalid.'];
  }
  const actual = new Map();
  const normalized = checksumText.endsWith('\n')
    ? checksumText.slice(0, -1)
    : checksumText;
  for (const [index, line] of normalized.split(/\r?\n/u).entries()) {
    const match = line.match(
      /^([a-f0-9]{64}) {2}([A-Za-z0-9][A-Za-z0-9._-]*)$/u,
    );
    if (match === null) {
      failures.push(
        `SHA256SUMS.txt line ${String(index + 1)} has invalid syntax.`,
      );
      continue;
    }
    const [, digest, name] = match;
    if (actual.has(name)) {
      failures.push(`SHA256SUMS.txt contains duplicate file ${name}.`);
      continue;
    }
    actual.set(name, digest);
  }
  for (const [name, digest] of [...expectedDigests].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    if (!actual.has(name)) {
      failures.push(`SHA256SUMS.txt is missing ${name}.`);
    } else if (actual.get(name) !== digest) {
      failures.push(`SHA256SUMS.txt has the wrong digest for ${name}.`);
    }
  }
  for (const name of [...actual.keys()].sort(compareStrings)) {
    if (!expectedDigests.has(name)) {
      failures.push(`SHA256SUMS.txt contains unexpected file ${name}.`);
    }
  }
  return failures;
}

export function validateRemoteReleaseAssets({ assets, expectedAssets }) {
  if (!Array.isArray(assets) || !(expectedAssets instanceof Map)) {
    return ['GitHub Release asset validation input is invalid.'];
  }
  const failures = [];
  const actual = new Map();
  for (const asset of assets) {
    if (!isMapping(asset) || typeof asset.name !== 'string') {
      failures.push('GitHub Release contains an invalid asset.');
      continue;
    }
    if (actual.has(asset.name)) {
      failures.push(`GitHub Release contains duplicate asset ${asset.name}.`);
      continue;
    }
    actual.set(asset.name, asset);
  }
  for (const [name, expected] of [...expectedAssets].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    const asset = actual.get(name);
    if (!isMapping(asset)) {
      failures.push(`GitHub Release is missing asset ${name}.`);
      continue;
    }
    if (asset.state !== 'uploaded') {
      failures.push(`GitHub Release asset ${name} is not uploaded.`);
    }
    if (asset.digest !== `sha256:${expected.sha256}`) {
      failures.push(
        `GitHub Release asset ${name} has the wrong SHA-256 digest.`,
      );
    }
    if (asset.size !== expected.size) {
      failures.push(`GitHub Release asset ${name} has the wrong size.`);
    }
  }
  for (const name of [...actual.keys()].sort(compareStrings)) {
    if (!expectedAssets.has(name)) {
      failures.push(`GitHub Release contains unexpected asset ${name}.`);
    }
  }
  return failures;
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
    workflow?.ref !== `refs/tags/harapter-v${version}`
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

function releaseTarballFileName(name, version) {
  return `${name.slice(1).replace('/', '-')}-${version}.tgz`;
}

function releasePackageSpdxId(name) {
  return `SPDXRef-Package-${name.slice(1).replace('/', '-')}`;
}

function releasePackagePurl(name, version) {
  const [scope, packageName] = name.slice(1).split('/');
  return `pkg:npm/%40${scope}/${packageName}@${version}`;
}

function validateReleaseSbomInput({ created, packages, releaseSha, version }) {
  const failures = validateReleaseVersion(version);
  if (!/^[a-f0-9]{40}$/u.test(releaseSha ?? '')) {
    failures.push('Release SBOM must identify a full release commit SHA.');
  }
  if (
    typeof created !== 'string' ||
    Number.isNaN(Date.parse(created)) ||
    new Date(created).toISOString() !== created
  ) {
    failures.push('Release SBOM must use a canonical release timestamp.');
  }
  if (!Array.isArray(packages) || packages.length === 0) {
    failures.push('Release SBOM packages must be a non-empty array.');
    return failures;
  }

  const packageNames = new Set();
  for (const entry of packages) {
    if (
      !isMapping(entry) ||
      typeof entry.name !== 'string' ||
      !/^@harapter\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.name) ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? '') ||
      !Array.isArray(entry.dependencies) ||
      entry.dependencies.some((dependency) => typeof dependency !== 'string')
    ) {
      failures.push('Release SBOM contains invalid package input.');
      continue;
    }
    if (packageNames.has(entry.name)) {
      failures.push(`Release SBOM contains duplicate package ${entry.name}.`);
    }
    packageNames.add(entry.name);
  }
  for (const entry of packages) {
    if (!isMapping(entry) || !Array.isArray(entry.dependencies)) {
      continue;
    }
    for (const dependency of entry.dependencies) {
      if (!packageNames.has(dependency)) {
        failures.push(
          `Release SBOM package ${String(entry.name)} references unknown package ${String(dependency)}.`,
        );
      }
    }
  }
  return failures;
}

function isReleaseAssetName(value) {
  return (
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  );
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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
