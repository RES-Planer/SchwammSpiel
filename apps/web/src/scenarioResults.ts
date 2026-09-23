import type { Catchment, ScenarioEvaluationResult, ScenarioHydrograph, ScenarioRainEvent } from '@schwammspiel/engine';

import type { MeasureState } from './scenarioState';

export const OUTLET_PROTECTION_POINT_ID = '__outlet__';

export type UnitCosts = {
  currency: string;
  excavationPerM3Eur: number;
  areaUsePerM2Eur: number;
  forestMulchPerItemEur: number;
  stonefieldPerM2Eur: number;
  flowPathChangePerM2Eur: number;
  note: string;
};

export type ProtectionPointOption = {
  id: string;
  label: string;
};

export type RainChartSeries = {
  timeH: number[];
  intensityMmH: number[];
};

export type CostEstimate = {
  totalEur: number;
  excavationEur: number;
  areaUseEur: number;
  extrasEur: number;
};

export type SubcatchmentPolygon = {
  id: string;
  coordinates: [number, number][];
};

export type MeasureSummaryLike = {
  areaHa: number;
  lengthM: number;
  volumeM3: number;
  excavationM3: number;
};

const RAIN_SHAPE_MITTENBETONT: Array<[number, number]> = [
  [0, 0],
  [0.3, 0.2],
  [0.5, 0.7],
  [1, 1],
];

export const SPEC_SECTION_11_LINES = [
  'Keine Pegelvalidierung → Ergebnisse sind Szenarienvergleiche, keine Prognosen. CN-Verfahren stark vereinfacht.',
  'Speicherbemessung ist Vorentwurf, keine Ausführungsplanung.',
  'Dezentrale Wirkung v. a. bis etwa HQ20.',
] as const;

function interpolateCumulativeFraction(points: Array<[number, number]>, timeFraction: number): number {
  const clamped = Math.max(0, Math.min(1, timeFraction));
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end) {
      continue;
    }
    if (clamped > end[0]) {
      continue;
    }
    const span = end[0] - start[0];
    if (span <= 0) {
      return end[1];
    }
    const ratio = (clamped - start[0]) / span;
    return start[1] + (end[1] - start[1]) * ratio;
  }
  return 1;
}

export function buildRainChartSeries(rainEvent: ScenarioRainEvent, dtH: number): RainChartSeries {
  const safeDtH = Number.isFinite(dtH) && dtH > 0 ? dtH : Math.max(rainEvent.durationH / 24, 0.1);
  const stepCount = Math.max(1, Math.ceil(rainEvent.durationH / safeDtH));
  const cumulativeShape: Array<[number, number]> =
    rainEvent.rainShape === 'block'
      ? [
          [0, 0],
          [1, 1],
        ]
      : RAIN_SHAPE_MITTENBETONT;

  const timeH: number[] = [];
  const intensityMmH: number[] = [];
  let previousFraction = 0;

  for (let index = 0; index <= stepCount; index += 1) {
    const endFraction = Math.min(1, ((index + 1) * safeDtH) / rainEvent.durationH);
    const cumulativeFraction = interpolateCumulativeFraction(cumulativeShape, endFraction);
    const deltaFraction = Math.max(0, cumulativeFraction - previousFraction);
    previousFraction = cumulativeFraction;
    timeH.push(index * safeDtH);
    intensityMmH.push((deltaFraction * rainEvent.pMm) / safeDtH);
  }

  return { timeH, intensityMmH };
}

export function getProtectionPointOptions(catchment: Catchment): ProtectionPointOption[] {
  return [
    { id: OUTLET_PROTECTION_POINT_ID, label: 'Gebietsauslass' },
    ...catchment.subcatchments.map((subcatchment) => ({
      id: subcatchment.id,
      label: subcatchment.id,
    })),
  ];
}

export function getHydrographsForProtectionPoint(
  result: ScenarioEvaluationResult,
  protectionPointId: string,
): { before: ScenarioHydrograph; after: ScenarioHydrograph } {
  if (protectionPointId === OUTLET_PROTECTION_POINT_ID) {
    return {
      before: result.before,
      after: result.after,
    };
  }
  const subcatchment = result.subcatchments.find((entry) => entry.id === protectionPointId);
  if (!subcatchment) {
    return {
      before: result.before,
      after: result.after,
    };
  }
  return {
    before: subcatchment.before,
    after: subcatchment.after,
  };
}

