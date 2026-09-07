import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assertPiCloneAccepted } from '../src/sessions.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../fixtures/pi/rpc-current/fork.json', import.meta.url),
    'utf8',
  ),
) as { clone: unknown };
it('requires an explicit successful clone receipt', () => {
  expect(() => {
    assertPiCloneAccepted(fixture.clone);
  }).not.toThrow();
});
it.each([null, [], {}, { cancelled: 'false' }, { cancelled: true }])(
  'rejects an unproven or declined clone %j',
  (value) => {
    expect(() => {
      assertPiCloneAccepted(value);
    }).toThrow();
  },
);
