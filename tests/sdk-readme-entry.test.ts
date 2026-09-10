import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import type * as DshModule from '@harapter/adapter-dsh';
import { startOpenCodeFixtureServer } from '../providers/opencode/test/fixture-server.js';

const fixture = vi.hoisted(() => ({ mode: 'normal' }));

vi.mock('@harapter/adapter-dsh', async (importOriginal) => {
  const original = await importOriginal<typeof DshModule>();
  return {
    ...original,
    createDshProviderFactory: () => {
      const factory = original.createDshProviderFactory();
      return {
        descriptor: () => factory.descriptor(),
        connect: (profile: Parameters<typeof factory.connect>[0]) => {
          if (profile.connection.kind !== 'process')
            throw new Error('Expected the documented DSH process profile.');
          expect(profile.connection.args).toEqual([
            '--profile',
            'sdk-minimal',
            '--patch',
            '/fixture/no-tools.patch.yml',
          ]);
          return factory.connect({
            ...profile,
            connection: {
              ...profile.connection,
              command: process.execPath,
              args: [
                fileURLToPath(
                  new URL(
                    '../providers/dsh/test/fixture-runtime.mjs',
                    import.meta.url,
                  ),
                ),
                fixture.mode,
              ],
            },
          });
        },
      };
    },
  };
});

it.each([
  { harness: 'dsh', mode: 'normal' },
  { harness: 'opencode', mode: 'normal' },
  { harness: 'dsh', mode: 'error-terminal' },
  { harness: 'dsh', mode: 'missing-terminal' },
])(
  'runs the short README entry with $harness and $mode',
  async ({ harness, mode }) => {
    vi.resetModules();
    fixture.mode = mode;
    const workspace = await realpath(
      await mkdtemp(join(tmpdir(), 'harapter-readme-entry-')),
    );
    const authorization = `Basic ${Buffer.from('opencode:synthetic-password').toString('base64')}`;
    const server = await startOpenCodeFixtureServer({ authorization });
    const previousExitCode = process.exitCode;
    const output = vi.spyOn(console, 'log').mockImplementation(() => {
      if (mode === 'missing-terminal')
        throw new Error('Synthetic host output failure with private detail.');
    });
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.stubEnv('HARAPTER_HARNESS', harness);
    vi.stubEnv('HARAPTER_WORKSPACE', workspace);
    vi.stubEnv('HARAPTER_DSH_COMMAND', 'fixture-dsh');
    vi.stubEnv('HARAPTER_DSH_PATCH', '/fixture/no-tools.patch.yml');
    vi.stubEnv('HARAPTER_DSH_PROVIDER', 'synthetic-provider');
    vi.stubEnv('HARAPTER_DSH_MODEL', 'synthetic-model');
    vi.stubEnv('HARAPTER_OPENCODE_URL', server.url);
    vi.stubEnv('OPENCODE_SERVER_PASSWORD', 'synthetic-password');
    vi.stubEnv('OPENCODE_SERVER_USERNAME', 'opencode');
    try {
      process.exitCode = undefined;
      await import('../examples/runtime-profiles/src/quick-start.js');
      const summaries = output.mock.calls.filter(
        ([value]: readonly unknown[]) =>
          typeof value === 'object' && value !== null && 'status' in value,
      );
      expect(summaries).toEqual(
        mode === 'missing-terminal'
          ? []
          : [
              [
                {
                  status: mode === 'error-terminal' ? 'failed' : 'completed',
                  hasText: mode !== 'error-terminal',
                },
              ],
            ],
      );
      expect(errors.mock.calls).toEqual(
        mode === 'missing-terminal' ? [[{ error: 'application_failed' }]] : [],
      );
      expect(process.exitCode).toBe(mode === 'normal' ? undefined : 1);
      expect(server.deleteRequests()).toBe(0);
      expect(server.disposeRequests()).toBe(0);
      const logged = JSON.stringify(output.mock.calls);
      expect(logged).not.toContain('synthetic-password');
      expect(logged).not.toContain(workspace);
      expect(logged).not.toContain('fixture answer');
    } finally {
      process.exitCode = previousExitCode;
      await server.close();
      await rm(workspace, { recursive: true, force: true });
    }
  },
);

it('reports missing configuration without printing environment values or error stacks', async () => {
  vi.resetModules();
  vi.stubEnv('HARAPTER_HARNESS', undefined);
  vi.stubEnv('HARAPTER_WORKSPACE', undefined);
  const previousExitCode = process.exitCode;
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    process.exitCode = undefined;
    await import('../examples/runtime-profiles/src/quick-start.js');
    expect(output).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledExactlyOnceWith({
      error: 'application_failed',
    });
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previousExitCode;
  }
});
