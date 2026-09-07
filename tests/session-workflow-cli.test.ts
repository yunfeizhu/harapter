import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let directory: string;
let entrypoint: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'harapter-session-cli-'));
  entrypoint = join(directory, 'session-main.js');
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ type: 'module' }),
  );
  await symlink(
    resolve('examples/multi-provider-client/node_modules'),
    join(directory, 'node_modules'),
    'dir',
  );
  for (const name of [
    'session-main',
    'session-providers',
    'session-workflow',
  ]) {
    const source = await readFile(
      resolve(`examples/multi-provider-client/src/${name}.ts`),
      'utf8',
    );
    const result = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2024,
        module: ts.ModuleKind.ESNext,
      },
    });
    await writeFile(join(directory, `${name}.js`), result.outputText);
  }
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('session workflow command entrypoint', () => {
  it('requires an explicit absolute configuration path', () => {
    const result = spawnSync(
      process.execPath,
      [entrypoint, 'relative-config.mjs'],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^Usage:/u);
  });

  it('recognizes a symlinked entrypoint when Node preserves the main symlink', async () => {
    const linked = join(directory, 'session-linked.js');
    await symlink(entrypoint, linked);
    const result = spawnSync(
      process.execPath,
      ['--preserve-symlinks-main', linked],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^Usage:/u);
  });

  it('redacts module errors instead of exposing paths or credential values', async () => {
    const config = join(directory, 'private-config.mjs');
    await writeFile(
      config,
      'throw new Error("fictional-secret-that-must-not-leak");',
    );
    const result = spawnSync(process.execPath, [entrypoint, config], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'Session workflow failed. Check the trusted host configuration and runtime requirements.\n',
    );
  });

  it('disposes host resources even when Provider configuration is rejected', async () => {
    const config = join(directory, 'cleanup-config.mjs');
    await writeFile(
      config,
      'export default {}; export function dispose() { process.stdout.write("host-cleanup-complete"); }',
    );
    const result = spawnSync(process.execPath, [entrypoint, config], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('host-cleanup-complete');
    expect(result.stderr).toMatch(/^Session workflow failed\./u);
  });
});
