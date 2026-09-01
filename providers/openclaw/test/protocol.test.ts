import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { HarnessInput } from '@harapter/core';
import type {
  AcpInitializeResult,
  AcpSessionUpdate,
} from '@harapter/transport-acp';
import { describe, expect, it } from 'vitest';

import {
  OPENCLAW_OBSERVATION_EXTENSION,
  OPENCLAW_PROVIDER_ID,
  OPENCLAW_SESSION_COMPATIBILITY_REF,
  mapOpenClawSessionUpdate,
  openClawCompatibilityIdentity,
  parseOpenClawRuntime,
  prepareOpenClawPrompt,
  redactOpenClawObservation,
} from '../src/protocol.js';

const fixtureDirectory = fileURLToPath(
  new URL('../../../fixtures/openclaw/acp-current/', import.meta.url),
);

describe('OpenClaw ACP mapping', () => {
  it('uses stable Provider identities without pinning the runtime version', () => {
    expect(OPENCLAW_PROVIDER_ID).toBe('openclaw');
    expect(OPENCLAW_OBSERVATION_EXTENSION).toBe('openclaw.acp.observations');
    expect(OPENCLAW_SESSION_COMPATIBILITY_REF).toContain('acp-v1');
    const identity = openClawCompatibilityIdentity('2026.8.1-synthetic');
    expect(identity).toMatch(/runtime=version-[0-9a-f]{16}$/u);
    expect(identity).not.toContain('2026.8.1-synthetic');
  });

  it('validates the official handshake identity and observed capabilities', () => {
    const result = {
      protocolVersion: 1,
      agentInfo: { name: 'openclaw-acp', version: '2026.8.1-synthetic' },
      authMethods: [],
      capabilities: {
        loadSession: true,
        prompt: { audio: false, embeddedContext: true, image: true },
        mcp: { http: false, sse: false },
        session: {
          additionalDirectories: false,
          close: true,
          delete: false,
          list: true,
          resume: true,
        },
      },
    } satisfies AcpInitializeResult;
    expect(parseOpenClawRuntime(result)).toMatchObject({
      name: 'openclaw-acp',
      capabilities: result.capabilities,
    });
    for (const invalid of [
      {
        protocolVersion: result.protocolVersion,
        authMethods: result.authMethods,
        capabilities: result.capabilities,
      },
      { ...result, agentInfo: { name: 'lookalike', version: '1' } },
      { ...result, agentInfo: { name: 'openclaw-acp', version: '' } },
    ]) {
      expect(() => parseOpenClawRuntime(invalid)).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
  });

  it('maps portable text and image references but rejects unsupported input', () => {
    expect(
      prepareOpenClawPrompt(
        {
          parts: [
            { type: 'text', text: 'synthetic' },
            {
              type: 'image_ref',
              uri: 'file:///synthetic/image.png',
              mediaType: 'image/png',
            },
          ],
        },
        { image: true },
      ),
    ).toEqual([
      { type: 'text', text: 'synthetic' },
      {
        type: 'resource_link',
        uri: 'file:///synthetic/image.png',
        name: 'image.png',
        mimeType: 'image/png',
      },
    ]);
    for (const input of [
      { parts: [] },
      { parts: [{ type: 'text', text: '' }] },
      { parts: [{ type: 'file_ref', uri: 'file:///synthetic/file' }] },
      {
        parts: [{ type: 'provider', name: 'synthetic', value: {} }],
      },
      {
        parts: [{ type: 'text', text: 'synthetic' }],
        metadata: { private: 'synthetic' },
      },
    ] as HarnessInput[]) {
      expect(() => prepareOpenClawPrompt(input, { image: true })).toThrow();
    }
    expect(() =>
      prepareOpenClawPrompt(
        {
          parts: [
            {
              type: 'image_ref',
              uri: 'file:///synthetic/image.png',
              mediaType: 'image/png',
            },
          ],
        },
        { image: false },
      ),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
  });

  it('validates image reference details without reading referenced content', () => {
    expect(
      prepareOpenClawPrompt(
        {
          parts: [{ type: 'image_ref', uri: 'file:///' }],
        },
        { image: true },
      ),
    ).toEqual([{ type: 'resource_link', uri: 'file:///', name: 'image' }]);
    expect(() =>
      prepareOpenClawPrompt(
        { parts: [{ type: 'image_ref', uri: 'not a uri' }] },
        { image: true },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('maps every exercised fixture update without retaining raw tool data', async () => {
    const fixture = JSON.parse(
      await readFile(`${fixtureDirectory}/completed.json`, 'utf8'),
    ) as { updates: AcpSessionUpdate[] };
    const mappings = fixture.updates.flatMap(mapOpenClawSessionUpdate);
    expect(mappings.map(({ type }) => type)).toEqual([
      'reasoning.delta',
      'message.delta',
      'tool.started',
      'tool.completed',
      'usage.updated',
    ]);
    expect(JSON.stringify(mappings)).not.toContain('private');
    expect(mappings.at(-1)).toMatchObject({
      usage: { totalTokens: 16 },
    });
  });

  it('loads and bounds every synthetic permission and unknown fixture', async () => {
    const permission = JSON.parse(
      await readFile(`${fixtureDirectory}/permission.json`, 'utf8'),
    ) as Record<string, unknown>;
    expect(permission['options']).toHaveLength(2);

    const unknown = JSON.parse(
      await readFile(`${fixtureDirectory}/unknown.json`, 'utf8'),
    ) as Record<string, unknown>;
    const redacted = redactOpenClawObservation(unknown);
    const encoded = JSON.stringify(redacted);
    expect(encoded).not.toContain('synthetic private value');
    expect(encoded).not.toContain('true');
    expect(encoded.length).toBeLessThan(2_048);

    const manifest = JSON.parse(
      await readFile(`${fixtureDirectory}/manifest.json`, 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      providerId: 'openclaw',
      interface: 'OpenClaw ACP stdio bridge',
    });
  });

  it('maps partial tool states and structural ACP updates conservatively', () => {
    expect(
      mapOpenClawSessionUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'synthetic-tool',
        status: 'in_progress',
      }),
    ).toMatchObject([{ type: 'tool.updated' }]);
    expect(
      mapOpenClawSessionUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'synthetic-tool',
        status: 'failed',
      }),
    ).toMatchObject([{ type: 'tool.completed' }]);
    expect(
      mapOpenClawSessionUpdate({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'synthetic user echo' },
      }),
    ).toEqual([]);
    expect(
      mapOpenClawSessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: 'synthetic', mimeType: 'image/png' },
      }),
    ).toEqual([]);
    expect(
      mapOpenClawSessionUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'image', data: 'synthetic', mimeType: 'image/png' },
      }),
    ).toEqual([]);
    expect(
      mapOpenClawSessionUpdate({
        sessionUpdate: 'plan',
        entries: [
          { content: 'synthetic plan', priority: 'medium', status: 'pending' },
        ],
      }),
    ).toMatchObject([{ type: 'provider', providerEventType: 'plan' }]);
  });

  it('bounds nested observations across scalar and collection shapes', () => {
    const redacted = redactOpenClawObservation({
      kind: 'unknown_session_update',
      nil: null,
      number: Number.NaN,
      list: [true, undefined, Symbol('synthetic')],
      nested: { one: { two: { three: { four: 'private' } } } },
    });
    expect(redacted).toMatchObject({
      kind: 'unknown_session_update',
      nil: null,
      number: '[redacted]',
      list: ['[redacted]', '[redacted]', '[redacted]'],
      nested: { one: { two: { three: '[bounded]' } } },
    });
    expect(JSON.stringify(redacted)).not.toContain('private');
  });
});