export function getPeakReductionPct(result: ScenarioEvaluationResult, protectionPointId: string): number {
  const { before, after } = getHydrographsForProtectionPoint(result, protectionPointId);
  if (before.qMaxM3s <= 0) {
    return 0;
  }
  return ((before.qMaxM3s - after.qMaxM3s) / before.qMaxM3s) * 100;
}

export function getPeakDelayH(result: ScenarioEvaluationResult, protectionPointId: string): number {
  const { before, after } = getHydrographsForProtectionPoint(result, protectionPointId);
  return after.tPeakH - before.tPeakH;
}

export function getStarRating(peakReductionPct: number): number {
  if (peakReductionPct >= 25) {
    return 3;
  }
  if (peakReductionPct >= 15) {
    return 2;
  }
  if (peakReductionPct >= 5) {
    return 1;
  }
  return 0;
}

export function estimateScenarioCost(
  measures: MeasureState[],
  summaries: Map<string, MeasureSummaryLike>,
  unitCosts: UnitCosts,
): CostEstimate {
  let excavationM3 = 0;
  let areaHa = 0;
  let extrasEur = 0;

  for (const measure of measures) {
    if (!measure.enabled) {
      continue;
    }
    const summary = summaries.get(measure.id);
    if (!summary) {
      continue;
    }
    excavationM3 += summary.excavationM3;
    areaHa += summary.areaHa;

    if (measure.kind === 'forestMulches') {
      const count = Number(measure.params.count ?? 0);
      extrasEur += Math.max(0, count) * unitCosts.forestMulchPerItemEur;
    }
    if (measure.kind === 'stonefield') {
      extrasEur += summary.areaHa * 1e4 * unitCosts.stonefieldPerM2Eur;
    }
    if (measure.kind === 'flowPathChange') {
      extrasEur += summary.areaHa * 1e4 * unitCosts.flowPathChangePerM2Eur;
    }
  }

  const excavationEur = excavationM3 * unitCosts.excavationPerM3Eur;
  const areaUseEur = areaHa * 1e4 * unitCosts.areaUsePerM2Eur;

  return {
    totalEur: excavationEur + areaUseEur + extrasEur,
    excavationEur,
    areaUseEur,
    extrasEur,
  };
}

function geometryAnchorPoint(measure: MeasureState): [number, number] | null {
  if (!measure.geometry) {
    return null;
  }
  if (measure.geometry.type === 'Polygon') {
    const sum = measure.geometry.coordinates.reduce(
      (acc, coordinate) => [acc[0] + coordinate[0], acc[1] + coordinate[1]] as [number, number],
      [0, 0] as [number, number],
    );
    return [sum[0] / measure.geometry.coordinates.length, sum[1] / measure.geometry.coordinates.length];
  }
  const middle = measure.geometry.coordinates[Math.floor(measure.geometry.coordinates.length / 2)];
  return middle ?? null;
}

export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (!current || !previous) {
      continue;
    }
    const intersects =
      current[1] > point[1] !== previous[1] > point[1] &&
      point[0] < ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) + current[0];
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function findMeasureSubcatchmentId(
  measure: MeasureState,
  subcatchmentPolygons: SubcatchmentPolygon[],
  fallbackSubcatchmentId: string,
): string {
  const explicitTarget = measure.params.targetSubcatchmentId;
  if (typeof explicitTarget === 'string' && explicitTarget.length > 0) {
    return explicitTarget;
  }
  const anchor = geometryAnchorPoint(measure);
  if (anchor) {
    const polygon = subcatchmentPolygons.find((entry) => pointInPolygon(anchor, entry.coordinates));
    if (polygon) {
      return polygon.id;
    }
  }
  return fallbackSubcatchmentId;
}

export function estimateFillTimeH(
  hydrograph: ScenarioHydrograph,
  storageVolumeM3: number,
  areaShare: number,
): number | null {
  if (storageVolumeM3 <= 0 || areaShare <= 0) {
    return null;
  }
  let storedM3 = 0;
  const dtS = hydrograph.dtH * 3600;
  for (let index = 0; index < hydrograph.qM3s.length; index += 1) {
    storedM3 += Math.max(0, hydrograph.qM3s[index] ?? 0) * dtS * areaShare;
    if (storedM3 >= storageVolumeM3) {
      return (index + 1) * hydrograph.dtH;
    }
  }
  return null;
}
