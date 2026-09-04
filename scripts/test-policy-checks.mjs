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
import { JSON_SCHEMA, load } from 'js-yaml';
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
import {
  normalizeRegistryIntegrity,
  validatePackageOrder,
  validatePackedFiles,
  validatePublicPackageManifest,
  validatePublicPackagePolicy,
  validateProvenanceStatement,
  validateRegistryAudit,
  validateRegistryDistribution,
  validateRegistryDistTag,
  validateReleaseVersion,
} from './lib/package-publication.mjs';
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

const pullRequestTemplate = readFileSync(
  resolve(repositoryRoot, '.github/PULL_REQUEST_TEMPLATE.md'),
  'utf8',
);
assert.match(
  pullRequestTemplate,
  /User-visible additions and removals use `feat`, `fix`, or a breaking-change marker; `refactor` is behavior-preserving/u,
);

copyFileSync(
  resolve(repositoryRoot, '.markdownlint-cli2.jsonc'),
  resolve(fixtureRoot, '.markdownlint-cli2.jsonc'),
);
const markdownlintCli = resolve(
  repositoryRoot,
  'node_modules/markdownlint-cli2/markdownlint-cli2-bin.mjs',
);
const checkedInChangelog = readFileSync(
  resolve(repositoryRoot, 'CHANGELOG.md'),
  'utf8',
);
const generatedChangelog = checkedInChangelog.replace(
  '## [Unreleased]',
  `## 0.1.0 (2026-09-03)


### Features

* Added a public feature.

## [Unreleased]`,
);
assert.notEqual(generatedChangelog, checkedInChangelog);
write('CHANGELOG.md', generatedChangelog);
requireSuccess(
  run(markdownlintCli, ['CHANGELOG.md']),
  'Release Please changelog formatting',
);
write(
  'README.md',
  `# Ordinary Markdown


The standard blank-line rule remains enabled.
`,
);
requireFailure(
  run(markdownlintCli, ['README.md']),
  'MD012/no-multiple-blanks',
  'Ordinary Markdown blank-line policy',
);

const publishWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/publish-npm.yml'),
  'utf8',
);
const publishNpm = load(publishWorkflow, { schema: JSON_SCHEMA });
assert.ok(isObject(publishNpm));
assert.deepEqual(Object.keys(publishNpm['on']), ['workflow_dispatch']);
assert.deepEqual(publishNpm['permissions'], { contents: 'read' });
assert.ok(isObject(publishNpm['jobs']));
assert.deepEqual(Object.keys(publishNpm['jobs']).sort(), [
  'publish',
  'resolve-release',
]);
const resolveReleaseJob = requiredJob(publishNpm['jobs'], 'resolve-release');
assert.equal(resolveReleaseJob['if'], "github.ref == 'refs/heads/main'");
assert.doesNotMatch(JSON.stringify(resolveReleaseJob), /secrets\./u);
const resolveReleaseStep = requiredStep(
  resolveReleaseJob,
  'Resolve published release tag',
);
assert.equal(
  resolveReleaseStep['env']['EXPECTED_MAIN_SHA'],
  '${{ github.sha }}',
);
assert.match(
  resolveReleaseStep['run'],
  /repos\/\$GITHUB_REPOSITORY\/releases\/tags\/\$RELEASE_TAG/u,
);
assert.match(
  resolveReleaseStep['run'],
  /repos\/\$GITHUB_REPOSITORY\/git\/ref\/tags\/\$RELEASE_TAG/u,
);
assert.match(resolveReleaseStep['run'], /\.immutable.*=.*"true"/u);
assert.match(resolveReleaseStep['run'], /\.prerelease.*=.*"false"/u);
assert.match(resolveReleaseStep['run'], /\.published_at.*!=.*"null"/u);
assert.match(
  resolveReleaseStep['run'],
  /test "\$object_sha" = "\$EXPECTED_MAIN_SHA"/u,
);
const publishJob = requiredJob(publishNpm['jobs'], 'publish');
assert.equal(publishJob['needs'], 'resolve-release');
assert.equal(publishJob['environment'], 'npm');
assert.deepEqual(publishJob['permissions'], {
  contents: 'read',
  'id-token': 'write',
});
const publishCheckout = requiredStep(
  publishJob,
  'Check out immutable release commit',
);
assert.equal(
  publishCheckout['with']['ref'],
  '${{ needs.resolve-release.outputs.sha }}',
);
assert.equal(publishCheckout['with']['persist-credentials'], false);
assert.match(
  requiredStep(publishJob, 'Run release evidence')['run'],
  /^pnpm check$/u,
);
const bootstrapPublish = requiredStep(
  publishJob,
  'Publish first npm release with bootstrap credential',
);
assert.equal(
  bootstrapPublish['env']['NODE_AUTH_TOKEN'],
  '${{ secrets.NPM_BOOTSTRAP_TOKEN }}',
);
assert.equal(
  bootstrapPublish['env']['EXPECTED_RELEASE_SHA'],
  '${{ needs.resolve-release.outputs.sha }}',
);
assert.match(bootstrapPublish['run'], /--bootstrap/u);
const trustedPublish = requiredStep(
  publishJob,
  'Publish npm release with trusted publishing',
);
assert.doesNotMatch(JSON.stringify(trustedPublish), /secrets\./u);
assert.equal(
  trustedPublish['env']['EXPECTED_RELEASE_SHA'],
  '${{ needs.resolve-release.outputs.sha }}',
);
assert.equal(
  (publishJob['steps'] ?? []).filter((step) =>
    JSON.stringify(step).includes('${{ secrets.'),
  ).length,
  1,
);

const liveCanaryWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/provider-live-canary.yml'),
  'utf8',
);
const liveCanary = load(liveCanaryWorkflow, { schema: JSON_SCHEMA });
assert.ok(isObject(liveCanary));
assert.ok(isObject(liveCanary['on']));
assert.deepEqual(Object.keys(liveCanary['on']).sort(), [
  'schedule',
  'workflow_dispatch',
]);
assert.deepEqual(liveCanary['permissions'], { contents: 'read' });
assert.ok(isObject(liveCanary['jobs']));
const liveJobs = liveCanary['jobs'];
assert.deepEqual(Object.keys(liveJobs).sort(), [
  'codex',
  'dsh',
  'hermes',
  'openclaw',
  'opencode',
  'pi',
  'selection',
]);
const selection = requiredJob(liveJobs, 'selection');
assert.match(
  requiredStep(selection, 'Verify trusted default branch')['run'],
  /test "\$GITHUB_REF" = "refs\/heads\/\$DEFAULT_BRANCH"/u,
);
const providerJobExpectations = {
  codex: {
    install: 'npm install --global @openai/codex@latest',
    liveStep: 'Run Codex live lifecycle',
    liveTest: 'providers/codex/test/live.test.ts',
    processTimeoutSeconds: 300,
    safetyStep: 'Verify Codex model-facing surface',
    secretSteps: new Set([
      'Prepare isolated Codex live configuration',
      'Run Codex live lifecycle',
      'Validate live configuration',
    ]),
  },
  dsh: {
    install: 'npm install --global @deepseek-ai/dsh@alpha',
    liveStep: 'Run DSH live lifecycle',
    liveTest: 'providers/dsh/test/live.test.ts',
    processTimeoutSeconds: 180,
    safetyStep: 'Verify DSH model-facing surface',
    secretSteps: new Set([
      'Run DSH live lifecycle',
      'Validate live configuration',
    ]),
  },
  hermes: {
    install: 'docker pull nousresearch/hermes-agent:latest',
    liveStep: 'Run Hermes Agent live lifecycle',
    liveTest: 'providers/hermes/test/live.test.ts',
    processTimeoutSeconds: 300,
    secretSteps: new Set([
      'Prepare isolated Hermes Agent configuration',
      'Run Hermes Agent live lifecycle',
      'Validate live configuration',
    ]),
  },
  opencode: {
    install: 'npm install --global opencode-ai@latest',
    liveStep: 'Run OpenCode live lifecycle',
    liveTest: 'providers/opencode/test/live.test.ts',
    processTimeoutSeconds: 300,
    secretSteps: new Set([
      'Prepare isolated OpenCode configuration',
      'Run OpenCode live lifecycle',
      'Validate live configuration',
    ]),
  },
  openclaw: {
    install: 'npm install --global --ignore-scripts openclaw@latest',
    liveStep: 'Run OpenClaw live lifecycle',
    liveTest: 'providers/openclaw/test/live.test.ts',
    processTimeoutSeconds: 240,
    secretSteps: new Set([
      'Prepare isolated OpenClaw configuration',
      'Run OpenClaw live lifecycle',
      'Validate live configuration',
    ]),
  },
  pi: {
    install:
      'npm install --global --ignore-scripts @earendil-works/pi-coding-agent@latest',
    liveStep: 'Run Pi Agent live lifecycle',
    liveTest: 'providers/pi/test/live.test.ts',
    processTimeoutSeconds: 300,
    safetyStep: 'Verify Pi Agent model-facing surface',
    secretSteps: new Set([
      'Prepare isolated Pi Agent configuration',
      'Run Pi Agent live lifecycle',
      'Validate live configuration',
    ]),
  },
};
for (const [provider, expectation] of Object.entries(providerJobExpectations)) {
  const job = requiredJob(liveJobs, provider);
  const checkout = requiredStep(job, 'Check out trusted default branch');
  assert.ok(isObject(checkout['with']));
  assert.equal(checkout['with']['persist-credentials'], false);
  assert.equal(checkout['with']['ref'], '${{ github.sha }}');
  assert.equal(job['if'], `needs.selection.outputs.${provider} == 'true'`);
  assert.ok(job['steps'].some((step) => step['run'] === expectation.install));
  assert.match(
    requiredStep(job, expectation.liveStep)['run'],
    new RegExp(
      `timeout --signal=TERM --kill-after=10s ${expectation.processTimeoutSeconds}s pnpm vitest run ${expectation.liveTest.replaceAll('.', '\\.')}`,
      'u',
    ),
  );
  assert.match(JSON.stringify(job), /Harapter revision: \$GITHUB_SHA/u);
  for (const step of job['steps']) {
    const hasSecret = JSON.stringify(step).includes('${{ secrets.');
    assert.equal(hasSecret, expectation.secretSteps.has(step['name']));
  }
  if (expectation.safetyStep !== undefined) {
    const safetyIndex = stepIndex(job, expectation.safetyStep);
    const firstSecretIndex = job['steps'].findIndex((step) =>
      JSON.stringify(step).includes('${{ secrets.'),
    );
    assert.ok(safetyIndex >= 0 && safetyIndex < firstSecretIndex);
  }
}
const codexJob = requiredJob(liveJobs, 'codex');
assertCodexWorkflowEvidence(codexJob);
const weakenedCodexJob = structuredClone(codexJob);
delete requiredStep(weakenedCodexJob, 'Run Codex live lifecycle')['env'][
  'HARAPTER_CODEX_LIVE'
];
assert.throws(() => assertCodexWorkflowEvidence(weakenedCodexJob));
assert.match(
  requiredStep(codexJob, 'Verify Codex model-facing surface')['run'],
  /validate-codex-features/u,
);
assert.match(
  requiredStep(requiredJob(liveJobs, 'dsh'), 'Verify DSH model-facing surface')[
    'run'
  ],
  /--profile sdk-minimal.*validate-dsh-config/su,
);
const dshJob = requiredJob(liveJobs, 'dsh');
assertDshWorkflowEvidence(dshJob);
const weakenedDshJob = structuredClone(dshJob);
delete requiredStep(weakenedDshJob, 'Run DSH live lifecycle')['env'][
  'HARAPTER_DSH_LIVE'
];
assert.throws(() => assertDshWorkflowEvidence(weakenedDshJob));
const openCodeJob = requiredJob(liveJobs, 'opencode');
assertOpenCodeWorkflowEvidence(openCodeJob);
const weakenedOpenCodeJob = structuredClone(openCodeJob);
delete requiredStep(weakenedOpenCodeJob, 'Run OpenCode live lifecycle')['env'][
  'HARAPTER_OPENCODE_LIVE'
];
assert.throws(() => assertOpenCodeWorkflowEvidence(weakenedOpenCodeJob));
assert.match(
  requiredStep(openCodeJob, 'Run OpenCode live lifecycle')['run'],
  /curl --connect-timeout 1 --max-time 2 --fail/u,
);
const piLiveStep = requiredStep(
  requiredJob(liveJobs, 'pi'),
  'Run Pi Agent live lifecycle',
);
assert.deepEqual(piLiveStep['env'], {
  HARAPTER_LIVE_MODEL_API_KEY: '${{ secrets.HARAPTER_LIVE_MODEL_API_KEY }}',
  HARAPTER_PI_LIVE: '1',
  HARAPTER_PI_MODEL: '${{ secrets.HARAPTER_LIVE_MODEL_ID }}',
  PI_CODING_AGENT_DIR: '${{ runner.temp }}/harapter-pi-home',
  PI_CODING_AGENT_SESSION_DIR: '${{ runner.temp }}/harapter-pi-sessions',
  PI_OFFLINE: '1',
  PI_SKIP_VERSION_CHECK: '1',
  PI_TELEMETRY: '0',
});
assert.match(JSON.stringify(piLiveStep), /HARAPTER_PI_COMMAND/u);
assert.match(
  requiredStep(
    requiredJob(liveJobs, 'pi'),
    'Verify Pi Agent model-facing surface',
  )['run'],
  /write-pi-config[\s\S]+timeout --signal=TERM --kill-after=5s 30s pi --no-tools --no-context-files --help[\s\S]+timeout --signal=TERM --kill-after=5s 30s pi --no-tools --no-context-files --list-models/u,
);
assert.match(
  requiredStep(
    requiredJob(liveJobs, 'pi'),
    'Prepare isolated Pi Agent configuration',
  )['run'],
  /write-pi-config/u,
);
const openClawJob = requiredJob(liveJobs, 'openclaw');
assertOpenClawWorkflowEvidence(openClawJob);
const weakenedOpenClawJob = structuredClone(openClawJob);
const weakenedOpenClawLiveStep = requiredStep(
  weakenedOpenClawJob,
  'Run OpenClaw live lifecycle',
);
weakenedOpenClawLiveStep['env']['HARAPTER_OPENCLAW_LIVE'] = '0';
assert.throws(() => assertOpenClawWorkflowEvidence(weakenedOpenClawJob));
const openClawLiveStep = requiredStep(
  openClawJob,
  'Run OpenClaw live lifecycle',
);
assert.deepEqual(openClawLiveStep['env'], {
  DO_NOT_TRACK: '1',
  HARAPTER_LIVE_MODEL_API_KEY: '${{ secrets.HARAPTER_LIVE_MODEL_API_KEY }}',
  HARAPTER_OPENCLAW_LIVE: '1',
  OPENCLAW_CONFIG_PATH:
    '${{ runner.temp }}/harapter-openclaw-state/openclaw.json',
  OPENCLAW_DISABLE_BONJOUR: '1',
  OPENCLAW_GATEWAY_PORT: '18961',
  OPENCLAW_LOAD_SHELL_ENV: '0',
  OPENCLAW_NO_AUTO_UPDATE: '1',
  OPENCLAW_NO_RESPAWN: '1',
  OPENCLAW_OFFLINE: '1',
  OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: '1',
  OPENCLAW_SKIP_CANVAS_HOST: '1',
  OPENCLAW_SKIP_CHANNELS: '1',
  OPENCLAW_SKIP_CRON: '1',
  OPENCLAW_SKIP_GMAIL_WATCHER: '1',
  OPENCLAW_SKIP_PROVIDERS: '1',
  OPENCLAW_SKIP_STARTUP_MODEL_PREWARM: '1',
  OPENCLAW_STATE_DIR: '${{ runner.temp }}/harapter-openclaw-state',
  TMPDIR: '${{ runner.temp }}/harapter-openclaw-tmp',
  XDG_CACHE_HOME: '${{ runner.temp }}/harapter-openclaw-cache',
});
assert.match(
  openClawLiveStep['run'],
  /openclaw_command=\$\(command -v openclaw\)/u,
);
assert.match(openClawLiveStep['run'], /randomBytes\(32\)/u);
assert.match(
  openClawLiveStep['run'],
  /gateway run .*--bind loopback --auth token/u,
);
assert.match(
  openClawLiveStep['run'],
  /timeout --signal=TERM --kill-after=2s 5s .* health --json --timeout 2000/u,
);
assert.match(openClawLiveStep['run'], /trap cleanup_gateway EXIT/u);
assert.match(openClawLiveStep['run'], /kill -KILL "\$gateway_pid"/u);
assert.match(
  openClawLiveStep['run'],
  /unset HARAPTER_LIVE_MODEL_API_KEY[\s\S]+pnpm vitest/u,
);
assert.match(
  openClawLiveStep['run'],
  /pnpm vitest run providers\/openclaw\/test\/live\.test\.ts/u,
);
assert.doesNotMatch(
  liveCanaryWorkflow,
  /npm install --global (?:@openai\/codex|opencode-ai|@deepseek-ai\/dsh|@earendil-works\/pi-coding-agent|openclaw)@\d/u,
);
assert.match(liveCanaryWorkflow, /DSH_TELEMETRY_DISABLED: '1'/u);
assert.doesNotMatch(liveCanaryWorkflow, /continue-on-error/u);

const hermesJob = requiredJob(liveJobs, 'hermes');
assertHermesWorkflowEvidence(hermesJob);
const weakenedHermesJob = structuredClone(hermesJob);
const weakenedHermesLiveStep = requiredStep(
  weakenedHermesJob,
  'Run Hermes Agent live lifecycle',
);
weakenedHermesLiveStep['run'] = weakenedHermesLiveStep['run'].replace(
  'HARAPTER_HERMES_LIVE=1',
  '',
);
assert.throws(() => assertHermesWorkflowEvidence(weakenedHermesJob));
const hermesLiveStep = requiredStep(
  hermesJob,
  'Run Hermes Agent live lifecycle',
);
const hermesIdentityStep = requiredStep(
  hermesJob,
  'Record Hermes Agent runtime identity',
);
assert.match(
  hermesIdentityStep['run'],
  /timeout --signal=TERM --kill-after=5s 30s docker run --rm --name "\$hermes_probe_container"/u,
);
assert.match(hermesIdentityStep['run'], /trap cleanup_hermes_probe EXIT/u);
assert.match(hermesIdentityStep['run'], /docker rm --force/u);
assert.match(hermesLiveStep['run'], /--publish 127\.0\.0\.1:8642:8642/u);
assert.match(
  hermesLiveStep['run'],
  /--mount type=bind,src="\$HERMES_DATA_DIR",dst=\/opt\/data/u,
);
assert.match(hermesLiveStep['run'], /gateway run --no-supervise/u);
assert.match(hermesLiveStep['run'], /trap cleanup_hermes EXIT/u);
assert.match(hermesLiveStep['run'], /docker stop --time 5/u);
assert.match(hermesLiveStep['run'], /docker rm --force/u);
assert.match(hermesLiveStep['run'], /validate-hermes-toolsets/u);
assert.match(hermesLiveStep['run'], /validate-hermes-enabled-toolsets/u);
assert.match(
  hermesLiveStep['run'],
  /timeout --signal=TERM --kill-after=5s 30s docker exec/u,
);
assert.match(
  hermesLiveStep['run'],
  /docker run[\s\S]+unset HARAPTER_LIVE_MODEL_API_KEY[\s\S]+validate-hermes-toolsets[\s\S]+validate-hermes-enabled-toolsets[\s\S]+pnpm vitest/u,
);
assert.doesNotMatch(JSON.stringify(hermesJob), /github\.workspace/u);
assert.doesNotMatch(JSON.stringify(hermesJob), /docker logs/u);
assert.doesNotMatch(JSON.stringify(hermesJob), /actions\/upload-artifact/u);
assert.match(
  liveCanaryWorkflow,
  /docker pull nousresearch\/hermes-agent:latest/u,
);

