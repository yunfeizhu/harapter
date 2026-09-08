import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import type * as OpenClawModule from '@harapter/adapter-openclaw';

vi.mock('@harapter/adapter-openclaw', async (importOriginal) => {
  const original = await importOriginal<typeof OpenClawModule>();
  return {
    ...original,
    createOpenClawProviderFactory: () => {
      const factory = original.createOpenClawProviderFactory();
      return {
        descriptor: () => factory.descriptor(),
        connect: (profile: Parameters<typeof factory.connect>[0]) => {
          if (profile.connection.kind !== 'process')
            throw new Error('Expected a process composition.');
          return factory.connect({
            ...profile,
            connection: {
              ...profile.connection,
              // Substitute only the process executable for this offline test.
              command: process.execPath,
              args: [
                fileURLToPath(
                  new URL(
                    '../providers/openclaw/test/fixture-runtime.mjs',
                    import.meta.url,
                  ),
                ),
              ],
            },
          });
        },
      };
    },
  };
});

it('runs the OpenClaw quick entry through terminal settlement and native Session cleanup', async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'harapter-sdk-quick-')),
  );
  const previousExitCode = process.exitCode;
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('HARAPTER_OPENCLAW_COMMAND', process.execPath);
  vi.stubEnv('HARAPTER_WORKSPACE', workspace);
  try {
    process.exitCode = undefined;
    await import('../examples/sdk-application/src/quick-openclaw.js');
    expect(output).toHaveBeenCalledWith({ status: 'completed', hasText: true });
    expect(errors).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  } finally {
    process.exitCode = previousExitCode;
    await rm(workspace, { recursive: true, force: true });
  }
});
