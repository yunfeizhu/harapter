import { describe, expect, it } from 'vitest';

import { AcpClientError } from '../src/errors.js';
import type {
  AcpAgentCapabilities,
  AcpContentBlock,
  AcpSessionUpdate,
} from '../src/types.js';
import {
  extensionMethod,
  parseEmptyResult,
  parseInitializeResult,
  parseListSessionsResult,
  parseNewSessionResult,
  parsePermissionRequest,
  parsePromptResult,
  parseSessionNotification,
  parseSessionStateResult,
  prepareInitializeInput,
  prepareListSessionsInput,
  prepareLoadSessionInput,
  prepareNewSessionInput,
  preparePermissionOutcome,
  preparePromptInput,
  prepareResumeSessionInput,
  redactAcpObservation,
  sessionIdentifier,
} from '../src/validation.js';

const noCapabilities: AcpAgentCapabilities = {
  loadSession: false,
  mcp: { http: false, sse: false },
  prompt: { audio: false, embeddedContext: false, image: false },
  session: {
    additionalDirectories: false,
    close: false,
    delete: false,
    list: false,
    resume: false,
  },
};

const allCapabilities: AcpAgentCapabilities = {
  loadSession: true,
  mcp: { http: true, sse: true },
  prompt: { audio: true, embeddedContext: true, image: true },
  session: {
    additionalDirectories: true,
    close: true,
    delete: true,
    list: true,
    resume: true,
  },
};

