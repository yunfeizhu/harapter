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
    processTimeoutSeconds: 150,
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
  opencode: {
    install: 'npm install --global opencode-ai@latest',
    liveStep: 'Run OpenCode live lifecycle',
    liveTest: 'providers/opencode/test/live.test.ts',
    processTimeoutSeconds: 180,
    secretSteps: new Set([
      'Prepare isolated OpenCode configuration',
      'Run OpenCode live lifecycle',
      'Validate live configuration',
    ]),
  },
  openclaw: {
    install: 'npm install --global --ignore-scripts openclaw@latest',
    liveStep: 'Run OpenClaw live Session lifecycle',
    liveTest: 'providers/openclaw/test/live.test.ts',
    processTimeoutSeconds: 120,
    secretSteps: new Set(),
  },
  pi: {
    install:
      'npm install --global --ignore-scripts @earendil-works/pi-coding-agent@latest',
    liveStep: 'Run Pi Agent live lifecycle',
    liveTest: 'providers/pi/test/live.test.ts',
    processTimeoutSeconds: 120,
    secretSteps: new Set(),
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
assert.match(
  requiredStep(
    requiredJob(liveJobs, 'codex'),
    'Verify Codex model-facing surface',
  )['run'],
  /validate-codex-features/u,
);
assert.match(
  requiredStep(requiredJob(liveJobs, 'dsh'), 'Verify DSH model-facing surface')[
    'run'
  ],
  /--profile sdk-minimal.*validate-dsh-config/su,
);
assert.match(
  requiredStep(
    requiredJob(liveJobs, 'opencode'),
    'Run OpenCode live lifecycle',
  )['run'],
  /curl --connect-timeout 1 --max-time 2 --fail/u,
);
const piLiveStep = requiredStep(
  requiredJob(liveJobs, 'pi'),
  'Run Pi Agent live lifecycle',
);
assert.deepEqual(piLiveStep['env'], {
  HARAPTER_PI_LIVE: '1',
  PI_CODING_AGENT_DIR: '${{ runner.temp }}/harapter-pi-home',
  PI_CODING_AGENT_SESSION_DIR: '${{ runner.temp }}/harapter-pi-sessions',
  PI_OFFLINE: '1',
  PI_SKIP_VERSION_CHECK: '1',
  PI_TELEMETRY: '0',
});
assert.match(JSON.stringify(piLiveStep), /HARAPTER_PI_COMMAND/u);
const openClawLiveStep = requiredStep(
  requiredJob(liveJobs, 'openclaw'),
  'Run OpenClaw live Session lifecycle',
);
assert.deepEqual(openClawLiveStep['env'], {
  DO_NOT_TRACK: '1',
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
assert.doesNotMatch(
  JSON.stringify(requiredJob(liveJobs, 'openclaw')),
  /HARAPTER_LIVE_MODEL_/u,
);
assert.doesNotMatch(
  liveCanaryWorkflow,
  /npm install --global (?:@openai\/codex|opencode-ai|@deepseek-ai\/dsh|@earendil-works\/pi-coding-agent|openclaw)@\d/u,
);
assert.match(liveCanaryWorkflow, /DSH_TELEMETRY_DISABLED: '1'/u);
assert.doesNotMatch(liveCanaryWorkflow, /continue-on-error/u);

const piLiveTest = readFileSync(
  resolve(repositoryRoot, 'providers/pi/test/live.test.ts'),
  'utf8',
);
assert.match(piLiveTest, /describe\.runIf\(liveEnabled\)/u);
assert.match(piLiveTest, /providerOptions: \{ persistSessions: false \}/u);
assert.match(piLiveTest, /PI_CODING_AGENT_SESSION_DIR/u);
assert.match(piLiveTest, /readdir\(sessionDirectory, \{ recursive: true \}\)/u);

const openClawLiveTest = readFileSync(
  resolve(repositoryRoot, 'providers/openclaw/test/live.test.ts'),
  'utf8',
);
assert.match(openClawLiveTest, /describe\.runIf\(liveEnabled\)/u);
assert.match(openClawLiveTest, /isAbsolute\(liveCommand\)/u);
assert.match(openClawLiveTest, /client\.createSession\(\)/u);
assert.match(openClawLiveTest, /timeout: 10_000/u);
assertOpenClawSessionOnly(openClawLiveTest);
assert.throws(
  () => assertOpenClawSessionOnly(`${openClawLiveTest}\nsession.start({});`),
  /session\.start/u,
);

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

function assertOpenClawSessionOnly(source) {
  assert.doesNotMatch(source, /session\.start\s*\(/u);
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
