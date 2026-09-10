import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { run, type HarnessEvent } from 'harapter';
import { startOpenCodeFixtureServer } from '../../../providers/opencode/test/fixture-server.js';
import { HermesFixtureApi } from '../../../providers/hermes/test/test-profile.js';

const fixturePath = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));
const dsh = fixturePath('../../../providers/dsh/test/fixture-runtime.mjs');
const pi = fixturePath('../../../providers/pi/test/fixture-runtime.mjs');
const codex = fixturePath(
  '../../../providers/codex/test/fixture-app-server.mjs',
);
const openclaw = fixturePath(
  '../../../providers/openclaw/test/fixture-runtime.mjs',
);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function workspace() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'harapter-run-')));
  directories.push(path);
  return path;
}

it.each([
  {
    harness: 'dsh',
    args: [dsh],
    model: { provider: 'synthetic-provider', id: 'synthetic-model' },
  },
  { harness: 'pi', args: [pi] },
  { harness: 'codex', args: [codex] },
  { harness: 'openclaw', args: [openclaw] },
] as const)('runs $harness through one public call', async (connection) => {
  const events: HarnessEvent[] = [];
  const result = await run({
    ...connection,
    command: process.execPath,
    cwd: await workspace(),
    input: 'Fictional task.',
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(result.status).toBe('completed');
  expect(result.finalMessage).toBeTypeOf('string');
  expect(events[0]?.type).toBe('run.started');
  expect(events.at(-1)?.type).toBe('run.completed');
});

it('runs authenticated OpenCode without a Profile or header resolver', async () => {
  const server = await startOpenCodeFixtureServer({
    authorization: 'Bearer synthetic-token',
  });
  try {
    const result = await run({
      harness: 'opencode',
      url: server.url,
      headers: { authorization: 'Bearer synthetic-token' },
      cwd: await workspace(),
      input: 'Fictional task.',
    });
    expect(result).toMatchObject({
      status: 'completed',
      finalMessage: 'fixture answer',
    });
    expect(server.deleteRequests()).toBe(0);
    expect(server.disposeRequests()).toBe(0);
  } finally {
    await server.close();
  }
});

it('runs Hermes using the same input and result API', async () => {
  const api = new HermesFixtureApi();
  vi.stubGlobal('fetch', api.fetch);
  const result = await run({
    harness: 'hermes',
    url: 'http://fixture.invalid/',
    input: 'Fictional task.',
  });
  expect(result.status).toBe('completed');
});

it('keeps an authoritative failed result distinct from a thrown error', async () => {
  const result = await run({
    harness: 'dsh',
    command: process.execPath,
    args: [dsh, 'error-terminal'],
    model: { provider: 'synthetic', id: 'synthetic' },
    input: 'Fictional task.',
  });
  expect(result.status).toBe('failed');
});

it('closes a pending task when an event observer rejects without exposing its cause', async () => {
  const result = run({
    harness: 'dsh',
    command: process.execPath,
    args: [dsh],
    model: { provider: 'synthetic', id: 'synthetic' },
    input: 'connection abort input',
    onEvent: () => Promise.reject(new Error('private observer content')),
  });
  await expect(result).rejects.toMatchObject({
    code: 'provider_error',
    cause: undefined,
  });
  await expect(result).rejects.not.toThrow('private observer content');
});

it('bounds asynchronous observers by the whole-call deadline', async () => {
  const output = vi.fn(() => new Promise<void>(() => undefined));
  await expect(
    run({
      harness: 'pi',
      command: process.execPath,
      args: [pi],
      input: 'Fictional task.',
      onEvent: output,
      timeoutMs: 300,
    }),
  ).rejects.toMatchObject({ code: 'timeout' });
  expect(output).toHaveBeenCalled();
});

it('rejects unattended approvals and closes its connection without answering them', async () => {
  const server = await startOpenCodeFixtureServer();
  try {
    await expect(
      run({
        harness: 'opencode',
        url: server.url,
        input: 'permission',
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' });
    expect(server.permissionResponses()).toEqual([]);
  } finally {
    await server.close();
  }
});
