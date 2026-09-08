import { describe, expect, it, vi } from 'vitest';
import { runInteractionDemo } from '../examples/multi-provider-client/src/interaction-demo.js';

describe('offline interactive example', () => {
  it('reports an unanswered deadline as failure while preserving connection-abort status', async () => {
    vi.useFakeTimers();
    const asked = Promise.withResolvers<undefined>();
    const lines: string[] = [];
    try {
      const result = runInteractionDemo({
        kind: 'approval',
        answer: () => {
          asked.resolve(undefined);
          return new Promise(() => undefined);
        },
        write: (line) => {
          lines.push(line);
        },
      }).then(
        () => 'fulfilled',
        () => 'rejected',
      );
      await asked.promise;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await result).toBe('rejected');
      expect(lines.at(-1)).toBe('connection_aborted');
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(['approve', 'deny'])(
    'finishes after an explicit %s decision and outputs only metadata',
    async (decision) => {
      const lines: string[] = [];
      await runInteractionDemo({
        kind: 'approval',
        answer: () => Promise.resolve(decision),
        write: (line) => {
          lines.push(line);
        },
      });
      expect(lines).toContain('interaction.requested');
      expect(lines).toContain('interaction.resolved');
      expect(lines.at(-1)).toBe('completed');
      expect(lines.join('\n')).not.toMatch(/approve|deny|requestId|fictional/);
    },
  );
  it.each(['user_input', 'provider'] as const)(
    'runs a synthetic %s interaction',
    async (kind) => {
      const lines: string[] = [];
      await runInteractionDemo({
        kind,
        answer: () =>
          Promise.resolve(
            kind === 'provider' ? 'cancel' : 'fictional private input',
          ),
        write: (line) => {
          lines.push(line);
        },
      });
      expect(lines.at(-1)).toBe('completed');
      expect(lines.join('\n')).not.toContain('fictional private input');
    },
  );
  it('rejects an empty or invalid approval without auto-approving', async () => {
    await expect(
      runInteractionDemo({
        kind: 'approval',
        answer: () => Promise.resolve(''),
        write: () => undefined,
      }),
    ).rejects.toThrow('Interaction demo failed.');
  });
});
