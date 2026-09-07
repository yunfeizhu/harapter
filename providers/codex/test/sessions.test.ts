import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertCodexForkSource, parseCodexFork } from '../src/sessions.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../fixtures/codex/app-server-stable/fork.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  source: { thread: Record<string, unknown> };
  child: { thread: Record<string, unknown> };
};

it('validates synthetic persisted fork identity and idle or unloaded sources', () => {
  expect(() => {
    assertCodexForkSource(fixture.source, 'source-synthetic');
  }).not.toThrow();
  expect(() => {
    assertCodexForkSource(
      { thread: { ...fixture.source.thread, status: { type: 'notLoaded' } } },
      'source-synthetic',
    );
  }).not.toThrow();
  expect(parseCodexFork(fixture.child, 'source-synthetic')).toBe(
    'child-synthetic',
  );
});

it.each([
  null,
  [],
  {},
  { thread: [] },
  { thread: { id: 'other' } },
  { thread: { ...fixture.source.thread, ephemeral: true } },
  { thread: { ...fixture.source.thread, status: { type: 'future' } } },
  { thread: { ...fixture.source.thread, status: { type: 'active' } } },
])('rejects unverified sources %j', (value) => {
  expect(() => {
    assertCodexForkSource(value, 'source-synthetic');
  }).toThrow();
});

it.each([
  null,
  { thread: { ...fixture.child.thread, id: 'source-synthetic' } },
  { thread: { ...fixture.child.thread, forkedFromId: 'other' } },
  { thread: { ...fixture.child.thread, ephemeral: true } },
])('rejects uncertain fork identities %j', (value) => {
  expect(() => parseCodexFork(value, 'source-synthetic')).toThrow();
});
