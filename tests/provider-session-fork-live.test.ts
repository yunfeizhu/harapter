import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  profileId,
  type HarnessClient,
  type HarnessSession,
  type SessionRef,
} from '@harapter/core';
import { expect, it } from 'vitest';
import { createCodexProviderFactory } from '../providers/codex/src/index.js';
import { createPiProviderFactory } from '../providers/pi/src/index.js';
import { createOpenCodeProviderFactory } from '../providers/opencode/src/index.js';
import {
  createOpenClawProviderFactory,
  type OpenClawGatewayBinding,
} from '../providers/openclaw/src/index.js';
import { createHermesProviderFactory } from '../providers/hermes/src/index.js';

const binaries = process.env['HARAPTER_FORK_LIVE_BIN'];
const hermesDirectory = process.env['HARAPTER_HERMES_FORK_LIVE_DIR'];

it.skipIf(hermesDirectory === undefined)(
  'verifies Hermes native branch history and retired parent with an official isolated server',
  async () => {
    if (hermesDirectory === undefined)
      throw new Error('Official Hermes installation is required.');
    const root = await mkdtemp(join(tmpdir(), 'harapter-hermes-fork-live-'));
    const model = await startModel();
    let server: ChildProcess | undefined;
    let client: HarnessClient | undefined;
    try {
      const port = await unusedPort();
      await writeFile(
        join(root, 'config.yaml'),
        JSON.stringify({
          agent: { max_turns: 2 },
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
          platform_toolsets: { api_server: [] },
          plugins: { enabled: [] },
          security: { allow_lazy_installs: false, redact_secrets: true },
          session_reset: { mode: 'none' },
          smart_model_routing: { enabled: false },
        }),
      );
      server = spawn(
        join(hermesDirectory, '.venv/bin/hermes'),
        ['gateway', 'run', '--no-supervise'],
        {
          cwd: root,
          stdio: 'ignore',
          env: {
            ...process.env,
            HERMES_HOME: root,
            HERMES_GATEWAY_NO_SUPERVISE: '1',
            API_SERVER_ENABLED: 'true',
            API_SERVER_HOST: '127.0.0.1',
            API_SERVER_PORT: String(port),
            API_SERVER_KEY: 'synthetic-api-key',
            HARAPTER_SYNTHETIC_MODEL_KEY: 'synthetic-local-key',
          },
        },
      );
      const url = `http://127.0.0.1:${String(port)}`;
      const headers = { authorization: 'Bearer synthetic-api-key' };
      await waitReady(`${url}/v1/capabilities`, server, headers);
      const factory = createHermesProviderFactory({
        resolveAuthHeaders: () => Promise.resolve(headers),
      });
      const profile = {
        providerId: factory.descriptor().providerId,
        profileId: profileId('fork-live-hermes'),
        displayName: 'Isolated official runtime',
        connection: {
          kind: 'endpoint' as const,
          url,
          ownership: 'external' as const,
          authRef: { scheme: 'synthetic', id: 'synthetic' },
        },
      };
      client = await factory.connect(profile);
      const parent = await client.createSession();
      await complete(parent, 'HARAPTER_FORK_PARENT');
      const sessions = client
        .extensions()
        .get<{ branch(ref: SessionRef): Promise<HarnessSession> }>(
          'nous.hermes-agent.sessions',
        );
      if (sessions === undefined)
        throw new Error('Missing native Session branch extension.');
      const child = await sessions.branch(parent.ref());
      expect(child.ref().providerSessionId).not.toBe(
        parent.ref().providerSessionId,
      );
      await complete(child, 'HARAPTER_FORK_CHILD');
      expect(model.childInherited()).toBe(true);
      await expect(
        parent.start({
          parts: [{ type: 'text', text: 'Synthetic retired parent.' }],
        }),
      ).rejects.toMatchObject({ code: 'session_not_found' });
      await client.close();
      client = await factory.connect(profile);
      await expect(client.resumeSession(parent.ref())).rejects.toMatchObject({
        code: 'session_not_found',
      });
      const resumed = await client.resumeSession(child.ref());
      await complete(resumed, 'HARAPTER_FORK_RESUMED');
      model.hold();
      const run = await resumed.start({
        parts: [{ type: 'text', text: 'HARAPTER_FORK_CANCEL' }],
      });
      const events = collect(run.events());
      await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
      await expect(run.result()).resolves.toMatchObject({
        status: 'cancelled',
      });
      await events;
    } finally {
      await client?.close();
      await stopChild(server);
      await model.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  90_000,
);

it.skipIf(binaries === undefined)(
  'verifies OpenClaw Gateway fork and ACP child routing with an official isolated runtime',
  async () => {
    if (binaries === undefined)
      throw new Error('Official runtime directory is required.');
    const root = await mkdtemp(join(tmpdir(), 'harapter-openclaw-fork-live-'));
    const model = await startModel();
    let server: ChildProcess | undefined;
    let client: HarnessClient | undefined;
    let gateway: Awaited<ReturnType<typeof connectGateway>> | undefined;
    try {
      const config = join(root, 'openclaw.json');
      const port = await unusedPort();
      const token = 'synthetic-isolated-gateway-token';
      const env = {
        ...process.env,
        OPENCLAW_CONFIG_PATH: config,
        OPENCLAW_STATE_DIR: join(root, 'state'),
        OPENCLAW_GATEWAY_PORT: String(port),
        OPENCLAW_GATEWAY_TOKEN: token,
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
      };
      await writeFile(
        config,
        JSON.stringify({
          agents: {
            defaults: {
              workspace: root,
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
                    compat: { supportsTools: false },
                  },
                ],
              },
            },
          },
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
      const binary = join(binaries, 'openclaw');
      server = spawn(
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
        { cwd: root, stdio: 'ignore', env },
      );
      await waitReady(`http://127.0.0.1:${String(port)}/readyz`, server);
      gateway = await connectGateway(`ws://127.0.0.1:${String(port)}`, token);
      const command = join(root, 'runtime');
      // Only the isolated OpenClaw settings cross the child environment boundary.
      const isolated = Object.fromEntries(
        Object.entries(env).filter(([key]) => key.startsWith('OPENCLAW_')),
      );
      await writeFile(
        command,
        `#!${process.execPath}\nconst env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));\nprocess.execve(${JSON.stringify(binary)}, [${JSON.stringify(binary)}, ...process.argv.slice(2)], { ...env, ...${JSON.stringify(isolated)} });\n`,
      );
      await chmod(command, 0o700);
      const factory = createOpenClawProviderFactory({
        gateway: gateway.binding,
      });
      client = await factory.connect({
        providerId: factory.descriptor().providerId,
        profileId: profileId('fork-live-openclaw'),
        displayName: 'Isolated official runtime',
        connection: {
          kind: 'process',
          command,
          args: ['acp'],
          cwd: root,
          ownership: 'adapter',
        },
      });
      const parent = await client.createSession();
      await complete(parent, 'HARAPTER_FORK_PARENT');
      const sessions = client
        .extensions()
        .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
          'openclaw.gateway.sessions',
        );
      if (sessions === undefined)
        throw new Error('Missing observed Gateway Session extension.');
      const child = await sessions.fork(parent.ref());
      expect(child.ref().providerSessionId).not.toBe(
        parent.ref().providerSessionId,
      );
      await complete(child, 'HARAPTER_FORK_CHILD');
      expect(model.childInherited()).toBe(true);
      await child.close();
      const resumed = await client.resumeSession(child.ref());
      await complete(resumed, 'HARAPTER_FORK_RESUMED');
      await complete(parent, 'HARAPTER_FORK_PARENT_CONTINUED');
      expect(model.parentIsolated()).toBe(true);
      model.hold();
      const run = await resumed.start({
        parts: [{ type: 'text', text: 'HARAPTER_FORK_CANCEL' }],
      });
      const events = collect(run.events());
      await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
      await expect(run.result()).resolves.toMatchObject({
        status: 'cancelled',
      });
      await events;
    } finally {
      await client?.close();
      gateway?.close();
      await stopChild(server);
      await model.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  90_000,
);

async function connectGateway(url: string, token: string) {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32);
  const deviceId = createHash('sha256').update(publicKey).digest('hex');
  const socket = new WebSocket(url);
  const ready = Promise.withResolvers<unknown>();
  const pending = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<unknown>>
  >();
  let serial = 0;
  const deadline = setTimeout(() => {
    ready.reject(new Error('Gateway handshake timed out.'));
    socket.close();
  }, 15_000);
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data) as {
      type: string;
      id?: string;
      event?: string;
      ok?: boolean;
      payload?: unknown;
    };
    if (message.event === 'connect.challenge') {
      const challenge = message.payload as { nonce: string; ts: number };
      const scopes = ['operator.admin', 'operator.read', 'operator.write'];
      const signature = sign(
        null,
        Buffer.from(
          [
            'v3',
            deviceId,
            'cli',
            'cli',
            'operator',
            scopes.join(','),
            String(challenge.ts),
            token,
            challenge.nonce,
            process.platform,
            '',
          ].join('|'),
        ),
        keys.privateKey,
      ).toString('base64url');
      socket.send(
        JSON.stringify({
          type: 'req',
          id: 'connect',
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 4,
            client: {
              id: 'cli',
              version: 'synthetic',
              platform: process.platform,
              mode: 'cli',
            },
            role: 'operator',
            scopes,
            auth: { token },
            device: {
              id: deviceId,
              publicKey: publicKey.toString('base64url'),
              signature,
              signedAt: challenge.ts,
              nonce: challenge.nonce,
            },
          },
        }),
      );
      return;
    }
    if (message.type !== 'res' || message.id === undefined) return;
    const target = message.id === 'connect' ? ready : pending.get(message.id);
    pending.delete(message.id);
    if (message.ok === true) target?.resolve(message.payload);
    else {
      const diagnostic = JSON.stringify(message).toLowerCase();
      const categories = [
        'device',
        'pairing',
        'signature',
        'protocol',
        'platform',
        'nonce',
        'scope',
        'auth',
        'client',
        'invalid',
        'origin',
        'token',
        'timestamp',
        'ready',
        'startup',
        'unavailable',
      ].filter((term) => diagnostic.includes(term));
      target?.reject(
        new Error(
          `Official Gateway rejected ${message.id === 'connect' ? 'handshake' : 'operation'} (${categories.join(',')}).`,
        ),
      );
    }
  });
  const fail = () => {
    ready.reject(new Error('Official Gateway disconnected.'));
    for (const entry of pending.values())
      entry.reject(new Error('Official Gateway disconnected.'));
    pending.clear();
  };
  socket.addEventListener('error', fail);
  socket.addEventListener('close', fail);
  try {
    const hello = (await ready.promise) as { features?: { methods?: unknown } };
    const methods = hello.features?.methods;
    if (
      !Array.isArray(methods) ||
      !methods.every((method): method is string => typeof method === 'string')
    )
      throw new Error('Gateway methods were not advertised.');
    const binding: OpenClawGatewayBinding = {
      profileId: profileId('fork-live-openclaw'),
      methods,
      request: async (method, params, { signal }) => {
        if (signal.aborted) throw new Error('Gateway operation aborted.');
        const id = String(++serial);
        const response = Promise.withResolvers<unknown>();
        pending.set(id, response);
        const abort = () => {
          pending.delete(id);
          response.reject(new Error('Gateway operation aborted.'));
        };
        signal.addEventListener('abort', abort, { once: true });
        socket.send(JSON.stringify({ type: 'req', id, method, params }));
        try {
          return await response.promise;
        } finally {
          signal.removeEventListener('abort', abort);
        }
      },
    };
    return {
      binding,
      close: () => {
        socket.close();
      },
    };
  } catch (error) {
    socket.close();
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

it.skipIf(binaries === undefined)(
  'verifies OpenCode native history fork with an official isolated server',
  async () => {
    if (binaries === undefined)
      throw new Error('Official runtime directory is required.');
    const root = await mkdtemp(join(tmpdir(), 'harapter-opencode-fork-live-'));
    const model = await startModel();
    let server: ChildProcess | undefined;
    let client: HarnessClient | undefined;
    try {
      const configFile = join(root, 'opencode.json');
      await writeFile(
        configFile,
        JSON.stringify({
          autoupdate: false,
          mcp: {},
          plugin: [],
          permission: { '*': 'deny' },
          share: 'disabled',
          snapshot: false,
          model: 'harapter_mock/synthetic-model',
          small_model: 'harapter_mock/synthetic-model',
          provider: {
            harapter_mock: {
              npm: '@ai-sdk/openai-compatible',
              name: 'Harapter mock',
              models: { 'synthetic-model': { name: 'Synthetic' } },
              options: {
                baseURL: `${model.url}/v1`,
                apiKey: 'synthetic-local-key',
              },
            },
          },
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
        }),
      );
      const port = await unusedPort();
      server = spawn(
        join(binaries, 'opencode'),
        ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
        {
          cwd: root,
          stdio: 'ignore',
          env: {
            ...process.env,
            XDG_CONFIG_HOME: join(root, 'config'),
            XDG_DATA_HOME: join(root, 'data'),
            XDG_STATE_HOME: join(root, 'state'),
            XDG_CACHE_HOME: join(root, 'cache'),
            OPENCODE_CONFIG: configFile,
            OPENCODE_CONFIG_DIR: root,
            OPENCODE_DISABLE_AUTOUPDATE: 'true',
            OPENCODE_DISABLE_MODELS_FETCH: 'true',
          },
        },
      );
      const url = `http://127.0.0.1:${String(port)}`;
      await waitReady(`${url}/global/health`, server);
      const factory = createOpenCodeProviderFactory();
      client = await factory.connect({
        providerId: factory.descriptor().providerId,
        profileId: profileId('fork-live-opencode'),
        displayName: 'Isolated official runtime',
        connection: { kind: 'endpoint', url, ownership: 'external' },
      });
      const parent = await client.createSession({
        workspace: { uri: pathToFileURL(root).href },
      });
      await complete(parent, 'HARAPTER_FORK_PARENT');
      const sessions = client
        .extensions()
        .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(
          'opencode.sessions',
        );
      if (sessions === undefined) throw new Error('Missing Session extension.');
      const child = await sessions.fork(parent.ref());
      expect(child.ref().providerSessionId).not.toBe(
        parent.ref().providerSessionId,
      );
      await complete(child, 'HARAPTER_FORK_CHILD');
      expect(model.childInherited()).toBe(true);
      await child.close();
      const resumed = await client.resumeSession(child.ref());
      await complete(resumed, 'HARAPTER_FORK_RESUMED');
      await complete(parent, 'HARAPTER_FORK_PARENT_CONTINUED');
      expect(model.parentIsolated()).toBe(true);
      model.hold();
      const run = await resumed.start({
        parts: [{ type: 'text', text: 'HARAPTER_FORK_CANCEL' }],
      });
      const events = collect(run.events());
      await expect(run.cancel()).resolves.toEqual({ mode: 'native' });
      await expect(run.result()).resolves.toMatchObject({
        status: 'cancelled',
      });
      await events;
    } finally {
      await client?.close();
      await stopChild(server);
      await model.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  90_000,
);

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Loopback port unavailable.');
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  return address.port;
}

async function waitReady(
  url: string,
  child: ChildProcess,
  headers?: Readonly<Record<string, string>>,
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null)
      throw new Error('Official runtime exited before readiness.');
    try {
      if (
        (
          await fetch(url, {
            signal: AbortSignal.timeout(200),
            ...(headers === undefined ? {} : { headers }),
          })
        ).ok
      )
        return;
    } catch {
      /* The owned runtime is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Official runtime did not become ready.');
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (child?.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) =>
    child.once('close', () => {
      resolve();
    }),
  );
  child.kill('SIGTERM');
  const escalation = setTimeout(() => child.kill('SIGKILL'), 2000);
  try {
    await closed;
  } finally {
    clearTimeout(escalation);
  }
}

// Opt in only with host-installed official runtimes. The loopback model returns
// synthetic text; it never calls tools or contacts a model service.
it.skipIf(binaries === undefined).each(['codex', 'pi'] as const)(
  'verifies %s native history fork with an official isolated runtime',
  async (provider) => {
    if (binaries === undefined)
      throw new Error('Official runtime directory is required.');
    const root = await mkdtemp(join(tmpdir(), 'harapter-fork-live-'));
    const workspace = join(root, 'workspace');
    const config = join(root, 'config');
    await Promise.all([mkdir(workspace), mkdir(config)]);
    const model = await startModel();
    let client: HarnessClient | undefined;
    try {
      let environment: Record<string, string>;
      let args: string[];
      if (provider === 'codex') {
        await writeFile(
          join(config, 'config.toml'),
          `model = "synthetic-model"\nmodel_provider = "harapter_mock"\n[model_providers.harapter_mock]\nname = "Harapter mock"\nbase_url = "${model.url}/v1"\nwire_api = "responses"\n[history]\npersistence = "none"\n[analytics]\nenabled = false\n[feedback]\nenabled = false\n[features]\nshell_tool = false\nunified_exec = false\nplugins = false\napps = false\n[tools]\nweb_search = false\n`,
        );
        environment = { CODEX_HOME: config };
        args = ['app-server', '--stdio'];
      } else {
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
                    name: 'Synthetic model',
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
        environment = {
          PI_CODING_AGENT_DIR: config,
          PI_CODING_AGENT_SESSION_DIR: join(root, 'sessions'),
        };
        args = [
          '--provider',
          'harapter_mock',
          '--model',
          'synthetic-model',
          '--thinking',
          'off',
          '--no-tools',
          '--no-context-files',
        ];
      }
      const command = join(root, 'runtime');
      // execve preserves one adapter-owned process and gives it isolated runtime
      // storage without changing the test runner's environment or user settings.
      await writeFile(
        command,
        `#!${process.execPath}\nconst env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));\nprocess.execve(${JSON.stringify(join(binaries, provider))}, [${JSON.stringify(join(binaries, provider))}, ...process.argv.slice(2)], { ...env, ...${JSON.stringify(environment)} });\n`,
      );
      await chmod(command, 0o700);
      const factory =
        provider === 'codex'
          ? createCodexProviderFactory()
          : createPiProviderFactory();
      client = await factory.connect({
        providerId: factory.descriptor().providerId,
        profileId: profileId(`fork-live-${provider}`),
        displayName: 'Isolated official runtime',
        connection: {
          kind: 'process',
          command,
          args,
          cwd: workspace,
          ownership: 'adapter',
        },
      });
      const parent = await client.createSession(
        provider === 'codex'
          ? {
              workspace: { uri: pathToFileURL(workspace).href },
              providerOptions: {
                ephemeral: false,
                approvalPolicy: 'never',
                sandbox: 'read-only',
              },
            }
          : {},
      );
      await complete(parent, 'HARAPTER_FORK_PARENT');
      const sourceRef = parent.ref();
      const extensionName =
        provider === 'codex' ? 'openai.codex.sessions' : 'pi.agent.sessions';
      const sessions = client
        .extensions()
        .get<{ fork(ref: SessionRef): Promise<HarnessSession> }>(extensionName);
      if (sessions === undefined) throw new Error('Missing Session extension.');
      const child = await sessions.fork(sourceRef);
      expect(child.ref().providerSessionId).not.toBe(
        sourceRef.providerSessionId,
      );
      expect(parent.ref()).toEqual(sourceRef);
      await complete(child, 'HARAPTER_FORK_CHILD');
      expect(model.childInherited()).toBe(true);
      const childRef = child.ref();
      await child.close();
      const resumed = await client.resumeSession(childRef);
      expect(resumed.ref()).toEqual(childRef);
      await complete(resumed, 'HARAPTER_FORK_RESUMED');
      await complete(parent, 'HARAPTER_FORK_PARENT_CONTINUED');
      expect(model.parentIsolated()).toBe(true);
      model.hold();
      const cancelled = await resumed.start({
        parts: [{ type: 'text', text: 'HARAPTER_FORK_CANCEL' }],
      });
      const events = collect(cancelled.events());
      await expect(cancelled.cancel()).resolves.toEqual({ mode: 'native' });
      await expect(cancelled.result()).resolves.toMatchObject({
        status: 'cancelled',
      });
      await events;
    } finally {
      await client?.close();
      await model.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

async function complete(session: HarnessSession, text: string): Promise<void> {
  const run = await session.start({ parts: [{ type: 'text', text }] });
  const events = collect(run.events());
  await expect(run.result()).resolves.toMatchObject({
    status: 'completed',
    finalMessage: 'Synthetic fork result.',
  });
  await events;
}

async function collect(events: AsyncIterable<unknown>): Promise<void> {
  for await (const event of events) {
    if (typeof event === 'object' && event !== null && 'type' in event)
      expect(['tool.started', 'interaction.requested']).not.toContain(
        event.type,
      );
  }
}

async function startModel() {
  let inherited = false;
  let isolated = false;
  let held = false;
  const server = createServer((request, response) => {
    void (async () => {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      // Only boolean evidence leaves this handler; never retain or log runtime
      // system instructions, model request content, headers, or paths.
      if (body.includes('HARAPTER_FORK_CHILD'))
        inherited = body.includes('HARAPTER_FORK_PARENT');
      if (body.includes('HARAPTER_FORK_PARENT_CONTINUED'))
        isolated = !body.includes('HARAPTER_FORK_CHILD');
      if (held) return;
      if (
        request.url?.endsWith('/responses') !== true &&
        (JSON.parse(body) as { stream?: boolean }).stream !== true
      ) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'chatcmpl_synthetic',
            object: 'chat.completion',
            created: 1,
            model: 'synthetic-model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Synthetic fork result.',
                },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = (value: unknown) =>
        response.write(`data: ${JSON.stringify(value)}\n\n`);
      const content = 'Synthetic fork result.';
      if (request.url?.endsWith('/responses') === true) {
        const item = {
          id: 'msg_synthetic',
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: content, annotations: [] }],
        };
        const result = {
          id: 'resp_synthetic',
          object: 'response',
          created_at: 1,
          status: 'completed',
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
        emit({
          type: 'response.created',
          response: { ...result, status: 'in_progress', output: [] },
        });
        emit({
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...item, status: 'in_progress', content: [] },
        });
        emit({
          type: 'response.content_part.added',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        });
        emit({
          type: 'response.output_text.delta',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: content,
        });
        emit({
          type: 'response.output_text.done',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          text: content,
        });
        emit({ type: 'response.output_item.done', output_index: 0, item });
        emit({ type: 'response.completed', response: result });
      } else {
        emit({
          id: 'chatcmpl_synthetic',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'synthetic-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content },
              finish_reason: null,
            },
          ],
        });
        emit({
          id: 'chatcmpl_synthetic',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'synthetic-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
        response.write('data: [DONE]\n\n');
      }
      response.end();
    })().catch(() => response.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Loopback model failed to bind.');
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    childInherited: () => inherited,
    parentIsolated: () => isolated,
    hold: () => {
      held = true;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
