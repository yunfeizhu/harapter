import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  PI_PROVIDER_ID,
  PI_SESSION_COMPATIBILITY_REF,
  mapPiRunEvent,
  parsePiAssistantOutcome,
  parsePiSessionState,
  parsePiVersionOutput,
  piCompatibilityIdentity,
  preparePiPrompt,
  redactPiObservation,
} from '../src/index.js';

const fixtureRoot = new URL(
  '../../../fixtures/pi/rpc-current/',
  import.meta.url,
);

describe('Pi Agent RPC protocol mapping', () => {
  it('loads and exercises every deterministic fixture', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('manifest.json', fixtureRoot), 'utf8'),
    ) as { providerId?: unknown; upstreamEvidence?: { commit?: unknown } };
    expect(manifest).toMatchObject({
      providerId: PI_PROVIDER_ID,
      upstreamEvidence: {
        commit: '853a80d26c90a14c1886f0ebb8ffaae133ca2185',
      },
    });

    for (const name of ['completed.jsonl', 'cancelled.jsonl', 'failed.jsonl']) {
      const messages = await jsonl(name);
      expect(messages.length).toBeGreaterThan(0);
      const outcomes = messages
        .filter((message) => message['type'] === 'message_end')
        .map((message) => parsePiAssistantOutcome(message['message']));
      expect(outcomes.every((outcome) => outcome !== undefined)).toBe(true);
      const mapped = messages
        .filter(
          (message) =>
            message['type'] !== 'response' &&
            message['type'] !== 'agent_settled' &&
            message['type'] !== 'message_end',
        )
        .flatMap((message) => mapPiRunEvent(message));
      expect(mapped.length).toBeGreaterThan(0);
    }

    const interaction = JSON.parse(
      await readFile(new URL('interaction.json', fixtureRoot), 'utf8'),
    ) as { inbound?: unknown; outbound?: unknown };
    expect(redactPiObservation(interaction.inbound)).toBeDefined();
    expect(redactPiObservation(interaction.outbound)).toBeDefined();

    const unknown = (await jsonl('unknown.jsonl'))[0];
    const mappedUnknown = mapPiRunEvent(unknown);
    expect(mappedUnknown).toMatchObject([{ type: 'provider' }]);
    expect(mappedUnknown[0]?.providerEventType).toMatch(
      /^event-[a-f0-9]{16}$/u,
    );
    expect(JSON.stringify(mappedUnknown)).not.toContain(
      'future_synthetic_event',
    );
  });

  it('validates Runtime identity and RPC Session state', () => {
    expect(parsePiVersionOutput('pi v0.84.4\n')).toBe('0.84.4');
    expect(parsePiVersionOutput('0.84.4-beta.1')).toBe('0.84.4-beta.1');
    expect(() => parsePiVersionOutput('Pi development build')).toThrow(
      expect.objectContaining({ code: 'provider_api_incompatible' }),
    );
    expect(piCompatibilityIdentity('0.84.4')).toMatch(
      new RegExp(
        `^${PI_SESSION_COMPATIBILITY_REF};runtime=version-[a-f0-9]{16}$`,
        'u',
      ),
    );
    expect(
      parsePiSessionState({
        sessionId: 'synthetic-session',
        isStreaming: false,
        isCompacting: false,
        thinkingLevel: 'medium',
        sessionFile: '/private/must-not-be-retained',
      }),
    ).toEqual({
      sessionId: 'synthetic-session',
      isStreaming: false,
      isCompacting: false,
      thinkingLevel: 'medium',
    });
    for (const state of [
      undefined,
      {},
      {
        sessionId: '',
        isStreaming: false,
        isCompacting: false,
        thinkingLevel: 'medium',
      },
      {
        sessionId: 'x',
        isStreaming: 'false',
        isCompacting: false,
        thinkingLevel: 'medium',
      },
      {
        sessionId: 'x',
        isStreaming: false,
        isCompacting: 0,
        thinkingLevel: 'medium',
      },
      {
        sessionId: 'x',
        isStreaming: false,
        isCompacting: false,
        thinkingLevel: '',
      },
    ]) {
      expect(() => parsePiSessionState(state)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
  });

  it('maps only the explicit portable text input subset', () => {
    expect(
      preparePiPrompt({
        parts: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      }),
    ).toBe('first\nsecond');
    expect(() => preparePiPrompt({ parts: [] })).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() =>
      preparePiPrompt({ parts: [{ type: 'text', text: '' }] }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      preparePiPrompt({
        parts: [{ type: 'image_ref', uri: 'file:///synthetic.png' }],
      }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
    expect(() =>
      preparePiPrompt({
        parts: [{ type: 'text', text: 'synthetic' }],
        metadata: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      preparePiPrompt({ parts: [{ type: 'text', text: '/new' }] }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
  });

  it('redacts unknown structural values and object keys', () => {
    const observation = redactPiObservation({
      type: 'credential-in-event-type',
      method: 'credential-in-method',
      'credential-in-key': 'credential-in-value',
    });
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain('credential-in-event-type');
    expect(serialized).not.toContain('credential-in-method');
    expect(serialized).not.toContain('credential-in-key');
    expect(serialized).not.toContain('credential-in-value');
  });

  it('parses assistant outcomes and fails closed on malformed terminal fields', () => {
    expect(
      parsePiAssistantOutcome({ role: 'user', content: 'synthetic' }),
    ).toBeUndefined();
    expect(
      parsePiAssistantOutcome({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'reasoning' },
          { type: 'text', text: 'answer' },
          { type: 'toolCall', id: 'call', name: 'read', arguments: {} },
        ],
        stopReason: 'stop',
        usage: { input: 4, output: 3, totalTokens: 7 },
      }),
    ).toEqual({
      stopReason: 'stop',
      text: 'answer',
      reasoning: 'reasoning',
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    });
    for (const message of [
      {
        role: 'assistant',
        content: [],
        stopReason: 'future',
        usage: { input: 0, output: 0, totalTokens: 0 },
      },
      {
        role: 'assistant',
        content: 'answer',
        stopReason: 'stop',
        usage: { input: 0, output: 0, totalTokens: 0 },
      },
      {
        role: 'assistant',
        content: [{ type: 'future' }],
        stopReason: 'stop',
        usage: { input: 0, output: 0, totalTokens: 0 },
      },
      {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
        usage: { input: -1, output: 0, totalTokens: 0 },
      },
      {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
        usage: { input: 0, output: Number.NaN, totalTokens: 0 },
      },
      {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
        usage: { input: 0, output: 0, totalTokens: -1 },
      },
    ]) {
      expect(() => parsePiAssistantOutcome(message)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
  });

  it('maps deltas and tool lifecycle without retaining tool payloads', () => {
    expect(
      mapPiRunEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'answer' },
      }),
    ).toMatchObject([{ type: 'message.delta', messageDelta: 'answer' }]);
    expect(
      mapPiRunEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'thought' },
      }),
    ).toMatchObject([{ type: 'reasoning.delta', reasoningDelta: 'thought' }]);
    expect(
      mapPiRunEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'toolcall_start', id: 'private' },
      }),
    ).toMatchObject([{ type: 'provider' }]);
    for (const [nativeType, portableType] of [
      ['tool_execution_start', 'tool.started'],
      ['tool_execution_update', 'tool.updated'],
      ['tool_execution_end', 'tool.completed'],
    ] as const) {
      const mapped = mapPiRunEvent({
        type: nativeType,
        toolCallId: 'private-call',
        toolName: 'read',
        args: { secret: 'must-not-escape' },
        result: { secret: 'must-not-escape' },
        isError: true,
      });
      expect(mapped).toMatchObject([{ type: portableType }]);
      expect(JSON.stringify(mapped)).not.toContain('must-not-escape');
      expect(JSON.stringify(mapped)).not.toContain('private-call');
    }
    for (const event of [
      undefined,
      {},
      { type: 'message_update' },
      { type: 'tool_execution_start', toolCallId: 1, toolName: 'read' },
    ]) {
      expect(() => mapPiRunEvent(event)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
  });

  it('bounds and redacts arbitrary observations', () => {
    const observation = redactPiObservation({
      type: 'future',
      success: true,
      secret: 'must-not-escape',
      booleanSecret: false,
      accountId: 123456789,
      pin: 1234,
      invalidNumber: Number.POSITIVE_INFINITY,
      nested: { deeper: { more: { hidden: 'value' } } },
      array: Array.from({ length: 30 }, (_, index) => `entry-${String(index)}`),
      ignored: undefined,
    });
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain('future');
    expect(serialized).toMatch(/value-[a-f0-9]{16}/u);
    expect(serialized).not.toContain('must-not-escape');
    expect(serialized).not.toContain('123456789');
    expect(serialized).not.toContain('1234');
    expect(serialized).toContain('[bounded]');
    expect(serialized).toContain('[redacted]');
    expect(redactPiObservation(null)).toBeNull();
    expect(redactPiObservation(7)).toMatch(/^number-[a-f0-9]{16}$/u);
    expect(redactPiObservation(Symbol('synthetic'))).toBe('[redacted]');
  });
});

async function jsonl(name: string): Promise<Record<string, unknown>[]> {
  const value = await readFile(new URL(name, fixtureRoot), 'utf8');
  return value
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
