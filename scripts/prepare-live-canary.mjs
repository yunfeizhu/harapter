import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { JSON_SCHEMA, defineScalarTag, load } from 'js-yaml';

const API_KEY_SETTING = 'HARAPTER_LIVE_MODEL_API_KEY';
const MODEL_ID_SETTING = 'HARAPTER_LIVE_MODEL_ID';
const MODEL_URL_SETTING = 'HARAPTER_LIVE_MODEL_URL';
const DSH_CONFIG_SCHEMA = JSON_SCHEMA.withTags([
  defineScalarTag('tag:yaml.org,2002:js', {
    resolve: (value) => value,
  }),
]);
const CODEX_ALLOWED_ENABLED_FEATURES = new Set([
  'collaboration_modes',
  'compaction_image_budget',
  'content_item_kinds',
  'enable_request_compression',
  'item_ids',
  'mentions_v2',
  'personality',
  'resize_all_images',
  'sqlite',
  'steer',
  'terminal_resize_reflow',
  'tool_search_always_defer_mcp_tools',
  'tui_app_server',
]);
const CODEX_SHELL_GATED_ENABLED_FEATURES = new Set([
  'unified_exec',
  'unified_exec_zsh_fork',
]);
const CODEX_REQUIRED_DISABLED_FEATURES = new Set([
  'apps',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'code_mode_host',
  'computer_use',
  'fast_mode',
  'goals',
  'guardian_approval',
  'hooks',
  'image_generation',
  'in_app_browser',
  'in_app_chat',
  'in_app_dictation',
  'in_app_local_automation',
  'in_app_updates',
  'multi_agent',
  'plugin_sharing',
  'plugins',
  'remote_compaction_v2',
  'remote_plugin',
  'shell_snapshot',
  'shell_tool',
  'skill_mcp_dependency_install',
  'skill_search',
  'sleep_tool',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'unbounded_connection_retries',
  'view_image',
  'workspace_dependencies',
]);
const DSH_EXPECTED_ROWS = new Map([
  ['agent', ['@deepseek-ai/dsh-agent', false]],
  ['agent-invariant', ['@deepseek-ai/dsh-agent/invariant', false]],
  ['agent-loop', ['@deepseek-ai/dsh-agent-loop', false]],
  ['agent-loop-invariant', ['@deepseek-ai/dsh-agent-loop/invariant', false]],
  [
    'deepseek-llm-api-extensions',
    ['@deepseek-ai/dsh-deepseek-llm-api-extensions', false],
  ],
  ['fs-local', ['@deepseek-ai/dsh-fs-local', false]],
  ['invariants', ['@deepseek-ai/dsh-invariants', false]],
  ['jobs', ['@deepseek-ai/dsh-jobs-local', false]],
  ['llm', ['@deepseek-ai/dsh-llm', false]],
  ['llm-deepseek', ['@deepseek-ai/dsh-llm-deepseek', true]],
  ['llm-pi-ai', ['@deepseek-ai/dsh-llm-pi-ai', false]],
  ['llm-retry', ['@deepseek-ai/dsh-llm-retry', false]],
  ['persistent-bash', ['@deepseek-ai/dsh-tool-bash-persistent', true]],
  ['persistent-pwsh', ['@deepseek-ai/dsh-tool-pwsh-persistent', true]],
  [
    'plugin-package-inventory-deepseek',
    ['@deepseek-ai/dsh-plugin-package-inventory-deepseek', false],
  ],
  ['pty', ['@deepseek-ai/dsh-terminal', false]],
  ['sandbox', ['@deepseek-ai/dsh-sandbox-local', false]],
  ['sandbox-policy', ['@deepseek-ai/dsh-sandbox-policy', false]],
  ['scope-invariant', ['@deepseek-ai/dsh-scope/invariant', false]],
  ['sdk-app-startup', ['@deepseek-ai/dsh-sdk-app', false]],
  ['sdk-jsonrpc-server', ['@deepseek-ai/dsh-sdk-jsonrpc-server', false]],
  ['session', ['@deepseek-ai/dsh-session', false]],
  ['session-invariant', ['@deepseek-ai/dsh-session/invariant', false]],
  ['session-log-deepseek', ['@deepseek-ai/dsh-session-log-deepseek', false]],
  ['session-projection', ['@deepseek-ai/dsh-session-projection', false]],
  ['session-title', ['@deepseek-ai/dsh-session-title', false]],
  ['sessions', ['@deepseek-ai/dsh-session-persistence-jsonl', false]],
  ['str-replace-editor', ['@deepseek-ai/dsh-tool-str-replace-editor', true]],
  ['subprocess', ['@deepseek-ai/dsh-subprocess-local', false]],
  ['system-prompt', ['@deepseek-ai/dsh-system-prompt', false]],
  ['terminal-bash', ['@deepseek-ai/dsh-terminal-bash', true]],
  ['terminal-pwsh', ['@deepseek-ai/dsh-terminal-bash', true]],
  ['timer', ['@deepseek-ai/cordis-plugin-timer', false]],
  ['tools', ['@deepseek-ai/dsh-tools', false]],
]);

