import { describe, expect, test } from 'vitest';

import { analyzeLocalFlowRouting } from './localFlowRouting';

function buildSlopeWindow(width: number, height: number, cellSizeM: number) {
  const elevationsM: number[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      elevationsM.push(1000 - row * 0.5);
    }
  }
  return {
    width,
    height,
    cellSizeM,
    elevationsM,
  };
}

describe('localFlowRouting', () => {
  test('swale across the slope captures the upstream slope area on a synthetic hillside', () => {
    const analysis = analyzeLocalFlowRouting(buildSlopeWindow(20, 20, 2), {
      kind: 'swale',
      coordinates: [
        [2, 20],
        [38, 20],
      ],
      bottomWidthM: 2,
      depthM: 1,
      sideSlopeM: 2,
    });

    expect(analysis.capturedAreaShare).toBeGreaterThan(0.65);
    expect(analysis.warningCodes).toEqual([]);
    expect(analysis.cutM3).toBeGreaterThan(0);
    expect(analysis.fillM3).toBeGreaterThan(0);
  });

  test('diagonal swale warns when it is not contour-parallel', () => {
    const analysis = analyzeLocalFlowRouting(buildSlopeWindow(20, 20, 2), {
      kind: 'swale',
      coordinates: [
        [4, 4],
        [36, 28],
      ],
      bottomWidthM: 2,
      depthM: 1,
      sideSlopeM: 2,
    });

    expect(analysis.warningCodes).toContain('not-contour-parallel');
  });

  test('dominant path follows a non-top outlet boundary on east-west drainage', () => {
    const elevationsM: number[] = [];
    for (let row = 0; row < 20; row += 1) {
      for (let col = 0; col < 20; col += 1) {
        elevationsM.push(1000 - col * 0.5);
      }
    }

    const analysis = analyzeLocalFlowRouting(
      {
        width: 20,
        height: 20,
        cellSizeM: 2,
        elevationsM,
      },
      {
        kind: 'swale',
        coordinates: [
          [20, 2],
          [20, 38],
        ],
        bottomWidthM: 2,
        depthM: 1,
        sideSlopeM: 2,
      },
    );

    expect(analysis.dominantFlowPathChainageM).toBeGreaterThan(10);
    expect(analysis.dominantFlowPathM[0]?.[0]).toBeLessThan(5);
    expect(analysis.dominantFlowPathM.at(-1)?.[0]).toBeGreaterThan(18);
  });
});
