import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GatewaySessionLog,
  parseGatewaySnapshot,
} from '../src/gateway-protocol.js';
import { DSH_GATEWAY_PROTOCOL } from '../src/gateway-types.js';

const fixture: unknown[] = JSON.parse(
  readFileSync(
    new URL(
      '../../../fixtures/dsh/gateway-session-v2/completed.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as unknown[];
const header = {
  version: 2,
  id: 'synthetic-session',
  createdAt: 0,
  cwd: '/synthetic',
  isSeeded: false,
};

describe('DSH Gateway Session v2 mapping', () => {
  it.each(['aborted', 'blocked', 'error', 'completed'])(
    'correlates claimed input with a pre-step %s terminal',
    (kind) => {
      const log = new GatewaySessionLog();
      log.begin('synthetic-request');
      fixture.slice(0, 3).forEach((event) => log.accept(event));
      log.accept({
        type: 'turn/end',
        seq: 3,
        time: 0,
        data: {
          turn: 1,
          reason: {
            kind,
            ...(kind === 'aborted'
              ? { reason: { kind: 'user' } }
              : kind === 'error'
                ? { error: { code: 'synthetic private code' } }
                : {}),
          },
        },
      });
      expect(log.terminal()?.status).toBe(
        kind === 'aborted'
          ? 'cancelled'
          : kind === 'completed'
            ? 'completed'
            : 'failed',
      );
    },
  );

  it.each(['canceled', 'different-message', 'unclaimed'])(
    'rejects false ownership from %s input',
    (mode) => {
      const records = structuredClone(fixture) as {
        type: string;
        seq: number;
        data: Record<string, unknown>;
      }[];
      const claim = records[2];
      const message = records[4];
      if (claim === undefined || message === undefined)
        throw new Error('Missing synthetic event.');
      if (mode === 'canceled') claim.data['outcome'] = 'canceled';
      if (mode === 'unclaimed') {
        claim.data['removedCount'] = 0;
      }
      if (mode === 'different-message') message.data['id'] = 'foreign';
      const log = new GatewaySessionLog();
      log.begin('synthetic-request');
      expect(() => {
        records.forEach((event) => log.accept(event));
      }).toThrow();
      expect(log.terminal()).toBeUndefined();
    },
  );

  it.each(['foreign-plugin', 'false-rpc', 'outside-step'])(
    'rejects a %s context message',
    (mode) => {
      const log = new GatewaySessionLog();
      log.begin('synthetic-request');
      const prefix =
        mode === 'outside-step' ? fixture.slice(0, 3) : fixture.slice(0, 5);
      prefix.forEach((event) => log.accept(event));
      expect(() =>
        log.accept({
          type: 'user/message',
          seq: prefix.length,
          time: 0,
          data: {
            id: 'synthetic-context',
            role: 'user',
            content: [],
            source: {
              kind: 'plugin',
              plugin:
                mode === 'foreign-plugin'
                  ? 'foreign'
                  : '@deepseek-ai/dsh-system-prompt',
              ...(mode === 'false-rpc' ? { rpcId: 'synthetic-request' } : {}),
            },
          },
        }),
      ).toThrow();
    },
  );
  it('does not discard restored pending input at an ordinary end-seed marker', () => {
    const log = new GatewaySessionLog();
    log.accept(fixture[0]);
    log.accept({ type: 'session/end-seed', seq: 1, time: 1, data: {} });
    expect(log.isIdle()).toBe(false);
    expect(() => {
      log.begin('new-request');
    }).toThrow();
  });

  it('does not correlate a plugin message carrying an unrelated rpcId field', () => {
    const records = structuredClone(fixture) as {
      data: Record<string, unknown>;
    }[];
    const insertion = records[0]?.data['inserted'] as {
      source: Record<string, unknown>;
    }[];
    const first = insertion[0];
    if (first === undefined) throw new Error('Missing synthetic insertion.');
    first.source['kind'] = 'plugin';
    const log = new GatewaySessionLog();
    log.begin('synthetic-request');
    expect(() => {
      records.forEach((event) => log.accept(event));
    }).toThrow();
  });

  it('omits arbitrary provider error codes from portable terminal results', () => {
    const records = structuredClone(fixture) as {
      data: Record<string, unknown>;
    }[];
    const last = records.at(-1);
    if (last === undefined) throw new Error('Missing synthetic terminal.');
    last.data['reason'] = {
      kind: 'error',
      error: { code: 'SYNTHETIC_PRIVATE_TOKEN' },
    };
    const log = new GatewaySessionLog();
    log.begin('synthetic-request');
    records.forEach((event) => log.accept(event));
    expect(log.terminal()?.status).toBe('failed');
    expect(JSON.stringify(log.terminal())).not.toContain(
      'SYNTHETIC_PRIVATE_TOKEN',
    );
  });

  it.each([
    { header: { ...header, version: 1 } },
    { header: { ...header, id: 'foreign' } },
    { header: { ...header, origin: 'subagent' } },
    { header: { ...header, createdAt: -1 } },
    { header: { ...header, cwd: undefined } },
    { header: { ...header, parentSession: 1 } },
    { header: { ...header, agentPreset: 1 } },
    { cursor: 0 },
    { records: [{ type: 'unknown' }] },
    { hasMore: true },
    { projections: { asOfSeq: 9, values: {} } },
  ])('rejects incompatible or incomplete snapshots %#', (change) => {
    expect(() =>
      parseGatewaySnapshot(
        {
          type: 'snapshot',
          header,
          cursor: -1,
          records: [],
          hasMore: false,
          projections: { asOfSeq: -1, values: {} },
          ...change,
        },
        header.id,
      ),
    ).toThrow();
  });

  it.each([
    [1, { turn: 0 }],
    [2, { target: 'next-turn', start: 2, inserted: [] }],
    [2, { target: 'unknown', start: 0, inserted: [] }],
    [3, { turn: 2, step: 1 }],
    [
      4,
      {
        id: 'foreign',
        role: 'user',
        content: [],
        source: { kind: 'user', rpcId: 'foreign' },
      },
    ],
    [7, { turn: 1, step: 2, stream: [] }],
    [7, { turn: 1, step: 1 }],
    [8, { turn: 1, step: 2 }],
    [9, { turn: 1, reason: { kind: 'future-success' } }],
    [9, { turn: 1, reason: { kind: 'aborted' } }],
  ])('fails closed on malformed owned events %#', (index, data) => {
    const log = new GatewaySessionLog();
    log.begin('synthetic-request');
    const records = structuredClone(fixture) as { data: unknown }[];
    const target = records[index];
    if (target === undefined) throw new Error('Missing synthetic event.');
    target.data = data;
    expect(() => {
      records.forEach((event) => log.accept(event));
    }).toThrow();
    expect(log.terminal()).toBeUndefined();
  });

  it.each(['blocked', 'max-tokens', 'interrupted', 'aborted'])(
    'maps recognized %s terminals without guessing success',
    (kind) => {
      const records = structuredClone(fixture) as {
        data: Record<string, unknown>;
      }[];
      const terminal = records.at(-1);
      if (terminal === undefined)
        throw new Error('Missing synthetic terminal.');
      terminal.data['reason'] = {
        kind,
        ...(kind === 'aborted' ? { reason: { kind: 'user' } } : {}),
      };
      const log = new GatewaySessionLog();
      log.begin('synthetic-request');
      records.forEach((event) => log.accept(event));
      expect(log.terminal()?.status).toBe(
        kind === 'aborted' ? 'cancelled' : 'failed',
      );
    },
  );
  it('pins provenance and validates a fresh complete snapshot', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(
        new URL(
          '../../../fixtures/dsh/gateway-session-v2/manifest.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(manifest).toMatchObject({
      upstreamEvidence: {
        commit: DSH_GATEWAY_PROTOCOL.slice('session-v2-'.length),
      },
    });
    const snapshot = parseGatewaySnapshot(
      {
        type: 'snapshot',
        header,
        cursor: -1,
        records: [],
        hasMore: false,
        projections: { asOfSeq: -1, values: {} },
      },
      header.id,
    );
    expect(snapshot.headerFingerprint).not.toContain('/synthetic');
    expect(snapshot.log.isIdle()).toBe(true);
  });

  it('correlates the durable request identity and produces an authoritative terminal', () => {
    const log = new GatewaySessionLog();
    log.begin('synthetic-request');
    const mapped = fixture.flatMap((event) => log.accept(event).events);
    expect(mapped.map((event) => event.type)).toContain('message.completed');
    expect(log.terminal()).toMatchObject({
      status: 'completed',
      finalMessage: 'synthetic answer',
      usage: { totalTokens: 5 },
    });
    expect(log.isIdle()).toBe(true);
  });

  it('excludes historical completed turns when beginning a later Run', () => {
    const log = new GatewaySessionLog();
    for (const event of fixture) log.accept(event);
    log.begin('another-request');
    expect(log.terminal()).toBeUndefined();
    expect(log.cursor).toBe(9);
  });

  it('rejects a gap and a foreign user message instead of claiming success', () => {
    const log = new GatewaySessionLog();
    log.begin('owned');
    expect(() =>
      log.accept({ type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } }),
    ).toThrow();
    expect(() => log.accept(fixture[0])).toThrow();
  });

  it('keeps unknown optional observations redacted and rejects unknown required events', () => {
    const log = new GatewaySessionLog();
    const observation = log.accept({
      type: 'synthetic/private-event',
      seq: 0,
      time: 0,
      ignorable: true,
      data: { token: 'synthetic secret' },
    });
    expect(observation.events[0]?.type).toBe('provider');
    expect(JSON.stringify(observation)).not.toContain('synthetic secret');
    expect(() =>
      log.accept({ type: 'unknown', seq: 1, time: 1, data: {} }),
    ).toThrow();
  });
});