class SafeFailure extends Error {}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(
    error instanceof SafeFailure
      ? error.message
      : 'Live-canary preparation failed without exposing local details.',
  );
  process.exitCode = 1;
}

function main(args) {
  const [command, ...rest] = args;
  switch (command) {
    case 'validate':
      requireCount(rest, 0, 'validate');
      liveSettings();
      return;
    case 'write-codex-config':
      requireCount(rest, 1, 'write-codex-config');
      writePrivateFile(rest[0], codexConfig(liveSettings()));
      return;
    case 'write-opencode-config':
      requireCount(rest, 1, 'write-opencode-config');
      writePrivateFile(rest[0], openCodeConfig(liveSettings()));
      return;
    case 'write-hermes-config':
      requireCount(rest, 1, 'write-hermes-config');
      writePrivateFile(rest[0], hermesConfig(modelSettings()));
      return;
    case 'write-openclaw-config':
      requireCount(rest, 3, 'write-openclaw-config');
      writePrivateFile(rest[0], openClawConfig(rest[1], rest[2]));
      return;
    case 'validate-codex-features':
      requireCount(rest, 1, 'validate-codex-features');
      validateCodexFeatures(rest[0]);
      return;
    case 'validate-dsh-config':
      requireCount(rest, 1, 'validate-dsh-config');
      validateDshConfig(rest[0]);
      return;
    case 'validate-hermes-toolsets':
      requireCount(rest, 1, 'validate-hermes-toolsets');
      validateHermesToolsets(rest[0]);
      return;
    case 'validate-hermes-enabled-toolsets':
      requireCount(rest, 1, 'validate-hermes-enabled-toolsets');
      validateHermesEnabledToolsets(rest[0]);
      return;
    case 'record-global-package':
      if (rest.length < 2 || rest.length > 3) {
        throw new SafeFailure(
          'record-global-package requires a label, package, and optional anchor package.',
        );
      }
      recordGlobalPackage(rest[0], rest[1], rest[2]);
      return;
    case 'record-container-package':
      requireCount(rest, 4, 'record-container-package');
      recordContainerPackage(rest[0], rest[1], rest[2], rest[3]);
      return;
    default:
      throw new SafeFailure('Unknown live-canary preparation command.');
  }
}

function requireCount(args, expected, command) {
  if (args.length !== expected) {
    throw new SafeFailure(`${command} received an invalid argument count.`);
  }
}

function liveSettings() {
  const apiKey = requiredEnvironment(API_KEY_SETTING, 4096);
  return { apiKey, ...modelSettings() };
}

function modelSettings() {
  const modelId = requiredEnvironment(MODEL_ID_SETTING, 512);
  const modelUrl = requiredEnvironment(MODEL_URL_SETTING, 2048);
  if (/\p{Cc}/u.test(modelId)) {
    throw new SafeFailure(`${MODEL_ID_SETTING} contains a control character.`);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(modelUrl);
  } catch {
    throw new SafeFailure(
      `${MODEL_URL_SETTING} must be an absolute HTTPS URL.`,
    );
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new SafeFailure(
      `${MODEL_URL_SETTING} must be an absolute HTTPS URL without embedded credentials.`,
    );
  }
  return { modelId, modelUrl: parsedUrl.toString() };
}

function requiredEnvironment(name, maximumLength) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new SafeFailure(`${name} is not configured.`);
  }
  if (value.length > maximumLength || value.includes('\0')) {
    throw new SafeFailure(`${name} is not a valid live-canary setting.`);
  }
  return value;
}

