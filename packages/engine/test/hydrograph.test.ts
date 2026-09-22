import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { computeHydrograph, type HydrographInput } from '../src/hydrograph';

type FixtureCase = {
  id: string;
  area_ha: number;
  cn: number;
  tc_h: number;
  p_mm: number;
  duration_h: number;
  ia_ratio: number;
  prf: number;
  rain_shape: HydrographInput['rainShape'];
  mq_l_s_km2: number;
  consistent: boolean;
  expected: {
    tp_h: number;
    s_mm: number;
    ia_mm: number;
    q_max_m3s: number;
  };
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturesPath = resolve(root, 'fixtures/thesis_b8_cases.json');
const fixtureCases = JSON.parse(readFileSync(fixturesPath, 'utf8')).cases as FixtureCase[];

const consistentCases = fixtureCases.filter((c) => c.consistent);

function toInput(c: FixtureCase): HydrographInput {
  return {
    areaHa: c.area_ha,
    cn: c.cn,
    tcH: c.tc_h,
    pMm: c.p_mm,
    durationH: c.duration_h,
    iaRatio: c.ia_ratio,
    prf: c.prf,
    rainShape: c.rain_shape,
    mqLsKm2: c.mq_l_s_km2,
  };
}

describe('computeHydrograph fixtures', () => {
  test('executes only consistent fixture cases', () => {
    expect(consistentCases.length).toBeGreaterThan(0);
    expect(consistentCases.every((c) => c.consistent)).toBe(true);
  });

  test.each(consistentCases)('$id matches tp, s, ia and qMax tolerances', (c) => {
    const result = computeHydrograph(toInput(c));

    const tpRel = Math.abs(result.tpH / c.expected.tp_h - 1);
    const sAbs = Math.abs(result.sMm - c.expected.s_mm);
    const iaAbs = Math.abs(result.iaMm - c.expected.ia_mm);
    const qRel = Math.abs(result.qMaxM3s / c.expected.q_max_m3s - 1);

    expect(tpRel).toBeLessThanOrEqual(0.005);
    expect(sAbs).toBeLessThanOrEqual(0.02);
    expect(iaAbs).toBeLessThanOrEqual(0.02);
    expect(qRel).toBeLessThanOrEqual(0.04);
  });

  test.each(consistentCases)('$id closes direct-runoff mass balance', (c) => {
    const result = computeHydrograph(toInput(c));
    const dtS = result.dtH * 3600;

    const directVolumeM3 = result.qM3s.reduce(
      (sum, qM3s) => sum + (qM3s - result.baseFlowM3s) * dtS,
      0,
    );
    const expectedDirectVolumeM3 = (result.neffMm / 1000) * result.areaHa * 1e4;
    const relError = Math.abs(directVolumeM3 / expectedDirectVolumeM3 - 1);

    expect(relError).toBeLessThanOrEqual(0.005);
  });

  test('quantizes duration to rounded dt steps for rainfall discretization', () => {
    const baseInput: HydrographInput = {
      areaHa: 27.8,
      cn: 77.9,
      tcH: 0.84,
      pMm: 69.9,
      durationH: 17.95,
      iaRatio: 0.165,
      prf: 484,
      rainShape: 'mittenbetont',
      mqLsKm2: 15.53,
    };

    const rounded = computeHydrograph(baseInput);
    const quantizedDurationH =
      Math.round(baseInput.durationH / rounded.dtH) * rounded.dtH;
    const quantized = computeHydrograph({
      ...baseInput,
      durationH: quantizedDurationH,
    });

    expect(quantizedDurationH).not.toBe(baseInput.durationH);
    expect(rounded.qM3s).toEqual(quantized.qM3s);
    expect(rounded.neffMm).toBeCloseTo(quantized.neffMm, 12);
  });
});
