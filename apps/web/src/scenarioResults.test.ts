import { describe, expect, test } from 'vitest';

import type { ScenarioEvaluationResult } from '@schwammspiel/engine';

import {
  OUTLET_PROTECTION_POINT_ID,
  buildRainChartSeries,
  estimateFillTimeH,
  estimateScenarioCost,
  findMeasureSubcatchmentId,
  getPeakDelayH,
  getPeakReductionPct,
  getStarRating,
  pointInPolygon,
  type UnitCosts,
} from './scenarioResults';
import type { MeasureState } from './scenarioState';

const unitCosts: UnitCosts = {
  currency: 'EUR',
  excavationPerM3Eur: 24,
  areaUsePerM2Eur: 1.8,
  forestMulchPerItemEur: 180,
  stonefieldPerM2Eur: 32,
  flowPathChangePerM2Eur: 4,
  note: 'TODO(DATA)',
};

const result: ScenarioEvaluationResult = {
  rainEventId: 'hq20-18h',
  before: { dtH: 1, qM3s: [0, 2, 4, 2, 0], qMaxM3s: 4, tPeakH: 2, volumeM3: 28800 },
  after: { dtH: 1, qM3s: [0, 1, 3, 2, 0], qMaxM3s: 3, tPeakH: 2, volumeM3: 21600 },
  qMaxBeforeM3s: 4,
  qMaxAfterM3s: 3,
  deltaPct: -25,
  peakDelayH: 0,
  volumeBeforeM3: 28800,
  volumeAfterM3: 21600,
  retainedVolumeM3: 7200,
  areaUsedHa: 0.5,
  excavationM3: 120,
  warnings: [],
  subcatchments: [
    {
      id: 'tgb-1',
      lagToOutletH: 0,
      reference: { dtH: 1, qM3s: [0, 1, 2, 1, 0], qMaxM3s: 2, tPeakH: 2, volumeM3: 14400 },
      before: { dtH: 1, qM3s: [0, 1, 2, 1, 0], qMaxM3s: 2, tPeakH: 2, volumeM3: 14400 },
      after: { dtH: 1, qM3s: [0, 1, 1.5, 1, 0], qMaxM3s: 1.5, tPeakH: 2, volumeM3: 12600 },
      measureAreas: [],
      retainedVolumeM3: 1800,
      areaUsedHa: 0.2,
      excavationM3: 60,
      warnings: [],
    },
  ],
};

describe('scenario result helpers', () => {
  test('builds mittenbetont rain bars that preserve the event depth', () => {
    const series = buildRainChartSeries(
      {
        id: 'hq20-4h',
        name: '20-jährlich, 4 h',
        pMm: 40,
        durationH: 4,
        rainShape: 'mittenbetont',
      },
      1,
    );

    const totalMm = series.intensityMmH.reduce((sum, value) => sum + value, 0);
    expect(totalMm).toBeCloseTo(40, 8);
    expect(Math.max(...series.intensityMmH)).toBeGreaterThan(series.intensityMmH[0] ?? 0);
  });

  test('computes peak reduction and delay for outlet and subcatchments', () => {
    expect(getPeakReductionPct(result, OUTLET_PROTECTION_POINT_ID)).toBeCloseTo(25, 8);
    expect(getPeakReductionPct(result, 'tgb-1')).toBeCloseTo(25, 8);
    expect(getPeakDelayH(result, 'tgb-1')).toBe(0);
  });

  test('maps reduction thresholds to stars', () => {
    expect(getStarRating(4.9)).toBe(0);
    expect(getStarRating(5)).toBe(1);
    expect(getStarRating(15)).toBe(2);
    expect(getStarRating(25)).toBe(3);
  });

  test('estimates costs from enabled measures and summaries', () => {
    const measures: MeasureState[] = [
      {
        id: 'storage-1',
        kind: 'storageWithPipe',
        enabled: true,
        params: {},
        geometry: null,
      },
      {
        id: 'mulch-1',
        kind: 'forestMulches',
        enabled: true,
        params: { count: 2 },
        geometry: null,
      },
    ];
    const summaries = new Map([
      ['storage-1', { areaHa: 0.1, lengthM: 0, volumeM3: 80, excavationM3: 80 }],
      ['mulch-1', { areaHa: 0, lengthM: 0, volumeM3: 0, excavationM3: 0 }],
    ]);

    const estimate = estimateScenarioCost(measures, summaries, unitCosts);

    expect(estimate.excavationEur).toBeCloseTo(1920, 8);
    expect(estimate.areaUseEur).toBeCloseTo(1800, 8);
    expect(estimate.extrasEur).toBeCloseTo(360, 8);
    expect(estimate.totalEur).toBeCloseTo(4080, 8);
  });

  test('assigns measures to polygons by geometry anchor or fallback', () => {
    const polygon = [
      [11.9, 49.9],
      [12.0, 49.9],
      [12.0, 50.0],
      [11.9, 50.0],
      [11.9, 49.9],
    ] as [number, number][];
    const measure: MeasureState = {
      id: 'm-1',
      kind: 'stonefield',
      enabled: true,
      params: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [11.94, 49.94],
          [11.95, 49.94],
          [11.95, 49.95],
          [11.94, 49.95],
          [11.94, 49.94],
        ],
      },
    };

    expect(pointInPolygon([11.95, 49.95], polygon)).toBe(true);
    expect(
      findMeasureSubcatchmentId(measure, [{ id: 'tgb-1', coordinates: polygon }], 'fallback'),
    ).toBe('tgb-1');
  });

  test('estimates fill time from routed hydrographs', () => {
    expect(estimateFillTimeH(result.after, 7200, 0.5)).toBe(3);
    expect(estimateFillTimeH(result.after, 100000, 0.5)).toBeNull();
  });
});
