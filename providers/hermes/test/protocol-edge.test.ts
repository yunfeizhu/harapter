import {
  profileId,
  providerId,
  providerSessionId,
  type SessionRef,
} from '@harapter/core';
import { describe, expect, it } from 'vitest';

import {
  compatibilityFingerprint,
  mapHermesEvent,
  parseHermesApprovalResponse,
  parseHermesCapabilities,
  parseHermesRunReceipt,
  parseHermesRunStatus,
  parseHermesSession,
  parseHermesStopResponse,
  prepareHermesRun,
  prepareHermesSession,
  redactHermesEvent,
  sessionStateFromRef,
  type HermesCapabilities,
} from '../src/protocol.js';

const requiredEndpoints = {
  runs: { method: 'POST', path: '/v1/runs' },
  run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
  run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
  session_create: { method: 'POST', path: '/api/sessions' },
  session: { method: 'GET', path: '/api/sessions/{session_id}' },
};

function capabilityDocument(): Record<string, unknown> {
  return {
    object: 'hermes.api_server.capabilities',
    platform: 'hermes-agent',
    model: 'synthetic-model',
    auth: { type: 'bearer', required: false },
    features: {
      run_submission: true,
      run_status: true,
      run_events_sse: true,
      session_resources: true,
      run_stop: false,
      run_approval_response: false,
      approval_events: false,
    },
    endpoints: requiredEndpoints,
  };
}

function ref(providerState: unknown): SessionRef {
  return {
    providerId: providerId('nous.hermes-agent'),
    profileId: profileId('fixture'),
    providerSessionId: providerSessionId('session_fixture'),
    providerState,
  };
}

