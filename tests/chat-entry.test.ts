import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('harapter');
  vi.resetModules();
});

it.each(['connect', 'send', 'close'])(
  'handles %s failures without printing exception stacks',
  async (stage) => {
    vi.resetModules();
    const failure = new Error('synthetic-private-detail');
    const chat = {
      send: () =>
        stage === 'send'
          ? Promise.reject(failure)
          : Promise.resolve({ status: 'completed' }),
      close: () =>
        stage === 'close' ? Promise.reject(failure) : Promise.resolve(),
    };
    vi.doMock('harapter', () => ({
      openSession: () =>
        stage === 'connect' ? Promise.reject(failure) : Promise.resolve(chat),
      isHarnessError: () => false,
    }));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const previous = process.exitCode;
    try {
      process.exitCode = undefined;
      const outcome =
        await import('../examples/runtime-profiles/src/quick-chat.js').then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(outcome).toBeUndefined();
      expect(errors.mock.calls).toEqual([[{ error: 'application_failed' }]]);
      expect(JSON.stringify(errors.mock.calls)).not.toContain(
        'synthetic-private-detail',
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previous;
    }
  },
);

it.each([false, true])(
  'keeps chat output metadata-only and closes the Session on observer failure: %s',
  async (fail) => {
    vi.resetModules();
    const chat = {
      send: vi.fn(() =>
        Promise.resolve({
          status: 'completed',
          finalMessage: 'synthetic-private-output',
        }),
      ),
      close: vi.fn(() => Promise.resolve()),
    };
    vi.doMock('harapter', () => ({
      openSession: () => Promise.resolve(chat),
      isHarnessError: () => false,
    }));
    const previous = process.exitCode;
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {
      if (fail) throw new Error('Synthetic observer failure');
    });
    const outcome =
      await import('../examples/runtime-profiles/src/quick-chat.js').then(
        () => undefined,
        (error: unknown) =>
          error instanceof Error ? error.message : 'unexpected failure',
      );
    process.exitCode = previous;
    expect(outcome).toBeUndefined();
    expect(errors.mock.calls).toEqual(
      fail ? [[{ error: 'application_failed' }]] : [],
    );
    expect(chat.send).toHaveBeenCalledWith('My name is Alex.');
    expect(chat.close).toHaveBeenCalledOnce();
    expect(log.mock.calls).toEqual(
      Array.from({ length: fail ? 1 : 2 }, () => [
        { status: 'completed', hasText: true },
      ]),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      'synthetic-private-output',
    );
  },
);
