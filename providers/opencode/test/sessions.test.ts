import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertOpenCodeForkSource } from '../src/sessions.js';
import { parseOpenCodeSession } from '../src/protocol.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../fixtures/opencode/http-openapi-stable/fork.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { source: unknown; child: unknown };
it('accepts default policy forks with separately verified child identity', () => {
  expect(() => {
    assertOpenCodeForkSource(fixture.source);
  }).not.toThrow();
  expect(() => {
    assertOpenCodeForkSource({});
  }).not.toThrow();
  expect(parseOpenCodeSession(fixture.child).id).toBe('ses_child');
});
it.each([{ permission: null }, { permission: [{}] }, { revert: {} }])(
  'rejects native state not preserved by OpenCode fork %j',
  (value) => {
    expect(() => {
      assertOpenCodeForkSource(value);
    }).toThrow(expect.objectContaining({ code: 'unsupported_capability' }));
  },
);
