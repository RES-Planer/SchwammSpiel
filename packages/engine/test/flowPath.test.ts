import { describe, expect, test } from 'vitest';

import { travelTime } from '../src/flowPath';

describe('travelTime (velocity method)', () => {
  test('matches SPEC sheet-flow check value and legacy rounding behavior', () => {
    const segments = [{ type: 'sheet' as const, k: 17, lengthM: 48.5, slope: 0.041, rHydM: 0.002 }];

    const exact = travelTime(segments);
    expect(exact.perSegment[0]?.vMs).toBeCloseTo(0.0546, 4);

    const legacy = travelTime(segments, { legacyRounding: true });
    expect(legacy.perSegment[0]?.vMs).toBeCloseTo(0.05, 12);
    expect(legacy.perSegment[0]?.tMin).toBeCloseTo(16.17, 2);
  });

  test('matches rill check value and legacy rounding behavior', () => {
    const segments = [{ type: 'rill' as const, k: 25, lengthM: 80, slope: 0.069, rHydM: 0.04 }];

    const exact = travelTime(segments);
    expect(exact.perSegment[0]?.vMs).toBeCloseTo(0.768, 3);

    const legacy = travelTime(segments, { legacyRounding: true });
    expect(legacy.perSegment[0]?.vMs).toBeCloseTo(0.77, 12);
    expect(legacy.perSegment[0]?.tMin).toBeCloseTo(1.73, 2);
  });

  test('applies tcFactor to total travel time', () => {
    const segments = [{ type: 'pipe' as const, k: 1, lengthM: 1440, slope: 1, rHydM: 1 }];
    const result = travelTime(segments, { tcFactor: 2.1 });

    expect(result.perSegment[0]?.tMin).toBeCloseTo(24, 12);
    expect(result.tcH).toBeCloseTo(0.84, 12);
  });
});