const codexLiveTest = readFileSync(
  resolve(repositoryRoot, 'providers/codex/test/live.test.ts'),
  'utf8',
);
assertCodexLiveEvidence(codexLiveTest);
const weakenedCodexMessageEvidence = codexLiveTest.replace(
  "assertCompletedTextRun(result, 'HARAPTER_CODEX_LIVE_OK');",
  '',
);
assert.notEqual(weakenedCodexMessageEvidence, codexLiveTest);
assert.throws(() => assertCodexLiveEvidence(weakenedCodexMessageEvidence));
const weakenedCodexEventEvidence = codexLiveTest.replace(
  "expect(eventTypes).toContain('message.completed');",
  '',
);
assert.notEqual(weakenedCodexEventEvidence, codexLiveTest);
assert.throws(() => assertCodexLiveEvidence(weakenedCodexEventEvidence));
const weakenedCodexResumeEvidence = codexLiveTest.replace(
  'assertResumedSession(sessionRef, resumed.ref());',
  '',
);
assert.notEqual(weakenedCodexResumeEvidence, codexLiveTest);
assert.throws(() => assertCodexLiveEvidence(weakenedCodexResumeEvidence));
const weakenedCodexCancellationEvidence = codexLiveTest.replace(
  'assertNativeCancellation(await cancelledRun.cancel());',
  '',
);
assert.notEqual(weakenedCodexCancellationEvidence, codexLiveTest);
assert.throws(() => assertCodexLiveEvidence(weakenedCodexCancellationEvidence));
const leakingCodexFailure = codexLiveTest.replace(
  "throw new Error('Codex did not return the expected synthetic response.');",
  "throw new Error(`Codex did not return the expected synthetic response. ${result.finalMessage ?? ''}`);",
);
assert.notEqual(leakingCodexFailure, codexLiveTest);
assert.throws(() => assertCodexLiveEvidence(leakingCodexFailure));
const maskingCodexFailure = codexLiveTest.replace(
  'await resumed.close();',
  'try {} finally { await resumed.close(); }',
);
assert.notEqual(maskingCodexFailure, codexLiveTest);
assert.throws(() => assertCodexLiveEvidence(maskingCodexFailure));
const maskingCodexClientFailure = codexLiveTest.replace(
  'await client.close().catch(() => undefined);',
  'await client.close();',
);
assert.notEqual(maskingCodexClientFailure, codexLiveTest);
assert.throws(() => assertCodexLiveEvidence(maskingCodexClientFailure));

const dshLiveTest = readFileSync(
  resolve(repositoryRoot, 'providers/dsh/test/live.test.ts'),
  'utf8',
);
assertDshLiveEvidence(dshLiveTest);
const weakenedDshMessageEvidence = dshLiveTest.replace(
  "assertCompletedTextRun(result, 'HARAPTER_DSH_LIVE_OK');",
  '',
);
assert.notEqual(weakenedDshMessageEvidence, dshLiveTest);
assert.throws(() => assertDshLiveEvidence(weakenedDshMessageEvidence));
const weakenedDshEventEvidence = dshLiveTest.replace(
  "expect(eventTypes).toContain('message.completed');",
  '',
);
assert.notEqual(weakenedDshEventEvidence, dshLiveTest);
assert.throws(() => assertDshLiveEvidence(weakenedDshEventEvidence));
const leakingDshFailure = dshLiveTest.replace(
  "throw new Error('DSH did not return the expected synthetic response.');",
  "throw new Error(`DSH did not return the expected synthetic response. ${result.finalMessage ?? ''}`);",
);
assert.notEqual(leakingDshFailure, dshLiveTest);
assert.throws(() => assertDshLiveEvidence(leakingDshFailure));

const openCodeLiveTest = readFileSync(
  resolve(repositoryRoot, 'providers/opencode/test/live.test.ts'),
  'utf8',
);
assertOpenCodeLiveEvidence(openCodeLiveTest);
const skippedOpenCodeLiveSuite = openCodeLiveTest.replace(
  'describe.runIf(liveEnabled)',
  'describe.skip',
);
assert.notEqual(skippedOpenCodeLiveSuite, openCodeLiveTest);
assert.throws(() => assertOpenCodeLiveEvidence(skippedOpenCodeLiveSuite));
const disconnectedOpenCodeLiveFlag = openCodeLiveTest.replace(
  "process.env['HARAPTER_OPENCODE_LIVE']",
  "process.env['HARAPTER_OPENCODE_OTHER']",
);
assert.notEqual(disconnectedOpenCodeLiveFlag, openCodeLiveTest);
assert.throws(() => assertOpenCodeLiveEvidence(disconnectedOpenCodeLiveFlag));
const weakenedOpenCodeMessageEvidence = openCodeLiveTest.replace(
  "assertCompletedTextRun(result, 'HARAPTER_OPENCODE_LIVE_OK');",
  '',
);
assert.notEqual(weakenedOpenCodeMessageEvidence, openCodeLiveTest);
assert.throws(() =>
  assertOpenCodeLiveEvidence(weakenedOpenCodeMessageEvidence),
);
const weakenedOpenCodeEventEvidence = openCodeLiveTest.replace(
  "expect(eventTypes).toContain('message.completed');",
  '',
);
assert.notEqual(weakenedOpenCodeEventEvidence, openCodeLiveTest);
assert.throws(() => assertOpenCodeLiveEvidence(weakenedOpenCodeEventEvidence));
const weakenedOpenCodeResumeEvidence = openCodeLiveTest.replace(
  'assertResumedSession(sessionRef, resumed.ref());',
  '',
);
assert.notEqual(weakenedOpenCodeResumeEvidence, openCodeLiveTest);
assert.throws(() => assertOpenCodeLiveEvidence(weakenedOpenCodeResumeEvidence));
const weakenedOpenCodeCancellationEvidence = openCodeLiveTest.replace(
  'assertNativeCancellation(await cancelledRun.cancel());',
  '',
);
assert.notEqual(weakenedOpenCodeCancellationEvidence, openCodeLiveTest);
assert.throws(() =>
  assertOpenCodeLiveEvidence(weakenedOpenCodeCancellationEvidence),
);
const leakingOpenCodeFailure = openCodeLiveTest.replace(
  "throw new Error('OpenCode did not return the expected synthetic response.');",
  "throw new Error(`OpenCode did not return the expected synthetic response. ${result.finalMessage ?? ''}`);",
);
assert.notEqual(leakingOpenCodeFailure, openCodeLiveTest);
assert.throws(() => assertOpenCodeLiveEvidence(leakingOpenCodeFailure));
const maskingOpenCodeFailure = openCodeLiveTest.replace(
  'await client.close().catch(() => undefined);',
  'await client.close();',
);
assert.notEqual(maskingOpenCodeFailure, openCodeLiveTest);
assert.throws(() => assertOpenCodeLiveEvidence(maskingOpenCodeFailure));

const piLiveTest = readFileSync(
  resolve(repositoryRoot, 'providers/pi/test/live.test.ts'),
  'utf8',
);
assert.match(piLiveTest, /describe\.runIf\(liveEnabled\)/u);
assert.match(piLiveTest, /PI_CODING_AGENT_SESSION_DIR/u);
assert.match(piLiveTest, /assertDirectoryEmpty\(sessionRoot\)/u);
assertPiLiveEvidence(piLiveTest);
const weakenedPiMessageEvidence = piLiveTest.replace(
  "assertExactFinalMessage(result.finalMessage, 'HARAPTER_PI_LIVE_OK');",
  '',
);
assert.notEqual(weakenedPiMessageEvidence, piLiveTest);
assert.throws(() => assertPiLiveEvidence(weakenedPiMessageEvidence));
const weakenedPiEventEvidence = piLiveTest.replace(
  "expect(events.map(({ type }) => type)).toContain('message.completed');",
  '',
);
assert.notEqual(weakenedPiEventEvidence, piLiveTest);
assert.throws(() => assertPiLiveEvidence(weakenedPiEventEvidence));
const weakenedPiCancellationEvidence = piLiveTest.replace(
  "expect(cancelledResult.status).toBe('cancelled');",
  '',
);
assert.notEqual(weakenedPiCancellationEvidence, piLiveTest);
assert.throws(() => assertPiLiveEvidence(weakenedPiCancellationEvidence));

const openClawLiveTest = readFileSync(
  resolve(repositoryRoot, 'providers/openclaw/test/live.test.ts'),
  'utf8',
);
assert.match(openClawLiveTest, /describe\.runIf\(liveEnabled\)/u);
assert.match(openClawLiveTest, /isAbsolute\(liveCommand\)/u);
assert.match(openClawLiveTest, /client\.createSession\(\)/u);
assert.match(openClawLiveTest, /timeout: 10_000/u);
assertOpenClawLiveEvidence(openClawLiveTest);
const weakenedOpenClawMessageEvidence = openClawLiveTest.replace(
  "assertCompletedTextRun(result, 'HARAPTER_OPENCLAW_LIVE_OK');",
  '',
);
assert.notEqual(weakenedOpenClawMessageEvidence, openClawLiveTest);
assert.throws(() =>
  assertOpenClawLiveEvidence(weakenedOpenClawMessageEvidence),
);
const weakenedOpenClawEventEvidence = openClawLiveTest.replace(
  "expect(eventTypes).toContain('message.completed');",
  '',
);
assert.notEqual(weakenedOpenClawEventEvidence, openClawLiveTest);
assert.throws(() => assertOpenClawLiveEvidence(weakenedOpenClawEventEvidence));
const weakenedOpenClawResumeEvidence = openClawLiveTest.replace(
  'assertResumedSession(sessionRef, resumed.ref());',
  '',
);
assert.notEqual(weakenedOpenClawResumeEvidence, openClawLiveTest);
assert.throws(() => assertOpenClawLiveEvidence(weakenedOpenClawResumeEvidence));
const weakenedOpenClawCancellationEvidence = openClawLiveTest.replace(
  'assertNativeCancellation(await cancelledRun.cancel());',
  '',
);
assert.notEqual(weakenedOpenClawCancellationEvidence, openClawLiveTest);
assert.throws(() =>
  assertOpenClawLiveEvidence(weakenedOpenClawCancellationEvidence),
);
const leakingOpenClawFailure = openClawLiveTest.replace(
  "throw new Error('OpenClaw did not return the expected synthetic response.');",
  "throw new Error(`OpenClaw did not return the expected synthetic response. ${result.finalMessage ?? ''}`);",
);
assert.notEqual(leakingOpenClawFailure, openClawLiveTest);
assert.throws(() => assertOpenClawLiveEvidence(leakingOpenClawFailure));

