import { spawn, type ChildProcess } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profileId, type HarnessClient } from '@harapter/core';
import { createCodexProviderFactory } from '../../providers/codex/src/index.js';
import { createPiProviderFactory } from '../../providers/pi/src/index.js';
import { createOpenCodeProviderFactory } from '../../providers/opencode/src/index.js';
import { createHermesProviderFactory } from '../../providers/hermes/src/index.js';
import { createOpenClawProviderFactory } from '../../providers/openclaw/src/index.js';
import {
  startInteractionModel,
  type InteractionRuntime,
} from './interaction-live-model.js';

export async function startInteractionRuntime(
  provider: InteractionRuntime,
  binary: string,
) {
  if (!isAbsolute(binary))
    throw new Error('Interaction runtime command must be absolute.');
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'harapter-interaction-live-')),
  );
  const workspace = join(root, 'workspace');
  const config = join(root, 'config');
  const target = join(workspace, 'approval-target');
  await Promise.all([
    mkdir(workspace),
    mkdir(config),
    mkdir(join(root, 'home')),
  ]);
  await mkdir(target);
  // The only shell operation targets this test-created empty directory.
  const command = `rm -r '${target.replaceAll("'", "'\\''")}'`;
  const model = await startInteractionModel(provider, command);
  const children: ChildProcess[] = [];
  let client: HarnessClient | undefined;
  const environment: Record<string, string> = {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: join(root, 'home'),
    TMPDIR: root,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: join(root, 'data'),
    XDG_STATE_HOME: join(root, 'state'),
    XDG_CACHE_HOME: join(root, 'cache'),
    DO_NOT_TRACK: '1',
  };
  const close = async () => {
    try {
      await client?.close();
    } finally {
      try {
        for (const child of children) await stopChild(child);
      } finally {
        await model.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  };
  try {
    if (provider === 'codex') {
      await writeFile(
        join(config, 'config.toml'),
        `model = "synthetic-model"\nmodel_provider = "harapter_mock"\n[model_providers.harapter_mock]\nname = "Harapter synthetic model"\nbase_url = "${model.url}/v1"\nwire_api = "responses"\n[history]\npersistence = "none"\n[analytics]\nenabled = false\n[feedback]\nenabled = false\n[features]\nshell_tool = true\nunified_exec = false\nplugins = false\napps = false\n[tools]\nweb_search = false\n`,
      );
      environment['CODEX_HOME'] = config;
      const factory = createCodexProviderFactory();
      client = await factory.connect({
        providerId: factory.descriptor().providerId,
        profileId: profileId('interaction-live-codex'),
        displayName: 'Isolated interaction runtime',
        connection: {
          kind: 'process',
          command: await wrapper(root, binary, environment),
          args: ['app-server', '--stdio'],
          cwd: workspace,
          ownership: 'adapter',
        },
      });
    } else if (provider === 'pi') {
      await writeFile(
        join(config, 'models.json'),
        JSON.stringify({
          providers: {
            harapter_mock: {
              baseUrl: `${model.url}/v1`,
              apiKey: 'synthetic-local-key',
              api: 'openai-completions',
              models: [
                {
                  id: 'synthetic-model',
                  name: 'Synthetic',
                  reasoning: false,
                  input: ['text'],
                  contextWindow: 128000,
                  maxTokens: 1000,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        }),
      );
      environment['PI_CODING_AGENT_DIR'] = config;
      environment['PI_CODING_AGENT_SESSION_DIR'] = join(root, 'sessions');
      Object.assign(environment, {
        PI_OFFLINE: '1',
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
      });
      const extension = join(root, 'interaction-extension.mjs');
      await writeFile(extension, piExtension);
      const factory = createPiProviderFactory();
      // This explicit host-owned command loads one synthetic extension. Pi's
      // --no-extensions still disables discovery; the Adapter API is unchanged.
      client = await factory.connect({
        providerId: factory.descriptor().providerId,
        profileId: profileId('interaction-live-pi'),
        displayName: 'Isolated interaction runtime',
        connection: {
          kind: 'process',
          command: await wrapper(root, binary, environment, [
            '--extension',
            extension,
          ]),
          args: [
            '--provider',
            'harapter_mock',
            '--model',
            'synthetic-model',
            '--thinking',
            'off',
            '--no-builtin-tools',
            '--no-context-files',
          ],
          cwd: workspace,
          ownership: 'adapter',
        },
      });
    } else if (provider === 'opencode') {
      const configFile = join(config, 'opencode.json');
      await writeFile(
        configFile,
        JSON.stringify({
          autoupdate: false,
          mcp: {},
          plugin: [],
          permission: { '*': 'deny', bash: 'ask' },
          share: 'disabled',
          snapshot: false,
          model: 'harapter_mock/synthetic-model',
          small_model: 'harapter_mock/synthetic-model',
          provider: {
            harapter_mock: {
              npm: '@ai-sdk/openai-compatible',
              name: 'Harapter synthetic',
              models: {
                'synthetic-model': { name: 'Synthetic', tool_call: true },
              },
              options: {
                baseURL: `${model.url}/v1`,
                apiKey: 'synthetic-local-key',
              },
            },
          },
        }),
      );
      Object.assign(environment, {
        OPENCODE_CONFIG: configFile,
        OPENCODE_CONFIG_DIR: config,
        OPENCODE_DISABLE_AUTOUPDATE: 'true',
        OPENCODE_DISABLE_MODELS_FETCH: 'true',
      });
      const port = await unusedPort();
      const child = spawn(
        binary,
        ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
        { cwd: workspace, env: environment, stdio: 'ignore' },
      );
      child.on('error', () => undefined);
      children.push(child);
      const url = `http://127.0.0.1:${String(port)}`;
      await waitReady(`${url}/global/health`, child);
      const factory = createOpenCodeProviderFactory();
      client = await factory.connect({
        providerId: factory.descriptor().providerId,
        profileId: profileId('interaction-live-opencode'),
        displayName: 'Isolated interaction runtime',
        connection: { kind: 'endpoint', url, ownership: 'external' },
      });
    } else if (provider === 'hermes') {
      await writeFile(
        join(config, 'config.yaml'),
        JSON.stringify({
          agent: { max_turns: 3 },
          approvals: { mode: 'manual', timeout: 30 },
          auxiliary: {
            background_review: { enabled: false },
            title_generation: { enabled: false },
          },
          checkpoints: { enabled: false },
          compression: { enabled: false },
          hooks: {},
          mcp_servers: {},
          memory: { memory_enabled: false, user_profile_enabled: false },
          model: {
            api_mode: 'chat_completions',
            base_url: `${model.url}/v1`,
            context_length: 128000,
            default: 'synthetic-model',
            provider: 'custom:harapter_mock',
          },
          providers: {
            harapter_mock: {
              api: `${model.url}/v1`,
              context_length: 128000,
              default_model: 'synthetic-model',
              discover_models: false,
              key_env: 'HARAPTER_SYNTHETIC_MODEL_KEY',
              models: ['synthetic-model'],
              transport: 'chat_completions',
            },
          },
          platform_toolsets: { api_server: ['terminal'] },
          plugins: { enabled: [] },
          security: { allow_lazy_installs: false, redact_secrets: true },
          session_reset: { mode: 'none' },
          smart_model_routing: { enabled: false },
        }),
      );
      const port = await unusedPort();
      Object.assign(environment, {
        HERMES_HOME: config,
        HERMES_GATEWAY_NO_SUPERVISE: '1',
        API_SERVER_ENABLED: 'true',
        API_SERVER_HOST: '127.0.0.1',
        API_SERVER_PORT: String(port),
        API_SERVER_KEY: 'synthetic-api-key',
        HARAPTER_SYNTHETIC_MODEL_KEY: 'synthetic-local-key',
        TERMINAL_ENV: 'local',
        TERMINAL_CWD: workspace,
      });
      const child = spawn(binary, ['gateway', 'run', '--no-supervise'], {
        cwd: workspace,
        env: environment,
        stdio: 'ignore',
      });
      child.on('error', () => undefined);
      children.push(child);
      const url = `http://127.0.0.1:${String(port)}`;
      const headers = { authorization: 'Bearer synthetic-api-key' };
      await waitReady(`${url}/v1/capabilities`, child, headers);
      await waitReady(`${url}/api/sessions`, child, headers);
      const factory = createHermesProviderFactory({
        resolveAuthHeaders: () => Promise.resolve(headers),
      });
      client = await factory.connect({
        providerId: factory.descriptor().providerId,
        profileId: profileId('interaction-live-hermes'),
        displayName: 'Isolated interaction runtime',
        connection: {
          kind: 'endpoint',
          url,
          ownership: 'external',
          authRef: { scheme: 'synthetic', id: 'synthetic' },
        },
      });
    } else {
      const configFile = join(config, 'openclaw.json');
      const port = await unusedPort();
      Object.assign(environment, {
        OPENCLAW_CONFIG_PATH: configFile,
        OPENCLAW_STATE_DIR: join(root, 'state'),
        OPENCLAW_GATEWAY_PORT: String(port),
        OPENCLAW_GATEWAY_TOKEN: 'synthetic-local-token',
        OPENCLAW_LOAD_SHELL_ENV: '0',
        OPENCLAW_NO_AUTO_UPDATE: '1',
        OPENCLAW_NO_RESPAWN: '1',
        OPENCLAW_OFFLINE: '1',
        OPENCLAW_DISABLE_BONJOUR: '1',
        OPENCLAW_SKIP_CHANNELS: '1',
        OPENCLAW_SKIP_CRON: '1',
        OPENCLAW_SKIP_PROVIDERS: '1',
        OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: '1',
        OPENCLAW_SKIP_CANVAS_HOST: '1',
        OPENCLAW_SKIP_GMAIL_WATCHER: '1',
        OPENCLAW_SKIP_STARTUP_MODEL_PREWARM: '1',
      });
      await writeFile(
        configFile,
        JSON.stringify({
          agents: {
            defaults: {
              workspace,
              model: { primary: 'harapter_mock/synthetic-model' },
              heartbeat: { every: '0m' },
            },
          },
          gateway: {
            mode: 'local',
            bind: 'loopback',
            auth: { mode: 'token' },
            controlUi: { enabled: false },
          },
          models: {
            mode: 'replace',
            catalogRefresh: { enabled: false },
            providers: {
              harapter_mock: {
                baseUrl: `${model.url}/v1`,
                apiKey: 'synthetic-local-key',
                api: 'openai-completions',
                models: [
                  {
                    id: 'synthetic-model',
                    name: 'Synthetic',
                    contextWindow: 128000,
                    maxTokens: 1000,
                    input: ['text'],
                    reasoning: false,
                  },
                ],
              },
            },
          },
          tools: { allow: ['exec'], exec: { host: 'gateway', mode: 'ask' } },
          plugins: { enabled: false, allow: [] },
          mcp: { servers: {} },
          browser: { enabled: false },
          cron: { enabled: false, triggers: { enabled: false } },
          skills: {
            allowBundled: [],
            load: { watch: false },
            workshop: { autonomous: { mode: 'off' } },
          },
          hooks: { internal: { enabled: false } },
          discovery: { mdns: { mode: 'off' } },
          telemetry: { enabled: false },
          logging: {
            file: join(root, 'runtime.log'),
            level: 'silent',
            consoleLevel: 'silent',
            audit: { enabled: false, messages: 'off' },
          },
        }),
      );
      const child = spawn(
        binary,
        [
          'gateway',
          'run',
          '--port',
          String(port),
          '--bind',
          'loopback',
          '--auth',
          'token',
        ],
        { cwd: workspace, env: environment, stdio: 'ignore' },
      );
      child.on('error', () => undefined);
      children.push(child);
      await waitReady(`http://127.0.0.1:${String(port)}/readyz`, child);
      const factory = createOpenClawProviderFactory();
      client = await factory.connect({
        providerId: factory.descriptor().providerId,
        profileId: profileId('interaction-live-openclaw'),
        displayName: 'Isolated interaction runtime',
        connection: {
          kind: 'process',
          command: await wrapper(root, binary, environment),
          args: ['acp', '--no-prefix-cwd'],
          cwd: workspace,
          ownership: 'adapter',
        },
      });
    }
    const session = await client.createSession(
      provider === 'codex'
        ? {
            workspace: { uri: pathToFileURL(workspace).href },
            providerOptions: {
              ephemeral: true,
              approvalPolicy: 'on-request',
              sandbox: 'read-only',
            },
          }
        : provider === 'opencode'
          ? { workspace: { uri: pathToFileURL(workspace).href } }
          : {},
    );
    return { client, session, model, target, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function wrapper(
  root: string,
  binary: string,
  environment: Record<string, string>,
  prefix: string[] = [],
) {
  const file = join(root, 'runtime');
  await writeFile(
    file,
    `#!${process.execPath}\nconst args = process.argv.slice(2);\nprocess.execve(${JSON.stringify(binary)}, [${JSON.stringify(binary)}, ...${JSON.stringify(prefix)}, ...args], ${JSON.stringify(environment)});\n`,
  );
  await chmod(file, 0o700);
  return file;
}

async function unusedPort() {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  if (address === null || typeof address === 'string')
    throw new Error('Runtime port allocation failed.');
  return address.port;
}

async function waitReady(
  url: string,
  child: ChildProcess,
  headers?: Record<string, string>,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Isolated runtime exited before readiness.');
    try {
      const response = await fetch(url, {
        ...(headers === undefined ? {} : { headers }),
        signal: AbortSignal.timeout(300),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      /* bounded readiness retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Isolated runtime readiness deadline exceeded.');
}

async function stopChild(child: ChildProcess) {
  const exited = () =>
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null;
  if (exited()) return;
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (exited()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGKILL');
  for (let attempt = 0; attempt < 40; attempt++) {
    if (exited()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Isolated runtime did not exit after forced cleanup.');
}

const piExtension = `export default function (pi) {
  pi.registerTool({
    name: 'harapter_probe', label: 'Synthetic interaction', description: 'Exercise the host interaction contract.',
    parameters: { type: 'object', properties: { method: { type: 'string' } }, required: ['method'], additionalProperties: false },
    async execute(_id, params, signal, _update, ctx) {
      let value;
      if (params.method === 'select') value = await ctx.ui.select('Synthetic selection', ['Synthetic accepted', 'Synthetic declined'], { signal });
      else if (params.method === 'input') value = await ctx.ui.input('Synthetic input', '', { signal });
      else if (params.method === 'editor') value = await ctx.ui.editor('Synthetic editor', '');
      else value = await ctx.ui.confirm('Synthetic confirmation', 'Confirm the test action.', { signal });
      return { content: [{ type: 'text', text: value === true || value === 'Synthetic accepted' ? 'HARAPTER_INTERACTION_ACCEPTED' : 'HARAPTER_INTERACTION_DECLINED' }], details: {} };
    }
  });
};\n`;
