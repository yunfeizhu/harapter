import { profileId, providerSessionId, type SessionRef } from '@harapter/core';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_PROVIDER_ID,
  CLAUDE_SESSION_COMPATIBILITY_REF,
} from '../src/index.js';
import {
  claudeInteractionRequest,
  claudeSessionStateFromRef,
  createClaudeEventState,
  mapClaudeSdkMessage,
  prepareClaudeSession,
  prepareClaudeUserMessage,
  redactClaudeSdkValue,
} from '../src/protocol.js';

const sessionId = '00000000-0000-4000-8000-000000000001';

describe('Claude Agent SDK protocol edge behavior', () => {
  it('maps stream tool, reasoning, usage, and unknown delta shapes', () => {
    const state = createClaudeEventState();
    expect(
      mapStream(state, {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: 'Synthetic.' },
      }),
    ).toMatchObject({ events: [{ type: 'provider' }] });
    expect(
      mapStream(state, {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'tool-1',
          name: 'SyntheticTool',
        },
      }),
    ).toMatchObject({ events: [{ type: 'tool.started' }] });
    expect(
      mapStream(state, {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'tool_use',
          id: 'tool-1',
          name: 'SyntheticTool',
        },
      }),
    ).toMatchObject({ events: [] });
    expect(
      mapStream(state, {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{' },
      }),
    ).toMatchObject({ events: [{ type: 'tool.updated' }] });
    expect(
      mapStream(state, {
        type: 'content_block_delta',
        index: 99,
        delta: { type: 'input_json_delta', partial_json: '{' },
      }),
    ).toMatchObject({ events: [{ type: 'provider' }] });
    expect(
      mapStream(state, {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Synthetic reasoning.' },
      }),
    ).toMatchObject({ events: [{ type: 'reasoning.delta' }] });
    expect(
      mapStream(state, {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'future_delta', value: 'Synthetic.' },
      }),
    ).toMatchObject({ events: [{ type: 'provider' }] });
    expect(
      mapStream(state, {
        type: 'message_delta',
        usage: { input_tokens: 2, output_tokens: 4 },
      }),
    ).toMatchObject({
      events: [{ type: 'usage.updated', data: { totalTokens: 6 } }],
    });
    expect(
      mapStream(state, { type: 'message_delta', usage: {} }),
    ).toMatchObject({
      events: [{ type: 'provider' }],
    });
    expect(mapStream(state, { type: 'future_event' })).toMatchObject({
      events: [{ type: 'provider' }],
    });
  });

  it('deduplicates complete assistant and tool-result messages', () => {
    const state = createClaudeEventState();
    const assistant = {
      type: 'assistant',
      session_id: sessionId,
      message: {
        content: [
          { type: 'text', text: 'Synthetic.' },
          { type: 'tool_use', id: 'tool-1', name: 'SyntheticTool', input: {} },
        ],
      },
    };
    expect(
      mapClaudeSdkMessage(assistant, state, sessionId, false),
    ).toMatchObject({
      events: [
        { type: 'provider', providerEventType: 'assistant.text' },
        { type: 'tool.started' },
        { type: 'tool.updated' },
      ],
    });
    expect(
      mapClaudeSdkMessage(assistant, state, sessionId, false),
    ).toMatchObject({
      events: [
        { type: 'provider', providerEventType: 'assistant.text' },
        { type: 'tool.updated' },
      ],
    });
    expect(
      mapClaudeSdkMessage(
        {
          type: 'user',
          session_id: sessionId,
          message: {
            content: [
              { type: 'text', text: 'Synthetic.' },
              { type: 'tool_result', tool_use_id: 'tool-1', is_error: true },
            ],
          },
        },
        state,
        sessionId,
        false,
      ),
    ).toMatchObject({
      events: [
        { type: 'provider', providerEventType: 'user.text' },
        { type: 'tool.completed', data: { isError: true } },
      ],
    });
    expect(
      mapClaudeSdkMessage(
        {
          type: 'user',
          session_id: sessionId,
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tool-1' }],
          },
        },
        state,
        sessionId,
        false,
      ),
    ).toMatchObject({ events: [{ type: 'provider' }] });
    expect(
      mapClaudeSdkMessage(
        {
          type: 'user',
          session_id: sessionId,
          message: { content: 'Synthetic.' },
        },
        state,
        sessionId,
        false,
      ),
    ).toMatchObject({ events: [{ type: 'provider' }] });
    expect(
      mapClaudeSdkMessage(
        {
          type: 'assistant',
          session_id: sessionId,
          message: { content: [{ type: 'text', text: 'Synthetic.' }] },
        },
        createClaudeEventState(),
        sessionId,
        false,
      ),
    ).toMatchObject({ events: [{ type: 'provider' }] });
  });

  it('rejects malformed stream, assistant, tool, and result shapes', () => {
    const malformed = [
      { type: 'stream_event', event: null },
      { type: 'stream_event', event: { type: 'content_block_start' } },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: null },
      },
      { type: 'assistant', message: null },
      { type: 'assistant', message: { content: [null] } },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: '', name: 'SyntheticTool' }],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tool', name: 'bad tool name' }],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: 'false',
        session_id: sessionId,
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: '00000000-0000-4000-8000-000000000099',
        result: 'Synthetic.',
      },
    ];
    for (const message of malformed) {
      expect(() =>
        mapClaudeSdkMessage(
          message,
          createClaudeEventState(),
          sessionId,
          false,
        ),
      ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
    }
  });

  it('maps optional result and usage fields conservatively', () => {
    const completed = mapClaudeSdkMessage(
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: sessionId,
        result: 'Synthetic.',
      },
      createClaudeEventState(),
      sessionId,
      false,
    );
    expect(completed).toMatchObject({
      kind: 'terminal',
      terminal: {
        providerCode: 'success',
        result: {
          status: 'completed',
          finalMessage: 'Synthetic.',
        },
      },
    });
    const longResult = 'x'.repeat(8_192);
    expect(
      mapClaudeSdkMessage(
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: sessionId,
          result: longResult,
        },
        createClaudeEventState(),
        sessionId,
        false,
      ),
    ).toMatchObject({
      terminal: {
        result: { status: 'completed', finalMessage: longResult },
      },
    });
    expect(
      mapClaudeSdkMessage(
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          session_id: sessionId,
          usage: { input_tokens: 4 },
        },
        createClaudeEventState(),
        sessionId,
        false,
      ),
    ).toMatchObject({
      terminal: { result: { status: 'failed', usage: { inputTokens: 4 } } },
    });
    expect(
      mapStream(createClaudeEventState(), {
        type: 'message_delta',
        usage: { output_tokens: 5 },
      }),
    ).toMatchObject({
      events: [{ data: { outputTokens: 5 }, type: 'usage.updated' }],
    });
  });

  it('rejects every unsupported Session and Run option without silent loss', () => {
    const invalidSessions = [
      { metadata: { synthetic: 'value' } },
      { providerOptions: { future: true } },
      { providerOptions: { allowedTools: ['SyntheticTool', 'SyntheticTool'] } },
      { providerOptions: { allowedTools: 'SyntheticTool' } },
      { providerOptions: { permissionMode: 'bypassPermissions' } },
      { model: { id: 'synthetic', providerOptions: { future: true } } },
      { workspace: { uri: 1 as unknown as string } },
      { systemContext: '' },
    ];
    for (const input of invalidSessions) {
      expect(() => prepareClaudeSession(input)).toThrow(
        expect.objectContaining({ code: 'invalid_request' }),
      );
    }
    expect(prepareClaudeSession()).toEqual({
      materialized: false,
      permissionMode: 'default',
    });
    expect(() =>
      prepareClaudeUserMessage(
        { parts: [{ type: 'text', text: '' }] },
        sessionId,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareClaudeUserMessage(
        {
          parts: [{ type: 'text', text: 'Synthetic.' }],
          metadata: { synthetic: 'value' },
        },
        sessionId,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('rejects corrupt opaque Session state fields', () => {
    const base: SessionRef = {
      providerId: CLAUDE_PROVIDER_ID,
      profileId: profileId('claude-edge'),
      providerSessionId: providerSessionId(sessionId),
      compatibilityRef: CLAUDE_SESSION_COMPATIBILITY_REF,
    };
    for (const providerState of [
      undefined,
      { materialized: false, future: true, permissionMode: 'default' },
      { materialized: 'false', permissionMode: 'default' },
      { materialized: false, permissionMode: 'future' },
      { materialized: false, permissionMode: 'default', allowedTools: [1] },
    ]) {
      expect(() =>
        claudeSessionStateFromRef({ ...base, providerState }),
      ).toThrow(expect.objectContaining({ code: 'session_provider_mismatch' }));
    }
  });

  it('validates bounded approval and question callback schemas', () => {
    const signal = new AbortController().signal;
    const invalid = [
      ['', {}, { requestId: 'request', toolUseID: 'tool', signal }],
      [
        'SyntheticTool',
        null,
        { requestId: 'request', toolUseID: 'tool', signal },
      ],
      ['SyntheticTool', {}, { requestId: '', toolUseID: 'tool', signal }],
      [
        'AskUserQuestion',
        { questions: [] },
        { requestId: 'request', toolUseID: 'tool', signal },
      ],
      [
        'AskUserQuestion',
        { questions: [{}] },
        { requestId: 'request', toolUseID: 'tool', signal },
      ],
      [
        'AskUserQuestion',
        {
          questions: [
            { question: 'Synthetic?', header: 'Synthetic', options: [] },
          ],
        },
        { requestId: 'request', toolUseID: 'tool', signal },
      ],
      [
        'AskUserQuestion',
        {
          questions: [
            { question: 'Synthetic?', header: 'Synthetic', options: [null] },
          ],
        },
        { requestId: 'request', toolUseID: 'tool', signal },
      ],
    ] as const;
    for (const [tool, input, options] of invalid) {
      expect(() => claudeInteractionRequest(tool, input, options)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
  });

  it('redacts primitive, null, deep, and oversized object shapes', () => {
    expect(redactClaudeSdkValue(null)).toEqual({ type: 'null' });
    expect(redactClaudeSdkValue(true)).toEqual({ type: 'boolean' });
    expect(redactClaudeSdkValue(4)).toEqual({ type: 'number' });
    expect(redactClaudeSdkValue(undefined)).toEqual({ type: 'undefined' });
    let getterCalls = 0;
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 40; index += 1) {
      Object.defineProperty(wide, `sensitive-field-${String(index)}`, {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return index;
        },
      });
    }
    const wideRedacted = redactClaudeSdkValue(wide);
    expect(wideRedacted).toMatchObject({
      type: 'object',
      truncated: true,
    });
    expect(getterCalls).toBe(0);
    expect(JSON.stringify(wideRedacted)).not.toContain('sensitive-field');
    const deep = redactClaudeSdkValue({ a: { b: { c: { d: 'Synthetic.' } } } });
    expect(JSON.stringify(deep)).not.toMatch(/Synthetic|"a"|"b"|"c"|"d"/u);
  });
});

function mapStream(
  state: ReturnType<typeof createClaudeEventState>,
  event: Readonly<Record<string, unknown>>,
) {
  return mapClaudeSdkMessage(
    { type: 'stream_event', session_id: sessionId, event },
    state,
    sessionId,
    false,
  );
}
