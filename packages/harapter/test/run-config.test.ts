import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { run, type RunRequest } from 'harapter';
import { prepareRun, snapshotRun } from '../src/run-config.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function directory() {
  const path = await realpath(
    await mkdtemp(join(tmpdir(), 'harapter-run-config-')),
  );
  directories.push(path);
  return path;
}

it.each([
  null,
  undefined,
  [],
  'pi',
  {},
  { harness: 'unknown', input: 'Fictional task.' },
  { harness: '__proto__', input: 'Fictional task.' },
  ...[
    { extra: true },
    { input: '' },
    { input: ' ' },
    { input: 1 },
    { cwd: '' },
    { command: 1 },
    { url: '\0' },
    { onEvent: 1 },
    { args: 'pi' },
    { args: [1] },
    { args: ['\0'] },
    { model: null },
    { model: [] },
    { model: { id: '' } },
    { model: { id: 'x', bad: true } },
    { model: { id: 'x', provider: '' } },
    { headers: [] },
    { headers: { authorization: 1 } },
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 1.5 },
    { timeoutMs: NaN },
    { timeoutMs: 2_147_483_648 },
  ].map((patch) => ({ harness: 'pi', input: 'Fictional task.', ...patch })),
])('rejects invalid run options before execution: %j', async (request) => {
  await expect(run(request as RunRequest)).rejects.toMatchObject({
    code: 'invalid_request',
    retryable: false,
  });
});

it('redacts exceptions raised while reading caller configuration', async () => {
  const request = {
    get harness(): 'pi' {
      throw new Error('private configuration');
    },
    input: 'Fictional task.',
  };
  await expect(run(request)).rejects.toMatchObject({
    code: 'invalid_request',
    cause: undefined,
  });
});

it('snapshots nested options without mutating caller-owned objects', () => {
  const args = ['--fixture'];
  const headers = { authorization: 'synthetic-original' };
  const model = { id: 'original', provider: 'synthetic' };
  const request = {
    harness: 'dsh',
    input: 'Fictional task.',
    args,
    headers,
    model,
  } as const;
  const snapshot = snapshotRun(request);
  args.push('changed');
  headers.authorization = 'changed';
  model.id = 'changed';
  expect(snapshot.args).toEqual(['--fixture']);
  expect(snapshot.headers).toEqual({ authorization: 'synthetic-original' });
  expect(snapshot.model).toEqual({ id: 'original', provider: 'synthetic' });
  expect(snapshot.timeoutMs).toBe(60_000);
});

it.each([
  { harness: 'dsh', code: 'invalid_request' },
  { harness: 'dsh', model: { id: 'x' }, code: 'invalid_request' },
  { harness: 'pi', model: { id: 'x' }, code: 'unsupported_capability' },
  { harness: 'openclaw', model: { id: 'x' }, code: 'unsupported_capability' },
  {
    harness: 'codex',
    model: { id: 'x', provider: 'x' },
    code: 'unsupported_capability',
  },
  { harness: 'opencode', model: { id: 'x' }, code: 'invalid_request' },
  { harness: 'pi', url: 'http://fixture.invalid', code: 'invalid_request' },
  { harness: 'pi', headers: {}, code: 'invalid_request' },
  { harness: 'opencode', command: 'node', code: 'invalid_request' },
  { harness: 'hermes', args: [], code: 'invalid_request' },
  { harness: 'hermes', cwd: '/synthetic', code: 'unsupported_capability' },
  { harness: 'opencode', cwd: 'relative', code: 'invalid_request' },
] as const)(
  'rejects unsupported composition for $harness',
  async ({ code, ...options }) => {
    await expect(
      run({ ...options, input: 'Fictional task.' }),
    ).rejects.toMatchObject({ code });
  },
);

it.each([
  {
    harness: 'dsh',
    model: { id: 'synthetic-model', provider: 'synthetic-provider' },
    args: ['--profile', 'sdk'],
  },
  {
    harness: 'codex',
    model: { id: 'synthetic-model' },
    args: ['app-server', '--stdio'],
  },
  { harness: 'pi', args: [] },
  { harness: 'openclaw', args: ['acp'] },
] as const)(
  'uses documented $harness command defaults from PATH',
  async ({ harness, model, args }) => {
    const path = await directory();
    const command = join(path, harness);
    await writeFile(command, 'synthetic executable');
    await chmod(command, 0o700);
    vi.stubEnv('PATH', ['', 'relative-entry', path].join(delimiter));
    const config = await prepareRun({
      harness,
      input: 'Fictional task.',
      ...(model ? { model } : {}),
    });
    expect(config.profile.connection).toMatchObject({
      command,
      args,
      ownership: 'adapter',
    });
    expect(config.sdk.harnesses).toEqual([harness]);
  },
);

it('resolves explicit relative commands from the selected working directory', async () => {
  const cwd = await directory();
  await writeFile(join(cwd, 'fixture'), 'synthetic executable');
  await chmod(join(cwd, 'fixture'), 0o700);
  const config = await prepareRun({
    harness: 'pi',
    command: './fixture',
    cwd,
    args: [],
    input: 'Fictional task.',
  });
  expect(config.profile.connection).toMatchObject({
    command: join(cwd, 'fixture'),
    cwd,
  });
});

it('skips missing, non-executable and directory PATH entries with safe errors', async () => {
  const first = await directory();
  const second = await directory();
  await mkdir(join(first, 'pi'));
  await writeFile(join(second, 'pi'), 'synthetic');
  await chmod(join(second, 'pi'), 0o600);
  vi.stubEnv('PATH', [join(first, 'missing'), first, second].join(delimiter));
  const failure = run({ harness: 'pi', input: 'Fictional task.' });
  await expect(failure).rejects.toMatchObject({
    code: 'runtime_not_found',
    retryable: false,
    cause: undefined,
  });
  await expect(failure).rejects.not.toThrow(first);
});

it('does not search the current directory when PATH is absent', async () => {
  vi.stubEnv('PATH', undefined);
  await expect(
    run({ harness: 'pi', input: 'Fictional task.' }),
  ).rejects.toMatchObject({ code: 'runtime_not_found' });
});

it.each([
  { harness: 'opencode', url: 'http://127.0.0.1:4096', key: 'providerId' },
  { harness: 'hermes', url: 'http://127.0.0.1:8642', key: 'provider' },
] as const)(
  'maps $harness model routing and keeps HTTP credentials outside the Profile',
  async ({ harness, url, key }) => {
    const headers = { authorization: 'synthetic-token' };
    const config = await prepareRun({
      harness,
      headers,
      input: 'Fictional task.',
      model: { id: 'synthetic-model', provider: 'synthetic-provider' },
    });
    expect(config.profile.connection).toMatchObject({
      url,
      ownership: 'external',
    });
    expect(config.session.model).toEqual({
      id: 'synthetic-model',
      providerOptions: { [key]: 'synthetic-provider' },
    });
    expect(JSON.stringify(config.profile)).not.toContain('synthetic-token');
    const connection = config.profile.connection;
    if (
      connection.kind !== 'endpoint' ||
      connection.authRef === undefined ||
      config.sdk.resolveAuthHeaders === undefined
    )
      throw new Error('Expected HTTP authentication configuration.');
    expect(await config.sdk.resolveAuthHeaders(connection.authRef)).toEqual(
      headers,
    );
    expect(() =>
      config.sdk.resolveAuthHeaders?.({ scheme: 'other', id: 'other' }),
    ).toThrow('Unknown run authentication reference.');
  },
);