function codexConfig({ modelId, modelUrl }) {
  return `model = ${JSON.stringify(modelId)}
model_provider = "harapter_live"

[model_providers.harapter_live]
name = "Harapter Live"
base_url = ${JSON.stringify(modelUrl)}
env_key = "${API_KEY_SETTING}"
wire_api = "responses"

[history]
persistence = "none"

[feedback]
enabled = false

[analytics]
enabled = false

[apps._default]
enabled = false

[features]
apps = false
auth_elicitation = false
browser_use = false
browser_use_external = false
browser_use_full_cdp_access = false
code_mode_host = false
computer_use = false
fast_mode = false
goals = false
guardian_approval = false
hooks = false
image_generation = false
in_app_browser = false
in_app_chat = false
in_app_dictation = false
in_app_local_automation = false
in_app_updates = false
multi_agent = false
plugin_sharing = false
plugins = false
remote_compaction_v2 = false
remote_plugin = false
shell_snapshot = false
shell_tool = false
skill_mcp_dependency_install = false
skill_search = false
sleep_tool = false
tool_call_mcp_elicitation = false
tool_suggest = false
unbounded_connection_retries = false
unified_exec = false
view_image = false
workspace_dependencies = false

[tools]
web_search = false

[shell_environment_policy]
inherit = "none"
`;
}

function validateCodexFeatures(path) {
  const content = readBoundedTextFile(
    path,
    'The Codex feature surface could not be verified safely.',
  );
  if (content.trim().length === 0) {
    throw new SafeFailure(
      'The Codex feature surface could not be verified safely.',
    );
  }
  const observed = new Map();
  for (const line of content.trim().split(/\r?\n/u)) {
    const match = /^([a-z][a-z0-9_]*)\s+.+\s+(true|false)$/u.exec(line);
    if (match === null || observed.has(match[1])) {
      throw new SafeFailure(
        'The Codex feature surface could not be verified safely.',
      );
    }
    observed.set(match[1], match[2] === 'true');
  }
  for (const feature of CODEX_REQUIRED_DISABLED_FEATURES) {
    if (observed.get(feature) !== false) {
      throw new SafeFailure(
        'The Codex feature surface is not safe for the live canary.',
      );
    }
  }
  const shellToolDisabled = observed.get('shell_tool') === false;
  for (const [feature, enabled] of observed) {
    const allowedShellBackend =
      shellToolDisabled && CODEX_SHELL_GATED_ENABLED_FEATURES.has(feature);
    if (
      enabled &&
      !CODEX_ALLOWED_ENABLED_FEATURES.has(feature) &&
      !allowedShellBackend
    ) {
      throw new SafeFailure(
        'The Codex feature surface is not safe for the live canary.',
      );
    }
  }
}

function validateDshConfig(path) {
  const content = readBoundedTextFile(
    path,
    'The DSH effective config could not be read safely.',
  );
  let rows;
  try {
    rows = load(content, { schema: DSH_CONFIG_SCHEMA });
  } catch {
    throw new SafeFailure('The DSH effective config is invalid.');
  }
  if (!Array.isArray(rows) || rows.length !== DSH_EXPECTED_ROWS.size) {
    throw new SafeFailure(
      'The DSH effective config does not match the reviewed canary surface.',
    );
  }
  const observed = new Set();
  for (const row of rows) {
    if (!isRecord(row)) {
      throw new SafeFailure('The DSH effective config is invalid.');
    }
    const id = row['id'];
    const name = row['name'];
    const disabled = row['disabled'] === true;
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      observed.has(id)
    ) {
      throw new SafeFailure('The DSH effective config is invalid.');
    }
    const expected = DSH_EXPECTED_ROWS.get(id);
    if (
      expected === undefined ||
      name !== expected[0] ||
      disabled !== expected[1]
    ) {
      throw new SafeFailure(
        'The DSH effective config does not match the reviewed canary surface.',
      );
    }
    observed.add(id);
  }
}

