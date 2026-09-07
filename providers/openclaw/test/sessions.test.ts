import { readFileSync } from 'node:fs';
import { profileId } from '@harapter/core';
import { expect, it } from 'vitest';
import {
  assertOpenClawFork,
  parseOpenClawForkSource,
  requestOpenClawGateway,
  type OpenClawGatewayBinding,
} from '../src/sessions.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../fixtures/openclaw/acp-current/fork.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  source: { sessions: [Record<string, unknown>] };
  child: Record<string, unknown> & { entry: Record<string, unknown> };
};
const key = 'acp-bridge:harapter-source';
const childKey = 'acp-bridge:harapter-child';
const source = parseOpenClawForkSource(fixture.source, key);

it('verifies the native fork receipt and policy', () => {
  expect(() => {
    assertOpenClawFork(fixture.child, childKey, source);
  }).not.toThrow();
  const canonical = parseOpenClawForkSource(
    {
      sessions: [
        {
          ...fixture.source.sessions[0],
          key: `agent:main:${key}`,
          spawnedCwd: '/synthetic-workspace',
        },
      ],
    },
    key,
  );
  expect(() => {
    assertOpenClawFork(
      {
        ...fixture.child,
        key: `agent:main:${childKey}`,
        entry: {
          ...fixture.child.entry,
          spawnedCwd: '/synthetic-workspace',
          forkSource: {
            sessionKey: canonical.key,
            sessionId: canonical.sessionId,
          },
        },
      },
      childKey,
      canonical,
    );
  }).not.toThrow();
  expect(
    parseOpenClawForkSource(
      { sessions: [{ key, sessionId: 'source-synthetic' }] },
      key,
    ).permissionMode,
  ).toBeUndefined();
});

it.each([
  null,
  {},
  { sessions: [] },
  { sessions: [null] },
  { sessions: [[], {}] },
])('rejects missing or ambiguous source rows %j', (value) => {
  expect(() => parseOpenClawForkSource(value, key)).toThrow();
});

it.each([
  { key: 'another-route' },
  { key: `agent:main:acp-bridge:harapter-another:${key}` },
  { key: `agent:main:agent:other:${key}` },
  { key: `agent:main:${key}:nested` },
  { key: null },
  { sessionId: '' },
  { sessionId: null },
  { sessionId: 'x'.repeat(513) },
  { permissionMode: 'future' },
  { spawnedCwd: '' },
  { spawnedCwd: 1 },
  { spawnedCwd: 'x'.repeat(4097) },
  { status: 'running' },
  { status: 'queued' },
  { hasActiveRun: true },
  { sendPolicy: 'deny' },
  { sendPolicy: 'allow' },
  { sendPolicy: 'future' },
  { permissionModePending: true },
  { worktree: {} },
  { sessionRoot: '/synthetic' },
  { execNode: 'node' },
  { execCwd: '/synthetic' },
  { spawnedBy: 'parent' },
  { controlOwnerSessionKey: 'parent' },
  { spawnedWorkspaceDir: '/synthetic' },
  { incognito: true },
  { visibility: 'private' },
])(
  'rejects unsafe source identities, policy and execution state %j',
  (patch) => {
    expect(() =>
      parseOpenClawForkSource(
        { sessions: [{ ...fixture.source.sessions[0], ...patch }] },
        key,
      ),
    ).toThrow();
  },
);

it.each([
  null,
  { ok: false },
  { runStarted: true },
  { runError: {} },
  { key: 'other' },
  { sessionId: '' },
  { sessionId: null },
  { sessionId: 'x'.repeat(513) },
  { sessionId: source.sessionId },
  { entry: {} },
  {
    entry: {
      ...fixture.child.entry,
      forkSource: { sessionKey: 'other', sessionId: source.sessionId },
    },
  },
  {
    entry: {
      ...fixture.child.entry,
      forkSource: { sessionKey: key, sessionId: 'other' },
    },
  },
  { entry: { ...fixture.child.entry, permissionMode: 'full' } },
  { entry: { ...fixture.child.entry, spawnedCwd: '/unexpected' } },
])('rejects unverified or policy-changing children %j', (patch) => {
  expect(() => {
    assertOpenClawFork(
      patch === null ? null : { ...fixture.child, ...patch },
      childKey,
      source,
    );
  }).toThrow();
});

it('bounds ignored host aborts, sanitizes rejection and handles already closed clients', async () => {
  const binding: OpenClawGatewayBinding = {
    profileId: profileId('fixture'),
    methods: [],
    request: () => new Promise(() => undefined),
  };
  const controller = new AbortController();
  await expect(
    requestOpenClawGateway(binding, 'sessions.list', {}, controller.signal, 10),
  ).rejects.toMatchObject({ code: 'connection_aborted' });
  const waiting = requestOpenClawGateway(
    binding,
    'sessions.create',
    {},
    controller.signal,
    1000,
  );
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ code: 'connection_aborted' });
  await expect(
    requestOpenClawGateway(
      binding,
      'sessions.list',
      {},
      controller.signal,
      1000,
    ),
  ).rejects.toMatchObject({ code: 'connection_aborted' });
  await expect(
    requestOpenClawGateway(
      {
        ...binding,
        request: () => Promise.reject(new Error('synthetic sensitive error')),
      },
      'sessions.list',
      {},
      new AbortController().signal,
      1000,
    ),
  ).rejects.toThrow(
    'OpenClaw Gateway operation did not establish an authoritative outcome.',
  );
});

it('does not dispatch a Gateway mutation after synchronous Client abort', async () => {
  let calls = 0;
  const controller = new AbortController();
  const pending = requestOpenClawGateway(
    {
      profileId: profileId('fixture'),
      methods: [],
      request: () => {
        calls++;
        return Promise.resolve({});
      },
    },
    'sessions.create',
    {},
    controller.signal,
    1000,
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: 'connection_aborted' });
  expect(calls).toBe(0);
});
