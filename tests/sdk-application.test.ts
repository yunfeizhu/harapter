import { describe, expect, it, vi } from 'vitest';
import {
  createFakeProfile,
  createFakeProviderFactory,
} from '@harapter/conformance/fake';
import { HarnessRegistry } from '@harapter/core';
import { runTask } from '../examples/sdk-application/src/service.js';
import { terminalApproval } from '../examples/sdk-application/src/approval.js';
import { runAcrossProviders } from '../examples/sdk-application/src/recipes.js';
import { validateSdkSnippet } from '../scripts/lib/sdk-application-smoke.mjs';

async function connect(interaction = false) {
  const registry = new HarnessRegistry();
  registry.register(
    createFakeProviderFactory(
      interaction ? { interaction: { kind: 'approval' } } : {},
    ),
  );
  return registry.connect(createFakeProfile());
}

describe('standalone SDK application', () => {
  it('returns application text and an opaque reference after draining the stream', async () => {
    const client = await connect();
    const events: string[] = [];
    try {
      const first = await runTask(client, 'fictional application input', {
        onEvent: (event) => {
          events.push(event.type);
        },
      });
      expect(first.result.status).toBe('completed');
      expect(first.result.finalMessage).toBe('fictional application input');
      expect(events.at(-1)).toBe('run.completed');
      const second = await runTask(client, 'second input', {
        resume: first.sessionRef,
      });
      expect(second.sessionRef).toEqual(first.sessionRef);
      expect(second.result.status).toBe('completed');
    } finally {
      await client.close();
    }
  });

  it('awaits an explicit decision while continuing to consume events', async () => {
    const client = await connect(true);
    const answer = vi.fn(() =>
      Promise.resolve({ kind: 'approval' as const, decision: 'deny' as const }),
    );
    try {
      const outcome = await runTask(client, 'fictional approval', {
        onInteraction: answer,
      });
      expect(outcome.result.status).toBe('completed');
      expect(answer).toHaveBeenCalledOnce();
      expect(answer.mock.calls[0]).toBeDefined();
    } finally {
      await client.close();
    }
  });

  it('fails explicitly without an interaction handler', async () => {
    const client = await connect(true);
    try {
      await expect(runTask(client, 'fictional approval')).rejects.toMatchObject(
        { code: 'unsupported_capability' },
      );
    } finally {
      await client.close();
    }
  });

  it('cancels natively while an interaction UI is waiting and dismisses it', async () => {
    const client = await connect(true);
    const cancel = new AbortController();
    let dismissed = false;
    try {
      const outcome = await runTask(client, 'fictional approval', {
        signal: cancel.signal,
        onInteraction: ({ signal }) => {
          signal.addEventListener(
            'abort',
            () => {
              dismissed = true;
            },
            { once: true },
          );
          cancel.abort();
          return new Promise(() => undefined);
        },
      });
      expect(outcome.result.status).toBe('cancelled');
      expect(dismissed).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('rejects an already-aborted request before creating a Session', async () => {
    const client = await connect();
    const create = vi.spyOn(client, 'createSession');
    try {
      await expect(
        runTask(client, 'unused', { signal: AbortSignal.abort() }),
      ).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it('settles on timeout without waiting for an unanswered UI', async () => {
    const client = await connect(true);
    try {
      const outcome = await runTask(client, 'fictional approval', {
        timeoutMs: 20,
        onInteraction: () => new Promise(() => undefined),
      });
      expect(outcome.result.status).toBe('connection_aborted');
    } finally {
      await client.close();
    }
  });

  it('denies unknown action descriptions without opening a terminal', async () => {
    const client = await connect(true);
    try {
      const outcome = await runTask(client, 'fictional approval', {
        onInteraction: terminalApproval(() => undefined),
      });
      expect(outcome.result.status).toBe('completed');
    } finally {
      await client.close();
    }
  });

  it('rejects an unsafe terminal description', async () => {
    const client = await connect(true);
    try {
      await expect(
        runTask(client, 'fictional approval', {
          onInteraction: terminalApproval(
            () => 'An untrusted\u001b[2J description',
          ),
        }),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  });

  it('finishes an independent Provider task when another has an unhandled interaction', async () => {
    const first = await connect(true);
    const second = await connect();
    try {
      const outcomes = await runAcrossProviders(
        first,
        second,
        'fictional task',
      );
      expect(outcomes[0]).toMatchObject({
        status: 'rejected',
        reason: { code: 'unsupported_capability' },
      });
      expect(outcomes[1]).toMatchObject({
        status: 'fulfilled',
        value: {
          result: { status: 'completed', finalMessage: 'fictional task' },
        },
      });
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe('copyable SDK documentation', () => {
  const sources = { 'quick-codex.ts': 'console.log({ completed: true });\n' };
  const markdown =
    '<!-- sdk-example: quick-codex.ts -->\n\n```ts\nconsole.log({ completed: true });\n```';

  it('accepts the executable entry source', () => {
    expect(validateSdkSnippet(markdown, sources)).toBe(true);
  });

  it('rejects stale, missing and unresolved entry examples', () => {
    expect(validateSdkSnippet(markdown.replace('true', 'false'), sources)).toBe(
      false,
    );
    expect(validateSdkSnippet('# Missing example', sources)).toBe(false);
    expect(validateSdkSnippet(markdown, {})).toBe(false);
  });
});