function validateHermesToolsets(path) {
  const failureMessage =
    'The Hermes Agent toolset surface is not safe for the live canary.';
  const content = readBoundedTextFile(path, failureMessage);
  let document;
  try {
    document = JSON.parse(content);
  } catch {
    throw new SafeFailure(failureMessage);
  }
  if (
    !isRecord(document) ||
    document['object'] !== 'list' ||
    document['platform'] !== 'api_server' ||
    !Array.isArray(document['data']) ||
    document['data'].length === 0 ||
    document['data'].length > 512
  ) {
    throw new SafeFailure(failureMessage);
  }
  const observed = new Set();
  for (const row of document['data']) {
    if (!isRecord(row)) throw new SafeFailure(failureMessage);
    const name = row['name'];
    const tools = row['tools'];
    if (
      typeof name !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(name) ||
      observed.has(name) ||
      row['enabled'] !== false ||
      !Array.isArray(tools) ||
      tools.length > 512 ||
      !tools.every(
        (tool) =>
          typeof tool === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(tool),
      )
    ) {
      throw new SafeFailure(failureMessage);
    }
    observed.add(name);
  }
}

function validateHermesEnabledToolsets(path) {
  const failureMessage =
    'The Hermes Agent effective toolset surface is not safe for the live canary.';
  const content = readBoundedTextFile(path, failureMessage);
  let document;
  try {
    document = JSON.parse(content);
  } catch {
    throw new SafeFailure(failureMessage);
  }
  if (!Array.isArray(document) || document.length !== 0) {
    throw new SafeFailure(failureMessage);
  }
}

