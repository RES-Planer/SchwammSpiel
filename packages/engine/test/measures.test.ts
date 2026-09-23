import { describe, expect, test } from 'vitest';

import {
  ASSUMPTION_A6,
  ASSUMPTION_A7,
  ASSUMPTION_A8,
  STONEFIELD_D50_DEFAULT_M,
  STONEFIELD_HOLE_DEPTH_DEFAULT_M,
  STONEFIELD_HOLE_DIAMETER_DEFAULT_M,
  STONEFIELD_K_DEFAULT,
  STONEFIELD_POROSITY_DEFAULT,
  STONEFIELD_SPACING_DEFAULT_M,
  SWALE_CONTOUR_DZ_WARNING_M,
  SWALE_L_SHEET_DEFAULT_M,
  analyzeStonefieldHydraulics,
  applyRetentionElements,
  applyToFlowPath,
  computeHydrograph,
  stonefieldGeometry,
  swaleGeometry,
  validateSwaleContourAlignment,
  type HydrographInput,
} from '../src';

function peakReductionFraction(before: number, after: number): number {
  return 1 - after / before;
}

describe('retention elements (SPEC sections 7–9)', () => {
  test('closes per-element mass balance for retained discharge volume', () => {
    const qM3s = [0.5, 0.4, 0.3, 0.2, 0.1];
    const dtH = 1 / 6;
    const dtS = dtH * 3600;
    const baseFlowM3s = 0.1;

    const result = applyRetentionElements(
      qM3s,
      dtH,
      baseFlowM3s,
      [
        {
          id: 'e1',
          volumeM3: 200,
          areaShare: 0.8,
          delayH: 0,
          infAreaM2: 0,
        },
      ],
      { mode: 'physical', infiltration: 'off' },
    );

    const reducedVolumeM3 = qM3s.reduce((sum, q, i) => {
      return sum + (q - (result.qM3s[i] ?? 0)) * dtS;
    }, 0);

    const retainedM3 = result.elements[0]?.retainedM3 ?? 0;
    const infiltratedM3 = result.elements[0]?.infiltratedM3 ?? 0;

    expect(retainedM3).toBeGreaterThan(0);
    expect(infiltratedM3).toBe(0);
    expect(reducedVolumeM3).toBeCloseTo(retainedM3, 6);
  });

  test('5b long rain: delay only shifts timing, not total peak reduction, and closes mass balance to 0.1%', () => {
    const input: HydrographInput = {
      areaHa: 11,
      cn: 73.1,
      tcH: 3,
      pMm: 69.9,
      durationH: 18,
      iaRatio: 0.07,
      prf: 250,
      rainShape: 'mittenbetont',
      mqLsKm2: 15.53,
    };
    const hydro = computeHydrograph(input);
    const dtS = hydro.dtH * 3600;

    const delay0 = applyRetentionElements(
      hydro.qM3s,
      hydro.dtH,
      hydro.baseFlowM3s,
      [{ id: 'v1500-d0', volumeM3: 1500, areaShare: 0.9, delayH: 0 }],
      { mode: 'physical', infiltration: 'off' },
    );

    const delay3 = applyRetentionElements(
      hydro.qM3s,
      hydro.dtH,
      hydro.baseFlowM3s,
      [{ id: 'v1500-d3', volumeM3: 1500, areaShare: 0.9, delayH: 3 }],
      { mode: 'physical', infiltration: 'off' },
    );

    const peakReductionDelay0 = peakReductionFraction(hydro.qMaxM3s, Math.max(...delay0.qM3s));
    const peakReductionDelay3 = peakReductionFraction(hydro.qMaxM3s, Math.max(...delay3.qM3s));

    expect(peakReductionDelay0).toBeCloseTo(0.31, 2);
    expect(peakReductionDelay3).toBeCloseTo(0.31, 2);
    expect(Math.abs(peakReductionDelay0 - peakReductionDelay3)).toBeLessThanOrEqual(0.005);

    const reducedVolumeDelay0M3 = hydro.qM3s.reduce((sum, q, i) => {
      return sum + (q - (delay0.qM3s[i] ?? 0)) * dtS;
    }, 0);
    const reducedVolumeDelay3M3 = hydro.qM3s.reduce((sum, q, i) => {
      return sum + (q - (delay3.qM3s[i] ?? 0)) * dtS;
    }, 0);
    const retainedDelay0M3 = delay0.elements[0]?.retainedM3 ?? 0;
    const retainedDelay3M3 = delay3.elements[0]?.retainedM3 ?? 0;

    expect(Math.abs(reducedVolumeDelay0M3 - retainedDelay0M3) / retainedDelay0M3).toBeLessThanOrEqual(0.001);
    expect(Math.abs(reducedVolumeDelay3M3 - retainedDelay3M3) / retainedDelay3M3).toBeLessThanOrEqual(0.001);
  });

  test('6d volume 457 m³: reduction > 15% for 4h rain and < 2% for 18h rain', () => {
    const baseInput = {
      areaHa: 4,
      cn: 91,
      tcH: 0.6,
      iaRatio: 0.165,
      rainShape: 'mittenbetont' as const,
      mqLsKm2: 15.53,
    };

    const rain4h = computeHydrograph({
      ...baseInput,
      pMm: 48.8,
      durationH: 4,
      prf: 300,
    });

    const rain18h = computeHydrograph({
      ...baseInput,
      pMm: 69.9,
      durationH: 18,
      prf: 350,
    });

    const element = [{ id: 'v457', volumeM3: 457, areaShare: 0.9, delayH: 0 }];

    const reduced4h = applyRetentionElements(
      rain4h.qM3s,
      rain4h.dtH,
      rain4h.baseFlowM3s,
      element,
      { mode: 'physical', infiltration: 'off' },
    );

    const reduced18h = applyRetentionElements(
      rain18h.qM3s,
      rain18h.dtH,
      rain18h.baseFlowM3s,
      element,
      { mode: 'physical', infiltration: 'off' },
    );

    const reduction4h = peakReductionFraction(rain4h.qMaxM3s, Math.max(...reduced4h.qM3s));
    const reduction18h = peakReductionFraction(rain18h.qMaxM3s, Math.max(...reduced18h.qM3s));

    expect(reduction4h).toBeGreaterThan(0.15);
    expect(reduction18h).toBeLessThan(0.02);
  });
});

