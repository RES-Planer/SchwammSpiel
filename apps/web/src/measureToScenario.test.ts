import { describe, expect, test } from 'vitest';
import type { Catchment } from '@schwammspiel/engine';

import { defaultParams, getLandUseChangeFormConfig } from './MeasureForm';
import { extractCnZones, inferCnZoneDefaults } from './cnZones';
import { buildEvaluableCatchment, evaluateLandUseChange } from './measureToScenario';
import type { MeasureState } from './scenarioState';

function landUseMeasure(params: Record<string, string | number>): MeasureState {
  return {
    id: 'land-use-1',
    kind: 'landUseChange',
    enabled: true,
    geometry: null,
    params,
  };
}

describe('measureToScenario land-use CN evaluation', () => {
  test('returns CN for maize in soil group C in March with mulch direct seeding and contour tillage', () => {
    const evaluation = evaluateLandUseChange(
      landUseMeasure({
        landUse: 'Mais',
        soilGroup: 'C',
        month: 'Mar',
        mulchDirectSeed: 'yes',
        mulchCoverFraction: 0.3,
        tillageDirection: 'contour-parallel',
      }),
    );

    expect(evaluation).not.toBeNull();
    expect(Math.abs((evaluation?.result.cn ?? 0) - 82.1)).toBeLessThanOrEqual(0.05);
  });

  test('returns CN for grassland in soil group B in March with contour tillage', () => {
    const evaluation = evaluateLandUseChange(
      landUseMeasure({
        landUse: 'Grünland',
        soilGroup: 'B',
        month: 'Mar',
        mulchDirectSeed: 'no',
        tillageDirection: 'contour-parallel',
      }),
    );

    expect(evaluation).not.toBeNull();
    expect(Math.abs((evaluation?.result.cn ?? 0) - 78.0)).toBeLessThanOrEqual(0.05);
  });

  test('returns CN for medium-runoff forest in soil group B with low seasonality', () => {
    const evaluation = evaluateLandUseChange(
      landUseMeasure({
        landUse: 'Wald (mittlere Abflussneigung)',
        soilGroup: 'B',
        month: 'low-seasonality',
      }),
    );

    expect(evaluation).not.toBeNull();
    expect(Math.abs((evaluation?.result.cn ?? 0) - 60.0)).toBeLessThanOrEqual(0.05);
  });

  test('hides mulch and tillage controls for forest land use configuration', () => {
    expect(getLandUseChangeFormConfig('Wald (mittlere Abflussneigung)').showMulchAndTillage).toBe(false);
  });

  test('derives CN-zone defaults and carries them into land-use default params', () => {
    const zones = extractCnZones({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Wald / B', cn: 60 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [11.9, 49.9],
                [11.95, 49.9],
                [11.95, 49.95],
                [11.9, 49.95],
                [11.9, 49.9],
              ],
            ],
          },
        },
      ],
    });
    const defaults = inferCnZoneDefaults(
      {
        type: 'Polygon',
        coordinates: [
          [11.91, 49.91],
          [11.94, 49.91],
          [11.94, 49.94],
          [11.91, 49.94],
          [11.91, 49.91],
        ],
      },
      zones,
    );
    const params = defaultParams('landUseChange', defaults);

    expect(defaults).toEqual({
      landUse: 'Wald',
      soilGroup: 'B',
      cn: 60,
    });
    expect(params.sourceLandUse).toBe('Wald');
    expect(params.sourceSoilGroup).toBe('B');
    expect(params.sourceCn).toBe(60);
  });

  test('evaluates CN from engine when land-use params come from CN-zone defaults', () => {
    const params = defaultParams('landUseChange', {
      landUse: 'Wald',
      soilGroup: 'B',
      cn: 60,
    });
    const evaluation = evaluateLandUseChange(landUseMeasure(params));

    expect(evaluation).not.toBeNull();
    expect(Math.abs((evaluation?.result.cn ?? 0) - 82.08)).toBeLessThanOrEqual(0.05);
    expect(evaluation?.before).toEqual({
      cn: 60,
      landUse: 'Wald',
      soilGroup: 'B',
    });
  });

  test('writes engine CN into evaluable catchment for land-use-change measures', () => {
    const catchment: Catchment = {
      id: 'demo',
      name: 'Demo',
      mqLsKm2: 0,
      rainEvents: [{ id: 'event-1', pMm: 10, durationH: 1, rainShape: 'block' }],
      subcatchments: [
        {
          id: 'sub-1',
          areaHa: 1,
          iaRatio: 0.2,
          prf: 484,
          tcFactor: 1,
          lagToOutletH: 0,
          reference: { cn: 75, tcH: 1 },
          measureAreas: [
            {
              id: 'area-1',
              areaHa: 1,
              patches: [{ id: 'patch-1', areaHa: 1, cn: 75 }],
              flowPath: [],
              lagToParentH: 0,
              measures: [],
            },
          ],
        },
      ],
    };
    const params = defaultParams('landUseChange', {
      landUse: 'Wald',
      soilGroup: 'B',
      cn: 60,
    });
    const measure = landUseMeasure({
      ...params,
      targetSubcatchmentId: 'sub-1',
      targetMeasureAreaId: 'area-1',
    });
    const evaluable = buildEvaluableCatchment(
      catchment,
      [measure],
      [],
      'sub-1',
      new Map([[measure.id, { areaHa: 0.1, lengthM: 0, volumeM3: 0, excavationM3: 0 }]]),
    );

    const converted = evaluable.subcatchments[0]?.measureAreas[0]?.measures[0];
    expect(converted).toMatchObject({
      kind: 'landUseChange',
      patchId: 'patch-1',
      areaUsedHa: 0.1,
    });
    expect(Math.abs(((converted as { cn?: number }).cn ?? 0) - 82.08)).toBeLessThanOrEqual(0.05);
  });
});
