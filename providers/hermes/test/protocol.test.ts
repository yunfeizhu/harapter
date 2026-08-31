import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  HERMES_SESSION_COMPATIBILITY_REF,
  compatibilityFingerprint,
  mapHermesEvent,
  parseHermesApprovalResponse,
  parseHermesCapabilities,
  parseHermesRunReceipt,
  parseHermesRunStatus,
  parseHermesSession,
  parseHermesStopResponse,
  prepareHermesSession,
  prepareHermesRun,
  redactHermesEvent,
  sessionStateFromRef,
} from '../src/protocol.js';
import { profileId, providerId, providerSessionId } from '@harapter/core';

const fixtureRoot = new URL(
  '../../../fixtures/hermes/api-server-current/',
  import.meta.url,
);

async function fixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(new URL(name, fixtureRoot), 'utf8'),
  ) as Record<string, unknown>;
}

describe('Hermes protocol mapping', () => {
  it('validates the current capability surface and produces a stable fingerprint', async () => {
    const completed = await fixture('completed.json');
    const capabilities = parseHermesCapabilities(completed['capabilities']);

    expect(capabilities).toMatchObject({
      model: 'synthetic-model',
      authRequired: true,
      features: {
        approval: true,
        cancel: true,
      },
    });
    expect(compatibilityFingerprint(capabilities)).toMatch(
      /^capabilities-[a-f0-9]{16}$/u,
    );
    expect(
      compatibilityFingerprint(
        parseHermesCapabilities(completed['capabilities']),
      ),
    ).toBe(compatibilityFingerprint(capabilities));
  });

  it('rejects a capability document without the required Session and Run endpoints', async () => {
    const completed = await fixture('completed.json');
    const capabilities = structuredClone(completed['capabilities']);
    expect(capabilities).toBeTypeOf('object');
    if (capabilities === null || Array.isArray(capabilities)) throw new Error();
    const endpoints = (capabilities as Record<string, unknown>)['endpoints'];
    expect(endpoints).toBeTypeOf('object');
    if (endpoints === null || Array.isArray(endpoints)) throw new Error();
    delete (endpoints as Record<string, unknown>)['run_status'];

    expect(() => parseHermesCapabilities(capabilities)).toThrow(
      expect.objectContaining({ code: 'provider_api_incompatible' }),
    );
  });

  it('prepares portable Session and text Run input without accepting workspace or native parts', () => {
    const prepared = prepareHermesSession({
      systemContext: 'synthetic system context',
      model: {
        id: 'synthetic-model',
        providerOptions: {
          provider: 'synthetic-provider',
          modelOptions: { reasoning_effort: 'medium' },
        },
      },
      providerOptions: { source: 'api_server', title: 'Synthetic session' },
    });
    expect(prepared.body).toEqual({
      model: 'synthetic-model',
      model_options: { reasoning_effort: 'medium' },
      provider: 'synthetic-provider',
      source: 'api_server',
      system_prompt: 'synthetic system context',
      title: 'Synthetic session',
    });
    expect(
      prepareHermesRun(
        {
          parts: [
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second' },
          ],
        },
        providerSessionId('session_fixture'),
        prepared.state,
      ),
    ).toEqual({
      input: 'first\nsecond',
      instructions: 'synthetic system context',
      model: 'synthetic-model',
      model_options: { reasoning_effort: 'medium' },
      provider: 'synthetic-provider',
      session_id: 'session_fixture',
    });
    expect(() =>
      prepareHermesSession({ workspace: { uri: 'file:///synthetic' } }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
    expect(() =>
      prepareHermesRun(
        { parts: [{ type: 'provider', name: 'future', value: {} }] },
        providerSessionId('session_fixture'),
        prepared.state,
      ),
    ).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
  });

  it('parses Session and Run receipts and restores only bounded compatible state', async () => {
    const completed = await fixture('completed.json');
    expect(parseHermesSession(completed['createSession']).id).toBe(
      'session_fixture_completed',
    );
    expect(parseHermesRunReceipt(completed['startRun'])).toEqual({
      runId: 'run_fixture_completed',
      status: 'started',
    });
    expect(
      sessionStateFromRef({
        providerId: providerId('nous.hermes-agent'),
        profileId: profileId('fixture'),
        providerSessionId: providerSessionId('session_fixture_completed'),
        compatibilityRef: HERMES_SESSION_COMPATIBILITY_REF,
        providerState: {
          systemContext: 'synthetic',
          model: 'synthetic-model',
          provider: 'synthetic-provider',
        },
      }),
    ).toEqual({
      model: 'synthetic-model',
      provider: 'synthetic-provider',
      systemContext: 'synthetic',
    });
  });

  it('maps completed, failed, and cancelled terminal status fixtures', async () => {
    const completed = await fixture('completed.json');
    const failed = await fixture('failed.json');
    const cancelled = await fixture('cancelled.json');

    expect(
      parseHermesRunStatus(
        completed['status'],
        'run_fixture_completed',
        'session_fixture_completed',
      ),
    ).toMatchObject({
      status: 'completed',
      result: {
        status: 'completed',
        finalMessage: 'synthetic final response',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      },
    });
    expect(
      parseHermesRunStatus(
        failed['status'],
        'run_fixture_failed',
        'session_fixture_failed',
      ),
    ).toMatchObject({ status: 'failed', result: { status: 'failed' } });
    expect(
      parseHermesRunStatus(
        cancelled['status'],
        'run_fixture_cancelled',
        'session_fixture_cancelled',
      ),
    ).toMatchObject({ status: 'cancelled', result: { status: 'cancelled' } });
  });

  it('maps portable events while keeping subagent and unknown data bounded and redacted', async () => {
    const completed = await fixture('completed.json');
    const lateChild = await fixture('late-child.json');
    const unknown = await fixture('unknown.json');
    const events = completed['events'];
    expect(Array.isArray(events)).toBe(true);
    if (!Array.isArray(events)) throw new Error();

    expect(mapHermesEvent(events[0], 'run_fixture_completed')).toMatchObject({
      kind: 'portable',
      event: { type: 'message.delta', data: { delta: 'synthetic response' } },
    });
    const childEvents = lateChild['events'];
    expect(Array.isArray(childEvents)).toBe(true);
    if (!Array.isArray(childEvents)) throw new Error();
    expect(mapHermesEvent(childEvents[1], 'run_fixture_parent')).toMatchObject({
      kind: 'subagent',
      event: {
        eventType: 'subagent.complete',
        childSessionId: 'session_fixture_child',
      },
    });
    const unknownEvent = unknown['event'];
    expect(mapHermesEvent(unknownEvent, 'run_fixture_unknown')).toMatchObject({
      kind: 'provider',
      event: {
        providerEventType: 'provider.future.notice',
        raw: {
          event: '<string>',
          run_id: '<string>',
          timestamp: '<number>',
        },
      },
    });
    expect(JSON.stringify(redactHermesEvent(unknownEvent))).not.toContain(
      'synthetic-secret-placeholder',
    );
  });

  it('parses approval and stop acknowledgements without treating stopping as terminal', async () => {
    const approval = await fixture('approval.json');
    const cancelled = await fixture('cancelled.json');

    expect(
      parseHermesApprovalResponse(
        approval['response'],
        'run_fixture_approval',
        'once',
      ),
    ).toEqual({ choice: 'once', resolved: 1 });
    expect(
      parseHermesStopResponse(cancelled['stop'], 'run_fixture_cancelled'),
    ).toEqual({ status: 'stopping' });
  });

  it('fails malformed identifiers, terminal contradictions, and unsafe persisted state closed', async () => {
    const completed = await fixture('completed.json');
    const contradictory = {
      ...(completed['status'] as Record<string, unknown>),
      last_event: 'run.failed',
    };
    expect(() =>
      parseHermesRunStatus(
        contradictory,
        'run_fixture_completed',
        'session_fixture_completed',
      ),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
    expect(() =>
      parseHermesRunReceipt({ run_id: '../unsafe', status: 'started' }),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
    expect(() =>
      sessionStateFromRef({
        providerId: providerId('nous.hermes-agent'),
        profileId: profileId('fixture'),
        providerSessionId: providerSessionId('session_fixture'),
        providerState: { modelOptions: { token: 'not-allowed' } },
      }),
    ).toThrow(expect.objectContaining({ code: 'session_provider_mismatch' }));
  });

  it('loads every fixture in the evidence set', async () => {
    await expect(fixture('manifest.json')).resolves.toMatchObject({
      providerId: 'nous.hermes-agent',
    });
    await expect(fixture('approval.json')).resolves.toBeDefined();
    await expect(fixture('cancelled.json')).resolves.toBeDefined();
    await expect(fixture('completed.json')).resolves.toBeDefined();
    await expect(fixture('failed.json')).resolves.toBeDefined();
    await expect(fixture('late-child.json')).resolves.toBeDefined();
    await expect(fixture('unknown.json')).resolves.toBeDefined();
  });
});