describe('swale utilities', () => {
  test('computes swale geometry and applies sheet replacement after chainage', () => {
    const g = swaleGeometry({ lengthM: 50 });
    expect(g.vMaxM3).toBeCloseTo(37.5, 9);
    expect(g.excavationM3).toBeCloseTo(g.vMaxM3, 12);
    expect(g.aInfM2).toBeGreaterThan(0);

    const path = applyToFlowPath(
      [
        { type: 'rill' as const, lengthM: 20, slope: 0.1, k: 20, rHydM: 0.04 },
        { type: 'hollow' as const, lengthM: 30, slope: 0.08, k: 12, rHydM: 0.1 },
      ],
      10,
      5,
      25,
    );

    expect(path.map((s) => s.type)).toEqual(['rill', 'sheet', 'sheet', 'hollow']);
    const totalLength = path.reduce((sum, s) => sum + s.lengthM, 0);
    expect(totalLength).toBeCloseTo(50, 12);
    expect(validateSwaleContourAlignment([500, 499.8, 499.6]).length).toBe(1);
  });
});

describe('stonefield sizing and hydraulics', () => {
  test('computes hole count, storage and required overload checks', () => {
    const g = stonefieldGeometry({ widthM: 10, lengthFlowM: 30, soilGroup: 'C' });
    expect(g.holeCount).toBe(75);
    expect(g.porosityStorageM3).toBeGreaterThan(0);
    expect(g.warnings.some((w) => w.code === 'low-infiltration-soil')).toBe(true);

    const stable = analyzeStonefieldHydraulics({
      widthM: 10,
      slope: 0.07,
      qInMaxM3s: 0.02,
    });
    expect(stable.overloaded).toBe(false);

    const overloaded = analyzeStonefieldHydraulics({
      widthM: 2,
      slope: 0.07,
      qInMaxM3s: 0.02,
    });
    expect(overloaded.overloaded).toBe(true);
    expect(overloaded.warnings.some((w) => w.code === 'overloaded')).toBe(true);
  });
});

describe('assumptions A6-A8', () => {
  test('exports expert-estimate assumptions for sections 7-9', () => {
    expect(ASSUMPTION_A6.status).toBe('expert-estimate');
    expect(ASSUMPTION_A7.status).toBe('expert-estimate');
    expect(ASSUMPTION_A8.status).toBe('expert-estimate');
    expect(SWALE_L_SHEET_DEFAULT_M.value).toBe(30);
    expect(SWALE_CONTOUR_DZ_WARNING_M.value).toBe(0.3);
    expect(STONEFIELD_SPACING_DEFAULT_M.value).toBe(2);
    expect(STONEFIELD_HOLE_DIAMETER_DEFAULT_M.value).toBe(0.4);
    expect(STONEFIELD_HOLE_DEPTH_DEFAULT_M.value).toBe(0.8);
    expect(STONEFIELD_POROSITY_DEFAULT.value).toBe(0.3);
    expect(STONEFIELD_D50_DEFAULT_M.value).toBe(0.08);
    expect(STONEFIELD_K_DEFAULT.value).toBe(8);
  });
});
