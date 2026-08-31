import {
  profileId,
  type HarnessProfile,
  type ProviderAdapterFactory,
} from '@harapter/core';

import { createHermesProviderFactory } from '../src/adapter.js';
import { HERMES_PROVIDER_ID } from '../src/protocol.js';

export type FixtureScenario =
  | 'approval'
  | 'approval-limited'
  | 'approval-overlap'
  | 'after-terminal'
  | 'completed'
  | 'contradictory'
  | 'duplicate-terminal'
  | 'eof-completed'
  | 'eof-running'
  | 'failed'
  | 'late-child'
  | 'malformed'
  | 'overflow'
  | 'provider-resolved'
  | 'subagent'
  | 'unknown';

interface FixtureRun {
  readonly id: string;
  readonly sessionId: string;
  readonly scenario: FixtureScenario | 'slow';
  status: Record<string, unknown>;
  stream: ReadableStreamDefaultController<Uint8Array> | undefined;
}

const capabilities = {
  object: 'hermes.api_server.capabilities',
  platform: 'hermes-agent',
  model: 'synthetic-model',
  auth: { type: 'bearer', required: false },
  runtime: {
    mode: 'server_agent',
    tool_execution: 'server',
    split_runtime: false,
  },
  features: {
    run_submission: true,
    run_status: true,
    run_events_sse: true,
    run_stop: true,
    run_approval_response: true,
    approval_events: true,
    session_resources: true,
  },
  endpoints: {
    runs: { method: 'POST', path: '/v1/runs' },
    run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
    run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
    run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' },
    run_stop: { method: 'POST', path: '/v1/runs/{run_id}/stop' },
    session_create: { method: 'POST', path: '/api/sessions' },
    session: { method: 'GET', path: '/api/sessions/{session_id}' },
  },
} as const;

export class HermesFixtureApi {
  readonly calls: {
    readonly body?: unknown;
    readonly headers: Readonly<Record<string, string>>;
    readonly method: string;
    readonly path: string;
  }[] = [];
  approvalEventDelayMs = 0;
  approvalEventChoice: string | undefined;
  approvalResponseDelayMs = 0;
  capabilityDocument: unknown = structuredClone(capabilities);
  requireAuthorization = false;
  runStartDelayMs = 0;
  private readonly runs = new Map<string, FixtureRun>();
  private readonly sessions = new Map<string, Record<string, unknown>>();
  private nextScenario: FixtureScenario = 'completed';
  private runSerial = 0;
  private sessionSerial = 0;

  queueScenario(scenario: FixtureScenario): void {
    this.nextScenario = scenario;
  }

