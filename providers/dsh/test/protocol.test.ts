import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DSH_NOTIFICATION_EXTENSION,
  DSH_PROVIDER_ID,
  DSH_SESSION_COMPATIBILITY_REF,
} from '../src/index.js';
import {
  dshCompatibilityIdentity,
  mapDshSessionEvent,
  parseDshInitializeResponse,
  parseDshPromptResponse,
  parseDshSessionEventNotification,
  parseDshStatusNotification,
  parseDshSubagentFinished,
  parseDshSubagentStarted,
  prepareDshPrompt,
  redactDshEvent,
  validateDshSessionInput,
  type DshSessionEvent,
} from '../src/protocol.js';

const fixtureDirectory = fileURLToPath(
  new URL('../../../fixtures/dsh/sdk-jsonrpc-current/', import.meta.url),
);

describe('DeepSeek Harness protocol mapping', () => {
  it('uses stable Provider-owned identities without pinning a runtime version', () => {
    expect(DSH_PROVIDER_ID).toBe('deepseek.harness');
    expect(DSH_NOTIFICATION_EXTENSION).toBe('deepseek.harness.notifications');
    expect(DSH_SESSION_COMPATIBILITY_REF).toContain('current');
    const identity = dshCompatibilityIdentity('0.0.0-synthetic');
    expect(identity).toMatch(
      new RegExp(
        `^${DSH_SESSION_COMPATIBILITY_REF};runtime=version-[0-9a-f]{16}$`,
        'u',
      ),
    );
    expect(identity).not.toContain('0.0.0-synthetic');
  });

  it('validates the wire-stable runtime identity and enqueue receipt', () => {
    const parsedRuntime = parseDshInitializeResponse({
      serverInfo: {
        name: 'deepseek-harness-sdk-runtime',
        version: '0.0.0-synthetic',
      },
    });
    expect(parsedRuntime).toMatchObject({
      name: 'deepseek-harness-sdk-runtime',
    });
    expect(parsedRuntime.version).toMatch(/^version-[0-9a-f]{16}$/u);
    expect(parsedRuntime.version).not.toContain('synthetic');
    expect(parseDshPromptResponse({ messageId: 'message-synthetic' })).toBe(
      'message-synthetic',
    );
    const redactedRuntime = parseDshInitializeResponse({
      serverInfo: {
        name: 'deepseek-harness-sdk-runtime',
        version: '/private/runtime/token value',
      },
    });
    expect(redactedRuntime.version).toMatch(/^version-[0-9a-f]{16}$/u);
    expect(redactedRuntime.version).not.toContain('private');
    expect(
      dshCompatibilityIdentity('/private/runtime/token value'),
    ).not.toContain('private');
    const credentialLikeRuntime = parseDshInitializeResponse({
      serverInfo: {
        name: 'deepseek-harness-sdk-runtime',
        version: 'sk_live_synthetic_secret',
      },
    });
    expect(credentialLikeRuntime.version).toMatch(/^version-[0-9a-f]{16}$/u);
    expect(credentialLikeRuntime.version).not.toContain('sk_live');

    for (const value of [
      undefined,
      {},
      { serverInfo: {} },
      { serverInfo: { name: 'lookalike', version: '1' } },
      {
        serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '' },
      },
    ]) {
      expect(() => parseDshInitializeResponse(value)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
    for (const value of [undefined, {}, { messageId: '' }, { messageId: 1 }]) {
      expect(() => parseDshPromptResponse(value)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
  });

  it('maps only non-empty portable text input', () => {
    expect(
      prepareDshPrompt({
        parts: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      }),
    ).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]);
    expect(() => prepareDshPrompt({ parts: [] })).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() =>
      prepareDshPrompt({ parts: [{ type: 'text', text: '' }] }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
    expect(() =>
      prepareDshPrompt({
        parts: [{ type: 'file_ref', uri: 'file:///synthetic' }],
      }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
    expect(() =>
      prepareDshPrompt({
        parts: [{ type: 'provider', name: 'synthetic', value: {} }],
      }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
    expect(() =>
      prepareDshPrompt({
        parts: [{ type: 'text', text: 'synthetic' }],
        metadata: { private: 'synthetic' },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareDshPrompt(
        { parts: [{ type: 'text', text: 'synthetic' }] },
        { providerOptions: {} },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareDshPrompt(
        { parts: [{ type: 'text', text: 'synthetic' }] },
        { metadata: {} },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('keeps Session settings fixed by the process handshake', () => {
    expect(() => {
      validateDshSessionInput({}, 'file:///synthetic');
    }).not.toThrow();
    expect(() => {
      validateDshSessionInput(
        { workspace: { uri: 'file:///synthetic' } },
        'file:///synthetic',
      );
    }).not.toThrow();
    for (const input of [
      { systemContext: 'synthetic' },
      { model: { id: 'synthetic' } },
      { providerOptions: {} },
      { metadata: {} },
      { workspace: { uri: 'file:///different' } },
    ]) {
      expect(() => {
        validateDshSessionInput(input, 'file:///synthetic');
      }).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
    }
  });

  it('validates session event, status, and subagent envelopes', () => {
    expect(
      parseDshSessionEventNotification({
        sessionId: 'session-synthetic',
        event: {
          type: 'future/event',
          seq: 0,
          time: 1,
          data: {},
          ignorable: true,
        },
      }),
    ).toEqual({
      sessionId: 'session-synthetic',
      event: {
        type: 'future/event',
        seq: 0,
        time: 1,
        data: {},
        ignorable: true,
      },
    });
    expect(
      parseDshStatusNotification({
        sessionId: 'session-synthetic',
        status: 'running',
      }),
    ).toEqual({ sessionId: 'session-synthetic', status: 'running' });
    expect(
      parseDshSubagentStarted({
        parentSessionId: 'session-parent',
        childSessionId: 'session-child',
      }),
    ).toEqual({
      parentSessionId: 'session-parent',
      childSessionId: 'session-child',
    });
    expect(
      parseDshSubagentFinished({
        provider: 'provider-synthetic',
        agentId: 'session-child',
        parentSessionId: 'session-parent',
        childSessionId: 'session-child',
        status: 'ok',
        stopReason: { kind: 'completed' },
      }),
    ).toEqual({
      parentSessionId: 'session-parent',
      childSessionId: 'session-child',
    });

    for (const value of [
      undefined,
      {},
      { sessionId: '', event: {} },
      {
        sessionId: 'session',
        event: { type: '', seq: 0, time: 1, data: {} },
      },
      {
        sessionId: 'session',
        event: { type: 'event', seq: -1, time: 1, data: {} },
      },
      {
        sessionId: 'session',
        event: { type: 'event', seq: 0.5, time: 1, data: {} },
      },
      {
        sessionId: 'session',
        event: { type: 'event', seq: 0, time: Number.NaN, data: {} },
      },
      {
        sessionId: 'session',
        event: { type: 'event', seq: 0, time: 1, data: [] },
      },
      {
        sessionId: 'session',
        event: { type: 'event', seq: 0, time: 1, data: {}, ignorable: false },
      },
    ]) {
      expect(() => parseDshSessionEventNotification(value)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
    for (const value of [
      undefined,
      {},
      { sessionId: '', status: 'idle' },
      { sessionId: 'session', status: 'future' },
    ]) {
      expect(() => parseDshStatusNotification(value)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
    for (const value of [
      undefined,
      {},
      { parentSessionId: '', childSessionId: 'child' },
      { parentSessionId: 'parent', childSessionId: '' },
    ]) {
      expect(() => parseDshSubagentStarted(value)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
    for (const value of [
      undefined,
      {},
      {
        provider: '',
        agentId: 'child',
        parentSessionId: 'parent',
        childSessionId: 'child',
        status: 'ok',
        stopReason: {},
      },
      {
        provider: 'provider',
        agentId: 'child',
        parentSessionId: 'parent',
        childSessionId: 'child',
        status: 'future',
        stopReason: {},
      },
    ]) {
      expect(() => parseDshSubagentFinished(value)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
  });

  it('maps inbox correlation and rejects malformed insertions', () => {
    expect(
      mapDshSessionEvent(
        sessionEvent('agent/inbox/spliced', {
          target: 'next-turn',
          start: 0,
          inserted: [userMessage('message-one'), userMessage('message-two')],
        }),
      ),
    ).toMatchObject({
      insertedMessageIds: ['message-one', 'message-two'],
      events: [{ type: 'provider' }],
    });
    expect(
      mapDshSessionEvent(
        sessionEvent('agent/inbox/spliced', {
          target: 'next-step',
          start: 0,
          inserted: [userMessage('message-next-step')],
        }),
      ).insertedMessageIds,
    ).toEqual([]);
    expect(
      mapDshSessionEvent(
        sessionEvent('agent/inbox/spliced', {
          target: 'next-turn',
          start: 0,
          inserted: [
            {
              ...userMessage('message-plugin'),
              source: { kind: 'plugin', plugin: 'synthetic' },
            },
          ],
        }),
      ).insertedMessageIds,
    ).toEqual([]);
    for (const data of [
      { target: 'next-turn', start: 0 },
      { target: 'future', start: 0, inserted: [] },
      { target: 'next-turn', start: -1, inserted: [] },
      { target: 'next-turn', start: 0, inserted: [{ id: '' }] },
      {
        target: 'next-turn',
        start: 0,
        inserted: [{ ...userMessage('message'), role: 'assistant' }],
      },
      {
        target: 'next-turn',
        start: 0,
        inserted: [{ ...userMessage('message'), content: undefined }],
      },
      {
        target: 'next-turn',
        start: 0,
        inserted: [{ ...userMessage('message'), source: undefined }],
      },
    ]) {
      expect(() =>
        mapDshSessionEvent(sessionEvent('agent/inbox/spliced', data)),
      ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
    }
  });

  it('maps Assistant stream, message, usage, and tool events', () => {
    expect(
      mapDshSessionEvent(
        sessionEvent('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'text-delta', index: 0, text: 'answer' },
        }),
      ).events,
    ).toEqual([{ type: 'message.delta', data: { delta: 'answer' } }]);
    expect(
      mapDshSessionEvent(
        sessionEvent('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'reasoning-delta', index: 0, text: 'reasoning' },
        }),
      ).events,
    ).toEqual([{ type: 'reasoning.delta', data: { delta: 'reasoning' } }]);
    expect(
      mapDshSessionEvent(
        sessionEvent('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: {
            type: 'usage',
            usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
          },
        }),
      ).events,
    ).toEqual([
      {
        type: 'usage.updated',
        data: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      },
    ]);
    expect(
      mapDshSessionEvent(
        sessionEvent('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'block-start', index: 0, blockType: 'text' },
        }),
      ).events[0],
    ).toMatchObject({ type: 'provider' });
    expect(
      mapDshSessionEvent(
        sessionEvent('assistant/message', {
          turn: 1,
          step: 1,
          message: assistantMessage('assistant-one', {
            content: [
              { type: 'reasoning', text: 'private' },
              { type: 'text', text: 'first' },
              { type: 'text', text: 'second' },
            ],
          }),
          usage: { inputTokens: 4, outputTokens: 2 },
        }),
      ),
    ).toMatchObject({
      events: [
        {
          type: 'message.completed',
          data: { message: 'firstsecond' },
          finalMessage: 'firstsecond',
        },
        {
          type: 'usage.updated',
          usage: { inputTokens: 4, outputTokens: 2 },
        },
      ],
    });
    expect(
      mapDshSessionEvent(
        sessionEvent('assistant/message', {
          turn: 1,
          step: 1,
          message: assistantMessage('assistant-two', {
            content: [{ type: 'text', text: 'answer' }],
          }),
        }),
      ).events,
    ).toHaveLength(1);
    expect(
      mapDshSessionEvent(
        sessionEvent('tool/call', {
          turn: 1,
          step: 1,
          callId: 'call-synthetic',
          name: 'synthetic-tool',
          arguments: '{"secret":"private"}',
        }),
      ).events,
    ).toEqual([
      {
        type: 'tool.started',
        data: { callId: 'call-synthetic', name: 'synthetic-tool' },
      },
    ]);
    expect(
      mapDshSessionEvent(
        sessionEvent('tool/result', {
          turn: 1,
          step: 1,
          message: toolResultMessage('tool-result-one', 'call-synthetic'),
          error: { name: 'SyntheticError', code: 'SYNTHETIC_ERROR' },
        }),
      ).events,
    ).toEqual([
      {
        type: 'tool.completed',
        data: { callId: 'call-synthetic', failed: true },
      },
    ]);
  });

  it('rejects malformed Assistant, usage, and tool events', () => {
    for (const event of [
      sessionEvent('assistant/chunk', { chunk: {} }),
      sessionEvent('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 1 },
      }),
      sessionEvent('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'usage',
          usage: { inputTokens: -1, outputTokens: 1 },
        },
      }),
      sessionEvent('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'usage',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 1.5 },
        },
      }),
      sessionEvent('assistant/message', { message: {} }),
      sessionEvent('assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('assistant-invalid', { content: [{}] }),
      }),
      sessionEvent('assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('assistant-invalid', {
          content: [{ type: 'text', text: 1 }],
        }),
      }),
      sessionEvent('assistant/message', {
        turn: 1,
        step: 1,
        message: { ...assistantMessage('assistant-invalid'), role: 'user' },
      }),
      sessionEvent('assistant/message', {
        turn: 1,
        step: 1,
        message: { ...assistantMessage('assistant-invalid'), source: {} },
      }),
      sessionEvent('tool/call', { callId: 1, name: 'tool' }),
      sessionEvent('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call',
        name: 1,
        arguments: '{}',
      }),
      sessionEvent('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call',
        name: 'tool',
        arguments: {},
      }),
      sessionEvent('tool/result', { message: {} }),
      sessionEvent('tool/result', {
        turn: 1,
        step: 1,
        message: {
          ...toolResultMessage('tool-result', 'call'),
          role: 'assistant',
        },
      }),
    ]) {
      expect(() => mapDshSessionEvent(event)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
  });

  it('maps the complete verified turn-end reason set and fails unknown reasons', () => {
    const observations = [
      [{ kind: 'completed' }, 'completed', 'run.completed', true],
      [
        { kind: 'aborted', reason: { kind: 'user' } },
        'cancelled',
        'run.cancelled',
        true,
      ],
      [
        { kind: 'aborted', reason: { kind: 'hook', reason: 'synthetic' } },
        'cancelled',
        'run.cancelled',
        true,
      ],
      [{ kind: 'blocked' }, 'failed', 'run.failed', true],
      [{ kind: 'max-tokens' }, 'failed', 'run.failed', true],
      [{ kind: 'interrupted' }, 'failed', 'run.failed', true],
      [
        { kind: 'error', error: { code: 'SYNTHETIC_FAILURE' } },
        'failed',
        'run.failed',
        true,
      ],
      [
        { kind: 'error', error: { code: 'unsafe code value' } },
        'failed',
        'run.failed',
        true,
      ],
      [
        { kind: 'aborted', reason: { kind: 'future' } },
        'failed',
        'run.failed',
        false,
      ],
      [{ kind: 'error', error: {} }, 'failed', 'run.failed', false],
      [{ kind: 'future' }, 'failed', 'run.failed', false],
      [undefined, 'failed', 'run.failed', false],
    ] as const;

    for (const [reason, status, eventType, valid] of observations) {
      expect(
        mapDshSessionEvent(sessionEvent('turn/end', { turn: 1, reason }))
          .terminal,
      ).toMatchObject({ result: { status }, eventType, valid });
    }
    expect(() =>
      mapDshSessionEvent(
        sessionEvent('turn/end', { reason: { kind: 'completed' } }),
      ),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
  });

  it('passes known structural and ignorable unknown events through raw mapping', () => {
    expect(
      mapDshSessionEvent(sessionEvent('turn/start', { turn: 1 })).events[0],
    ).toMatchObject({
      type: 'provider',
      providerEventType: 'turn/start',
    });
    const unknown = mapDshSessionEvent(
      sessionEvent('future/event', { secret: 'private' }, true),
    ).events[0];
    expect(unknown).toMatchObject({ type: 'provider' });
    expect(unknown?.providerEventType).toMatch(/^unknown-[0-9a-f]{16}$/u);
    expect(() => mapDshSessionEvent(sessionEvent('future/event', {}))).toThrow(
      expect.objectContaining({ code: 'provider_api_incompatible' }),
    );
    const unsafeType = '/private/provider/token value';
    const mapped = mapDshSessionEvent(
      sessionEvent(unsafeType, { secret: 'private' }, true),
    ).events[0];
    expect(mapped?.providerEventType).toMatch(/^unknown-[0-9a-f]{16}$/u);
    expect(JSON.stringify(mapped)).not.toContain('private/provider');
  });

  it('bounds and redacts raw events without leaking identifiers or content', () => {
    const event = redactDshEvent('unsafe method value', {
      method: 'session.event',
      sessionId: 'session-private',
      seq: 1,
      enabled: true,
      content: 'private content',
      unknown: 'private value',
      nested: {
        data: {
          event: {
            data: { message: { data: { message: 'too deep' } } },
          },
        },
      },
      values: Array.from({ length: 20 }, (_, index) => index),
    });
    expect(event.method).toMatch(/^method-[0-9a-f]{16}$/u);
    expect(JSON.stringify(event)).not.toContain('session-private');
    expect(JSON.stringify(event)).not.toContain('private content');
    expect(JSON.stringify(event)).not.toContain('private value');
    expect(JSON.stringify(event)).toContain('[truncated]');
    expect(redactDshEvent('session.event', null)).toEqual({
      method: 'session.event',
      params: null,
    });
  });

  it('loads and structurally maps every recorded synthetic fixture', async () => {
    const names = [
      'completed.jsonl',
      'failed.jsonl',
      'missing-terminal.jsonl',
      'unknown-terminal.jsonl',
    ];
    for (const name of names) {
      const records = await readJsonLines(name);
      expect(records.length).toBeGreaterThan(0);
      const statusSessionIds: string[] = [];
      for (const record of records) {
        if (record.method === 'session.event') {
          const parsed = parseDshSessionEventNotification(record.params);
          mapDshSessionEvent(parsed.event);
        } else {
          statusSessionIds.push(
            parseDshStatusNotification(record.params).sessionId,
          );
        }
      }
      expect(
        statusSessionIds.every((sessionId) => sessionId === 'session-fixture'),
      ).toBe(true);
    }
    const manifest = JSON.parse(
      await readFile(`${fixtureDirectory}/manifest.json`, 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest['providerId']).toBe(DSH_PROVIDER_ID);
  });
});

function sessionEvent(
  type: string,
  data: Record<string, unknown>,
  ignorable = false,
): DshSessionEvent {
  return {
    type,
    seq: 1,
    time: 1,
    data,
    ...(ignorable ? { ignorable: true } : {}),
  };
}

function userMessage(id: string) {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text: 'synthetic input' }],
    source: { kind: 'user' },
  };
}

function assistantMessage(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text: 'synthetic answer' }],
    source: {
      kind: 'model',
      provider: 'synthetic-provider',
      model: 'synthetic-model',
    },
    ...overrides,
  };
}

function toolResultMessage(id: string, callId: string) {
  return {
    id,
    role: 'user',
    content: [
      {
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text: 'synthetic result' }],
      },
    ],
    source: { kind: 'tool', callId },
  };
}

async function readJsonLines(
  name: string,
): Promise<readonly { method: string; params: unknown }[]> {
  const content = await readFile(`${fixtureDirectory}/${name}`, 'utf8');
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { method: string; params: unknown });
}
