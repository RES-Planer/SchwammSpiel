import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { evaluateScenario, type Catchment } from '../src';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function baseCatchment(overrides?: Partial<Catchment>): Catchment {
  return {
    id: 'demo',
    name: 'Demo Catchment',
    mqLsKm2: 15.53,
    rainEvents: [
      {
        id: 'hq20-18h',
        pMm: 69.9,
        durationH: 18,
        rainShape: 'mittenbetont',
      },
    ],
    subcatchments: [
      {
        id: 'tgb-1',
        areaHa: 10,
        iaRatio: 0.165,
        prf: 484,
        tcFactor: 1,
        lagToOutletH: 0,
        reference: {
          cn: 80,
          tcH: 1,
        },
        measureAreas: [
          {
            id: 'utgb-1',
            areaHa: 10,
            patches: [{ id: 'p1', areaHa: 10, cn: 80 }],
            flowPath: [{ type: 'pipe', lengthM: 3600, slope: 1, k: 1, rHydM: 1 }],
            lagToParentH: 0,
            measures: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('evaluateScenario', () => {
  test('returns the exact reference hydrograph when no measures change the scenario', () => {
    const catchment = baseCatchment();
    const result = evaluateScenario(catchment, 'hq20-18h', true);

    expect(result.subcatchments[0]?.before.qM3s).toEqual(result.subcatchments[0]?.reference.qM3s);
    expect(result.subcatchments[0]?.after.qM3s).toEqual(result.subcatchments[0]?.reference.qM3s);
    expect(result.after.qM3s).toEqual(result.before.qM3s);
  });

  test('translates the peak by lagToOutletH on the catchment hydrograph', () => {
    const catchment = baseCatchment({
      subcatchments: [
        {
          ...baseCatchment().subcatchments[0]!,
          lagToOutletH: 0.5,
        },
      ],
    });

    const result = evaluateScenario(catchment, 'hq20-18h', false);
    const subcatchment = result.subcatchments[0]!;

    expect(result.before.tPeakH - subcatchment.reference.tPeakH).toBeCloseTo(0.5, 12);
  });

  test('returns consistent summary metrics for a routed storage measure', () => {
    const catchment = baseCatchment({
      subcatchments: [
        {
          ...baseCatchment().subcatchments[0]!,
          measureAreas: [
            {
              ...baseCatchment().subcatchments[0]!.measureAreas[0]!,
              measures: [
                {
                  kind: 'storage',
                  shape: { form: 'prism', baseAreaM2: 200, hMaxM: 2 },
                  outlet: { type: 'constant', qM3s: 0.01 },
                  areaUsedHa: 0.05,
                  excavationM3: 400,
                },
              ],
            },
          ],
        },
      ],
    });

    const result = evaluateScenario(catchment, 'hq20-18h', true);

    expect(result.qMaxBeforeM3s).toBe(Math.max(...result.before.qM3s));
    expect(result.qMaxAfterM3s).toBe(Math.max(...result.after.qM3s));
    expect(result.deltaPct).toBeCloseTo(
      ((result.qMaxAfterM3s - result.qMaxBeforeM3s) / result.qMaxBeforeM3s) * 100,
      12,
    );
    expect(result.peakDelayH).toBeCloseTo(result.after.tPeakH - result.before.tPeakH, 12);
    expect(result.retainedVolumeM3).toBeGreaterThan(0);
    expect(result.areaUsedHa).toBeCloseTo(0.05, 12);
    expect(result.excavationM3).toBeCloseTo(400, 12);
  });

  test('generated Goldbach catchment keeps the calibrated no-measure peak close to the SPEC target', () => {
    const catchment = JSON.parse(
      readFileSync(resolve(root, 'data/goldbach/catchment.json'), 'utf8'),
    ) as Catchment;

    const result = evaluateScenario(catchment, 'hq20-18h', false);
    const totalAreaHa = catchment.subcatchments.reduce((sum, subcatchment) => sum + subcatchment.areaHa, 0);

    expect(result.after.qM3s).toEqual(result.before.qM3s);
    expect(totalAreaHa).toBeGreaterThanOrEqual(585);
    expect(totalAreaHa).toBeLessThanOrEqual(587);
    expect(
      catchment.subcatchments.every((subcatchment) => {
        return 'tcH' in subcatchment.reference && subcatchment.reference.tcH >= 1 && subcatchment.reference.tcH <= 5;
      }),
    ).toBe(true);
    expect(
      catchment.subcatchments.every((subcatchment) => {
        return subcatchment.lagToOutletH >= 0 && subcatchment.lagToOutletH <= 3;
      }),
    ).toBe(true);
    expect(result.qMaxBeforeM3s).toBeGreaterThanOrEqual(4.41);
    expect(result.qMaxBeforeM3s).toBeLessThanOrEqual(4.51);
  });
});