const hermesLiveTest = readFileSync(
  resolve(repositoryRoot, 'providers/hermes/test/live.test.ts'),
  'utf8',
);
assertHermesLiveEvidence(hermesLiveTest);
const weakenedHermesMessageEvidence = hermesLiveTest.replace(
  "assertCompletedTextRun(result, 'HARAPTER_HERMES_LIVE_OK');",
  '',
);
assert.notEqual(weakenedHermesMessageEvidence, hermesLiveTest);
assert.throws(() => assertHermesLiveEvidence(weakenedHermesMessageEvidence));
const weakenedHermesResumeEvidence = hermesLiveTest.replace(
  'assertResumedSession(sessionRef, resumed.ref());',
  '',
);
assert.notEqual(weakenedHermesResumeEvidence, hermesLiveTest);
assert.throws(() => assertHermesLiveEvidence(weakenedHermesResumeEvidence));
const weakenedHermesCancellationEvidence = hermesLiveTest.replace(
  'assertNativeCancellation(await cancelledRun.cancel());',
  '',
);
assert.notEqual(weakenedHermesCancellationEvidence, hermesLiveTest);
assert.throws(() =>
  assertHermesLiveEvidence(weakenedHermesCancellationEvidence),
);
const leakingHermesFailure = hermesLiveTest.replace(
  "throw new Error(\n      'Hermes Agent did not return the expected synthetic response.',\n    );",
  "throw new Error(`Hermes Agent did not return the expected synthetic response. ${result.finalMessage ?? ''}`);",
);
assert.notEqual(leakingHermesFailure, hermesLiveTest);
assert.throws(() => assertHermesLiveEvidence(leakingHermesFailure));

const prepareLiveCanary = resolve(
  repositoryRoot,
  'scripts/prepare-live-canary.mjs',
);
const liveEnvironment = {
  ...process.env,
  HARAPTER_LIVE_MODEL_API_KEY: 'test-key-that-must-not-be-written',
  HARAPTER_LIVE_MODEL_ID: 'test-model',
  HARAPTER_LIVE_MODEL_URL: 'https://model.example.test/v1',
};
const missingLiveEnvironment = { ...liveEnvironment };
delete missingLiveEnvironment.HARAPTER_LIVE_MODEL_API_KEY;
const missingLiveResult = run(
  prepareLiveCanary,
  ['validate'],
  missingLiveEnvironment,
);
requireFailure(
  missingLiveResult,
  'HARAPTER_LIVE_MODEL_API_KEY is not configured.',
  'live-canary missing configuration',
);
assert.doesNotMatch(
  `${missingLiveResult.stderr}${missingLiveResult.stdout}`,
  /test-key-that-must-not-be-written/u,
);

const codexConfigPath = join(fixtureRoot, 'live-config', 'codex.toml');
requireSuccess(
  run(
    prepareLiveCanary,
    ['write-codex-config', codexConfigPath],
    liveEnvironment,
  ),
  'Codex live-canary config',
);
const codexConfig = readFileSync(codexConfigPath, 'utf8');
assert.match(codexConfig, /model_provider = "harapter_live"/u);
assert.match(codexConfig, /wire_api = "responses"/u);
assert.match(codexConfig, /shell_tool = false/u);
for (const feature of [
  'apps',
  'browser_use',
  'computer_use',
  'image_generation',
  'multi_agent',
  'plugins',
  'remote_plugin',
  'workspace_dependencies',
]) {
  assert.match(codexConfig, new RegExp(`^${feature} = false$`, 'mu'));
}
assert.match(codexConfig, /inherit = "none"/u);
assert.doesNotMatch(codexConfig, /test-key-that-must-not-be-written/u);

const codexFeaturesPath = join(
  fixtureRoot,
  'live-config',
  'codex-features.txt',
);
writeFileSync(
  codexFeaturesPath,
  [
    'apps stable false',
    'auth_elicitation stable false',
    'browser_use stable false',
    'browser_use_external stable false',
    'browser_use_full_cdp_access stable false',
    'code_mode_host stable false',
    'collaboration_modes removed true',
    'compaction_image_budget stable true',
    'computer_use stable false',
    'content_item_kinds stable true',
    'enable_request_compression stable true',
    'fast_mode stable false',
    'goals stable false',
    'guardian_approval stable false',
    'hooks stable false',
    'image_generation stable false',
    'in_app_browser stable false',
    'in_app_chat stable false',
    'in_app_dictation stable false',
    'in_app_local_automation stable false',
    'in_app_updates stable false',
    'item_ids removed true',
    'mentions_v2 stable true',
    'multi_agent stable false',
    'personality stable true',
    'plugin_sharing stable false',
    'plugins stable false',
    'remote_compaction_v2 stable false',
    'remote_plugin stable false',
    'resize_all_images removed true',
    'shell_snapshot stable false',
    'shell_tool stable false',
    'skill_mcp_dependency_install stable false',
    'skill_search stable false',
    'sleep_tool stable false',
    'sqlite removed true',
    'steer removed true',
    'terminal_resize_reflow removed true',
    'tool_call_mcp_elicitation stable false',
    'tool_search_always_defer_mcp_tools removed true',
    'tool_suggest stable false',
    'tui_app_server removed true',
    'unbounded_connection_retries stable false',
    'unified_exec stable true',
    'unified_exec_zsh_fork removed true',
    'view_image stable false',
    'workspace_dependencies stable false',
  ].join('\n') + '\n',
  'utf8',
);
requireSuccess(
  run(prepareLiveCanary, ['validate-codex-features', codexFeaturesPath]),
  'Codex safe feature surface',
);
const unsafeCodexFeaturesPath = join(
  fixtureRoot,
  'live-config',
  'codex-features-unsafe.txt',
);
writeFileSync(
  unsafeCodexFeaturesPath,
  readFileSync(codexFeaturesPath, 'utf8') + 'future_tool stable true\n',
  'utf8',
);
requireFailure(
  run(prepareLiveCanary, ['validate-codex-features', unsafeCodexFeaturesPath]),
  'The Codex feature surface is not safe for the live canary.',
  'Codex unknown enabled feature',
);
const unsafeCodexShellPath = join(
  fixtureRoot,
  'live-config',
  'codex-features-shell-enabled.txt',
);
writeFileSync(
  unsafeCodexShellPath,
  readFileSync(codexFeaturesPath, 'utf8').replace(
    'shell_tool stable false',
    'shell_tool stable true',
  ),
  'utf8',
);
requireFailure(
  run(prepareLiveCanary, ['validate-codex-features', unsafeCodexShellPath]),
  'The Codex feature surface is not safe for the live canary.',
  'Codex shell feature',
);

const openCodeConfigPath = join(fixtureRoot, 'live-config', 'opencode.json');
requireSuccess(
  run(
    prepareLiveCanary,
    ['write-opencode-config', openCodeConfigPath],
    liveEnvironment,
  ),
  'OpenCode live-canary config',
);
const openCodeConfig = JSON.parse(readFileSync(openCodeConfigPath, 'utf8'));
assert.equal(openCodeConfig.permission['*'], 'deny');
assert.equal(openCodeConfig.share, 'disabled');
assert.equal(openCodeConfig.tools.bash, false);
assert.equal(
  openCodeConfig.provider['harapter-live'].options.apiKey,
  '{env:HARAPTER_LIVE_MODEL_API_KEY}',
);
assert.equal(
  openCodeConfig.provider['harapter-live'].options.baseURL,
  '{env:HARAPTER_LIVE_MODEL_URL}',
);
assert.doesNotMatch(
  readFileSync(openCodeConfigPath, 'utf8'),
  /test-key-that-must-not-be-written/u,
);

const openClawConfigPath = join(fixtureRoot, 'live-config', 'openclaw.json');
const openClawWorkspacePath = join(fixtureRoot, 'openclaw-workspace');
const openClawLogPath = join(fixtureRoot, 'openclaw.log');
requireSuccess(
  run(
    prepareLiveCanary,
    [
      'write-openclaw-config',
      openClawConfigPath,
      openClawWorkspacePath,
      openClawLogPath,
    ],
    liveEnvironment,
  ),
  'OpenClaw live-canary config',
);
const openClawConfig = JSON.parse(readFileSync(openClawConfigPath, 'utf8'));
assert.equal(openClawConfig.agents.defaults.heartbeat.every, '0m');
assert.equal(
  openClawConfig.agents.defaults.model.primary,
  'harapter-live/test-model',
);
assert.equal(openClawConfig.agents.defaults.workspace, openClawWorkspacePath);
assert.equal(openClawConfig.browser.enabled, false);
assert.equal(openClawConfig.cron.enabled, false);
assert.equal(openClawConfig.gateway.bind, 'loopback');
assert.equal(openClawConfig.gateway.controlUi.enabled, false);
assert.equal(openClawConfig.gateway.nodes.browser.mode, 'off');
assert.equal(openClawConfig.hooks.internal.enabled, false);
assert.equal(openClawConfig.logging.audit.enabled, false);
assert.equal(openClawConfig.logging.file, openClawLogPath);
assert.deepEqual(openClawConfig.mcp.servers, {});
assert.equal(openClawConfig.models.catalogRefresh.enabled, false);
assert.equal(openClawConfig.models.mode, 'replace');
assert.deepEqual(openClawConfig.models.providers['harapter-live'].apiKey, {
  source: 'env',
  provider: 'default',
  id: 'HARAPTER_LIVE_MODEL_API_KEY',
});
assert.equal(
  openClawConfig.models.providers['harapter-live'].baseUrl,
  'https://model.example.test/v1',
);
assert.equal(
  openClawConfig.models.providers['harapter-live'].api,
  'openai-completions',
);
assert.equal(
  openClawConfig.models.providers['harapter-live'].models[0].id,
  'test-model',
);
assert.equal(
  openClawConfig.models.providers['harapter-live'].models[0].compat
    .supportsTools,
  false,
);
assert.equal(openClawConfig.plugins.enabled, false);
assert.deepEqual(openClawConfig.skills.allowBundled, []);
assert.equal(openClawConfig.skills.workshop.autonomous.mode, 'off');
assert.equal(openClawConfig.telemetry.enabled, false);
assert.doesNotMatch(
  readFileSync(openClawConfigPath, 'utf8'),
  /test-key-that-must-not-be-written/u,
);
requireFailure(
  run(
    prepareLiveCanary,
    [
      'write-openclaw-config',
      join(fixtureRoot, 'live-config', 'invalid-openclaw.json'),
      'relative-workspace',
      openClawLogPath,
    ],
    liveEnvironment,
  ),
  'The OpenClaw canary workspace must be absolute.',
  'OpenClaw relative canary workspace',
);

const piConfigPath = join(fixtureRoot, 'live-config', 'pi-models.json');
requireSuccess(
  run(prepareLiveCanary, ['write-pi-config', piConfigPath], liveEnvironment),
  'Pi Agent live-canary config',
);
const piConfig = JSON.parse(readFileSync(piConfigPath, 'utf8'));
assert.equal(
  piConfig.providers['harapter-live'].baseUrl,
  'https://model.example.test/v1',
);
assert.equal(
  piConfig.providers['harapter-live'].apiKey,
  '$HARAPTER_LIVE_MODEL_API_KEY',
);
assert.equal(piConfig.providers['harapter-live'].api, 'openai-completions');
assert.equal(piConfig.providers['harapter-live'].models[0].id, 'test-model');
assert.deepEqual(piConfig.providers['harapter-live'].models[0].input, ['text']);
assert.doesNotMatch(
  readFileSync(piConfigPath, 'utf8'),
  /test-key-that-must-not-be-written/u,
);