describe('ACP v1 validation', () => {
  it('prepares initialization defaults and validates metadata and client services', () => {
    expect(prepareInitializeInput()).toEqual({
      clientCapabilities: {
        auth: { terminal: false },
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      protocolVersion: 1,
    });
    expect(
      prepareInitializeInput({
        _meta: { 'synthetic.dev/trace': true },
        clientCapabilities: {
          _meta: null,
          auth: { _meta: {}, terminal: false },
          fs: { _meta: {}, readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          _meta: {},
          name: 'synthetic-client',
          title: null,
          version: 'current',
        },
      }),
    ).toMatchObject({
      _meta: { 'synthetic.dev/trace': true },
      clientInfo: { name: 'synthetic-client', title: null },
    });

    for (const clientCapabilities of [
      { fs: { readTextFile: true } },
      { fs: { writeTextFile: true } },
      { terminal: true },
      { auth: { terminal: true } },
    ]) {
      expect(() => prepareInitializeInput({ clientCapabilities })).toThrow(
        expect.objectContaining({ code: 'invalid_configuration' }),
      );
    }
    expect(() =>
      prepareInitializeInput({
        clientCapabilities: { terminal: 'yes' as unknown as boolean },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_params' }));
    expect(() =>
      prepareInitializeInput({ clientInfo: { name: '', version: 'x' } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_params' }));
    expect(() =>
      prepareInitializeInput({
        _meta: 1 as unknown as Record<string, unknown>,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_params' }));
  });

  it('normalizes missing capabilities and validates initialize response shapes', () => {
    expect(
      parseInitializeResult({
        _meta: null,
        agentInfo: {
          _meta: {},
          name: 'synthetic-agent',
          title: 'Synthetic Agent',
          version: 'current',
        },
        protocolVersion: 1,
      }),
    ).toEqual({
      _meta: null,
      agentInfo: {
        _meta: {},
        name: 'synthetic-agent',
        title: 'Synthetic Agent',
        version: 'current',
      },
      authMethods: [],
      capabilities: noCapabilities,
      protocolVersion: 1,
    });
    expect(() => parseInitializeResult(null)).toThrow(
      expect.objectContaining({ code: 'invalid_message' }),
    );
    expect(() => parseInitializeResult({ protocolVersion: -1 })).toThrow(
      expect.objectContaining({ code: 'invalid_message' }),
    );
    expect(() =>
      parseInitializeResult({ authMethods: {}, protocolVersion: 1 }),
    ).toThrow(expect.objectContaining({ code: 'invalid_message' }));
    expect(() =>
      parseInitializeResult({
        agentCapabilities: { loadSession: 'yes' },
        protocolVersion: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_message' }));
    expect(() =>
      parseInitializeResult({
        agentCapabilities: { sessionCapabilities: { list: true } },
        protocolVersion: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_message' }));
  });

  it('validates stdio, HTTP, and SSE MCP servers and additional directories', () => {
    const input = {
      _meta: {},
      additionalDirectories: ['/synthetic/secondary'],
      cwd: '/synthetic/workspace',
      mcpServers: [
        {
          args: ['--synthetic'],
          command: '/synthetic/bin/server',
          env: [{ name: 'SYNTHETIC', value: 'placeholder' }],
          name: 'stdio-server',
        },
        {
          headers: [{ name: 'X-Synthetic', value: 'placeholder' }],
          name: 'http-server',
          type: 'http' as const,
          url: 'https://synthetic.invalid/mcp',
        },
        {
          headers: [],
          name: 'sse-server',
          type: 'sse' as const,
          url: 'http://synthetic.invalid/events',
        },
      ],
    };
    const httpServer = input.mcpServers[1];
    if (!httpServer) throw new Error('Expected a synthetic HTTP MCP server.');
    expect(prepareNewSessionInput(input, allCapabilities)).toEqual(input);
    expect(
      prepareLoadSessionInput(
        { ...input, sessionId: 'synthetic-session' },
        allCapabilities,
      ),
    ).toMatchObject({ sessionId: 'synthetic-session' });
    expect(
      prepareResumeSessionInput(
        {
          additionalDirectories: [],
          cwd: '/synthetic/workspace',
          sessionId: 'synthetic-session',
        },
        noCapabilities,
      ),
    ).toEqual({
      additionalDirectories: [],
      cwd: '/synthetic/workspace',
      sessionId: 'synthetic-session',
    });

    expect(() =>
      prepareNewSessionInput(
        {
          additionalDirectories: ['/synthetic/secondary'],
          cwd: '/synthetic/workspace',
          mcpServers: [],
        },
        noCapabilities,
      ),
    ).toThrow(expect.objectContaining({ code: 'capability_not_advertised' }));
    expect(() =>
      prepareNewSessionInput(
        {
          cwd: '/synthetic/workspace',
          mcpServers: [httpServer],
        },
        noCapabilities,
      ),
    ).toThrow(expect.objectContaining({ code: 'capability_not_advertised' }));
    expect(() =>
      prepareNewSessionInput(
        {
          cwd: '/synthetic/workspace',
          mcpServers: [
            {
              args: [],
              command: 'relative-command',
              env: [],
              name: 'stdio-server',
            },
          ],
        },
        allCapabilities,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_params' }));
    expect(() =>
      prepareNewSessionInput(
        {
          cwd: '/synthetic/workspace',
          mcpServers: [
            {
              headers: [],
              name: 'http-server',
              type: 'http',
              url: 'file:///synthetic/socket',
            },
          ],
        },
        allCapabilities,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_params' }));
  });

  it('parses Session setup, list, and empty responses without retaining unknown roots', () => {
    expect(
      parseNewSessionResult({
        _meta: {},
        configOptions: [
          {
            currentValue: true,
            id: 'synthetic',
            name: 'Synthetic',
            type: 'boolean',
          },
        ],
        modes: {
          availableModes: [{ id: 'synthetic', name: 'Synthetic' }],
          currentModeId: 'synthetic',
        },
        sessionId: 'synthetic-session',
        unknownRoot: 'ignored',
      }),
    ).toMatchObject({
      configOptions: [{ id: 'synthetic' }],
      sessionId: 'synthetic-session',
    });
    expect(
      parseSessionStateResult({ configOptions: null, modes: null }),
    ).toEqual({
      configOptions: null,
      modes: null,
    });
    expect(
      parseListSessionsResult({
        _meta: {},
        nextCursor: null,
        sessions: [
          {
            _meta: null,
            additionalDirectories: ['/synthetic/secondary'],
            cwd: '/synthetic/workspace',
            sessionId: 'synthetic-session',
            title: null,
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    ).toMatchObject({
      nextCursor: null,
      sessions: [{ sessionId: 'synthetic-session', title: null }],
    });
    expect(parseEmptyResult({ _meta: null, ignored: true })).toEqual({
      _meta: null,
    });
    expect(prepareListSessionsInput({ cwd: null, cursor: null })).toEqual({
      cwd: null,
      cursor: null,
    });
    expect(
      prepareListSessionsInput({
        _meta: {},
        cursor: 'synthetic-cursor',
        cwd: '/synthetic/workspace',
      }),
    ).toMatchObject({ cursor: 'synthetic-cursor' });

    for (const invalid of [
      () => parseNewSessionResult({ sessionId: '' }),
      () => parseSessionStateResult({ modes: [] }),
      () => parseSessionStateResult({ configOptions: {} }),
      () =>
        parseSessionStateResult({
          modes: { availableModes: [{}], currentModeId: 'synthetic' },
        }),
      () =>
        parseSessionStateResult({ configOptions: [{ id: 'missing-fields' }] }),
      () => parseListSessionsResult({ sessions: {} }),
      () =>
        parseListSessionsResult({
          sessions: [{ cwd: 'relative', sessionId: 'synthetic' }],
        }),
      () => parseListSessionsResult({ nextCursor: 1, sessions: [] }),
    ]) {
      expect(invalid).toThrow(
        expect.objectContaining({ code: 'invalid_message' }),
      );
    }
  });

  it('validates every stable prompt content variant and terminal reason', () => {
    const blocks: AcpContentBlock[] = [
      {
        annotations: {
          _meta: {},
          audience: ['assistant'],
          lastModified: null,
          priority: 0.5,
        },
        text: 'synthetic',
        type: 'text',
      },
      {
        data: 'c3ludGhldGlj',
        mimeType: 'image/png',
        type: 'image',
        uri: null,
      },
      { data: 'c3ludGhldGlj', mimeType: 'audio/wav', type: 'audio' },
      {
        description: null,
        mimeType: null,
        name: 'synthetic.txt',
        size: 9,
        title: null,
        type: 'resource_link',
        uri: 'file:///synthetic/workspace/synthetic.txt',
      },
      {
        resource: {
          mimeType: 'text/plain',
          text: 'synthetic',
          uri: 'file:///synthetic/workspace/synthetic.txt',
        },
        type: 'resource',
      },
      {
        resource: {
          blob: 'c3ludGhldGlj',
          uri: 'file:///synthetic/workspace/synthetic.bin',
        },
        type: 'resource',
      },
    ];
    const imageBlock = blocks[1];
    const audioBlock = blocks[2];
    const embeddedBlock = blocks[4];
    if (!imageBlock || !audioBlock || !embeddedBlock) {
      throw new Error('Expected synthetic optional content blocks.');
    }
    expect(
      preparePromptInput(
        { prompt: blocks, sessionId: 'synthetic-session' },
        allCapabilities,
      ),
    ).toMatchObject({ prompt: blocks });
    for (const stopReason of [
      'end_turn',
      'max_tokens',
      'max_turn_requests',
      'refusal',
      'cancelled',
    ] as const) {
      expect(parsePromptResult({ _meta: {}, stopReason })).toEqual({
        _meta: {},
        stopReason,
      });
    }
    for (const [block, capability] of [
      [imageBlock, 'image'],
      [audioBlock, 'audio'],
      [embeddedBlock, 'embedded'],
    ] as const) {
      expect(() =>
        preparePromptInput(
          { prompt: [block], sessionId: 'synthetic-session' },
          noCapabilities,
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'capability_not_advertised',
        }),
      );
      expect(() =>
        preparePromptInput(
          { prompt: [block], sessionId: 'synthetic-session' },
          noCapabilities,
        ),
      ).toThrow(capability);
    }
    expect(() =>
      preparePromptInput(
        { prompt: [], sessionId: 'synthetic-session' },
        noCapabilities,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_params' }));
    expect(() =>
      preparePromptInput(
        {
          prompt: [
            {
              annotations: {
                audience: ['invalid' as unknown as 'assistant'],
              },
              text: 'synthetic',
              type: 'text',
            },
          ],
          sessionId: 'synthetic-session',
        },
        allCapabilities,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_params' }));
    expect(() => parsePromptResult({ stopReason: 'success' })).toThrow(
      expect.objectContaining({ code: 'invalid_message' }),
    );
  });

  it('parses every stable Session update family', () => {
    const updates: AcpSessionUpdate[] = [
      {
        content: {
          annotations: {
            audience: ['user'],
            lastModified: '2026-01-01T00:00:00Z',
            priority: 1,
          },
          text: 'synthetic',
          type: 'text',
        },
        messageId: null,
        sessionUpdate: 'user_message_chunk',
      },
      {
        content: { data: 'c3ludGhldGlj', mimeType: 'image/png', type: 'image' },
        sessionUpdate: 'agent_message_chunk',
      },
      {
        content: { data: 'c3ludGhldGlj', mimeType: 'audio/wav', type: 'audio' },
        sessionUpdate: 'agent_thought_chunk',
      },
      {
        content: {
          description: null,
          mimeType: null,
          name: 'synthetic.txt',
          size: 9,
          title: null,
          type: 'resource_link',
          uri: 'file:///synthetic/workspace/synthetic.txt',
        },
        sessionUpdate: 'agent_message_chunk',
      },
      {
        content: {
          resource: {
            mimeType: 'text/plain',
            text: 'synthetic',
            uri: 'file:///synthetic/workspace/synthetic.txt',
          },
          type: 'resource',
        },
        sessionUpdate: 'agent_message_chunk',
      },
      {
        kind: 'execute',
        rawInput: { synthetic: true },
        sessionUpdate: 'tool_call',
        status: 'pending',
        title: 'Synthetic tool',
        toolCallId: 'tool-1',
      },
      {
        content: [
          {
            content: { text: 'synthetic output', type: 'text' },
            type: 'content',
          },
          {
            newText: 'after',
            oldText: 'before',
            path: '/synthetic/file',
            type: 'diff',
          },
          { terminalId: 'terminal-1', type: 'terminal' },
        ],
        kind: null,
        locations: [{ line: 3, path: '/synthetic/file' }],
        rawOutput: null,
        sessionUpdate: 'tool_call_update',
        status: 'completed',
        title: null,
        toolCallId: 'tool-1',
      },
      {
        content: null,
        locations: null,
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-2',
      },
      {
        entries: [
          {
            content: 'Synthetic step',
            priority: 'high',
            status: 'in_progress',
          },
          {
            content: 'Completed synthetic step',
            priority: 'low',
            status: 'completed',
          },
        ],
        sessionUpdate: 'plan',
      },
      {
        availableCommands: [
          {
            description: 'Synthetic command',
            input: { hint: 'value' },
            name: 'synthetic',
          },
          {
            description: 'Synthetic command without input',
            input: null,
            name: 'synthetic-null-input',
          },
        ],
        sessionUpdate: 'available_commands_update',
      },
      { currentModeId: 'synthetic-mode', sessionUpdate: 'current_mode_update' },
      {
        configOptions: [
          {
            category: 'model',
            currentValue: 'synthetic-fast',
            id: 'synthetic-model',
            name: 'Synthetic model',
            options: [
              {
                description: null,
                name: 'Fast',
                value: 'synthetic-fast',
              },
            ],
            type: 'select',
          },
          {
            currentValue: 'synthetic-balanced',
            id: 'synthetic-grouped-model',
            name: 'Synthetic grouped model',
            options: [
              {
                group: 'synthetic-family',
                name: 'Synthetic family',
                options: [
                  {
                    name: 'Balanced',
                    value: 'synthetic-balanced',
                  },
                ],
              },
            ],
            type: 'select',
          },
          {
            currentValue: true,
            id: 'synthetic-toggle',
            name: 'Synthetic toggle',
            type: 'boolean',
          },
        ],
        sessionUpdate: 'config_option_update',
      },
      {
        sessionUpdate: 'session_info_update',
        title: null,
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        cost: { amount: 0.01, currency: 'USD' },
        sessionUpdate: 'usage_update',
        size: 100,
        used: 10,
      },
      {
        cost: null,
        sessionUpdate: 'usage_update',
        size: 100,
        used: 10,
      },
    ];
    for (const update of updates) {
      expect(
        parseSessionNotification({
          sessionId: 'synthetic-session',
          update,
        }),
      ).toMatchObject({ kind: 'update', update });
    }
    expect(() =>
      parseSessionNotification({
        sessionId: 'synthetic-session',
        update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1' },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_message' }));
    expect(() =>
      parseSessionNotification({
        sessionId: 'synthetic-session',
        update: { sessionUpdate: 'usage_update', size: 100, used: -1 },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_message' }));
    for (const update of [
      { entries: [{}], sessionUpdate: 'plan' },
      {
        availableCommands: [{ description: 'missing name' }],
        sessionUpdate: 'available_commands_update',
      },
      {
        configOptions: [{ id: 'missing-fields' }],
        sessionUpdate: 'config_option_update',
      },
      {
        content: [{ type: 'content' }],
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
      },
      {
        locations: [{ path: 'relative' }],
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
      },
      {
        content: [{ type: 'future' }],
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
      },
      {
        kind: 'future',
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
      },
      {
        sessionUpdate: 'tool_call_update',
        status: 'future',
        toolCallId: 'tool-1',
      },
      {
        configOptions: [
          {
            currentValue: 'synthetic',
            id: 'mixed-options',
            name: 'Mixed options',
            options: [
              { name: 'Synthetic', value: 'synthetic' },
              { group: 'group', name: 'Group', options: [] },
            ],
            type: 'select',
          },
        ],
        sessionUpdate: 'config_option_update',
      },
      {
        configOptions: [
          {
            currentValue: 'yes',
            id: 'invalid-boolean',
            name: 'Invalid boolean',
            type: 'boolean',
          },
        ],
        sessionUpdate: 'config_option_update',
      },
    ]) {
      expect(() =>
        parseSessionNotification({ sessionId: 'synthetic-session', update }),
      ).toThrow(expect.objectContaining({ code: 'invalid_message' }));
    }
  });

  it('validates permission requests, selected options, and cancellation outcomes', () => {
    const request = parsePermissionRequest({
      _meta: {},
      options: [
        { kind: 'allow_once', name: 'Allow once', optionId: 'allow-once' },
        { kind: 'allow_always', name: 'Always', optionId: 'allow-always' },
        { kind: 'reject_once', name: 'Reject', optionId: 'reject-once' },
        { kind: 'reject_always', name: 'Never', optionId: 'reject-always' },
      ],
      sessionId: 'synthetic-session',
      toolCall: { title: 'Synthetic', toolCallId: 'tool-1' },
    });
    expect(
      preparePermissionOutcome(
        { _meta: {}, optionId: 'allow-once', outcome: 'selected' },
        request,
      ),
    ).toEqual({
      outcome: { _meta: {}, optionId: 'allow-once', outcome: 'selected' },
    });
    expect(preparePermissionOutcome({ outcome: 'cancelled' }, request)).toEqual(
      {
        outcome: { outcome: 'cancelled' },
      },
    );
    expect(() =>
      preparePermissionOutcome(
        { optionId: 'missing', outcome: 'selected' },
        request,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_params' }));
    expect(() =>
      parsePermissionRequest({
        options: [],
        sessionId: 'synthetic-session',
        toolCall: { toolCallId: 'tool-1' },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_message' }));
  });

  it('bounds unknown structural observations and validates extension names', () => {
    const observation = redactAcpObservation(
      'unknown_notification',
      'future/vendor',
      {
        enabled: true,
        kind: 'future-kind',
        list: Array.from({ length: 32 }, (_, index) => ({ index })),
        nested: { deeper: { deepest: { secret: 'must-not-survive' } } },
      },
    );
    const encoded = JSON.stringify(observation);
    expect(observation.method).toMatch(/^method-[0-9a-f]{16}$/u);
    expect(encoded).not.toContain('must-not-survive');
    expect(encoded).not.toContain('true');
    expect(encoded).toContain('[truncated]');
    expect(
      redactAcpObservation('unknown_request', '_synthetic.dev/request', null),
    ).toMatchObject({ method: '_synthetic.dev/request', params: null });
    expect(extensionMethod('_synthetic.dev/request')).toBe(
      '_synthetic.dev/request',
    );
    expect(() => extensionMethod('session/future')).toThrow(
      expect.objectContaining({ code: 'invalid_params' }),
    );
    expect(sessionIdentifier('synthetic-session')).toBe('synthetic-session');
    expect(() => sessionIdentifier('')).toThrow(AcpClientError);
  });
});
