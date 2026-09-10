import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Opt-in package evidence. Install the native SDK only in an external consumer project.
const root = resolve(process.argv[2]);
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(metadata.name, '@earendil-works/pi-coding-agent');
assert.equal(metadata.version, '0.85.1');
const require = createRequire(join(root, 'package.json'));
const sdk = await import(pathToFileURL(join(root, 'dist/index.js')).href);
let aiEntry;
for (const directory of require.resolve.paths('@earendil-works/pi-ai')) {
  const candidate = join(directory, '@earendil-works/pi-ai/dist/index.js');
  try {
    await access(candidate);
    aiEntry = candidate;
    break;
  } catch {
    /* Continue Node's package search paths. */
  }
}
assert.ok(aiEntry);
const ai = await import(pathToFileURL(aiEntry).href);
const { openSession } = await import(
  new URL('../../../packages/harapter/dist/index.js', import.meta.url)
);
const directory = await mkdtemp(join(tmpdir(), 'harapter-pi-sdk-native-'));
const nativeSessions = [];
let disposed = 0;
let historyLength = 0;
let hang = false;
const modelRuntime = await sdk.ModelRuntime.create({
  credentials: new ai.InMemoryCredentialStore(),
  modelsStore: new ai.InMemoryModelsStore(),
  modelsPath: null,
  refreshOnCreate: false,
});
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
modelRuntime.registerProvider('harapter-synthetic', {
  api: 'openai-completions',
  apiKey: 'synthetic-not-a-credential',
  baseUrl: 'http://127.0.0.1:1',
  models: [
    {
      id: 'synthetic',
      name: 'Synthetic',
      reasoning: false,
      input: ['text'],
      cost,
      contextWindow: 32_000,
      maxTokens: 100,
    },
  ],
  streamSimple(model, context, options) {
    historyLength = context.messages.length;
    const stream = ai.createAssistantMessageEventStream();
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Synthetic native SDK answer' }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: 'stop',
      timestamp: 0,
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { ...cost, total: 0 },
      },
    };
    const finish = () => {
      if (options?.signal?.aborted)
        stream.push({
          type: 'error',
          reason: 'aborted',
          error: { ...message, stopReason: 'aborted' },
        });
      else {
        stream.push({
          type: 'text_delta',
          contentIndex: 0,
          delta: 'Synthetic native SDK answer',
          partial: message,
        });
        stream.push({ type: 'done', reason: 'stop', message });
      }
      stream.end();
    };
    if (hang) options.signal.addEventListener('abort', finish, { once: true });
    else setTimeout(finish, 5);
    return stream;
  },
});
let chat;
try {
  chat = await openSession({
    harness: 'pi',
    runtime: {
      kind: 'pi-sdk',
      version: '0.85.1',
      async createSession() {
        const settingsManager = sdk.SettingsManager.inMemory({
          retry: { enabled: false },
          compaction: { enabled: false },
        });
        const resourceLoader = new sdk.DefaultResourceLoader({
          cwd: directory,
          agentDir: directory,
          settingsManager,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          systemPrompt: 'Synthetic SDK integration fixture.',
        });
        await resourceLoader.reload();
        const { session } = await sdk.createAgentSession({
          cwd: directory,
          agentDir: directory,
          sessionManager: sdk.SessionManager.inMemory(),
          modelRuntime,
          settingsManager,
          resourceLoader,
          tools: [],
          model: modelRuntime.getModel('harapter-synthetic', 'synthetic'),
        });
        const dispose = session.dispose.bind(session);
        session.dispose = () => {
          disposed++;
          dispose();
        };
        nativeSessions.push(session);
        return session;
      },
    },
  });
  assert.equal((await chat.send('Synthetic first turn')).status, 'completed');
  assert.equal((await chat.send('Synthetic second turn')).status, 'completed');
  assert.equal(nativeSessions.length, 1);
  assert.equal(historyLength, 3);
  hang = true;
  const run = await chat.start({
    parts: [{ type: 'text', text: 'Synthetic cancellation turn' }],
  });
  await new Promise((done) => setTimeout(done, 20));
  assert.deepEqual(await run.cancel(), { mode: 'native' });
  assert.equal((await run.result()).status, 'cancelled');
  await chat.close();
  assert.equal(disposed, 1);
  console.log(
    'Pi SDK 0.85.1: two turns retained history; native cancellation and owned disposal passed. Synthetic model; no network or credentials used.',
  );
} finally {
  await chat?.close();
  await rm(directory, { recursive: true, force: true });
}