function readBoundedTextFile(path, failureMessage) {
  if (path === undefined || path.length === 0 || path.includes('\0')) {
    throw new SafeFailure(failureMessage);
  }
  try {
    if (statSync(path).size > 1024 * 1024) throw new Error('oversized');
    return readFileSync(path, 'utf8');
  } catch {
    throw new SafeFailure(failureMessage);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function openCodeConfig({ modelId }) {
  return `${JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      autoupdate: false,
      mcp: {},
      model: `harapter-live/${modelId}`,
      permission: { '*': 'deny' },
      plugin: [],
      provider: {
        'harapter-live': {
          models: {
            [modelId]: {
              name: 'Harapter Live Model',
            },
          },
          name: 'Harapter Live',
          npm: '@ai-sdk/openai-compatible',
          options: {
            apiKey: `{env:${API_KEY_SETTING}}`,
            baseURL: `{env:${MODEL_URL_SETTING}}`,
          },
        },
      },
      share: 'disabled',
      small_model: `harapter-live/${modelId}`,
      snapshot: false,
      tools: {
        bash: false,
        edit: false,
        glob: false,
        grep: false,
        list: false,
        read: false,
        task: false,
        webfetch: false,
        websearch: false,
        write: false,
      },
    },
    undefined,
    2,
  )}\n`;
}

function hermesConfig({ modelId, modelUrl }) {
  return `${JSON.stringify(
    {
      agent: { max_turns: 2 },
      auxiliary: {
        background_review: { enabled: false },
        title_generation: { enabled: false },
      },
      checkpoints: { enabled: false },
      compression: { enabled: false },
      hooks: {},
      mcp_servers: {},
      memory: {
        memory_enabled: false,
        user_profile_enabled: false,
      },
      model: {
        api_mode: 'chat_completions',
        base_url: modelUrl,
        context_length: 131_072,
        default: modelId,
        provider: 'custom:harapter-live',
      },
      platform_toolsets: { api_server: [] },
      plugins: { enabled: [] },
      providers: {
        'harapter-live': {
          api: modelUrl,
          context_length: 131_072,
          default_model: modelId,
          discover_models: false,
          key_env: API_KEY_SETTING,
          models: [modelId],
          transport: 'chat_completions',
        },
      },
      security: {
        allow_lazy_installs: false,
        redact_secrets: true,
      },
      session_reset: { mode: 'none' },
      smart_model_routing: { enabled: false },
    },
    undefined,
    2,
  )}\n`;
}

function openClawConfig(workspacePath, logPath) {
  const workspace = requiredAbsolutePath(
    workspacePath,
    'The OpenClaw canary workspace must be absolute.',
  );
  const log = requiredAbsolutePath(
    logPath,
    'The OpenClaw canary log path must be absolute.',
  );
  return `${JSON.stringify(
    {
      agents: {
        defaults: {
          heartbeat: { every: '0m' },
          workspace,
        },
      },
      browser: {
        allowSystemProfileImport: false,
        enabled: false,
      },
      cron: {
        enabled: false,
        triggers: { enabled: false },
      },
      discovery: { mdns: { mode: 'off' } },
      gateway: {
        auth: { mode: 'token' },
        bind: 'loopback',
        controlUi: {
          automaticallyFetchFavicons: false,
          enabled: false,
          sessionObserver: false,
        },
        mode: 'local',
        nodes: {
          allowSkills: false,
          browser: { mode: 'off' },
          pairing: {
            autoApproveLocal: true,
            sshVerify: false,
          },
          pluginTools: { enabled: false },
        },
      },
      hooks: { internal: { enabled: false } },
      logging: {
        audit: {
          enabled: false,
          messages: 'off',
        },
        consoleLevel: 'warn',
        file: log,
        level: 'warn',
        maxFileBytes: 1024 * 1024,
      },
      mcp: { servers: {} },
      models: { catalogRefresh: { enabled: false } },
      plugins: {
        allow: [],
        enabled: false,
      },
      skills: {
        allowBundled: [],
        load: { watch: false },
        workshop: { autonomous: { mode: 'off' } },
      },
      telemetry: { enabled: false },
    },
    undefined,
    2,
  )}\n`;
}

function requiredAbsolutePath(value, failureMessage) {
  if (
    value === undefined ||
    !isAbsolute(value) ||
    value.includes('\0') ||
    /\p{Cc}/u.test(value)
  ) {
    throw new SafeFailure(failureMessage);
  }
  return value;
}

function writePrivateFile(path, content) {
  if (path === undefined || path.length === 0 || path.includes('\0')) {
    throw new SafeFailure('The live-canary config destination is invalid.');
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch {
    throw new SafeFailure(
      'The live-canary config could not be written safely.',
    );
  }
}

function recordGlobalPackage(label, packageName, anchorPackage = packageName) {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/u.test(label ?? '')) {
    throw new SafeFailure('The runtime label is invalid.');
  }
  if (!validPackageName(packageName) || !validPackageName(anchorPackage)) {
    throw new SafeFailure('The runtime package name is invalid.');
  }
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryPath === undefined || summaryPath.length === 0) {
    throw new SafeFailure('GITHUB_STEP_SUMMARY is not available.');
  }
  const npmRoot = spawnSync('npm', ['root', '--global'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (npmRoot.status !== 0 || npmRoot.stdout.trim().length === 0) {
    throw new SafeFailure('The global npm package root is unavailable.');
  }
  const root = npmRoot.stdout.trim();
  const candidates = [
    join(root, ...packageName.split('/'), 'package.json'),
    join(
      root,
      ...anchorPackage.split('/'),
      'node_modules',
      ...packageName.split('/'),
      'package.json',
    ),
  ];
  const manifestPath = candidates.find((candidate) => existsSync(candidate));
  if (manifestPath === undefined) {
    throw new SafeFailure(
      'The installed runtime package could not be located.',
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new SafeFailure('The installed runtime package metadata is invalid.');
  }
  if (
    manifest?.name !== packageName ||
    typeof manifest.version !== 'string' ||
    !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/u.test(manifest.version)
  ) {
    throw new SafeFailure('The installed runtime package identity is invalid.');
  }
  const identity = `${packageName}@${manifest.version}`;
  try {
    appendFileSync(summaryPath, `- ${label}: \`${identity}\`\n`, 'utf8');
  } catch {
    throw new SafeFailure('The runtime identity summary could not be written.');
  }
  console.log(`${label}: ${identity}`);
}

function recordContainerPackage(label, packageName, version, imageDigest) {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/u.test(label ?? '')) {
    throw new SafeFailure('The runtime label is invalid.');
  }
  if (
    !validPackageName(packageName) ||
    typeof version !== 'string' ||
    !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/u.test(version) ||
    typeof imageDigest !== 'string' ||
    !/^[a-z0-9][a-z0-9._/-]{0,127}@sha256:[a-f0-9]{64}$/u.test(imageDigest)
  ) {
    throw new SafeFailure('The container runtime identity is invalid.');
  }
  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryPath === undefined || summaryPath.length === 0) {
    throw new SafeFailure('GITHUB_STEP_SUMMARY is not available.');
  }
  const identity = `${packageName}@${version}`;
  try {
    appendFileSync(
      summaryPath,
      `- ${label}: \`${identity}\`\n- Image: \`${imageDigest}\`\n`,
      'utf8',
    );
  } catch {
    throw new SafeFailure('The runtime identity summary could not be written.');
  }
  console.log(`${label}: ${identity}`);
  console.log(`Image: ${imageDigest}`);
}

function validPackageName(value) {
  return (
    typeof value === 'string' &&
    /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(value)
  );
}