const hermesConfigPath = join(fixtureRoot, 'live-config', 'hermes.json');
requireSuccess(
  run(
    prepareLiveCanary,
    ['write-hermes-config', hermesConfigPath],
    liveEnvironment,
  ),
  'Hermes Agent live-canary config',
);
const hermesConfig = JSON.parse(readFileSync(hermesConfigPath, 'utf8'));
assert.deepEqual(hermesConfig.platform_toolsets.api_server, []);
assert.equal(hermesConfig.agent.max_turns, 2);
assert.equal(hermesConfig.auxiliary.background_review.enabled, false);
assert.equal(hermesConfig.auxiliary.title_generation.enabled, false);
assert.equal(hermesConfig.checkpoints.enabled, false);
assert.equal(hermesConfig.compression.enabled, false);
assert.equal(hermesConfig.memory.memory_enabled, false);
assert.equal(hermesConfig.memory.user_profile_enabled, false);
assert.deepEqual(hermesConfig.mcp_servers, {});
assert.deepEqual(hermesConfig.plugins.enabled, []);
assert.equal(hermesConfig.security.allow_lazy_installs, false);
assert.equal(hermesConfig.session_reset.mode, 'none');
assert.equal(hermesConfig.smart_model_routing.enabled, false);
assert.equal(hermesConfig.model.provider, 'custom:harapter-live');
assert.equal(hermesConfig.model.default, 'test-model');
assert.equal(
  hermesConfig.providers['harapter-live'].key_env,
  'HARAPTER_LIVE_MODEL_API_KEY',
);
assert.equal(
  hermesConfig.providers['harapter-live'].transport,
  'chat_completions',
);
assert.doesNotMatch(
  readFileSync(hermesConfigPath, 'utf8'),
  /test-key-that-must-not-be-written/u,
);

const hermesToolsetsPath = join(
  fixtureRoot,
  'live-config',
  'hermes-toolsets.json',
);
writeFileSync(
  hermesToolsetsPath,
  JSON.stringify({
    object: 'list',
    platform: 'api_server',
    data: [
      {
        name: 'terminal',
        enabled: false,
        configured: true,
        tools: ['terminal'],
      },
    ],
  }),
  'utf8',
);
requireSuccess(
  run(prepareLiveCanary, ['validate-hermes-toolsets', hermesToolsetsPath]),
  'Hermes Agent disabled toolset surface',
);
const unsafeHermesToolsetsPath = join(
  fixtureRoot,
  'live-config',
  'hermes-toolsets-unsafe.json',
);
writeFileSync(
  unsafeHermesToolsetsPath,
  JSON.stringify({
    object: 'list',
    platform: 'api_server',
    data: [
      {
        name: 'terminal',
        enabled: true,
        configured: true,
        tools: ['terminal'],
      },
    ],
  }),
  'utf8',
);
requireFailure(
  run(prepareLiveCanary, [
    'validate-hermes-toolsets',
    unsafeHermesToolsetsPath,
  ]),
  'The Hermes Agent toolset surface is not safe for the live canary.',
  'Hermes Agent enabled toolset surface',
);

const hermesEnabledToolsetsPath = join(
  fixtureRoot,
  'live-config',
  'hermes-enabled-toolsets.json',
);
writeFileSync(hermesEnabledToolsetsPath, '[]', 'utf8');
requireSuccess(
  run(prepareLiveCanary, [
    'validate-hermes-enabled-toolsets',
    hermesEnabledToolsetsPath,
  ]),
  'Hermes Agent empty effective toolset surface',
);
writeFileSync(hermesEnabledToolsetsPath, '["hidden-toolset"]', 'utf8');
requireFailure(
  run(prepareLiveCanary, [
    'validate-hermes-enabled-toolsets',
    hermesEnabledToolsetsPath,
  ]),
  'The Hermes Agent effective toolset surface is not safe for the live canary.',
  'Hermes Agent hidden effective toolset surface',
);

const safeDshRows = [
  ['agent', '@deepseek-ai/dsh-agent', false],
  ['agent-invariant', '@deepseek-ai/dsh-agent/invariant', false],
  ['agent-loop', '@deepseek-ai/dsh-agent-loop', false],
  ['agent-loop-invariant', '@deepseek-ai/dsh-agent-loop/invariant', false],
  [
    'deepseek-llm-api-extensions',
    '@deepseek-ai/dsh-deepseek-llm-api-extensions',
    false,
  ],
  ['fs-local', '@deepseek-ai/dsh-fs-local', false],
  ['invariants', '@deepseek-ai/dsh-invariants', false],
  ['jobs', '@deepseek-ai/dsh-jobs-local', false],
  ['llm', '@deepseek-ai/dsh-llm', false],
  ['llm-deepseek', '@deepseek-ai/dsh-llm-deepseek', true],
  ['llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai', false],
  ['llm-retry', '@deepseek-ai/dsh-llm-retry', false],
  ['persistent-bash', '@deepseek-ai/dsh-tool-bash-persistent', true],
  ['persistent-pwsh', '@deepseek-ai/dsh-tool-pwsh-persistent', true],
  [
    'plugin-package-inventory-deepseek',
    '@deepseek-ai/dsh-plugin-package-inventory-deepseek',
    false,
  ],
  ['pty', '@deepseek-ai/dsh-terminal', false],
  ['sandbox', '@deepseek-ai/dsh-sandbox-local', false],
  ['sandbox-policy', '@deepseek-ai/dsh-sandbox-policy', false],
  ['scope-invariant', '@deepseek-ai/dsh-scope/invariant', false],
  ['sdk-app-startup', '@deepseek-ai/dsh-sdk-app', false],
  ['sdk-jsonrpc-server', '@deepseek-ai/dsh-sdk-jsonrpc-server', false],
  ['session', '@deepseek-ai/dsh-session', false],
  ['session-invariant', '@deepseek-ai/dsh-session/invariant', false],
  ['session-log-deepseek', '@deepseek-ai/dsh-session-log-deepseek', false],
  ['session-projection', '@deepseek-ai/dsh-session-projection', false],
  ['session-title', '@deepseek-ai/dsh-session-title', false],
  ['sessions', '@deepseek-ai/dsh-session-persistence-jsonl', false],
  ['str-replace-editor', '@deepseek-ai/dsh-tool-str-replace-editor', true],
  ['subprocess', '@deepseek-ai/dsh-subprocess-local', false],
  ['system-prompt', '@deepseek-ai/dsh-system-prompt', false],
  ['terminal-bash', '@deepseek-ai/dsh-terminal-bash', true],
  ['terminal-pwsh', '@deepseek-ai/dsh-terminal-bash', true],
  ['timer', '@deepseek-ai/cordis-plugin-timer', false],
  ['tools', '@deepseek-ai/dsh-tools', false],
].map(([id, name, disabled]) => ({
  id,
  name,
  ...(disabled ? { disabled: true } : {}),
}));
const dshConfigPath = join(fixtureRoot, 'live-config', 'dsh-effective.json');
writeFileSync(dshConfigPath, JSON.stringify(safeDshRows), 'utf8');
requireSuccess(
  run(prepareLiveCanary, ['validate-dsh-config', dshConfigPath]),
  'DSH safe effective config',
);
const unsafeDshConfigPath = join(
  fixtureRoot,
  'live-config',
  'dsh-effective-unsafe.json',
);
writeFileSync(
  unsafeDshConfigPath,
  JSON.stringify([
    ...safeDshRows,
    { id: 'future-tool', name: '@deepseek-ai/dsh-tool-future' },
  ]),
  'utf8',
);
requireFailure(
  run(prepareLiveCanary, ['validate-dsh-config', unsafeDshConfigPath]),
  'The DSH effective config does not match the reviewed canary surface.',
  'DSH unexpected effective row',
);

const npmPrefix = join(fixtureRoot, 'npm-prefix');
write(
  'npm-prefix/lib/node_modules/@example/runtime/package.json',
  '{"name":"@example/runtime","version":"1.2.3"}\n',
);
const packageSummaryPath = join(fixtureRoot, 'package-summary.md');
requireSuccess(
  run(
    prepareLiveCanary,
    ['record-global-package', 'Runtime', '@example/runtime'],
    {
      ...process.env,
      GITHUB_STEP_SUMMARY: packageSummaryPath,
      NPM_CONFIG_PREFIX: npmPrefix,
    },
  ),
  'live-canary package identity',
);
assert.equal(
  readFileSync(packageSummaryPath, 'utf8'),
  '- Runtime: `@example/runtime@1.2.3`\n',
);
const containerSummaryPath = join(fixtureRoot, 'container-summary.md');
const containerDigest = `example/runtime@sha256:${'a'.repeat(64)}`;
requireSuccess(
  run(
    prepareLiveCanary,
    [
      'record-container-package',
      'Runtime',
      'hermes-agent',
      '0.21.0',
      containerDigest,
    ],
    {
      ...process.env,
      GITHUB_STEP_SUMMARY: containerSummaryPath,
    },
  ),
  'live-canary container identity',
);
assert.equal(
  readFileSync(containerSummaryPath, 'utf8'),
  `- Runtime: \`hermes-agent@0.21.0\`\n- Image: \`${containerDigest}\`\n`,
);
requireFailure(
  run(
    prepareLiveCanary,
    [
      'record-container-package',
      'Runtime',
      'hermes-agent',
      '0.21.0',
      'example/runtime@sha256:not-a-digest',
    ],
    {
      ...process.env,
      GITHUB_STEP_SUMMARY: containerSummaryPath,
    },
  ),
  'The container runtime identity is invalid.',
  'live-canary malformed container identity',
);