describe('Hermes protocol negative boundaries', () => {
  it('rejects invalid capability identity, authentication, and required features', () => {
    expect(() => parseHermesCapabilities({})).toThrow(
      expect.objectContaining({ code: 'provider_api_incompatible' }),
    );
    expect(() =>
      parseHermesCapabilities({
        ...capabilityDocument(),
        auth: { type: 'basic', required: 'yes' },
      }),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
    const missingFeature = capabilityDocument();
    const features = missingFeature['features'] as Record<string, unknown>;
    features['run_status'] = false;
    expect(() => parseHermesCapabilities(missingFeature)).toThrow(
      expect.objectContaining({ code: 'provider_api_incompatible' }),
    );
    expect(parseHermesCapabilities(capabilityDocument()).features).toEqual({
      approval: false,
      cancel: false,
    });
  });

  it('keeps the compatibility fingerprint deterministic for nested arrays', () => {
    const capabilities: HermesCapabilities = {
      authRequired: false,
      model: 'synthetic-model',
      features: { approval: false, cancel: false },
      fingerprintSource: { nested: [{ z: 1, a: true }, null] },
    };
    expect(compatibilityFingerprint(capabilities)).toBe(
      compatibilityFingerprint({
        ...capabilities,
        fingerprintSource: { nested: [{ a: true, z: 1 }, null] },
      }),
    );
  });

  it('classifies malformed caller input as invalid requests', () => {
    expect(() => prepareHermesSession({ model: { id: 'bad\nmodel' } })).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() =>
      prepareHermesSession({
        providerOptions: [] as unknown as Record<string, unknown>,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareHermesSession({ providerOptions: { future: true } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareHermesSession({ metadata: { trace: 'synthetic' } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareHermesRun({ parts: [] }, providerSessionId('session_fixture'), {}),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareHermesRun(
        { parts: [{ type: 'text', text: 'input' }] },
        providerSessionId('session_fixture'),
        {},
        { providerOptions: { future: true } },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareHermesRun(
        {
          parts: [{ type: 'text', text: 'input' }],
          metadata: { trace: 'synthetic' },
        },
        providerSessionId('session_fixture'),
        {},
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    expect(() =>
      prepareHermesRun(
        { parts: [{ type: 'text', text: 'input' }] },
        providerSessionId('session_fixture'),
        {},
        { metadata: { trace: 'synthetic' } },
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('copies bounded JSON model options and rejects secret or unbounded values', () => {
    expect(
      prepareHermesSession({
        model: {
          id: 'synthetic-model',
          providerOptions: {
            modelOptions: {
              nullable: null,
              enabled: true,
              temperature: 0.5,
              labels: ['one', false],
              nested: { label: 'synthetic' },
              monkey: 'synthetic',
              keyboardLayout: 'synthetic',
            },
          },
        },
      }).body,
    ).toMatchObject({
      model_options: {
        nullable: null,
        enabled: true,
        temperature: 0.5,
        labels: ['one', false],
        nested: { label: 'synthetic' },
        monkey: 'synthetic',
        keyboardLayout: 'synthetic',
      },
    });
    for (const modelOptions of [
      { api_token: 'secret' },
      { accessToken: 'secret' },
      { refreshToken: 'secret' },
      { clientSecret: 'secret' },
      { databasePassword: 'secret' },
      { consumerSecret: 'secret' },
      { passphrase: 'secret' },
      { sshPassphrase: 'secret' },
      { privatePem: 'secret' },
      { secretKey: 'secret' },
      { serviceAccountKey: 'secret' },
      { signingKey: 'secret' },
      { value: Number.NaN },
      { value: Array.from({ length: 17 }, () => 1) },
      { value: () => undefined },
      { a: { b: { c: { d: { e: { f: true } } } } } },
    ]) {
      expect(() =>
        prepareHermesSession({
          model: {
            id: 'synthetic-model',
            providerOptions: { modelOptions },
          },
        }),
      ).toThrow(expect.objectContaining({ code: 'invalid_request' }));
    }
  });

  it('validates Session and Run resource identity and every nonterminal status', () => {
    expect(
      parseHermesSession({ object: 'hermes.session', session: { id: 's1' } }),
    ).toEqual({ id: 's1' });
    expect(() => parseHermesSession({ object: 'wrong', session: {} })).toThrow(
      expect.objectContaining({ code: 'provider_api_incompatible' }),
    );
    expect(() =>
      parseHermesRunReceipt({ run_id: 'r1', status: 'queued' }),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
    for (const status of [
      'queued',
      'running',
      'waiting_for_approval',
      'stopping',
    ]) {
      expect(
        parseHermesRunStatus(
          {
            object: 'hermes.run',
            run_id: 'r1',
            session_id: 's1',
            status,
          },
          'r1',
          's1',
        ),
      ).toEqual({ status });
    }
    expect(() =>
      parseHermesRunStatus(
        {
          object: 'hermes.run',
          run_id: 'other',
          session_id: 's1',
          status: 'running',
        },
        'r1',
        's1',
      ),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
    expect(() =>
      parseHermesRunStatus(
        {
          object: 'hermes.run',
          run_id: 'r1',
          session_id: 's1',
          status: 'future',
        },
        'r1',
        's1',
      ),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
  });

  it('accepts completed status without usage and rejects malformed usage', () => {
    expect(
      parseHermesRunStatus(
        {
          object: 'hermes.run',
          run_id: 'r1',
          session_id: 's1',
          status: 'completed',
          output: '',
          last_event: 'run.completed',
        },
        'r1',
        's1',
      ).result,
    ).toEqual({
      status: 'completed',
      finalMessage: '',
      providerResult: { status: 'completed' },
    });
    expect(() =>
      parseHermesRunStatus(
        {
          object: 'hermes.run',
          run_id: 'r1',
          session_id: 's1',
          status: 'completed',
          output: '',
          usage: { input_tokens: -1 },
          last_event: 'run.completed',
        },
        'r1',
        's1',
      ),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
  });

  it('maps tools, reasoning, approvals, terminal signals, and child Sessions', () => {
    const base = { run_id: 'r1', timestamp: 1 };
    expect(
      mapHermesEvent({ ...base, event: 'tool.started', tool: 'shell' }, 'r1'),
    ).toMatchObject({
      kind: 'portable',
      event: { type: 'tool.started' },
    });
    expect(
      mapHermesEvent(
        {
          ...base,
          event: 'tool.completed',
          tool: 'shell',
          duration: 1.5,
          error: false,
        },
        'r1',
      ),
    ).toMatchObject({ kind: 'portable', event: { type: 'tool.completed' } });
    expect(
      mapHermesEvent({ ...base, event: 'reasoning.available', text: '' }, 'r1'),
    ).toMatchObject({
      kind: 'portable',
      event: { type: 'reasoning.completed' },
    });
    for (const event of ['run.completed', 'run.failed', 'run.cancelled']) {
      expect(mapHermesEvent({ ...base, event }, 'r1')).toEqual({
        kind: 'terminal',
        eventType: event,
      });
    }
    expect(
      mapHermesEvent(
        { ...base, event: 'approval.request', choices: ['once'] },
        'r1',
      ),
    ).toMatchObject({ kind: 'interaction', request: { kind: 'approval' } });
    expect(
      mapHermesEvent(
        {
          ...base,
          event: 'approval.responded',
          choice: 'once',
          resolved: 1,
        },
        'r1',
      ),
    ).toEqual({
      kind: 'interaction.resolved',
      choice: 'once',
      resolved: 1,
    });
    expect(
      mapHermesEvent(
        {
          ...base,
          event: 'subagent.start',
          child_session_id: 'child_1',
          subagent_id: 'agent_1',
          status: 'running',
        },
        'r1',
      ),
    ).toMatchObject({
      kind: 'subagent',
      event: {
        childSessionId: 'child_1',
        subagentId: 'agent_1',
        status: 'running',
      },
    });
    expect(
      mapHermesEvent(
        { ...base, event: 'subagent.start', child_session_id: '../bad' },
        'r1',
      ),
    ).toMatchObject({ kind: 'provider' });
  });

  it('rejects malformed event, stop, and approval evidence', () => {
    const base = { run_id: 'r1', timestamp: 1 };
    for (const event of [
      { ...base, event: 'message.delta', delta: '', run_id: 'other' },
      {
        ...base,
        event: 'tool.completed',
        tool: 'shell',
        duration: 1,
        error: 'no',
      },
      { ...base, event: 'approval.request', choices: [] },
      { ...base, event: 'approval.request', choices: ['future'] },
      { ...base, event: 'approval.responded' },
      {
        ...base,
        event: 'approval.responded',
        choice: 'future',
        resolved: 1,
      },
      {
        ...base,
        event: 'approval.responded',
        choice: 'once',
        resolved: 0,
      },
      { ...base, event: 'message.delta', delta: '', timestamp: Number.NaN },
    ]) {
      expect(() => mapHermesEvent(event, 'r1')).toThrow(
        expect.objectContaining({ code: 'provider_api_incompatible' }),
      );
    }
    expect(() =>
      parseHermesStopResponse({ run_id: 'r1', status: 'cancelled' }, 'r1'),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
    expect(() =>
      parseHermesApprovalResponse(
        {
          object: 'hermes.run.approval_response',
          run_id: 'r1',
          choice: 'once',
          resolved: 0,
        },
        'r1',
        'once',
      ),
    ).toThrow(expect.objectContaining({ code: 'provider_api_incompatible' }));
  });

  it('turns every malformed persisted field into a Session mismatch', () => {
    for (const state of [
      undefined,
      { model: 1 },
      { provider: 'bad\nprovider' },
      { systemContext: 1 },
      { modelOptions: { password: 'secret' } },
      { future: true },
    ]) {
      expect(() => sessionStateFromRef(ref(state))).toThrow(
        expect.objectContaining({ code: 'session_provider_mismatch' }),
      );
    }
  });

  it('bounds and redacts primitive, array, unknown, and oversized raw values', () => {
    expect(redactHermesEvent(null)).toBeNull();
    expect(redactHermesEvent('secret')).toBe('<string>');
    expect(redactHermesEvent(Number.NaN)).toBe('<non-finite>');
    expect(redactHermesEvent(true)).toBe(true);
    expect(redactHermesEvent(Symbol('secret'))).toBe('<symbol>');
    expect(
      redactHermesEvent(Array.from({ length: 20 }, (_, index) => index)),
    ).toHaveLength(16);
    expect(
      redactHermesEvent({
        event: 'notice',
        token: 'secret',
        nested: { deeper: { value: true } },
      }),
    ).toEqual({ event: '<string>', omittedFields: 2 });
    expect(
      redactHermesEvent({
        event: { event: { event: { event: { event: { event: 'deep' } } } } },
      }),
    ).toEqual({
      event: {
        event: { event: { event: { event: { event: '<truncated>' } } } },
      },
    });
    expect(
      mapHermesEvent({ event: 'bad event!', run_id: 'r1' }, 'r1'),
    ).toMatchObject({
      kind: 'provider',
      event: { providerEventType: 'unknown' },
    });
  });
});