  readonly fetch: typeof fetch = async (input, init = {}) => {
    await Promise.resolve();
    const url = new URL(
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input,
    );
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = requestBody(init.body);
    this.calls.push({
      ...(body === undefined ? {} : { body }),
      headers,
      method,
      path: url.pathname,
    });
    if (
      this.requireAuthorization &&
      headers['authorization'] !== 'Bearer synthetic-token'
    ) {
      return jsonResponse(
        { error: { code: 'unauthorized', message: 'synthetic' } },
        401,
      );
    }
    if (method === 'GET' && url.pathname === '/v1/capabilities') {
      return jsonResponse(this.capabilityDocument);
    }
    if (method === 'POST' && url.pathname === '/api/sessions') {
      const request = runtimeRecord(body) ?? {};
      const id = `session_fixture_${String(++this.sessionSerial)}`;
      const session = {
        id,
        source: request['source'] ?? 'api_server',
        ...(request['model'] === undefined ? {} : { model: request['model'] }),
        has_system_prompt: request['system_prompt'] !== undefined,
        has_model_config: request['model_options'] !== undefined,
      };
      this.sessions.set(id, session);
      return jsonResponse({ object: 'hermes.session', session }, 201);
    }
    const sessionMatch = /^\/api\/sessions\/([^/]+)$/u.exec(url.pathname);
    if (method === 'GET' && sessionMatch !== null) {
      const id = decodeURIComponent(sessionMatch[1] ?? '');
      const session = this.sessions.get(id);
      return session === undefined
        ? jsonResponse({ error: { code: 'session_not_found' } }, 404)
        : jsonResponse({ object: 'hermes.session', session });
    }
    if (method === 'POST' && url.pathname === '/v1/runs') {
      if (this.runStartDelayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, this.runStartDelayMs);
        });
      }
      return this.startRun(body);
    }
    const runMatch = /^\/v1\/runs\/([^/]+)(?:\/(events|stop|approval))?$/u.exec(
      url.pathname,
    );
    if (runMatch !== null) {
      const id = decodeURIComponent(runMatch[1] ?? '');
      const operation = runMatch[2];
      const run = this.runs.get(id);
      if (run === undefined)
        return jsonResponse({ error: { code: 'run_not_found' } }, 404);
      if (method === 'GET' && operation === undefined)
        return jsonResponse(run.status);
      if (method === 'GET' && operation === 'events')
        return this.eventStream(run);
      if (method === 'POST' && operation === 'stop') return this.stopRun(run);
      if (method === 'POST' && operation === 'approval') {
        const response = this.resolveApproval(run, body);
        if (this.approvalResponseDelayMs > 0) {
          await new Promise((resolve) => {
            setTimeout(resolve, this.approvalResponseDelayMs);
          });
        }
        return response;
      }
    }
    return jsonResponse({ error: { code: 'not_found' } }, 404);
  };

  private startRun(value: unknown): Response {
    const body = runtimeRecord(value) ?? {};
    const id = `run_fixture_${String(++this.runSerial)}`;
    const sessionIdValue = body['session_id'];
    const inputValue = body['input'];
    const sessionId = typeof sessionIdValue === 'string' ? sessionIdValue : '';
    const input = typeof inputValue === 'string' ? inputValue : '';
    const queued = this.nextScenario;
    this.nextScenario = 'completed';
    const scenario: FixtureRun['scenario'] =
      input.includes('cancel conformance') ||
      input.includes('connection abort input')
        ? 'slow'
        : queued;
    const run: FixtureRun = {
      id,
      scenario,
      sessionId,
      status: this.initialStatus(id, sessionId, scenario),
      stream: undefined,
    };
    this.runs.set(id, run);
    return jsonResponse({ run_id: id, status: 'started' }, 202);
  }

  private initialStatus(
    id: string,
    sessionId: string,
    scenario: FixtureRun['scenario'],
  ): Record<string, unknown> {
    const base = { object: 'hermes.run', run_id: id, session_id: sessionId };
    if (
      scenario === 'slow' ||
      scenario === 'approval' ||
      scenario === 'approval-limited' ||
      scenario === 'approval-overlap' ||
      scenario === 'eof-running'
    ) {
      return { ...base, status: 'running', last_event: 'message.delta' };
    }
    if (scenario === 'failed' || scenario === 'contradictory') {
      return {
        ...base,
        status: 'failed',
        error: 'synthetic failure',
        last_event: 'run.failed',
      };
    }
    return {
      ...base,
      status: 'completed',
      output: 'synthetic final response',
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      last_event: 'run.completed',
    };
  }

  private eventStream(run: FixtureRun): Response {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        run.stream = controller;
        for (const event of scenarioEvents(run)) {
          controller.enqueue(sseFrame(event));
        }
        if (
          run.scenario !== 'slow' &&
          run.scenario !== 'approval' &&
          run.scenario !== 'approval-limited'
        ) {
          controller.close();
          run.stream = undefined;
        }
      },
      cancel: () => {
        run.stream = undefined;
      },
    });
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream' },
      status: 200,
    });
  }

  private stopRun(run: FixtureRun): Response {
    run.status = {
      object: 'hermes.run',
      run_id: run.id,
      session_id: run.sessionId,
      status: 'cancelled',
      last_event: 'run.cancelled',
    };
    const emitResolution = (): void => {
      if (run.stream === undefined) return;
      run.stream.enqueue(
        sseFrame({ event: 'run.cancelled', run_id: run.id, timestamp: 1 }),
      );
      run.stream.close();
      run.stream = undefined;
    };
    if (this.approvalEventDelayMs > 0) {
      setTimeout(emitResolution, this.approvalEventDelayMs);
    } else {
      emitResolution();
    }
    return jsonResponse({ run_id: run.id, status: 'stopping' });
  }

  private resolveApproval(run: FixtureRun, value: unknown): Response {
    const body = runtimeRecord(value) ?? {};
    const choice = body['choice'];
    run.status = {
      object: 'hermes.run',
      run_id: run.id,
      session_id: run.sessionId,
      status: 'completed',
      output: 'synthetic approved response',
      usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
      last_event: 'run.completed',
    };
    const emitResolution = (): void => {
      if (run.stream === undefined) return;
      run.stream.enqueue(
        sseFrame({
          event: 'approval.responded',
          run_id: run.id,
          timestamp: 2,
          choice: this.approvalEventChoice ?? choice,
          resolved: 1,
        }),
      );
      run.stream.enqueue(
        sseFrame({
          event: 'run.completed',
          run_id: run.id,
          timestamp: 3,
          output: 'synthetic approved response',
          usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
        }),
      );
      run.stream.close();
      run.stream = undefined;
    };
    if (this.approvalEventDelayMs > 0) {
      setTimeout(emitResolution, this.approvalEventDelayMs);
    } else {
      emitResolution();
    }
    return jsonResponse({
      object: 'hermes.run.approval_response',
      run_id: run.id,
      choice,
      resolved: 1,
    });
  }
}

export function createHermesFixtureFactory(
  runtime = new HermesFixtureApi(),
): ProviderAdapterFactory {
  return createHermesProviderFactory({ fetch: runtime.fetch });
}

export function createHermesProfile(
  providerOptions?: Readonly<Record<string, unknown>>,
): HarnessProfile {
  return {
    profileId: profileId('hermes-fixture'),
    providerId: HERMES_PROVIDER_ID,
    displayName: 'Hermes fixture',
    connection: {
      kind: 'endpoint',
      url: 'https://hermes.fixture/',
      transport: 'http',
      ownership: 'external',
    },
    ...(providerOptions === undefined ? {} : { providerOptions }),
  };
}

