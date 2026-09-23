import { describe, expect, test } from 'vitest';

import { parseHashRoute } from './hashRoute';

describe('parseHashRoute', () => {
  test('defaults to app route', () => {
    expect(parseHashRoute('')).toEqual({ kind: 'app' });
    expect(parseHashRoute('#scenario=raw.abc')).toEqual({ kind: 'app' });
  });

  test('parses steckbrief route', () => {
    expect(parseHashRoute('#/steckbrief/')).toEqual({
      kind: 'steckbrief',
      scenarioPayload: null,
    });
    expect(parseHashRoute('#/steckbrief/?scenario=raw.abc')).toEqual({
      kind: 'steckbrief',
      scenarioPayload: 'raw.abc',
    });
  });
});