function write(path, content) {
  const absolutePath = resolve(fixtureRoot, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function run(script, argumentsList = [], environment = process.env) {
  return spawnSync(process.execPath, [script, ...argumentsList], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: environment,
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

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertCodexLiveEvidence(source) {
  assert.match(source, /isAbsolute\(liveCommand\)/u);
  assert.match(source, /command: liveCommand/u);
  assert.match(source, /approvalPolicy: 'never'/u);
  assert.match(source, /ephemeral: false/u);
  assert.match(source, /sandbox: 'read-only'/u);
  assert.match(source, /session\.start\s*\(/u);
  assert.match(source, /assertToolFreeLiveEvent\(event\)/u);
  assert.match(
    source,
    /assertCompletedTextRun\(result, 'HARAPTER_CODEX_LIVE_OK'\)/u,
  );
  assert.match(source, /eventTypes\)\.toContain\('run\.started'\)/u);
  assert.match(source, /eventTypes\)\.toContain\('message\.completed'\)/u);
  assert.match(source, /eventTypes\.at\(-1\)\)\.toBe\('run\.completed'\)/u);
  assert.match(source, /client\.resumeSession\(sessionRef\)/u);
  assert.match(source, /assertResumedSession\(sessionRef, resumed\.ref\(\)\)/u);
  assert.match(
    source,
    /assertNativeCancellation\(await cancelledRun\.cancel\(\)\)/u,
  );
  assert.match(source, /assertCancelledRun\(cancelledResult\)/u);
  assert.match(
    source,
    /cancelledEventTypes\.at\(-1\)\)\.toBe\('run\.cancelled'\)/u,
  );
  assert.match(source, /await session\.close\(\)/u);
  assert.match(source, /await resumed\.close\(\)/u);
  assert.match(source, /await client\.close\(\)/u);
  assert.match(source, /let primaryFailure: unknown/u);
  assert.match(source, /primaryFailure = error/u);
  assert.match(source, /await client\.close\(\)\.catch\(\(\) => undefined\)/u);
  assert.match(
    source,
    /assertSupportedDescriptor\(await client\.descriptor\(\)\)/u,
  );
  assert.match(source, /assertOwnedSessionRef\(sessionRef\)/u);
  assert.match(source, /assertThrowsExactMessage\(\(\) => \{/u);
  assert.doesNotMatch(
    source,
    /throw new Error\(`[^`]*\$\{result\.finalMessage/u,
  );
  assert.doesNotMatch(source, /events\.push\(event\)/u);
  assert.doesNotMatch(source, /expect\(result/u);
  assert.doesNotMatch(source, /expect\(sessionRef/u);
  assert.doesNotMatch(source, /expect\(resumed\.ref/u);
  assert.doesNotMatch(source, /expect\(client\.descriptor/u);
  assert.doesNotMatch(
    source,
    /finally\s*\{\s*await (?:session|resumed)\.close\(\)/u,
  );
}

function assertCodexWorkflowEvidence(job) {
  const liveStep = requiredStep(job, 'Run Codex live lifecycle');
  assert.ok(isObject(liveStep['env']));
  assert.equal(liveStep['env']['HARAPTER_CODEX_LIVE'], '1');
  assert.equal(liveStep['continue-on-error'], undefined);
  assert.match(liveStep['run'], /codex_command=\$\(command -v codex\)/u);
  assert.match(liveStep['run'], /HARAPTER_CODEX_COMMAND="\$codex_command"/u);
  const summaryStep = requiredStep(job, 'Record passing Codex evidence');
  assert.ok(
    stepIndex(job, 'Record passing Codex evidence') >
      stepIndex(job, 'Run Codex live lifecycle'),
  );
  assert.equal(summaryStep['if'], undefined);
  assert.equal(summaryStep['continue-on-error'], undefined);
  assert.match(summaryStep['run'], /- Lifecycle: passed/u);
  assert.match(summaryStep['run'], /- Synthetic Prompts submitted: 2/u);
  assert.match(summaryStep['run'], /- Completed message Event: passed/u);
  assert.match(summaryStep['run'], /- Session resume: passed/u);
  assert.match(summaryStep['run'], /- Native cancellation: passed/u);
  assert.match(
    summaryStep['run'],
    /- Authoritative terminals: run\.completed, run\.cancelled/u,
  );
  assert.match(summaryStep['run'], /- Model tools enabled: 0/u);
}

function assertOpenCodeLiveEvidence(source) {
  assert.match(
    source,
    /const liveEnabled = process\.env\['HARAPTER_OPENCODE_LIVE'\] === '1'/u,
  );
  assert.match(source, /describe\.runIf\(liveEnabled\)/u);
  assert.match(source, /session\.start\s*\(/u);
  assert.match(source, /assertToolFreeLiveEvent\(event\)/u);
  assert.match(
    source,
    /assertCompletedTextRun\(result, 'HARAPTER_OPENCODE_LIVE_OK'\)/u,
  );
  assert.match(source, /eventTypes\)\.toContain\('run\.started'\)/u);
  assert.match(source, /eventTypes\)\.toContain\('message\.completed'\)/u);
  assert.match(source, /eventTypes\.at\(-1\)\)\.toBe\('run\.completed'\)/u);
  assert.match(
    source,
    /const resumedClient = await factory\.connect\(profile\)/u,
  );
  assert.match(source, /resumedClient\.resumeSession\(sessionRef\)/u);
  assert.match(source, /assertResumedSession\(sessionRef, resumed\.ref\(\)\)/u);
  assert.match(
    source,
    /assertNativeCancellation\(await cancelledRun\.cancel\(\)\)/u,
  );
  assert.match(source, /assertCancelledRun\(cancelledResult\)/u);
  assert.match(
    source,
    /cancelledEventTypes\.at\(-1\)\)\.toBe\('run\.cancelled'\)/u,
  );
  assert.match(source, /await session\.close\(\)/u);
  assert.match(source, /await resumed\.close\(\)/u);
  assert.match(source, /await client\.close\(\)/u);
  assert.match(source, /await resumedClient\.close\(\)/u);
  assert.match(source, /let primaryFailure: unknown/u);
  assert.match(source, /primaryFailure = error/u);
  assert.match(source, /await client\.close\(\)\.catch\(\(\) => undefined\)/u);
  assert.match(
    source,
    /assertSupportedDescriptor\(await client\.descriptor\(\)\)/u,
  );
  assert.match(source, /assertOwnedSessionRef\(ref\)/u);
  assert.match(source, /assertThrowsExactMessage\(\(\) => \{/u);
  assert.doesNotMatch(
    source,
    /throw new Error\(`[^`]*\$\{result\.finalMessage/u,
  );
  assert.doesNotMatch(source, /events\.push\(event\)/u);
  assert.doesNotMatch(source, /expect\(result/u);
  assert.doesNotMatch(source, /expect\(sessionRef/u);
  assert.doesNotMatch(source, /expect\(resumed\.ref/u);
  assert.doesNotMatch(source, /expect\(client\.descriptor/u);
  assert.doesNotMatch(source, /HARAPTER_OPENCODE_LIVE_CONTROL/u);
}

function assertOpenCodeWorkflowEvidence(job) {
  const liveStep = requiredStep(job, 'Run OpenCode live lifecycle');
  assert.ok(isObject(liveStep['env']));
  assert.equal(liveStep['env']['HARAPTER_OPENCODE_LIVE'], '1');
  assert.equal(liveStep['continue-on-error'], undefined);
  assert.match(liveStep['run'], /opencode_command=\$\(command -v opencode\)/u);
  assert.match(liveStep['run'], /"\$opencode_command" serve/u);
  assert.match(liveStep['run'], /trap cleanup_opencode EXIT/u);
  assert.match(liveStep['run'], /kill -TERM "\$server_pid"/u);
  assert.match(liveStep['run'], /for _cleanup_attempt in \$\(seq 1 10\)/u);
  assert.match(liveStep['run'], /kill -KILL "\$server_pid"/u);
  assert.match(
    liveStep['run'],
    /unset HARAPTER_LIVE_MODEL_API_KEY[\s\S]+unset HARAPTER_LIVE_MODEL_ID[\s\S]+unset HARAPTER_LIVE_MODEL_URL[\s\S]+pnpm vitest/u,
  );
  assert.doesNotMatch(liveStep['run'], /cat .*opencode-server\.log/u);
  const summaryStep = requiredStep(job, 'Record passing OpenCode evidence');
  assert.ok(
    stepIndex(job, 'Record passing OpenCode evidence') >
      stepIndex(job, 'Run OpenCode live lifecycle'),
  );
  assert.equal(summaryStep['if'], undefined);
  assert.equal(summaryStep['continue-on-error'], undefined);
  assert.match(summaryStep['run'], /- Lifecycle: passed/u);
  assert.match(summaryStep['run'], /- Synthetic Prompts submitted: 2/u);
  assert.match(summaryStep['run'], /- Completed message Event: passed/u);
  assert.match(summaryStep['run'], /- Session resume: passed/u);
  assert.match(summaryStep['run'], /- Native cancellation: passed/u);
  assert.match(
    summaryStep['run'],
    /- Authoritative terminals: run\.completed, run\.cancelled/u,
  );
  assert.match(summaryStep['run'], /- Model tools enabled: 0/u);
}

function assertOpenClawLiveEvidence(source) {
  assert.match(source, /args: \['acp', '--no-prefix-cwd'\]/u);
  assert.match(source, /session\.start\s*\(/u);
  assert.match(source, /assertToolFreeLiveEvent\(event\)/u);
  assert.match(
    source,
    /assertCompletedTextRun\(result, 'HARAPTER_OPENCLAW_LIVE_OK'\)/u,
  );
  assert.match(source, /eventTypes\)\.toContain\('run\.started'\)/u);
  assert.match(source, /eventTypes\)\.toContain\('message\.completed'\)/u);
  assert.match(source, /eventTypes\.at\(-1\)\)\.toBe\('run\.completed'\)/u);
  assert.match(
    source,
    /const resumedClient = await factory\.connect\(profile\)/u,
  );
  assert.match(source, /resumedClient\.resumeSession\(sessionRef\)/u);
  assert.match(source, /assertResumedSession\(sessionRef, resumed\.ref\(\)\)/u);
  assert.match(
    source,
    /assertNativeCancellation\(await cancelledRun\.cancel\(\)\)/u,
  );
  assert.match(source, /assertCancelledRun\(cancelledResult\)/u);
  assert.match(
    source,
    /cancelledEventTypes\.at\(-1\)\)\.toBe\('run\.cancelled'\)/u,
  );
  assert.match(source, /await client\.close\(\)/u);
  assert.match(source, /await resumed\.close\(\)/u);
  assert.match(source, /await resumedClient\.close\(\)/u);
  assert.match(source, /assertSuccessfulVersionProbe\(version\.status\)/u);
  assert.match(
    source,
    /assertSupportedDescriptor\(await client\.descriptor\(\)\)/u,
  );
  assert.match(source, /assertOwnedSessionRef\(ref\)/u);
  assert.match(source, /assertThrowsExactMessage\(\(\) => \{/u);
  assert.doesNotMatch(
    source,
    /throw new Error\(`[^`]*\$\{result\.finalMessage/u,
  );
  assert.doesNotMatch(source, /events\.push\(event\)/u);
  assert.doesNotMatch(source, /expect\(result/u);
  assert.doesNotMatch(source, /expect\(sessionRef/u);
  assert.doesNotMatch(source, /expect\(resumed\.ref/u);
  assert.doesNotMatch(source, /expect\(version/u);
  assert.doesNotMatch(source, /expect\(client\.descriptor/u);
}

function assertOpenClawWorkflowEvidence(job) {
  const liveStep = requiredStep(job, 'Run OpenClaw live lifecycle');
  assert.ok(isObject(liveStep['env']));
  assert.equal(liveStep['env']['HARAPTER_OPENCLAW_LIVE'], '1');
  assert.equal(liveStep['continue-on-error'], undefined);
  const summaryStep = requiredStep(job, 'Record passing OpenClaw evidence');
  assert.ok(
    stepIndex(job, 'Record passing OpenClaw evidence') >
      stepIndex(job, 'Run OpenClaw live lifecycle'),
  );
  assert.equal(summaryStep['if'], undefined);
  assert.equal(summaryStep['continue-on-error'], undefined);
  assert.match(summaryStep['run'], /- Lifecycle: passed/u);
  assert.match(summaryStep['run'], /- Synthetic Prompts submitted: 2/u);
  assert.match(summaryStep['run'], /- Completed message Event: passed/u);
  assert.match(summaryStep['run'], /- Session resume: passed/u);
  assert.match(summaryStep['run'], /- Native cancellation: passed/u);
  assert.match(
    summaryStep['run'],
    /- Authoritative terminals: run\.completed, run\.cancelled/u,
  );
  assert.match(summaryStep['run'], /- Model tools enabled: no/u);
}

function assertDshLiveEvidence(source) {
  assert.match(source, /session\.start\s*\(/u);
  assert.match(source, /assertToolFreeLiveEvent\(event\)/u);
  assert.match(
    source,
    /assertCompletedTextRun\(result, 'HARAPTER_DSH_LIVE_OK'\)/u,
  );
  assert.match(source, /eventTypes\)\.toContain\('run\.started'\)/u);
  assert.match(source, /eventTypes\)\.toContain\('message\.completed'\)/u);
  assert.match(source, /eventTypes\.at\(-1\)\)\.toBe\('run\.completed'\)/u);
  assert.match(source, /await session\.close\(\)/u);
  assert.match(source, /await client\.close\(\)/u);
  assert.match(
    source,
    /throw new Error\('DSH did not return the expected synthetic response\.'\);/u,
  );
  assert.match(source, /assertThrowsExactMessage\(\(\) => \{/u);
  assert.doesNotMatch(source, /expect\(result/u);
  assert.doesNotMatch(source, /toMatchObject\(\{\s*status: 'completed'/u);
}

function assertDshWorkflowEvidence(job) {
  const liveStep = requiredStep(job, 'Run DSH live lifecycle');
  assert.ok(isObject(liveStep['env']));
  assert.equal(liveStep['env']['HARAPTER_DSH_LIVE'], '1');
  assert.equal(liveStep['continue-on-error'], undefined);
  const summaryStep = requiredStep(job, 'Record passing DSH evidence');
  assert.ok(
    stepIndex(job, 'Record passing DSH evidence') >
      stepIndex(job, 'Run DSH live lifecycle'),
  );
  assert.equal(summaryStep['if'], undefined);
  assert.equal(summaryStep['continue-on-error'], undefined);
  assert.match(summaryStep['run'], /- Lifecycle: passed/u);
  assert.match(summaryStep['run'], /- Prompt submitted: yes/u);
  assert.match(summaryStep['run'], /- Completed message Event: passed/u);
  assert.match(summaryStep['run'], /- Authoritative terminal: run\.completed/u);
  assert.match(summaryStep['run'], /- Model tools enabled: 0/u);
}

function assertHermesLiveEvidence(source) {
  assert.match(source, /session\.start\s*\(/u);
  assert.match(source, /assertToolFreeLiveEvent\(event\)/u);
  assert.match(
    source,
    /assertCompletedTextRun\(result, 'HARAPTER_HERMES_LIVE_OK'\)/u,
  );
  assert.match(source, /eventTypes\)\.toContain\('run\.started'\)/u);
  assert.match(source, /eventTypes\)\.toContain\('message\.completed'\)/u);
  assert.match(source, /eventTypes\.at\(-1\)\)\.toBe\('run\.completed'\)/u);
  assert.match(source, /client\.resumeSession\(sessionRef\)/u);
  assert.match(source, /assertResumedSession\(sessionRef, resumed\.ref\(\)\)/u);
  assert.match(
    source,
    /assertNativeCancellation\(await cancelledRun\.cancel\(\)\)/u,
  );
  assert.match(source, /assertCancelledRun\(cancelledResult\)/u);
  assert.match(
    source,
    /cancelledEventTypes\.at\(-1\)\)\.toBe\('run\.cancelled'\)/u,
  );
  assert.match(source, /await session\.close\(\)/u);
  assert.match(source, /await resumed\.close\(\)/u);
  assert.match(source, /await client\.close\(\)/u);
  assert.match(
    source,
    /'Hermes Agent did not return the expected synthetic response\.'/u,
  );
  assert.match(source, /assertThrowsExactMessage\(\(\) => \{/u);
  assert.doesNotMatch(
    source,
    /throw new Error\(`[^`]*\$\{result\.finalMessage/u,
  );
  assert.doesNotMatch(source, /events\.push\(event\)/u);
  assert.doesNotMatch(source, /expect\(result/u);
  assert.doesNotMatch(source, /expect\(sessionRef/u);
  assert.doesNotMatch(source, /expect\(resumed\.ref/u);
}

function assertHermesWorkflowEvidence(job) {
  const liveStep = requiredStep(job, 'Run Hermes Agent live lifecycle');
  assert.match(liveStep['run'], /HARAPTER_HERMES_LIVE=1/u);
  assert.equal(liveStep['continue-on-error'], undefined);
  const summaryStep = requiredStep(job, 'Record passing Hermes Agent evidence');
  assert.ok(
    stepIndex(job, 'Record passing Hermes Agent evidence') >
      stepIndex(job, 'Run Hermes Agent live lifecycle'),
  );
  assert.equal(summaryStep['if'], undefined);
  assert.equal(summaryStep['continue-on-error'], undefined);
  assert.match(summaryStep['run'], /- Lifecycle: passed/u);
  assert.match(summaryStep['run'], /- Prompt submitted: yes/u);
  assert.match(summaryStep['run'], /- Completed message Event: passed/u);
  assert.match(summaryStep['run'], /- Session resume: passed/u);
  assert.match(summaryStep['run'], /- Native cancellation: passed/u);
  assert.match(
    summaryStep['run'],
    /- Authoritative terminals: run\.completed, run\.cancelled/u,
  );
  assert.match(summaryStep['run'], /- Model toolsets enabled: 0/u);
}

function assertPiLiveEvidence(source) {
  assert.match(source, /'--no-tools'/u);
  assert.match(source, /'--no-context-files'/u);
  assert.match(source, /session\.start\s*\(/u);
  assert.match(source, /client\.resumeSession\(sessionRef\)/u);
  assert.match(source, /assertToolFreeLiveEvent\(event\)/u);
  assert.match(source, /result\.status\)\.toBe\('completed'\)/u);
  assert.match(
    source,
    /assertExactFinalMessage\(result\.finalMessage, 'HARAPTER_PI_LIVE_OK'\)/u,
  );
  assert.match(source, /assertPersistentSessionRef\(sessionRef\)/u);
  assert.match(source, /assertResumedSession\(sessionRef, resumed\.ref\(\)\)/u);
  assert.match(source, /assertDirectoryEmpty\(sessionRoot\)/u);
  assert.doesNotMatch(source, /expect\(result\.finalMessage/u);
  assert.doesNotMatch(source, /expect\(sessionRef/u);
  assert.doesNotMatch(source, /expect\(resumed\.ref\(\)\.providerSessionId/u);
  assert.doesNotMatch(source, /expect\(readdir/u);
  assert.match(source, /toContain\('message\.completed'\)/u);
  assert.match(source, /events\.at\(-1\)\?\.type\)\.toBe\('run\.completed'\)/u);
  assert.match(source, /cancelledRun\.cancel\(\)/u);
  assert.match(source, /mode: 'native'/u);
  assert.match(source, /cancelledResult\.status\)\.toBe\('cancelled'\)/u);
  assert.match(
    source,
    /cancelledEvents\.at\(-1\)\?\.type\)\.toBe\('run\.cancelled'\)/u,
  );
}

function requiredJob(jobs, id) {
  const job = jobs[id];
  assert.ok(isObject(job), `Expected ${id} to be a workflow job.`);
  assert.ok(Array.isArray(job['steps']), `Expected ${id} to define steps.`);
  return job;
}

function requiredStep(job, name) {
  const step = job['steps'].find(
    (candidate) => isObject(candidate) && candidate['name'] === name,
  );
  assert.ok(isObject(step), `Expected workflow step ${name}.`);
  return step;
}

function stepIndex(job, name) {
  return job['steps'].findIndex(
    (step) => isObject(step) && step['name'] === name,
  );
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

const publicPackagePolicyFixture = {
  schemaVersion: 1,
  distTag: 'next',
  packages: [
    {
      path: 'packages/core',
      name: '@harapter/core',
      smokeExport: 'HarnessRegistry',
    },
  ],
};
assert.deepEqual(validatePublicPackagePolicy(publicPackagePolicyFixture), []);
assert.deepEqual(
  validateReleaseAutomation({
    prettierIgnore: 'node_modules\nCHANGELOG.md\n',
    publicPackagePolicy: publicPackagePolicyFixture,
    releasePleaseConfig: {
      packages: {
        '.': {
          'initial-version': '0.1.0',
          'release-type': 'simple',
          'extra-files': [
            { type: 'json', path: 'package.json', jsonpath: '$.version' },
            {
              type: 'json',
              path: 'packages/core/package.json',
              jsonpath: '$.version',
            },
          ],
        },
      },
    },
  }),
  [],
);
assert.deepEqual(
  validateReleaseAutomation({
    prettierIgnore: 'node_modules\n',
    publicPackagePolicy: publicPackagePolicyFixture,
    releasePleaseConfig: {
      packages: { '.': { 'initial-version': '1.0.0' } },
    },
  }),
  [
    'release-please-config.json must set packages["."].initial-version to 0.1.0.',
    'release-please-config.json must keep one simple root release train.',
    'release-please-config.json must update package.json on every release.',
    'release-please-config.json must update packages/core/package.json on every release.',
    '.prettierignore must exclude Release Please-owned CHANGELOG.md.',
  ],
);

assert.deepEqual(
  validatePublicPackagePolicy({
    schemaVersion: 2,
    distTag: 'latest',
    packages: [
      { path: 'examples/demo', name: '@other/core', smokeExport: 'not-valid!' },
      { path: 'examples/demo', name: '@other/core', smokeExport: '' },
    ],
    unexpected: true,
  }),
  [
    'scripts/public-packages.json contains unknown key unexpected.',
    'scripts/public-packages.json schemaVersion must be 1.',
    'scripts/public-packages.json distTag must be next.',
    'scripts/public-packages.json packages[0].path must identify one package directory.',
    'scripts/public-packages.json packages[0].name must be an @harapter package name.',
    'scripts/public-packages.json packages[0].smokeExport must be a public identifier.',
    'scripts/public-packages.json packages[1].path must identify one package directory.',
    'scripts/public-packages.json packages[1].name must be an @harapter package name.',
    'scripts/public-packages.json packages[1].smokeExport must be a public identifier.',
  ],
);

const validPublicManifest = {
  name: '@harapter/core',
  version: '0.0.0',
  description: 'Portable contracts.',
  license: 'Apache-2.0',
  repository: {
    type: 'git',
    url: 'git+https://github.com/yunfeizhu/harapter.git',
    directory: 'packages/core',
  },
  bugs: { url: 'https://github.com/yunfeizhu/harapter/issues' },
  homepage: 'https://github.com/yunfeizhu/harapter#readme',
  type: 'module',
  sideEffects: false,
  files: ['dist'],
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
  },
  engines: { node: '>=24' },
  publishConfig: {
    access: 'public',
    provenance: true,
    registry: 'https://registry.npmjs.org/',
    tag: 'next',
  },
  scripts: { build: 'tsc --build' },
};
assert.deepEqual(
  validatePublicPackageManifest({
    entry: publicPackagePolicyFixture.packages[0],
    knownPackageNames: new Set(['@harapter/core']),
    packageJson: validPublicManifest,
  }),
  [],
);
assert.deepEqual(
  validatePublicPackageManifest({
    entry: publicPackagePolicyFixture.packages[0],
    knownPackageNames: new Set(['@harapter/core']),
    packageJson: {
      ...validPublicManifest,
      private: false,
      files: ['dist', 'src'],
      dependencies: { '@harapter/missing': '^1.0.0' },
    },
  }),
  [
    'packages/core/package.json must not set private.',
    'packages/core/package.json files must contain only dist.',
    'packages/core/package.json dependencies contains unknown public package @harapter/missing.',
    'packages/core/package.json dependencies.@harapter/missing must use workspace:* before packing.',
  ],
);
assert.deepEqual(
  validatePackageOrder(
    [
      { name: '@harapter/adapter', path: 'providers/adapter' },
      { name: '@harapter/core', path: 'packages/core' },
    ],
    new Map([
      [
        'providers/adapter',
        { dependencies: { '@harapter/core': 'workspace:*' } },
      ],
      ['packages/core', validPublicManifest],
    ]),
  ),
  [
    'scripts/public-packages.json must list @harapter/core before @harapter/adapter.',
  ],
);
assert.deepEqual(
  validatePackedFiles(
    publicPackagePolicyFixture.packages[0],
    [
      'LICENSE',
      'README.md',
      'package.json',
      'dist/index.js',
      'dist/index.d.ts',
    ].map((path) => ({ path })),
  ),
  [],
);
assert.deepEqual(
  validatePackedFiles(publicPackagePolicyFixture.packages[0], [
    { path: 'package.json' },
    { path: 'src/index.ts' },
    { path: 'dist/tsconfig.build.tsbuildinfo' },
  ]),
  [
    '@harapter/core tarball is missing LICENSE.',
    '@harapter/core tarball is missing README.md.',
    '@harapter/core tarball is missing dist/index.js.',
    '@harapter/core tarball is missing dist/index.d.ts.',
    '@harapter/core tarball contains unexpected path src/index.ts.',
    '@harapter/core tarball must not contain dist/tsconfig.build.tsbuildinfo.',
  ],
);
assert.deepEqual(validateReleaseVersion('0.1.0'), []);
assert.deepEqual(validateReleaseVersion('0.0.0'), [
  'Release version 0.0.0 is not publishable.',
]);
assert.deepEqual(validateReleaseVersion('0.2.0', { bootstrap: true }), [
  'The npm bootstrap path is restricted to release 0.1.0.',
]);
const registryIntegrity = `sha512-${Buffer.from('a'.repeat(128), 'hex').toString('base64')}`;
const otherRegistryIntegrity = `sha512-${Buffer.from('b'.repeat(128), 'hex').toString('base64')}`;
assert.equal(
  normalizeRegistryIntegrity(`"${registryIntegrity}"\n`),
  registryIntegrity,
);
assert.equal(normalizeRegistryIntegrity('sha1-not-accepted'), undefined);

const registryDist = {
  integrity: registryIntegrity,
  attestations: {
    url: 'https://registry.npmjs.org/-/npm/v1/attestations/@harapter%2fcore@0.1.0',
    provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
  },
};
assert.deepEqual(
  validateRegistryDistribution({
    dist: registryDist,
    localIntegrity: registryIntegrity,
    name: '@harapter/core',
    version: '0.1.0',
  }),
  [],
);
assert.deepEqual(
  validateRegistryDistribution({
    dist: {
      ...registryDist,
      integrity: otherRegistryIntegrity,
      attestations: {
        url: 'https://example.com/untrusted',
        provenance: { predicateType: 'unexpected' },
      },
    },
    localIntegrity: registryIntegrity,
    name: '@harapter/core',
    version: '0.1.0',
  }),
  [
    '@harapter/core@0.1.0 has different immutable registry content.',
    '@harapter/core@0.1.0 is missing npm provenance metadata.',
    '@harapter/core@0.1.0 returned an unexpected npm attestation URL.',
  ],
);
assert.deepEqual(
  validateRegistryDistTag({
    distTag: 'next',
    distTags: { next: '0.1.0' },
    name: '@harapter/core',
    version: '0.1.0',
  }),
  [],
);
assert.deepEqual(
  validateRegistryDistTag({
    distTag: 'next',
    distTags: { next: '0.2.0' },
    name: '@harapter/core',
    version: '0.1.0',
  }),
  ['@harapter/core@0.1.0 must own the npm next dist-tag.'],
);

const releaseCommit = 'c'.repeat(40);
const provenanceStatement = {
  predicateType: 'https://slsa.dev/provenance/v1',
  subject: [{ digest: { sha512: 'a'.repeat(128) } }],
  predicate: {
    buildDefinition: {
      externalParameters: {
        workflow: {
          repository: 'https://github.com/yunfeizhu/harapter',
          path: '.github/workflows/publish-npm.yml',
          ref: 'refs/heads/main',
        },
      },
      resolvedDependencies: [{ digest: { gitCommit: releaseCommit } }],
    },
    runDetails: {
      builder: { id: 'https://github.com/actions/runner/github-hosted' },
    },
  },
};
assert.deepEqual(
  validateProvenanceStatement({
    expectedCommit: releaseCommit,
    localIntegrity: registryIntegrity,
    name: '@harapter/core',
    statement: provenanceStatement,
    version: '0.1.0',
  }),
  [],
);
assert.deepEqual(
  validateProvenanceStatement({
    expectedCommit: 'd'.repeat(40),
    localIntegrity: otherRegistryIntegrity,
    name: '@harapter/core',
    statement: {
      ...provenanceStatement,
      predicateType: 'unexpected',
      predicate: {
        ...provenanceStatement.predicate,
        buildDefinition: {
          ...provenanceStatement.predicate.buildDefinition,
          externalParameters: {
            workflow: {
              repository: 'https://github.com/other/project',
              path: '.github/workflows/publish.yml',
              ref: 'refs/heads/feature',
            },
          },
        },
        runDetails: { builder: { id: 'unexpected' } },
      },
    },
    version: '0.1.0',
  }),
  [
    '@harapter/core@0.1.0 provenance uses an unexpected predicate.',
    '@harapter/core@0.1.0 provenance identifies an unexpected workflow.',
    '@harapter/core@0.1.0 provenance identifies an unexpected builder.',
    '@harapter/core@0.1.0 provenance does not resolve the release commit.',
    '@harapter/core@0.1.0 provenance does not identify the packed tarball.',
  ],
);
const provenancePayload = Buffer.from(
  JSON.stringify(provenanceStatement),
).toString('base64');
assert.deepEqual(
  validateRegistryAudit({
    audit: {
      invalid: [],
      missing: [],
      verified: [
        {
          name: '@harapter/core',
          version: '0.1.0',
          attestationBundles: [
            {
              predicateType: 'https://slsa.dev/provenance/v1',
              bundle: { dsseEnvelope: { payload: provenancePayload } },
            },
          ],
        },
      ],
    },
    entries: [{ name: '@harapter/core' }],
    expectedCommit: releaseCommit,
    localIntegrities: new Map([['@harapter/core', registryIntegrity]]),
    version: '0.1.0',
  }),
  [],
);
assert.deepEqual(
  validateRegistryAudit({
    audit: { invalid: [{}], missing: [{}], verified: [] },
    entries: [{ name: '@harapter/core' }],
    expectedCommit: releaseCommit,
    localIntegrities: new Map([['@harapter/core', registryIntegrity]]),
    version: '0.1.0',
  }),
  [
    'npm provenance audit reported invalid signatures.',
    'npm provenance audit reported missing signatures.',
    '@harapter/core@0.1.0 was not verified by npm provenance audit.',
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
    'scripts/lib/package-publication.mjs',
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
  `export const productContext = '${['Hi', 'Work'].join('')}';\nexport const adapterDescription = '${['Codex ', 'harness adapter'].join('')}';\n`,
);
assert.deepEqual(
  findForbiddenTextViolations(fixtureRoot, ['src/provider.ts']),
  [],
);
write(
  'src/local-path.ts',
  `export const localPath = '${['/', 'Users', '/example/project'].join('')}';\n`,
);
assert.deepEqual(
  findForbiddenTextViolations(fixtureRoot, ['src/local-path.ts']),
  ['src/local-path.ts contains a forbidden local absolute path.'],
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
