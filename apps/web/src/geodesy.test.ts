import { describe, expect, test } from 'vitest';

import { geodesicLengthM, geodesicPolygonAreaM2 } from './geodesy';

describe('geodesy helpers', () => {
  test('computes geodesic path length in meters', () => {
    const lengthM = geodesicLengthM([
      [11.93, 49.945],
      [11.931, 49.946],
    ]);

    expect(lengthM).toBeGreaterThan(120);
    expect(lengthM).toBeLessThan(140);
  });

  test('computes polygon area in square meters for open rings', () => {
    const areaM2 = geodesicPolygonAreaM2([
      [11.93, 49.945],
      [11.931, 49.945],
      [11.931, 49.946],
      [11.93, 49.946],
    ]);

    expect(areaM2).toBeGreaterThan(7_000);
    expect(areaM2).toBeLessThan(9_000);
  });

  test('returns zero for invalid polygons', () => {
    expect(geodesicPolygonAreaM2([])).toBe(0);
    expect(geodesicPolygonAreaM2([[11.93, 49.945], [11.931, 49.946]])).toBe(0);
  });
});
