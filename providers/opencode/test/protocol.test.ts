import { readFile } from 'node:fs/promises';
import { HarnessError, profileId, providerSessionId } from '@harapter/core';
import { describe, expect, it } from 'vitest';
import {
  OPENCODE_NATIVE_PART,
  OPENCODE_PROVIDER_ID,
  OPENCODE_SESSION_COMPATIBILITY_REF,
  createOpenCodeEventState,
  mapOpenCodeEvent,
  parseOpenCodeEvent,
  parseOpenCodeHealth,
  parseOpenCodePromptResponse,
  parseOpenCodeSession,
  prepareOpenCodePrompt,
  prepareOpenCodeSession,
  redactOpenCodeEvent,
  sessionStateFromRef,
} from '../src/protocol.js';

const fixtureRoot = new URL(
  '../../../fixtures/opencode/http-openapi-stable/',
  import.meta.url,
);

describe('OpenCode stable HTTP protocol mapping', () => {
  it('validates health and Session responses without pinning a runtime release', () => {
    expect(parseOpenCodeHealth({ healthy: true, version: 'current' })).toEqual({
      version: 'current',
    });
    expect(
      parseOpenCodeSession({
        id: 'ses_1',
        projectID: 'project_1',
        directory: '/workspace',
        title: 'Harapter session',
        version: 'current',
        time: { created: 1, updated: 2 },
      }),
    ).toMatchObject({ id: 'ses_1', directory: '/workspace' });
    expect(() =>
      parseOpenCodeHealth({ healthy: false, version: 'current' }),
    ).toThrow(HarnessError);
    expect(() => parseOpenCodeSession({ id: 'ses_1' })).toThrow(HarnessError);
  });

  it('maps portable Session defaults and supported prompt parts explicitly', () => {
    const session = prepareOpenCodeSession({
      workspace: { uri: 'file:///workspace' },
      systemContext: 'Use the repository instructions.',
      model: {
        id: 'model-current',
        providerOptions: { providerId: 'provider-current' },
      },
      providerOptions: { title: 'Harapter session' },
    });
    expect(session).toEqual({
      body: { title: 'Harapter session' },
      directory: '/workspace',
      defaults: {
        model: {
          modelId: 'model-current',
          providerId: 'provider-current',
        },
        system: 'Use the repository instructions.',
      },
    });

    expect(
      prepareOpenCodePrompt(
        {
          parts: [
            { type: 'text', text: 'Inspect the project.' },
            {
              type: 'image_ref',
              uri: 'data:image/png;base64,AA==',
              mediaType: 'image/png',
            },
            {
              type: 'provider',
              name: OPENCODE_NATIVE_PART,
              value: { type: 'agent', name: 'review' },
            },
          ],
        },
        {
          providerOptions: {
            agent: 'build',
            tools: { bash: false },
          },
        },
        session.defaults,
      ),
    ).toEqual({
      agent: 'build',
      model: {
        modelID: 'model-current',
        providerID: 'provider-current',
      },
      parts: [
        { type: 'text', text: 'Inspect the project.' },
        {
          type: 'file',
          mime: 'image/png',
          url: 'data:image/png;base64,AA==',
        },
        { type: 'agent', name: 'review' },
      ],
      system: 'Use the repository instructions.',
      tools: { bash: false },
    });
  });

  it('rejects unsupported or incomplete input instead of silently dropping it', () => {
    expect(() =>
      prepareOpenCodePrompt(
        { parts: [{ type: 'file_ref', uri: 'file:///workspace/a.txt' }] },
        {},
        {},
      ),
    ).toThrow(/mediaType/u);
    expect(() =>
      prepareOpenCodePrompt(
        {
          parts: [
            { type: 'provider', name: 'other.part', value: { type: 'text' } },
          ],
        },
        {},
        {},
      ),
    ).toThrow(/Provider input/u);
    expect(() =>
      prepareOpenCodeSession({ providerOptions: { unknown: true } }),
    ).toThrow(/unknown/u);
  });

  it('maps assistant deltas, tools, usage, and approvals only for the owning Session', () => {
    const state = createOpenCodeEventState();
    const sessionId = providerSessionId('ses_1');
    const assistant = parseOpenCodeEvent(
      JSON.stringify({
        id: 'evt_1',
        type: 'message.updated',
        properties: {
          info: {
            id: 'msg_1',
            sessionID: 'ses_1',
            role: 'assistant',
            tokens: {
              input: 4,
              output: 2,
              reasoning: 1,
              cache: { read: 0, write: 0 },
            },
          },
        },
      }),
    );
    expect(mapOpenCodeEvent(assistant, sessionId, state).events).toEqual([
      {
        data: { inputTokens: 4, outputTokens: 2 },
        type: 'usage.updated',
        usage: { inputTokens: 4, outputTokens: 2 },
      },
    ]);

    const delta = parseOpenCodeEvent(
      JSON.stringify({
        type: 'message.part.updated',
        properties: {
          delta: 'hello',
          part: {
            id: 'part_1',
            messageID: 'msg_1',
            sessionID: 'ses_1',
            type: 'text',
            text: 'hello',
          },
        },
      }),
    );
    expect(mapOpenCodeEvent(delta, sessionId, state).events).toEqual([
      { data: { delta: 'hello' }, type: 'message.delta' },
    ]);

    const permission = parseOpenCodeEvent(
      JSON.stringify({
        type: 'permission.asked',
        properties: {
          id: 'permission_1',
          sessionID: 'ses_1',
          permission: 'bash',
          patterns: ['pnpm check'],
          metadata: {},
          always: ['pnpm check'],
        },
      }),
    );
    expect(mapOpenCodeEvent(permission, sessionId, state)).toMatchObject({
      permission: {
        permissionId: 'permission_1',
        title: 'OpenCode bash permission',
        type: 'bash',
      },
    });

    const other = parseOpenCodeEvent(
      JSON.stringify({
        type: 'message.part.updated',
        properties: {
          delta: 'private',
          part: {
            id: 'part_2',
            messageID: 'msg_2',
            sessionID: 'ses_other',
            type: 'text',
            text: 'private',
          },
        },
      }),
    );
    expect(mapOpenCodeEvent(other, sessionId, state)).toEqual({
      events: [],
      routed: false,
    });
  });

  it('uses the synchronous assistant response as the authoritative terminal result', () => {
    const completed = parseOpenCodePromptResponse(
      {
        info: {
          id: 'msg_1',
          sessionID: 'ses_1',
          role: 'assistant',
          tokens: {
            input: 8,
            output: 5,
            reasoning: 2,
            cache: { read: 1, write: 0 },
          },
          finish: 'stop',
        },
        parts: [
          {
            id: 'part_1',
            messageID: 'msg_1',
            sessionID: 'ses_1',
            type: 'text',
            text: 'final answer',
          },
        ],
      },
      providerSessionId('ses_1'),
    );
    expect(completed).toEqual({
      finalMessage: 'final answer',
      providerResult: { finish: 'stop', messageId: 'msg_1' },
      result: {
        finalMessage: 'final answer',
        providerResult: { finish: 'stop', messageId: 'msg_1' },
        status: 'completed',
        usage: { inputTokens: 8, outputTokens: 5 },
      },
      usage: { inputTokens: 8, outputTokens: 5 },
    });

    const cancelled = parseOpenCodePromptResponse(
      {
        info: {
          id: 'msg_2',
          sessionID: 'ses_1',
          role: 'assistant',
          tokens: {
            input: 1,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          error: { name: 'MessageAbortedError', data: { message: 'secret' } },
        },
        parts: [],
      },
      providerSessionId('ses_1'),
    );
    expect(cancelled.result).toEqual({
      providerResult: {
        error: 'MessageAbortedError',
        messageId: 'msg_2',
      },
      status: 'cancelled',
      usage: { inputTokens: 1, outputTokens: 0 },
    });
  });

  it('keeps unknown events observable through bounded structural redaction', () => {
    const raw = redactOpenCodeEvent({
      type: 'future.event',
      properties: {
        sessionID: 'ses_1',
        prompt: 'never retain this',
        nested: { token: 'secret', value: 42 },
      },
    });
    expect(JSON.stringify(raw)).not.toContain('never retain this');
    expect(JSON.stringify(raw)).not.toContain('secret');
    expect(JSON.stringify(raw).length).toBeLessThan(4_096);
    expect(raw.type).toBe('future.event');
  });

  it('maps synthetic stable-interface fixtures without treating them as live traffic', async () => {
    const sessionId = providerSessionId('ses_fixture');
    const completed = await fixture('completed.json');
    const state = createOpenCodeEventState();
    const events = completed.events.flatMap(
      (value) =>
        mapOpenCodeEvent(
          parseOpenCodeEvent(JSON.stringify(value)),
          sessionId,
          state,
        ).events,
    );
    expect(events.map(({ type }) => type)).toEqual([
      'provider',
      'usage.updated',
      'message.delta',
    ]);
    expect(
      parseOpenCodePromptResponse(completed.response, sessionId).result,
    ).toMatchObject({
      finalMessage: 'synthetic answer',
      status: 'completed',
    });

    const cancelled = await fixture('cancelled.json');
    expect(
      parseOpenCodePromptResponse(cancelled.response, sessionId).result,
    ).toMatchObject({ status: 'cancelled' });

    const permission = await fixture('permission.json');
    expect(
      permission.events.map((value) =>
        mapOpenCodeEvent(
          parseOpenCodeEvent(JSON.stringify(value)),
          sessionId,
          createOpenCodeEventState(),
        ),
      ),
    ).toMatchObject([
      { permission: { permissionId: 'permission_fixture' } },
      { resolvedPermissionId: 'permission_fixture' },
    ]);

    const unknown = await fixture('unknown.json');
    const mapping = mapOpenCodeEvent(
      parseOpenCodeEvent(JSON.stringify(unknown.events[0])),
      sessionId,
      createOpenCodeEventState(),
    );
    expect(mapping.events[0]?.providerEventType).toBe('future.event');
    expect(JSON.stringify(mapping)).not.toContain('synthetic content');
    expect(JSON.stringify(mapping)).not.toContain('synthetic credential');
  });

  it('requires the owning compatibility and directory state when resuming', () => {
    expect(
      sessionStateFromRef({
        providerId: OPENCODE_PROVIDER_ID,
        profileId: profileId('opencode-local'),
        providerSessionId: providerSessionId('ses_1'),
        compatibilityRef: OPENCODE_SESSION_COMPATIBILITY_REF,
        providerState: { directory: '/workspace' },
      }),
    ).toEqual({ directory: '/workspace' });
    expect(() =>
      sessionStateFromRef({
        providerId: OPENCODE_PROVIDER_ID,
        profileId: profileId('opencode-local'),
        providerSessionId: providerSessionId('ses_1'),
        compatibilityRef: OPENCODE_SESSION_COMPATIBILITY_REF,
      }),
    ).toThrow(/state/u);
  });
});

async function fixture(name: string): Promise<{
  readonly events: readonly unknown[];
  readonly response?: unknown;
}> {
  const value = JSON.parse(
    await readFile(new URL(name, fixtureRoot), 'utf8'),
  ) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid synthetic OpenCode fixture.');
  }
  const fixtureRecord = value as Record<string, unknown>;
  const events = fixtureRecord['events'];
  if (!Array.isArray(events)) {
    throw new Error('Synthetic OpenCode fixture events must be an array.');
  }
  return {
    events,
    ...('response' in fixtureRecord
      ? { response: fixtureRecord['response'] }
      : {}),
  };
}
