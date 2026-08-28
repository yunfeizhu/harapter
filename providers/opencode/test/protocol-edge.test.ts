import {
  HarnessError,
  profileId,
  providerId,
  providerSessionId,
  type HarnessInput,
  type SessionRef,
} from '@harapter/core';
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
  parseOpenCodeSessionStatus,
  prepareOpenCodePrompt,
  prepareOpenCodeSession,
  redactOpenCodeEvent,
  sessionStateFromRef,
  type OpenCodeWireEvent,
} from '../src/protocol.js';

const sessionId = providerSessionId('ses_edge');

describe('OpenCode protocol edge behavior', () => {
  it('rejects every malformed health, Session, and SSE identity surface', () => {
    for (const health of [undefined, {}, { healthy: false, version: 'x' }]) {
      expect(() => parseOpenCodeHealth(health)).toThrow(HarnessError);
    }
    expect(() => parseOpenCodeHealth({ healthy: true, version: '' })).toThrow(
      HarnessError,
    );

    const validSession = {
      id: 'ses_edge',
      projectID: 'project',
      directory: '/workspace',
      title: 'Harapter session',
      version: 'current',
      time: { created: 1, updated: 1 },
    };
    for (const replacement of [
      undefined,
      { ...validSession, projectID: 1 },
      { ...validSession, title: 1 },
      { ...validSession, time: [] },
      { ...validSession, id: '' },
      { ...validSession, directory: '' },
      { ...validSession, version: '' },
    ]) {
      expect(() => parseOpenCodeSession(replacement)).toThrow(HarnessError);
    }

    for (const data of [
      '{',
      'null',
      JSON.stringify({ type: 'x' }),
      JSON.stringify({ type: '', properties: {} }),
      JSON.stringify({ type: 'x', id: 1, properties: {} }),
    ]) {
      expect(() => parseOpenCodeEvent(data)).toThrow(HarnessError);
    }
    expect(
      parseOpenCodeEvent(
        JSON.stringify({ id: 'evt', type: 'future.event', properties: {} }),
      ),
    ).toEqual({ id: 'evt', type: 'future.event', properties: {} });

    expect(parseOpenCodeSessionStatus({}, sessionId)).toBe('idle');
    for (const status of ['busy', 'idle', 'retry'] as const) {
      expect(
        parseOpenCodeSessionStatus(
          { [sessionId]: { type: status } },
          sessionId,
        ),
      ).toBe(status);
    }
    for (const statuses of [
      [],
      { [sessionId]: null },
      { [sessionId]: { type: 'future' } },
    ]) {
      expect(() => parseOpenCodeSessionStatus(statuses, sessionId)).toThrow(
        HarnessError,
      );
    }
  });

  it('validates Session and prompt options without silently dropping data', () => {
    expect(prepareOpenCodeSession()).toEqual({ body: {}, defaults: {} });
    expect(
      prepareOpenCodeSession({
        providerOptions: { parentId: 'ses_parent', title: 'Harapter child' },
      }),
    ).toEqual({
      body: { parentID: 'ses_parent', title: 'Harapter child' },
      defaults: {},
    });

    for (const input of [
      { workspace: { uri: 'relative' } },
      { workspace: { uri: 'https://example.invalid/workspace' } },
      { workspace: { uri: 'file:///%E0%A4%A' } },
      { systemContext: '' },
      { model: { id: '', providerOptions: { providerId: 'provider' } } },
      { model: { id: 'model' } },
      { model: { id: 'model', providerOptions: { providerId: '' } } },
      { providerOptions: [] },
      { providerOptions: { title: '' } },
      { providerOptions: { parentId: 1 } },
    ]) {
      expect(() => prepareOpenCodeSession(input as never)).toThrow(
        HarnessError,
      );
    }

    for (const timeoutMs of [0, -1, 1.5, 2_147_483_648]) {
      expect(() =>
        prepareOpenCodePrompt(textInput(), { timeoutMs }, {}),
      ).toThrow(HarnessError);
    }
    expect(() => prepareOpenCodePrompt({ parts: [] }, {}, {})).toThrow(
      HarnessError,
    );
    expect(() =>
      prepareOpenCodePrompt(textInput(), { providerOptions: [] as never }, {}),
    ).toThrow(HarnessError);
    expect(() =>
      prepareOpenCodePrompt(
        textInput(),
        { providerOptions: { unknown: true } },
        {},
      ),
    ).toThrow(HarnessError);
  });

  it('maps every supported prompt part and rejects malformed native values', () => {
    expect(
      prepareOpenCodePrompt(
        {
          parts: [
            {
              type: 'file_ref',
              uri: 'https://example.invalid/file.txt',
              mediaType: 'text/plain',
            },
            {
              type: 'provider',
              name: OPENCODE_NATIVE_PART,
              value: {
                type: 'file',
                mime: 'application/json',
                url: 'data:application/json,%7B%7D',
                filename: 'fixture.json',
              },
            },
            {
              type: 'provider',
              name: OPENCODE_NATIVE_PART,
              value: { type: 'text', text: 'native text' },
            },
            {
              type: 'provider',
              name: OPENCODE_NATIVE_PART,
              value: {
                type: 'subtask',
                prompt: 'inspect',
                description: 'Inspect fixture',
                agent: 'review',
              },
            },
          ],
        },
        {
          providerOptions: {
            model: { providerId: 'provider', modelId: 'model' },
            system: 'Override system',
            tools: { bash: true, write: false },
          },
        },
      ),
    ).toMatchObject({
      model: { providerID: 'provider', modelID: 'model' },
      system: 'Override system',
      tools: { bash: true, write: false },
    });

    const invalidParts: HarnessInput['parts'] = [
      { type: 'image_ref', uri: 'file:///image.txt', mediaType: 'text/plain' },
      { type: 'file_ref', uri: 'relative', mediaType: 'text/plain' },
      {
        type: 'provider',
        name: OPENCODE_NATIVE_PART,
        value: { type: 'file', mime: '', url: 'file:///x' },
      },
      {
        type: 'provider',
        name: OPENCODE_NATIVE_PART,
        value: { type: 'file', mime: 'text/plain', url: 'relative' },
      },
      {
        type: 'provider',
        name: OPENCODE_NATIVE_PART,
        value: {
          type: 'file',
          mime: 'text/plain',
          url: 'file:///x',
          filename: 1,
        },
      },
      {
        type: 'provider',
        name: OPENCODE_NATIVE_PART,
        value: { type: 'agent', name: '' },
      },
      {
        type: 'provider',
        name: OPENCODE_NATIVE_PART,
        value: { type: 'subtask', prompt: 1, description: '', agent: '' },
      },
      {
        type: 'provider',
        name: OPENCODE_NATIVE_PART,
        value: { type: 'future' },
      },
    ];
    for (const part of invalidParts) {
      expect(() => prepareOpenCodePrompt({ parts: [part] }, {}, {})).toThrow(
        HarnessError,
      );
    }

    for (const providerOptions of [
      { model: null },
      { model: { providerId: 'p', modelId: 'm', extra: true } },
      { model: { providerId: '', modelId: 'm' } },
      { model: { providerId: 'p', modelId: '' } },
      { system: '' },
      { agent: '' },
      { tools: [] },
      { tools: { bash: 'yes' } },
      { tools: { '': true } },
    ]) {
      expect(() =>
        prepareOpenCodePrompt(textInput(), { providerOptions }, {}),
      ).toThrow(HarnessError);
    }
  });

  it('routes current message and delta shapes conservatively', () => {
    const state = createOpenCodeEventState();
    expect(map('server.connected', {}, state)).toEqual({
      events: [],
      routed: false,
    });
    expect(map('message.updated', { sessionID: 'other' }, state).routed).toBe(
      false,
    );
    expect(
      map('message.updated', { sessionID: sessionId }, state).events[0]?.type,
    ).toBe('provider');
    expect(
      map(
        'message.updated',
        { sessionID: sessionId, info: { role: 'user', id: 'user' } },
        state,
      ),
    ).toEqual({ events: [], routed: true });
    expect(
      map(
        'message.updated',
        { sessionID: sessionId, info: { role: 'assistant', id: '' } },
        state,
      ).events[0]?.type,
    ).toBe('provider');
    expect(
      map(
        'message.updated',
        {
          sessionID: sessionId,
          info: {
            role: 'assistant',
            id: 'msg_invalid',
            tokens: { input: -1, output: 0 },
          },
        },
        state,
      ),
    ).toEqual({ events: [], routed: true });

    for (let index = 0; index < 65; index += 1) {
      map(
        'message.updated',
        {
          sessionID: sessionId,
          info: {
            role: 'assistant',
            id: `msg_${String(index)}`,
            tokens: { input: index, output: 0 },
          },
        },
        state,
      );
    }
    expect(state.assistantMessageIds.size).toBe(64);
    expect(state.assistantMessageIds.has('msg_0')).toBe(false);

    expect(
      map('message.part.updated', { sessionID: sessionId }, state).events[0]
        ?.type,
    ).toBe('provider');
    for (let index = 0; index < 257; index += 1) {
      map(
        'message.part.updated',
        {
          sessionID: sessionId,
          part: {
            id: `part_${String(index)}`,
            messageID: 'not-assistant',
            sessionID: sessionId,
            type: 'text',
          },
        },
        state,
      );
    }
    expect(state.partTypes.size).toBe(256);
    expect(state.partTypes.has('part_0')).toBe(false);

    trackAssistant(state, 'msg_current');
    trackPart(state, 'msg_current', 'part_text', 'text');
    trackPart(state, 'msg_current', 'part_reasoning', 'reasoning');
    trackPart(state, 'msg_current', 'part_future', 'future');
    expect(
      map(
        'message.part.delta',
        {
          sessionID: sessionId,
          messageID: 'msg_current',
          partID: 'part_text',
          field: 'text',
          delta: 'answer',
        },
        state,
      ).events[0]?.type,
    ).toBe('message.delta');
    expect(
      map(
        'message.part.delta',
        {
          sessionID: sessionId,
          messageID: 'msg_current',
          partID: 'part_reasoning',
          field: 'text',
          delta: 'reason',
        },
        state,
      ).events[0]?.type,
    ).toBe('reasoning.delta');
    expect(
      map(
        'message.part.delta',
        {
          sessionID: sessionId,
          messageID: 'msg_current',
          partID: 'part_future',
          field: 'text',
          delta: 'unknown',
        },
        state,
      ).events[0]?.type,
    ).toBe('provider');
    for (const properties of [
      { sessionID: 'other' },
      { sessionID: sessionId, messageID: 'other' },
      { sessionID: sessionId, messageID: 'msg_current', partID: 1 },
      {
        sessionID: sessionId,
        messageID: 'msg_current',
        partID: 'part_text',
        field: 'other',
      },
      {
        sessionID: sessionId,
        messageID: 'msg_current',
        partID: 'part_text',
        field: 'text',
        delta: 1,
      },
    ]) {
      const mapping = map('message.part.delta', properties, state);
      expect(
        properties.sessionID === 'other'
          ? mapping.routed
          : mapping.events[0]?.type,
      ).toBe(properties.sessionID === 'other' ? false : 'provider');
    }
  });

  it('maps part lifecycle variants only after assistant ownership is proven', () => {
    const state = createOpenCodeEventState();
    trackAssistant(state, 'msg_parts');
    const part = (value: Record<string, unknown>, delta?: unknown) =>
      map(
        'message.part.updated',
        {
          sessionID: sessionId,
          ...(delta === undefined ? {} : { delta }),
          part: {
            id: `part_${String(value['type'])}`,
            messageID: 'msg_parts',
            sessionID: sessionId,
            ...value,
          },
        },
        state,
      );

    expect(part({ type: 'text' }, 'text').events[0]?.type).toBe(
      'message.delta',
    );
    expect(part({ type: 'reasoning' }, 'reason').events[0]?.type).toBe(
      'reasoning.delta',
    );
    expect(part({ type: 'reasoning', time: { end: 2 } }).events[0]?.type).toBe(
      'reasoning.completed',
    );
    expect(
      part({ type: 'reasoning', time: { end: 2 }, text: 'private' }).events[0],
    ).toMatchObject({
      data: {},
      providerEventType: 'message.part.updated',
    });
    expect(
      part({ type: 'tool', state: { status: 'pending' } }).events[0]?.type,
    ).toBe('tool.started');
    expect(
      part({ type: 'tool', state: { status: 'running' } }).events[0]?.type,
    ).toBe('tool.updated');
    expect(
      part({ type: 'tool', state: { status: 'completed' } }).events[0]?.type,
    ).toBe('tool.completed');
    expect(
      part({ type: 'tool', state: { status: 'error' } }).events[0]?.type,
    ).toBe('tool.completed');
    const safeTool = part({
      type: 'tool',
      tool: 'bash',
      state: {
        status: 'running',
        input: { command: 'private command' },
        output: 'private output',
      },
    }).events[0];
    expect(safeTool).toMatchObject({
      data: { status: 'running', tool: 'bash' },
      providerEventType: 'message.part.updated',
      type: 'tool.updated',
    });
    expect(JSON.stringify(safeTool)).not.toContain('private command');
    expect(JSON.stringify(safeTool)).not.toContain('private output');
    expect(
      part({ type: 'tool', state: { status: 'future' } }).events[0]?.type,
    ).toBe('provider');
    expect(part({ type: 'file', mime: 1, url: 2 }).events[0]?.type).toBe(
      'provider',
    );
    expect(
      part({
        type: 'file',
        mime: 'text/plain',
        url: 'file:///artifact',
        filename: 'artifact.txt',
      }).events[0],
    ).toMatchObject({
      type: 'artifact.created',
      data: { filename: 'artifact.txt' },
    });
    expect(
      part({ type: 'file', mime: 'text/plain', url: 'file:///artifact' })
        .events[0],
    ).toMatchObject({ type: 'artifact.created' });
    expect(part({ type: 'step-finish', tokens: {} }).events[0]?.type).toBe(
      'provider',
    );
    expect(
      part({ type: 'step-finish', tokens: { input: 2, output: 3 } }).events[0]
        ?.type,
    ).toBe('usage.updated');
    expect(part({ type: 'snapshot' })).toEqual({ events: [], routed: true });
  });

  it('maps permission and Session events without inventing ownership', () => {
    const state = createOpenCodeEventState();
    expect(
      map(
        'permission.asked',
        {
          id: 'permission_1',
          sessionID: sessionId,
          permission: 'bash',
          patterns: ['pnpm check'],
        },
        state,
      ).permission,
    ).toMatchObject({
      pattern: ['pnpm check'],
      title: 'OpenCode bash permission',
    });
    expect(
      map(
        'permission.updated',
        {
          id: 'permission_2',
          sessionID: sessionId,
          type: 'edit',
          title: 'Edit file',
          pattern: '*.ts',
        },
        state,
      ).permission,
    ).toMatchObject({ pattern: '*.ts', title: 'Edit file' });
    expect(
      map(
        'permission.updated',
        {
          id: 'permission_3',
          sessionID: sessionId,
          type: 'edit',
          title: 'Edit file',
          pattern: [1],
        },
        state,
      ).permission,
    ).not.toHaveProperty('pattern');
    for (const properties of [
      { sessionID: 'other' },
      { sessionID: sessionId },
      { id: '', sessionID: sessionId, permission: 'bash' },
      { id: 'p', sessionID: sessionId, permission: 1 },
    ]) {
      const mapping = map('permission.asked', properties, state);
      expect(
        properties.sessionID === 'other'
          ? mapping.routed
          : mapping.events[0]?.type,
      ).toBe(properties.sessionID === 'other' ? false : 'provider');
    }

    expect(
      map(
        'permission.replied',
        { sessionID: sessionId, requestID: 'permission_1' },
        state,
      ).resolvedPermissionId,
    ).toBe('permission_1');
    expect(
      map(
        'permission.replied',
        { sessionID: sessionId, permissionID: 'permission_2' },
        state,
      ).resolvedPermissionId,
    ).toBe('permission_2');
    expect(
      map('permission.replied', { sessionID: sessionId }, state).events[0]
        ?.type,
    ).toBe('provider');
    expect(
      map('permission.replied', { sessionID: 'other' }, state).routed,
    ).toBe(false);

    for (const type of [
      'session.status',
      'session.idle',
      'session.created',
      'session.updated',
    ]) {
      expect(map(type, { sessionID: sessionId }, state).routed).toBe(true);
      expect(map(type, { sessionID: 'other' }, state).routed).toBe(false);
    }
    expect(
      map('future.event', { sessionID: sessionId }, state).events[0]?.type,
    ).toBe('provider');
    expect(map('future.event', {}, state).routed).toBe(false);
  });

  it('requires authoritative terminal identity, usage, and text ownership', () => {
    const base = {
      info: {
        id: 'msg_terminal',
        sessionID: sessionId,
        role: 'assistant',
        tokens: { input: 2, output: 1 },
        finish: 'stop',
      },
      parts: [],
    };
    for (const value of [
      undefined,
      {},
      { ...base, info: { ...base.info, role: 'user' } },
      { ...base, info: { ...base.info, sessionID: 'other' } },
      { ...base, parts: {} },
      { ...base, info: { ...base.info, id: '' } },
      { ...base, info: { ...base.info, tokens: {} } },
      { ...base, info: { ...base.info, tokens: { input: 1.5, output: 0 } } },
      { ...base, info: { ...base.info, tokens: { input: 0, output: -1 } } },
      { ...base, info: { ...base.info, finish: undefined } },
      { ...base, info: { ...base.info, finish: '' } },
      { ...base, info: { ...base.info, finish: 'unknown' } },
      { ...base, info: { ...base.info, finish: 'tool-calls' } },
      { ...base, info: { ...base.info, finish: 'future' } },
    ]) {
      expect(() => parseOpenCodePromptResponse(value, sessionId)).toThrow(
        HarnessError,
      );
    }

    expect(parseOpenCodePromptResponse(base, sessionId)).toMatchObject({
      providerResult: { finish: 'stop' },
      result: { status: 'completed' },
    });
    expect(
      parseOpenCodePromptResponse(
        { ...base, info: { ...base.info, finish: 'error' } },
        sessionId,
      ).result,
    ).toMatchObject({
      providerResult: { finish: 'error' },
      status: 'failed',
    });
    for (const finish of ['content-filter', 'length', 'other']) {
      expect(
        parseOpenCodePromptResponse(
          { ...base, info: { ...base.info, finish } },
          sessionId,
        ).result.status,
      ).toBe('completed');
    }
    const terminalTool = {
      id: 'tool_part',
      type: 'tool',
      sessionID: sessionId,
      messageID: 'msg_terminal',
      state: { status: 'error' },
    };
    expect(
      parseOpenCodePromptResponse(
        {
          ...base,
          info: { ...base.info, finish: 'tool-calls' },
          parts: [terminalTool],
        },
        sessionId,
      ).result.status,
    ).toBe('completed');
    for (const part of [
      { ...terminalTool, state: { status: 'pending' } },
      { ...terminalTool, state: { status: 'running' } },
      { ...terminalTool, state: {} },
      { ...terminalTool, sessionID: 'other' },
    ]) {
      expect(() =>
        parseOpenCodePromptResponse(
          {
            ...base,
            info: { ...base.info, finish: 'tool-calls' },
            parts: [part],
          },
          sessionId,
        ),
      ).toThrow(HarnessError);
    }
    expect(
      parseOpenCodePromptResponse(
        {
          ...base,
          info: { ...base.info, error: { name: 'ProviderFailure' } },
        },
        sessionId,
      ).result,
    ).toMatchObject({
      status: 'failed',
      providerResult: { error: 'ProviderFailure' },
    });
    expect(
      parseOpenCodePromptResponse(
        { ...base, info: { ...base.info, error: { name: 'unsafe code!' } } },
        sessionId,
      ).result,
    ).toMatchObject({ providerResult: { error: 'UnknownUpstreamError' } });

    const ownedText = {
      id: 'part',
      type: 'text',
      sessionID: sessionId,
      messageID: 'msg_terminal',
      text: 'owned',
    };
    expect(
      parseOpenCodePromptResponse(
        {
          ...base,
          parts: [
            { ...ownedText, sessionID: 'other', text: 'foreign' },
            { ...ownedText, messageID: 'other', text: 'other message' },
            { ...ownedText, ignored: true, text: 'ignored' },
            { ...ownedText, synthetic: true, text: 'synthetic' },
            { ...ownedText, type: 'tool', text: 'tool' },
            ownedText,
            { ...ownedText, id: 'part_2', text: 'second' },
          ],
        },
        sessionId,
      ).finalMessage,
    ).toBe('owned\nsecond');
    expect(() =>
      parseOpenCodePromptResponse(
        { ...base, parts: [{ ...ownedText, text: 1 }] },
        sessionId,
      ),
    ).toThrow(HarnessError);
  });

  it('rejects foreign or malformed resumable state and snapshots valid defaults', () => {
    const valid: SessionRef = {
      providerId: OPENCODE_PROVIDER_ID,
      profileId: profileId('profile'),
      providerSessionId: sessionId,
      compatibilityRef: OPENCODE_SESSION_COMPATIBILITY_REF,
      providerState: {
        directory: '/workspace',
        system: 'System',
        model: { providerId: 'provider', modelId: 'model' },
      },
    };
    expect(sessionStateFromRef(valid)).toEqual(valid.providerState);
    for (const ref of [
      { ...valid, providerId: providerId('other') },
      { ...valid, compatibilityRef: 'other' },
      { ...valid, providerState: undefined },
      { ...valid, providerState: [] },
      { ...valid, providerState: { directory: '' } },
      { ...valid, providerState: { directory: '/workspace', system: 1 } },
      { ...valid, providerState: { directory: '/workspace', model: null } },
      {
        ...valid,
        providerState: {
          directory: '/workspace',
          model: { providerId: 'provider', modelId: 'model', extra: true },
        },
      },
    ]) {
      expect(() => sessionStateFromRef(ref)).toThrow(
        expect.objectContaining({ code: 'session_provider_mismatch' }),
      );
    }
  });

  it('bounds and structurally redacts every JSON and non-JSON value', () => {
    const properties: Record<string, unknown> = {
      id: 'secret',
      status: true,
      time: null,
      tokens: Number.POSITIVE_INFINITY,
      data: Array.from({ length: 32 }, (_, index) => ({ id: String(index) })),
      unsafe: 'omitted',
    };
    for (let index = 0; index < 40; index += 1) {
      properties[`unsafe_${String(index)}`] = index;
    }
    const raw = redactOpenCodeEvent({ type: ' unsafe event ', properties });
    expect(raw.type).toBe('unknown');
    expect(raw.properties).toMatchObject({
      id: '<string>',
      status: true,
      time: null,
      tokens: '<non-finite>',
    });
    expect(JSON.stringify(raw)).not.toContain('secret');
    expect(JSON.stringify(raw)).not.toContain('"unsafe"');

    const deep = redactOpenCodeEvent({
      type: 'future.event',
      properties: {
        data: { data: { data: { data: { data: { data: { id: 'x' } } } } } },
      },
    });
    expect(JSON.stringify(deep)).toContain('<truncated>');
    expect(
      redactOpenCodeEvent({
        type: 'future.event',
        properties: Symbol('fixture'),
      }).properties,
    ).toBe('<symbol>');
  });
});

function textInput(): HarnessInput {
  return { parts: [{ type: 'text', text: 'fixture' }] };
}

function map(
  type: string,
  properties: Readonly<Record<string, unknown>>,
  state: ReturnType<typeof createOpenCodeEventState>,
) {
  return mapOpenCodeEvent({ type, properties }, sessionId, state);
}

function trackAssistant(
  state: ReturnType<typeof createOpenCodeEventState>,
  messageId: string,
): void {
  map(
    'message.updated',
    {
      sessionID: sessionId,
      info: {
        role: 'assistant',
        id: messageId,
        tokens: { input: 0, output: 0 },
      },
    },
    state,
  );
}

function trackPart(
  state: ReturnType<typeof createOpenCodeEventState>,
  messageId: string,
  partId: string,
  type: string,
): OpenCodeWireEvent {
  const event = {
    type: 'message.part.updated',
    properties: {
      sessionID: sessionId,
      part: { id: partId, messageID: messageId, sessionID: sessionId, type },
    },
  } satisfies OpenCodeWireEvent;
  mapOpenCodeEvent(event, sessionId, state);
  return event;
}
