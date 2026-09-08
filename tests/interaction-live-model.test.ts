import { expect, it } from 'vitest';
import { startInteractionModel } from './helpers/interaction-live-model.js';

it('requires the offered tool and an actual tool result for interaction evidence', async () => {
  const model = await startInteractionModel('pi', 'unused');
  try {
    const messages = [{ role: 'user', content: 'HARAPTER_INTERACTION_PROBE' }];
    const tools = [{ type: 'function', function: { name: 'harapter_probe' } }];
    const post = async (body: unknown) => {
      const response = await fetch(`${model.url}/v1/chat/completions`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await response.body?.cancel();
      return response.status;
    };
    expect(await post({ messages })).toBe(200);
    expect(model.evidence()).toMatchObject({ calls: 0, returned: false });
    expect(await post({ messages, tools })).toBe(200);
    expect(model.evidence()).toMatchObject({ calls: 1, returned: false });
    expect(
      await post({
        tools,
        messages: [
          ...messages,
          { role: 'tool', content: 'HARAPTER_INTERACTION_ACCEPTED' },
        ],
      }),
    ).toBe(200);
    expect(model.evidence()).toMatchObject({
      valid: true,
      calls: 1,
      returned: true,
      accepted: true,
      declined: false,
    });
  } finally {
    await model.close();
  }
});

it.each(['malformed', 'oversized'] as const)(
  'fails closed on a %s model request without retaining its content',
  async (scenario) => {
    const model = await startInteractionModel('pi', 'unused');
    try {
      const body =
        scenario === 'malformed' ? '{' : 'x'.repeat(2 * 1024 * 1024 + 1);
      await expect(
        fetch(`${model.url}/v1/chat/completions`, { method: 'POST', body }),
      ).rejects.toBeDefined();
      expect(model.evidence()).toEqual({
        valid: false,
        calls: 0,
        returned: false,
        requests: 1,
        failure: 'request-or-response',
        accepted: false,
        declined: false,
      });
    } finally {
      await model.close();
    }
  },
);
