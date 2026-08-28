import { readFile } from 'node:fs/promises';
import { profileId, providerSessionId } from '@harapter/core';
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
  snapshotClaudeSessionState,
} from '../src/protocol.js';

const fixtureRoot = new URL(
  '../../../fixtures/claude/agent-sdk-query-stable/',
  import.meta.url,
);
const sessionId = '00000000-0000-4000-8000-000000000001';

async function jsonLines(name: string): Promise<unknown[]> {
  const body = await readFile(new URL(name, fixtureRoot), 'utf8');
  return body
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown);
}

async function jsonFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8'));
}

describe('Claude Agent SDK protocol mapping', () => {
  it('maps the completed fixture and structurally redacts unknown data', async () => {
    const state = createClaudeEventState();
    const observations = (await jsonLines('completed.jsonl')).map((message) =>
      mapClaudeSdkMessage(message, state, sessionId, false),
    );

    expect(observations[0]).toMatchObject({
      kind: 'init',
      init: {
        capabilities: ['interrupt_receipt_v1'],
        claudeCodeVersion: '2.1.250-synthetic',
        cwd: '/synthetic/workspace',
        sessionId,
      },
    });
    const events = observations.flatMap((observation) =>
      observation.kind === 'events' ? observation.events : [],
    );
    expect(events.map(({ type }) => type)).toEqual([
      'message.delta',
      'provider',
      'tool.started',
      'tool.updated',
      'tool.completed',
    ]);
    expect(events.find(({ type }) => type === 'provider')).toMatchObject({
      providerEventType: 'system.future_synthetic',
      data: { observed: true },
    });
    expect(JSON.stringify(events)).not.toContain('synthetic-sensitive-value');
    expect(JSON.stringify(events)).not.toContain('/synthetic/private/file');
    expect(observations.at(-1)).toMatchObject({
      kind: 'terminal',
      terminal: {
        providerCode: 'success',
        result: {
          finalMessage: 'Synthetic Claude reply.',
          status: 'completed',
          usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
        },
        terminalReason: 'completed',
      },
    });
  });

  it('maps authoritative failures and only proves cancellation after interrupt', async () => {
    const failed = await jsonLines('failed.jsonl');
    expect(
      mapClaudeSdkMessage(
        failed[1],
        createClaudeEventState(),
        sessionId,
        false,
      ),
    ).toMatchObject({
      terminal: {
        providerCode: 'error_max_turns',
        result: { status: 'failed' },
        terminalReason: 'max_turns',
      },
    });

    const cancelled = await jsonLines('cancelled.jsonl');
    const withoutInterrupt = mapClaudeSdkMessage(
      cancelled[1],
      createClaudeEventState(),
      sessionId,
      false,
    );
    const afterInterrupt = mapClaudeSdkMessage(
      cancelled[1],
      createClaudeEventState(),
      sessionId,
      true,
    );
    expect(withoutInterrupt).toMatchObject({
      terminal: { result: { status: 'failed' } },
    });
    expect(afterInterrupt).toMatchObject({
      terminal: {
        result: { status: 'cancelled' },
        terminalReason: 'aborted_streaming',
      },
    });
    expect(JSON.stringify(afterInterrupt)).not.toContain(
      'Synthetic interrupted turn.',
    );
  });

  it('prepares bounded portable Session and text Run input', () => {
    const state = prepareClaudeSession({
      workspace: { uri: 'file:///synthetic/workspace' },
      systemContext: 'Synthetic system context.',
      model: { id: 'claude-synthetic' },
      providerOptions: {
        allowedTools: ['SyntheticTool'],
        permissionMode: 'plan',
      },
    });
    expect(state).toEqual({
      allowedTools: ['SyntheticTool'],
      cwd: '/synthetic/workspace',
      materialized: false,
      model: 'claude-synthetic',
      permissionMode: 'plan',
      systemPrompt: 'Synthetic system context.',
    });
    const snapshot = snapshotClaudeSessionState(state);
    expect(snapshot).toEqual(state);
    expect(
      claudeSessionStateFromRef({
        providerId: CLAUDE_PROVIDER_ID,
        profileId: profileId('claude-protocol'),
        providerSessionId: providerSessionId(sessionId),
        compatibilityRef: CLAUDE_SESSION_COMPATIBILITY_REF,
        providerState: snapshot,
      }),
    ).toEqual(state);
    expect(
      prepareClaudeUserMessage(
        {
          parts: [
            { type: 'text', text: 'Synthetic first line.' },
            { type: 'text', text: 'Synthetic second line.' },
          ],
        },
        '00000000-0000-4000-8000-000000000002',
      ),
    ).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: 'Synthetic first line.\nSynthetic second line.',
      },
      parent_tool_use_id: null,
      uuid: '00000000-0000-4000-8000-000000000002',
    });
  });

  it('maps approval and user-input callbacks without exposing tool input', async () => {
    const fixture = (await jsonFixture('interactions.json')) as {
      approval: {
        input: Readonly<Record<string, unknown>>;
        options: Readonly<Record<string, unknown>>;
        toolName: string;
      };
      userInput: {
        input: Readonly<Record<string, unknown>>;
        options: Readonly<Record<string, unknown>>;
        toolName: string;
      };
    };
    const signal = new AbortController().signal;
    const approval = claudeInteractionRequest(
      fixture.approval.toolName,
      fixture.approval.input,
      { ...fixture.approval.options, signal },
    );
    expect(approval.request).toMatchObject({
      kind: 'approval',
      requestId: 'synthetic-approval-request',
      prompt: 'Claude Agent requested permission to use SyntheticTool.',
      providerState: {
        toolName: 'SyntheticTool',
        toolUseId: 'synthetic-tool-use',
      },
    });
    expect(JSON.stringify(approval.request)).not.toContain(
      'synthetic-sensitive-value',
    );
    expect(JSON.stringify(approval.request)).not.toContain(
      '/synthetic/private/file',
    );

    const userInput = claudeInteractionRequest(
      fixture.userInput.toolName,
      fixture.userInput.input,
      { ...fixture.userInput.options, signal },
    );
    expect(userInput.request).toMatchObject({
      kind: 'user_input',
      requestId: 'synthetic-user-input-request',
      schema: {
        questions: [
          {
            header: 'Synthetic choice',
            multiSelect: false,
            question: 'Choose a synthetic option.',
          },
        ],
      },
    });
  });

  it('fails closed on malformed ownership, terminals, and portable input', () => {
    const malformed = [
      undefined,
      {},
      {
        type: 'result',
        subtype: 'future',
        is_error: false,
        session_id: sessionId,
      },
      {
        type: 'system',
        subtype: 'init',
        session_id: '00000000-0000-4000-8000-000000000099',
        claude_code_version: 'synthetic',
        cwd: '/synthetic/workspace',
        model: 'synthetic',
        permissionMode: 'default',
      },
      {
        type: 'stream_event',
        session_id: '00000000-0000-4000-8000-000000000099',
        event: { type: 'future' },
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

    for (const input of [
      { parts: [] },
      { parts: [{ type: 'file_ref', uri: 'file:///synthetic/file' }] },
      { parts: [{ type: 'image_ref', uri: 'https://example.invalid/image' }] },
      { parts: [{ type: 'provider', name: 'synthetic', value: {} }] },
    ] as const) {
      expect(() => prepareClaudeUserMessage(input, sessionId)).toThrow(
        expect.objectContaining({ code: 'invalid_request' }),
      );
    }
    expect(() =>
      prepareClaudeSession({ workspace: { uri: 'https://example.invalid' } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      claudeSessionStateFromRef({
        providerId: CLAUDE_PROVIDER_ID,
        profileId: profileId('claude-protocol'),
        providerSessionId: providerSessionId(sessionId),
        compatibilityRef: `${CLAUDE_SESSION_COMPATIBILITY_REF};mismatch`,
        providerState: {},
      }),
    ).toThrow(expect.objectContaining({ code: 'session_provider_mismatch' }));
  });

  it('bounds arbitrary raw values by type, depth, keys, and item count', () => {
    const cyclic: Record<string, unknown> = {
      secret: 'synthetic-sensitive-value',
      values: Array.from(
        { length: 40 },
        (_, index) => `synthetic-${String(index)}`,
      ),
    };
    cyclic['self'] = cyclic;
    const redacted = redactClaudeSdkValue(cyclic);
    expect(JSON.stringify(redacted)).not.toContain('synthetic-sensitive-value');
    expect(JSON.stringify(redacted)).not.toMatch(/secret|values|self/u);
    expect(redacted).toMatchObject({
      type: 'object',
      fields: [
        {
          key: { type: 'string', length: 6 },
          value: { type: 'string', length: 25 },
        },
        {
          key: { type: 'string', length: 6 },
          value: { type: 'array', length: 40, truncated: true },
        },
        {
          key: { type: 'string', length: 4 },
          value: { type: 'object' },
        },
      ],
    });
  });
});
