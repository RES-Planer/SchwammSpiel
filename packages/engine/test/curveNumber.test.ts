import { describe, expect, test } from 'vitest';

import { aggregateCn, cnForPatch, computeHydrograph } from '../src/index';

describe('cnForPatch', () => {
  test('matches SPEC check value for maize C in March with mulch and contour tillage', () => {
    const result = cnForPatch({
      landUse: 'Mais',
      soilGroup: 'C',
      month: 'Mar',
      mulchCoverFraction: 0.3,
      tillage: 'contour_parallel',
    });

    expect(result.cn).toBeCloseTo(82.1, 1);
    expect(result.steps.length).toBeGreaterThanOrEqual(3);
  });

  test('matches SPEC check value for grassland B in March with contour tillage', () => {
    const result = cnForPatch({
      landUse: 'Grünland',
      soilGroup: 'B',
      month: 'Mar',
      tillage: 'contour_parallel',
    });

    expect(result.cn).toBeCloseTo(78.0, 1);
  });

  test('matches SPEC check value for clover grass B in March with contour tillage', () => {
    const result = cnForPatch({
      landUse: 'Kleegras',
      soilGroup: 'B',
      month: 'Mar',
      tillage: 'contour_parallel',
    });

    expect(result.cn).toBeCloseTo(58.2, 1);
  });

  test('warns for soil group A missing formula and returns unadjusted value', () => {
    const result = cnForPatch({
      landUse: 'Mais',
      soilGroup: 'A',
      month: 'Mar',
      tillage: 'downslope',
    });

    expect(result.cn).toBe(94);
    expect(result.warnings.some((warning) => warning.code === 'missing-formula')).toBe(true);
  });


  test('rejects mulch cover fractions above 1', () => {
    expect(() =>
      cnForPatch({
        landUse: 'Mais',
        soilGroup: 'C',
        month: 'Mar',
        mulchCoverFraction: 1.1,
        tillage: 'downslope',
      }),
    ).toThrow(/mulchCoverFraction/);
  });

  test('warns for terraced tillage missing formula and keeps CN unchanged at tillage step', () => {
    const result = cnForPatch({
      landUse: 'Mais',
      soilGroup: 'C',
      month: 'Mar',
      tillage: 'terraced',
    });

    expect(result.cn).toBe(94);
    expect(result.warnings.some((warning) => warning.code === 'missing-formula')).toBe(true);
  });
});

describe('aggregateCn', () => {
  const areasHa = [1.7, 3, 5.4, 4.4, 4.6, 4.5, 1.7, 2.5];

  test('matches 1abc area-weighted CN for baseline and measure list from SPEC source', () => {
    const baselineCn = [92.0, 94.0, 84.2, 93.0, 78.0, 48.3, 80.6, 60.0];
    const measureCn = [92.0, 82.1, 84.2, 93.0, 58.2, 48.3, 80.6, 60.0];

    const baseline = aggregateCn(
      areasHa.map((areaHa, i) => ({ areaHa, cn: baselineCn[i] })),
      'area_weighted',
    );
    const measure = aggregateCn(
      areasHa.map((areaHa, i) => ({ areaHa, cn: measureCn[i] })),
      'area_weighted',
    );

    expect(baseline.mode).toBe('area_weighted');
    expect(measure.mode).toBe('area_weighted');

    if (baseline.mode !== 'area_weighted' || measure.mode !== 'area_weighted') {
      throw new Error('unexpected aggregation mode');
    }

    expect(baseline.cn).toBeCloseTo(77.9, 1);
    expect(measure.cn).toBeCloseTo(73.3, 1);
  });


  test('runoff_weighted requires iaRatio at aggregation time', () => {
    expect(() =>
      aggregateCn(
        [
          { areaHa: 1.7, cn: 92 },
          { areaHa: 3.0, cn: 82.1 },
        ],
        'runoff_weighted',
      ),
    ).toThrow(/iaRatio/);
  });

  test('runoff_weighted neff function is accepted by computeHydrograph', () => {
    const weighted = aggregateCn(
      [
        { areaHa: 1.7, cn: 92 },
        { areaHa: 3.0, cn: 82.1 },
      ],
      'runoff_weighted',
      { iaRatio: 0.165 },
    );

    if (weighted.mode !== 'runoff_weighted') {
      throw new Error('unexpected aggregation mode');
    }

    const result = computeHydrograph({
      areaHa: 4.7,
      neffMm: weighted.neffMm,
      tcH: 0.84,
      pMm: 69.9,
      durationH: 18,
      iaRatio: 0.165,
      prf: 484,
      rainShape: 'mittenbetont',
      mqLsKm2: 15.53,
    });

    expect(result.neffMm).toBeGreaterThan(0);
    expect(Number.isNaN(result.sMm)).toBe(true);
    expect(Number.isNaN(result.iaMm)).toBe(true);
  });
});
