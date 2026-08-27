import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  codexCompatibilityIdentity,
  encodeCodexInteractionResponse,
  mapCodexNotification,
  mapCodexServerRequest,
  parseCodexInitializeResponse,
  parseCodexThreadResponse,
  parseCodexTurnStartResponse,
  prepareCodexInput,
  prepareCodexSessionParams,
  prepareCodexTurnParams,
  redactCodexEvent,
  redactCodexRaw,
} from '../src/protocol.js';

const fixtureRoot = new URL(
  '../../../fixtures/codex/app-server-stable/',
  import.meta.url,
);

async function fixture(name: string): Promise<unknown[]> {
  const body = await readFile(new URL(name, fixtureRoot), 'utf8');
  return body
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown);
}

function syntheticTurn(
  status: string,
  error: null | Record<string, unknown> = null,
): Record<string, unknown> {
  return {
    id: 'synthetic-turn',
    items: [],
    itemsView: 'full',
    status,
    error,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1000,
  };
}

describe('Codex stable protocol mapping', () => {
  it('accepts the stable interface by shape and keeps runtime versions diagnostic', () => {
    expect(
      parseCodexInitializeResponse({
        userAgent: 'Codex Desktop/0.0.0-synthetic (Synthetic OS; arm64)',
        codexHome: '/synthetic/codex-home',
        platformFamily: 'unix',
        platformOs: 'synthetic',
      }),
    ).toEqual({ runtimeVersion: '0.0.0-synthetic' });
    expect(codexCompatibilityIdentity('0.0.0-synthetic')).toBe(
      'openai.codex;app-server=stable;runtime=0.0.0-synthetic',
    );

    expect(
      parseCodexInitializeResponse({
        userAgent: 'codex_cli_rs/0.0.1-synthetic',
        codexHome: '/synthetic/codex-home',
        platformFamily: 'unix',
        platformOs: 'synthetic',
      }),
    ).toEqual({ runtimeVersion: '0.0.1-synthetic' });
    expect(() =>
      parseCodexInitializeResponse({
        userAgent: 'codex_cli_rs/0.0.1-synthetic',
        codexHome: '/synthetic/codex-home',
      }),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
    expect(() => parseCodexInitializeResponse({ userAgent: 147 })).toThrow(
      expect.objectContaining({ code: 'provider_api_incompatible' }),
    );
    expect(() => parseCodexThreadResponse({ thread: {} })).toThrow(
      expect.objectContaining({ code: 'provider_api_incompatible' }),
    );
    expect(() => parseCodexTurnStartResponse({ turn: { id: '' } })).toThrow(
      expect.objectContaining({ code: 'provider_api_incompatible' }),
    );
  });

  it('maps completed fixtures while bounding and redacting unknown events', async () => {
    const mapped = (await fixture('completed.jsonl')).flatMap((message) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('method' in message)
      ) {
        throw new Error('Invalid synthetic fixture.');
      }
      return mapCodexNotification(
        String(message.method),
        'params' in message ? message.params : undefined,
      ).events;
    });

    expect(mapped.map(({ type }) => type)).toEqual([
      'reasoning.delta',
      'message.delta',
      'provider',
      'message.completed',
      'usage.updated',
      'run.completed',
    ]);
    const unknown = mapped.find(({ type }) => type === 'provider');
    expect(unknown).toMatchObject({
      providerEventType: 'future/syntheticEvent',
      raw: {
        method: 'future/syntheticEvent',
        params: {
          threadId: '[redacted]',
          turnId: '[redacted]',
        },
      },
    });
    expect(JSON.stringify(unknown)).not.toContain('synthetic-sensitive-value');
    expect(JSON.stringify(unknown)).not.toContain('"secret"');
    expect(JSON.stringify(unknown)).not.toContain('/synthetic/private/file');
    expect(mapped.at(-1)?.terminalResult).toEqual({
      status: 'completed',
    });
  });

  it('keeps error detail redacted and never guesses an unknown terminal as success', async () => {
    const failures = (await fixture('failed.jsonl')).flatMap((message) => {
      const record = message as { method: string; params: unknown };
      return mapCodexNotification(record.method, record.params).events;
    });
    expect(failures.map(({ type }) => type)).toEqual([
      'provider',
      'run.failed',
    ]);
    expect(JSON.stringify(failures)).not.toContain('Synthetic upstream detail');
    expect(failures.at(-1)?.terminalResult).toMatchObject({ status: 'failed' });

    const unknownTerminal = (await fixture('unknown-terminal.jsonl')).flatMap(
      (message) => {
        const record = message as { method: string; params: unknown };
        return mapCodexNotification(record.method, record.params).events;
      },
    );
    expect(unknownTerminal.map(({ type }) => type)).toEqual([
      'provider',
      'run.failed',
    ]);
    expect(unknownTerminal.at(-1)?.terminalResult).toEqual({
      providerResult: { reason: 'unknown_terminal_status' },
      status: 'failed',
    });

    const malformedError = mapCodexNotification('error', {
      threadId: 'synthetic-thread',
      turnId: 'synthetic-turn',
      willRetry: false,
      error: { codexErrorInfo: 'syntheticSensitiveErrorCode' },
    }).events;
    expect(JSON.stringify(malformedError)).not.toContain(
      'syntheticSensitiveErrorCode',
    );
    expect(malformedError[0]).toMatchObject({
      data: { providerCode: undefined, willRetry: false },
      type: 'provider',
    });
  });

  it('prepares supported portable input and rejects silent option loss', () => {
    expect(
      prepareCodexInput({
        parts: [
          { type: 'text', text: 'Synthetic text.' },
          { type: 'image_ref', uri: 'https://example.invalid/synthetic.png' },
          { type: 'image_ref', uri: 'file:///synthetic/image.png' },
          {
            type: 'provider',
            name: 'openai.codex.userInput',
            value: {
              type: 'text',
              text: 'Native synthetic text.',
              text_elements: [],
            },
          },
        ],
      }),
    ).toEqual([
      { type: 'text', text: 'Synthetic text.', text_elements: [] },
      { type: 'image', url: 'https://example.invalid/synthetic.png' },
      { type: 'localImage', path: '/synthetic/image.png' },
      { type: 'text', text: 'Native synthetic text.', text_elements: [] },
    ]);
    expect(() =>
      prepareCodexInput({ parts: [{ type: 'file_ref', uri: 'file:///a' }] }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
    expect(() =>
      prepareCodexInput({
        parts: [{ type: 'image_ref', uri: 'relative.png' }],
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareCodexInput({
        parts: [
          {
            type: 'image_ref',
            uri: 'file:///synthetic/%2Fprivate-image.png',
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'invalid_request',
        message: 'Codex image_ref file URI is invalid.',
      }),
    );
    expect(() => prepareCodexInput({ parts: [] })).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() =>
      prepareCodexInput({
        parts: [{ type: 'provider', name: 'future.input', value: {} }],
      }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));

    expect(
      prepareCodexSessionParams({
        workspace: { uri: 'file:///synthetic/workspace' },
        systemContext: 'Synthetic system context.',
        model: { id: 'synthetic-model' },
        providerOptions: {
          approvalPolicy: 'never',
          ephemeral: true,
          sandbox: 'read-only',
        },
      }),
    ).toMatchObject({
      approvalPolicy: 'never',
      cwd: '/synthetic/workspace',
      developerInstructions: 'Synthetic system context.',
      ephemeral: true,
      model: 'synthetic-model',
      sandbox: 'read-only',
    });
    expect(() =>
      prepareCodexSessionParams({
        workspace: { uri: 'https://example.invalid' },
      }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
    expect(() =>
      prepareCodexSessionParams({ workspace: { uri: 'relative' } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareCodexSessionParams({
        workspace: { uri: 'file:///synthetic/%2Fprivate-workspace' },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'invalid_request',
        message: 'Codex workspace file URI is invalid.',
      }),
    );
    expect(() =>
      prepareCodexSessionParams({
        model: { id: 'synthetic', providerOptions: { future: true } },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareCodexSessionParams({
        providerOptions: { approvalPolicy: 'future' },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareCodexSessionParams({ providerOptions: { sandbox: false } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareCodexSessionParams({ providerOptions: { ephemeral: 'yes' } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareCodexSessionParams({ providerOptions: { config: [] } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareCodexSessionParams({ providerOptions: { unknownOption: true } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    const sensitiveOptionName = '/private/synthetic/secret\nPROMPT=do-not-log';
    for (const prepare of [
      () =>
        prepareCodexSessionParams({
          providerOptions: { [sensitiveOptionName]: true },
        }),
      () =>
        prepareCodexTurnParams({
          providerOptions: { [sensitiveOptionName]: true },
        }),
    ]) {
      let sensitiveFailure: unknown;
      try {
        prepare();
      } catch (error) {
        sensitiveFailure = error;
      }
      expect(sensitiveFailure).toMatchObject({
        code: 'invalid_request',
        message: 'Unsupported Codex option.',
      });
      expect(inspect(sensitiveFailure)).not.toContain(sensitiveOptionName);
    }

    expect(
      prepareCodexTurnParams({
        timeoutMs: 50,
        providerOptions: { effort: 'high', serviceTier: 'priority' },
      }),
    ).toEqual({ effort: 'high', serviceTier: 'priority' });
    expect(() =>
      prepareCodexTurnParams({ providerOptions: { future: true } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() => prepareCodexTurnParams({ timeoutMs: 0 })).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() => prepareCodexTurnParams({ timeoutMs: 2_147_483_648 })).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() =>
      prepareCodexTurnParams({ providerOptions: { personality: 'future' } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() =>
      prepareCodexTurnParams({ providerOptions: { outputSchema: cyclic } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('maps portable and provider-native server request responses', () => {
    const approval = mapCodexServerRequest(
      'item/commandExecution/requestApproval',
      {
        threadId: 'synthetic-thread',
        turnId: 'synthetic-turn',
        itemId: 'synthetic-item',
        command: 'synthetic-command --safe',
        reason: 'Synthetic reason.',
      },
      'interaction-1',
    );
    expect(approval).toMatchObject({
      interaction: {
        kind: 'approval',
        prompt: 'Synthetic reason.',
        requestId: 'interaction-1',
      },
      threadId: 'synthetic-thread',
      turnId: 'synthetic-turn',
    });
    expect(
      encodeCodexInteractionResponse(approval, {
        kind: 'approval',
        decision: 'approve',
      }),
    ).toEqual({ decision: 'accept' });
    expect(
      encodeCodexInteractionResponse(approval, {
        kind: 'approval',
        decision: 'deny',
      }),
    ).toEqual({ decision: 'decline' });
    expect(
      encodeCodexInteractionResponse(approval, {
        kind: 'provider',
        value: { decision: 'acceptForSession' },
      }),
    ).toEqual({ decision: 'acceptForSession' });
    expect(() =>
      encodeCodexInteractionResponse(approval, {
        kind: 'approval',
        decision: 'approve',
        providerOptions: { scope: 'session' },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));

    const userInput = mapCodexServerRequest(
      'item/tool/requestUserInput',
      {
        threadId: 'synthetic-thread',
        turnId: 'synthetic-turn',
        itemId: 'synthetic-item',
        questions: [
          {
            id: 'synthetic-question',
            header: 'Choice',
            question: 'Choose one.',
            isOther: false,
            isSecret: false,
            options: null,
          },
        ],
      },
      'interaction-2',
    );
    expect(userInput.interaction.kind).toBe('provider');
    expect(
      encodeCodexInteractionResponse(userInput, {
        kind: 'provider',
        value: {
          answers: {
            'synthetic-question': { answers: ['Synthetic answer.'] },
          },
        },
      }),
    ).toEqual({
      answers: {
        'synthetic-question': { answers: ['Synthetic answer.'] },
      },
    });
    expect(() =>
      encodeCodexInteractionResponse(userInput, {
        kind: 'approval',
        decision: 'deny',
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));

    const providerRequest = mapCodexServerRequest(
      'future/request',
      { threadId: 'synthetic-thread', turnId: 'synthetic-turn', secret: 'x' },
      'interaction-3',
    );
    expect(providerRequest.interaction).toMatchObject({ kind: 'provider' });
    expect(JSON.stringify(providerRequest.interaction)).not.toContain('"x"');
    expect(() =>
      encodeCodexInteractionResponse(providerRequest, {
        kind: 'approval',
        decision: 'deny',
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      encodeCodexInteractionResponse(providerRequest, {
        kind: 'provider',
        value: undefined,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('maps tool, reasoning, approval, malformed, cancelled, and sparse terminal events', () => {
    const context = { threadId: 'synthetic-thread', turnId: 'synthetic-turn' };
    expect(
      mapCodexNotification('item/started', {
        ...context,
        item: { type: 'commandExecution', id: 'synthetic-tool' },
      }).events.map(({ type }) => type),
    ).toEqual(['tool.started']);
    expect(
      mapCodexNotification('item/completed', {
        ...context,
        item: {
          type: 'reasoning',
          id: 'synthetic-reasoning',
          summary: [],
          content: [],
        },
      }).events.map(({ type }) => type),
    ).toEqual(['reasoning.completed']);
    expect(
      mapCodexNotification('item/commandExecution/outputDelta', {
        ...context,
        delta: 'synthetic-output',
      }).events.map(({ type }) => type),
    ).toEqual(['tool.updated']);
    expect(
      mapCodexNotification('item/agentMessage/delta', context).events[0],
    ).toMatchObject({ type: 'provider' });
    expect(
      mapCodexNotification('item/completed', {
        ...context,
        item: { type: 'agentMessage', id: 'synthetic-message' },
      }).events[0],
    ).toMatchObject({ type: 'provider' });
    expect(
      mapCodexNotification('thread/tokenUsage/updated', context).events[0],
    ).toMatchObject({ type: 'provider' });
    expect(
      mapCodexNotification('turn/completed', {
        threadId: context.threadId,
        turn: syntheticTurn('interrupted'),
      }).events[0],
    ).toMatchObject({
      type: 'run.cancelled',
      terminalResult: { status: 'cancelled' },
    });
    expect(
      mapCodexNotification('turn/completed', {
        threadId: context.threadId,
        turn: syntheticTurn('failed'),
      }).events[0],
    ).toMatchObject({
      type: 'run.failed',
      terminalResult: { status: 'failed' },
    });
    const malformedTerminal = mapCodexNotification('turn/completed', {
      threadId: context.threadId,
      turn: { status: 'completed' },
    }).events;
    expect(malformedTerminal).toEqual([
      expect.objectContaining({ type: 'provider' }),
    ]);
    expect(malformedTerminal[0]?.terminalResult).toBeUndefined();

    const fileApproval = mapCodexServerRequest(
      'item/fileChange/requestApproval',
      { ...context, itemId: 'synthetic-file', reason: null },
      'interaction-file',
    );
    expect(fileApproval.interaction.title).toBe('Codex file-change approval');
    const multiple = mapCodexServerRequest(
      'item/tool/requestUserInput',
      {
        ...context,
        questions: [
          {
            id: 'one',
            header: 'One',
            question: 'Question one?',
            isOther: false,
            isSecret: false,
            options: null,
          },
          {
            id: 'two',
            header: 'Two',
            question: 'Question two?',
            isOther: false,
            isSecret: false,
            options: [],
          },
        ],
      },
      'interaction-multiple',
    );
    expect(multiple.interaction.kind).toBe('provider');
    expect(
      mapCodexServerRequest(
        'item/tool/requestUserInput',
        { ...context, questions: [{ id: false }] },
        'interaction-malformed',
      ).interaction.kind,
    ).toBe('provider');
  });

  it('bounds raw structural summaries by depth, entries, keys, and scalar content', () => {
    const raw = redactCodexRaw({
      ['k'.repeat(100)]: 'synthetic-sensitive-value',
      values: Array.from({ length: 100 }, (_, index) => ({
        index,
        value: `v${String(index)}`,
      })),
      deep: { a: { b: { c: { d: { e: 'hidden' } } } } },
      special: [null, true, Number.NaN, () => undefined],
    });
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain('synthetic-sensitive-value');
    expect(serialized.length).toBeLessThan(8192);
    expect(serialized).toContain('[truncated]');
    expect(
      redactCodexRaw({ id: 47, requestId: 48, threadId: 49, turnId: 50 }),
    ).toEqual({
      id: '[redacted]',
      requestId: '[redacted]',
      threadId: '[redacted]',
      turnId: '[redacted]',
    });
    expect(redactCodexEvent('x'.repeat(129), {})).toEqual({
      method: '[redacted-method]',
      params: {},
    });
    expect(
      redactCodexRaw({ accountId: 47, values: [48, { code: 49 }] }),
    ).toEqual({
      '[redacted-key-0]': '[redacted]',
      '[redacted-key-1]': ['[redacted]', { '[redacted-key-0]': '[redacted]' }],
    });
  });
});
