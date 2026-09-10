import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Verify the one-package application contract outside Workspace resolution. */
export function checkHarapterConsumer({
  repositoryRoot,
  fixtureRoot,
  tarballs,
  dependencyStore,
  packageManager,
  pnpm,
  run,
}) {
  const directory = resolve(fixtureRoot, 'harapter-only');
  mkdirSync(directory);
  const overrides = Object.fromEntries(
    [...tarballs].map(([name, path]) => [name, `file:${path}`]),
  );
  writeFileSync(
    resolve(directory, 'package.json'),
    JSON.stringify({
      name: 'harapter-only-consumer',
      private: true,
      type: 'module',
      packageManager,
      dependencies: { harapter: overrides.harapter },
    }),
  );
  writeFileSync(
    resolve(directory, 'pnpm-workspace.yaml'),
    JSON.stringify({
      autoInstallPeers: true,
      overrides,
    }),
  );
  run(
    pnpm,
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--lockfile=false',
      '--store-dir',
      dependencyStore,
    ],
    directory,
    'Harapter-only consumer install',
  );
  writeFileSync(
    resolve(directory, 'app.ts'),
    readFileSync(
      resolve(repositoryRoot, 'examples/runtime-profiles/src/quick-unified.ts'),
    ),
  );
  for (const name of [
    'quick-start.ts',
    'runtime-config.ts',
    'quick-run.ts',
    'quick-dsh-run.ts',
    'quick-chat.ts',
  ]) {
    writeFileSync(
      resolve(directory, name),
      readFileSync(
        resolve(repositoryRoot, 'examples/runtime-profiles/src', name),
      ),
    );
  }
  writeFileSync(
    resolve(directory, 'fake.ts'),
    readFileSync(
      resolve(repositoryRoot, 'examples/sdk-application/src/test-with-fake.ts'),
    ),
  );
  // The consumer has only one direct Harapter dependency and no source aliases.
  run(
    process.execPath,
    [
      resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'),
      '--strict',
      '--exactOptionalPropertyTypes',
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
      '--outDir',
      'dist',
      'app.ts',
      'quick-start.ts',
      'runtime-config.ts',
      'quick-run.ts',
      'quick-dsh-run.ts',
      'quick-chat.ts',
      'fake.ts',
    ],
    directory,
    'Harapter-only type consumer',
  );
  run(
    process.execPath,
    ['dist/fake.js'],
    directory,
    'Core README Fake consumer without Vitest',
  );
  const fixtureServer = pathToFileURL(
    resolve(repositoryRoot, 'providers/opencode/test/fixture-server.ts'),
  ).href;
  const fixtureRuntime = resolve(
    repositoryRoot,
    'providers/dsh/test/fixture-runtime.mjs',
  );
  writeFileSync(
    resolve(directory, 'smoke.mjs'),
    `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHarapter, profileId, providerId, HarnessError, run, openSession} from 'harapter';
import {runTask} from './dist/app.js';
import {createDshProviderFactory} from 'harapter/dsh';
import {startOpenCodeFixtureServer} from ${JSON.stringify(fixtureServer)};
const require = createRequire(import.meta.url);
const fromHarapter = createRequire(require.resolve('harapter'));
for (const name of ${JSON.stringify(JSON.parse(readFileSync(resolve(repositoryRoot, 'scripts/harapter-modules.json'), 'utf8')).modules.map((entry) => entry.name))}) {
  assert.throws(() => fromHarapter.resolve(name), {code: 'MODULE_NOT_FOUND'});
}
assert.throws(() => fromHarapter.resolve('vitest'), {code: 'MODULE_NOT_FOUND'});
const custom = await createHarapter();
custom.register(createDshProviderFactory());
assert.equal(custom.listProviders().length, 1);
assert.equal((await createHarapter()).listProviders().length, 0);
const all = await createHarapter({harnesses: ['codex', 'dsh', 'hermes', 'openclaw', 'opencode', 'pi']});
assert.equal(all.listProviders().length, 6);
await assert.rejects(createHarapter({harnesses: ['unknown']}), (error) => error instanceof HarnessError && error.code === 'invalid_request');
const server = await startOpenCodeFixtureServer({authorization: 'Bearer synthetic-token'});
try {
  const sdk = await createHarapter({harnesses: ['dsh', 'opencode'], resolveAuthHeaders: () => ({authorization: 'Bearer synthetic-token'})});
  assert.deepEqual(sdk.listProviders().map((provider) => provider.providerId).sort(), ['deepseek.harness', 'opencode']);
  const profiles = [{profileId: profileId('bundled-dsh'), providerId: providerId('deepseek.harness'), displayName: 'Synthetic DSH',
    connection: {kind: 'process', command: process.execPath, args: [${JSON.stringify(fixtureRuntime)}], ownership: 'adapter'},
    providerOptions: {provider: 'synthetic-provider', model: 'synthetic-model'}},
    {profileId: profileId('bundled-opencode'), providerId: providerId('opencode'), displayName: 'Synthetic OpenCode',
    connection: {kind: 'endpoint', transport: 'http', url: server.url, ownership: 'external', authRef: {scheme: 'fixture', id: 'opencode'}}}];
  const outcomes = await Promise.all(profiles.map(async (profile) => {
    const events = [];
    const outcome = await runTask(sdk, profile, 'synthetic answer', (event) => events.push(event.type));
    assert.equal(outcome.result.status, 'completed');
    assert.ok(events.includes('message.delta'));
    assert.equal(events.at(-1), 'run.completed');
    assert.equal(outcome.sessionRef.providerId, profile.providerId);
    return outcome;
  }));
  assert.deepEqual(outcomes.map((outcome) => outcome.result.finalMessage), ['synthetic answer', 'fixture answer']);
  // The same public one-call function switches harnesses without application Profiles.
  for (const connection of [
    {harness: 'dsh', command: process.execPath, args: [${JSON.stringify(fixtureRuntime)}], model: {provider: 'synthetic-provider', id: 'synthetic-model'}},
    {harness: 'pi', command: process.execPath, args: [${JSON.stringify(resolve(repositoryRoot, 'providers/pi/test/fixture-runtime.mjs'))}]},
    {harness: 'opencode', url: server.url, headers: {authorization: 'Bearer synthetic-token'}},
  ]) {
    const events = [];
    const result = await run({...connection, input: 'synthetic answer', onEvent: (event) => { events.push(event.type); }});
    assert.equal(result.status, 'completed');
    assert.equal(typeof result.finalMessage, 'string');
    assert.equal(events[0], 'run.started');
    assert.equal(events.at(-1), 'run.completed');
    const chat = await openSession(connection);
    try {
      const ref = chat.ref();
      assert.equal((await chat.send('synthetic first')).status, 'completed');
      assert.equal((await chat.send('synthetic second')).status, 'completed');
      assert.deepEqual(chat.ref(), ref);
    } finally { await chat.close(); }
  }
  assert.equal(server.deleteRequests(), 0);
  assert.equal(server.disposeRequests(), 0);
} finally {await server.close();}
`,
  );
  run(
    process.execPath,
    ['smoke.mjs'],
    directory,
    'Harapter-only Runtime fixture consumer',
  );
}