function scenarioEvents(run: FixtureRun): readonly unknown[] {
  const common = { run_id: run.id };
  if (run.scenario === 'slow') {
    return [
      { ...common, event: 'message.delta', timestamp: 1, delta: 'waiting' },
    ];
  }
  if (run.scenario === 'approval') {
    return [
      {
        ...common,
        event: 'approval.request',
        timestamp: 1,
        command: 'synthetic command',
        description: 'synthetic approval',
        choices: ['once', 'session', 'always', 'deny'],
      },
    ];
  }
  if (run.scenario === 'approval-limited') {
    return [
      {
        ...common,
        event: 'approval.request',
        timestamp: 1,
        command: 'synthetic command',
        choices: ['once', 'deny'],
      },
    ];
  }
  if (run.scenario === 'approval-overlap') {
    const approval = {
      ...common,
      event: 'approval.request',
      timestamp: 1,
      command: 'synthetic command',
      choices: ['once', 'session', 'always', 'deny'],
    };
    return [approval, { ...approval, timestamp: 2 }];
  }
  if (run.scenario === 'failed') {
    return [
      {
        ...common,
        event: 'run.failed',
        timestamp: 1,
        error: 'synthetic failure',
      },
    ];
  }
  if (run.scenario === 'contradictory') {
    return [
      {
        ...common,
        event: 'run.completed',
        timestamp: 1,
        output: 'contradictory',
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ];
  }
  if (run.scenario === 'duplicate-terminal') {
    const completed = {
      ...common,
      event: 'run.completed',
      timestamp: 1,
      output: 'synthetic final response',
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    };
    return [completed, { ...completed, timestamp: 2 }];
  }
  if (run.scenario === 'after-terminal') {
    return [
      {
        ...common,
        event: 'run.completed',
        timestamp: 1,
        output: 'synthetic final response',
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      },
      {
        ...common,
        event: 'message.delta',
        timestamp: 2,
        delta: 'too late',
      },
    ];
  }
  if (run.scenario === 'eof-completed') {
    return [
      {
        ...common,
        event: 'message.delta',
        timestamp: 1,
        delta: 'synthetic response',
      },
    ];
  }
  if (run.scenario === 'eof-running') {
    return [
      {
        ...common,
        event: 'message.delta',
        timestamp: 1,
        delta: 'incomplete response',
      },
    ];
  }
  if (run.scenario === 'late-child') {
    return [
      {
        ...common,
        event: 'run.completed',
        timestamp: 1,
        output: 'synthetic final response',
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      },
      {
        ...common,
        event: 'subagent.complete',
        timestamp: 2,
        subagent_id: 'subagent_fixture',
        child_session_id: 'session_fixture_child',
        status: 'completed',
        summary: 'synthetic child summary',
      },
    ];
  }
  if (run.scenario === 'subagent') {
    return [
      {
        ...common,
        event: 'subagent.start',
        timestamp: 1,
        subagent_id: 'subagent_fixture',
        child_session_id: 'session_fixture_child',
        status: 'running',
      },
      {
        ...common,
        event: 'run.completed',
        timestamp: 2,
        output: 'synthetic final response',
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      },
    ];
  }
  if (run.scenario === 'provider-resolved') {
    return [
      {
        ...common,
        event: 'approval.request',
        timestamp: 1,
        choices: ['once'],
      },
      {
        ...common,
        event: 'approval.responded',
        timestamp: 2,
        choice: 'once',
        resolved: 1,
      },
      {
        ...common,
        event: 'run.completed',
        timestamp: 3,
        output: 'synthetic final response',
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      },
    ];
  }
  if (run.scenario === 'malformed') return ['{malformed'];
  if (run.scenario === 'overflow') {
    return Array.from({ length: 8 }, (_, index) => ({
      ...common,
      event: 'message.delta',
      timestamp: index,
      delta: `chunk-${String(index)}`,
    }));
  }
  if (run.scenario === 'unknown') {
    return [
      {
        ...common,
        event: 'provider.future.notice',
        timestamp: 1,
        token: 'synthetic-secret-placeholder',
      },
      {
        ...common,
        event: 'run.completed',
        timestamp: 2,
        output: 'synthetic final response',
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      },
    ];
  }
  return [
    {
      ...common,
      event: 'message.delta',
      timestamp: 1,
      delta: 'synthetic response',
    },
    {
      ...common,
      event: 'run.completed',
      timestamp: 2,
      output: 'synthetic final response',
      usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    },
  ];
}

function sseFrame(value: unknown): Uint8Array {
  if (typeof value === 'string')
    return new TextEncoder().encode(`data: ${value}\n\n`);
  return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function requestBody(value: RequestInit['body']): unknown {
  if (value === undefined || value === null) return undefined;
  let text: string;
  if (typeof value === 'string') text = value;
  else if (value instanceof Uint8Array) text = new TextDecoder().decode(value);
  else return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function runtimeRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
