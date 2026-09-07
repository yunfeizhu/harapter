import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  assertHermesBranchSource,
  parseHermesBranch,
} from '../src/sessions.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../fixtures/hermes/api-server-current/fork.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { child: { object: string; session: Record<string, unknown> } };
it('validates the native Hermes parent-child relationship', () => {
  expect(() => {
    assertHermesBranchSource({
      ...fixture.child,
      session: { ...fixture.child.session, has_model_config: false },
    });
  }).not.toThrow();
  expect(parseHermesBranch(fixture.child, 'source-synthetic')).toBe(
    'child-synthetic',
  );
});

it.each([undefined, true, 'false'])(
  'rejects source model configuration that cannot be preserved: %j',
  (hasModelConfig) => {
    expect(() => {
      assertHermesBranchSource({
        ...fixture.child,
        session: { ...fixture.child.session, has_model_config: hasModelConfig },
      });
    }).toThrow();
  },
);
it.each([
  null,
  {
    ...fixture.child,
    session: { ...fixture.child.session, id: 'source-synthetic' },
  },
  {
    ...fixture.child,
    session: { ...fixture.child.session, parent_session_id: 'other' },
  },
  {
    ...fixture.child,
    session: { ...fixture.child.session, end_reason: 'branched' },
  },
])('rejects ambiguous branch identity %j', (value) => {
  expect(() => parseHermesBranch(value, 'source-synthetic')).toThrow();
});
