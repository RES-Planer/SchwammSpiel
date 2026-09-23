import {
  cnForPatch,
  FOREST_MULCH_DELAY_LOW_H,
  FOREST_MULCH_DELAY_MID_H,
  FOREST_MULCH_DELAY_TOP_H,
  FLOWPATH_CHANGE_SLOPE_DEFAULT,
  FLOWPATH_LOCATION_SHARE_DEFAULT,
  hydrologyTables,
  type Catchment,
  type CnForPatchResult,
  type CurveNumberLandUse,
  type FlowSegmentType,
  type Month,
  type ScenarioMeasure,
  type SoilGroup,
  type TillageDirection,
} from '@schwammspiel/engine';

import { findMeasureSubcatchmentId, type MeasureSummaryLike, type SubcatchmentPolygon } from './scenarioResults';
import type { MeasureState } from './scenarioState';

const monthByNumber: Record<string, Month> = {
  '1': 'Jan',
  '2': 'Feb',
  '3': 'Mar',
  '4': 'Apr',
  '5': 'May',
  '6': 'Jun',
  '7': 'Jul',
  '8': 'Aug',
  '9': 'Sep',
  '10': 'Oct',
  '11': 'Nov',
  '12': 'Dec',
};

const tillageByUiValue: Record<string, TillageDirection> = {
  downslope: 'downslope',
  'contour-parallel': 'contour_parallel',
  contour_parallel: 'contour_parallel',
  terraced: 'terraced',
};

const mulchAndTillageLandUses = new Set<string>([
  'Sommergetreide',
  'Wintergetreide',
  'Mais',
  'Zuckerrüben',
  'Kartoffeln',
  'Kleegras',
  'Grünland',
  'Reihenfrüchte (hohe Abflussneigung)',
  'Reihenfrüchte (niedrige Abflussneigung)',
  'Getreide (hohe Abflussneigung)',
  'Getreide (niedrige Abflussneigung)',
  'Kleegras/Luzerne (hohe Abflussneigung)',
  'Kleegras/Luzerne (niedrige Abflussneigung)',
  'Weide',
  'Wiese',
]);

export const TODO_DATA_FOREST_MULCH_DELAY_H = {
  top: FOREST_MULCH_DELAY_TOP_H.value,
  mid: FOREST_MULCH_DELAY_MID_H.value,
  low: FOREST_MULCH_DELAY_LOW_H.value,
} as const;

export const TODO_DATA_CHANGED_FLOWPATH_SLOPE = FLOWPATH_CHANGE_SLOPE_DEFAULT.value;
export const TODO_DATA_FLOWPATH_LOCATION_SHARE = FLOWPATH_LOCATION_SHARE_DEFAULT.value;

export type LandUseChangeEvaluation = {
  input: {
    landUse: CurveNumberLandUse;
    soilGroup: SoilGroup;
    month: Month | 'low-seasonality';
    mulchCoverFraction: number | undefined;
    tillage: TillageDirection;
  };
  result: CnForPatchResult;
  before: {
    cn: number;
    landUse?: string;
    soilGroup?: SoilGroup;
  } | null;
};

function readNumber(value: string | number | boolean | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readFlowSegmentType(value: string | number | boolean | undefined): Exclude<FlowSegmentType, 'trapezoid'> {
  switch (value) {
    case 'sheet':
    case 'rill':
    case 'hollow':
    case 'pipe':
    case 'stonefield':
      return value;
    default:
      return 'hollow';
  }
}

function parseElevationProfile(value: string | number | boolean | undefined): number[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}

function measureAreaShare(summaryAreaHa: number, targetAreaHa: number): number {
  return Math.min(0.95, Math.max(0.05, Math.max(summaryAreaHa, 0.1) / Math.max(targetAreaHa, 0.1)));
}

function readSoilGroup(value: string | number | boolean | undefined): SoilGroup {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D') {
    return value;
  }
  return 'C';
}

function readMonth(
  value: string | number | boolean | undefined,
  landUse: CurveNumberLandUse,
): Month | 'low-seasonality' {
  if (landUse in hydrologyTables.cn_low_seasonality_by_soil_group) {
    return 'low-seasonality';
  }

  if (typeof value === 'string') {
    if (value in monthByNumber) {
      return monthByNumber[value];
    }
    if (value in hydrologyTables.cn_monthly_soil_group_C.Mais) {
      return value as Month;
    }
  }
  return 'Mar';
}

export function supportsMulchAndTillage(landUse: string): boolean {
  return mulchAndTillageLandUses.has(landUse);
}

export function evaluateLandUseChange(measure: MeasureState): LandUseChangeEvaluation | null {
  const landUseRaw = String(measure.params.landUse ?? '');
  if (
    !(landUseRaw in hydrologyTables.cn_monthly_soil_group_C) &&
    !(landUseRaw in hydrologyTables.cn_low_seasonality_by_soil_group)
  ) {
    return null;
  }

  const landUse = landUseRaw as CurveNumberLandUse;
  const soilGroup = readSoilGroup(measure.params.soilGroup ?? measure.params.sourceSoilGroup);
  const month = readMonth(measure.params.month, landUse);
  const tillage = supportsMulchAndTillage(landUse)
    ? tillageByUiValue[String(measure.params.tillageDirection ?? 'downslope')] ?? 'downslope'
    : 'downslope';
  const mulchCoverFraction =
    supportsMulchAndTillage(landUse) && measure.params.mulchDirectSeed === 'yes'
      ? readNumber(measure.params.mulchCoverFraction, 0.3)
      : undefined;

  const result = cnForPatch({
    landUse,
    soilGroup,
    month,
    mulchCoverFraction,
    tillage,
  });

  const sourceCn = readNumber(measure.params.sourceCn, Number.NaN);
  const sourceSoilGroup = readSoilGroup(measure.params.sourceSoilGroup);
  const sourceLandUse = typeof measure.params.sourceLandUse === 'string' ? measure.params.sourceLandUse : undefined;

  return {
    input: {
      landUse,
      soilGroup,
      month,
      mulchCoverFraction,
      tillage,
    },
    result,
    before: Number.isFinite(sourceCn)
      ? {
          cn: sourceCn,
          landUse: sourceLandUse,
          soilGroup: sourceSoilGroup,
        }
      : null,
  };
}

function selectTargetMeasureAreaId(
  catchment: Catchment,
  targetSubcatchmentId: string,
  measure: MeasureState,
): string | null {
  const targetSubcatchment = catchment.subcatchments.find((entry) => entry.id === targetSubcatchmentId);
  if (!targetSubcatchment) {
    return null;
  }
  const explicitTarget = measure.params.targetMeasureAreaId;
  if (
    typeof explicitTarget === 'string' &&
    targetSubcatchment.measureAreas.some((measureArea) => measureArea.id === explicitTarget)
  ) {
    return explicitTarget;
  }
  return targetSubcatchment.measureAreas[0]?.id ?? null;
}

function toScenarioMeasure(
  catchment: Catchment,
  targetSubcatchmentId: string,
  targetMeasureAreaId: string,
  measure: MeasureState,
  summary: MeasureSummaryLike,
): ScenarioMeasure | null {
  const targetSubcatchment = catchment.subcatchments.find((entry) => entry.id === targetSubcatchmentId);
  const targetMeasureArea = targetSubcatchment?.measureAreas.find((entry) => entry.id === targetMeasureAreaId);
  const areaShare = targetSubcatchment ? measureAreaShare(summary.areaHa, targetSubcatchment.areaHa) : 0.15;
  const baseFlowPath = targetMeasureArea?.flowPath ?? [];
  const chainageM =
    baseFlowPath.reduce((sum, segment) => sum + segment.lengthM, 0) * TODO_DATA_FLOWPATH_LOCATION_SHARE;

  switch (measure.kind) {
    case 'landUseChange': {
      const patchId = targetMeasureArea?.patches[0]?.id;
      const cnEvaluation = evaluateLandUseChange(measure);
      if (!patchId || !cnEvaluation) {
        return null;
      }
      return {
        kind: 'landUseChange',
        patchId,
        cn: cnEvaluation.result.cn,
        areaUsedHa: Math.max(0.05, summary.areaHa),
      };
    }
    case 'storageWithPipe':
      return {
        kind: 'storage',
        shape:
          measure.params.form === 'hollow'
            ? {
                form: 'hollow',
                lengthM: Math.max(2, Math.sqrt(Math.max(summary.areaHa, 0.01) * 1e4)),
                widthM: Math.max(2, Math.sqrt(Math.max(summary.areaHa, 0.01) * 1e4)),
                hMaxM: readNumber(measure.params.depthM, 1.2),
              }
            : {
                form: 'prism',
                baseAreaM2: Math.max(20, Math.max(summary.areaHa, 0.01) * 1e4),
                hMaxM: readNumber(measure.params.depthM, 1.2),
              },
        outlet: {
          type: 'pipe',
          dnMm: readNumber(measure.params.pipeDnMm, 300),
          lengthM: readNumber(measure.params.pipeLengthM, 12),
        },
        areaUsedHa: Math.max(0.01, summary.areaHa),
        excavationM3: summary.excavationM3,
      };
    case 'forestMulches': {
      const count = Math.max(1, readNumber(measure.params.count, 3));
      const volumeEachM3 = Math.max(1, readNumber(measure.params.volumeEachM3, 8));
      const delayH =
        measure.params.location === 'top'
          ? TODO_DATA_FOREST_MULCH_DELAY_H.top
          : measure.params.location === 'low'
            ? TODO_DATA_FOREST_MULCH_DELAY_H.low
            : TODO_DATA_FOREST_MULCH_DELAY_H.mid;
      return {
        kind: 'retentionGroup',
        mode: 'physical',
        elements: Array.from({ length: count }, (_, index) => ({
          id: `${measure.id}-${index}`,
          volumeM3: volumeEachM3,
          areaShare: Math.min(0.9, 0.9 / count),
          delayH,
        })),
        areaUsedHa: Math.max(0, summary.areaHa),
        excavationM3: summary.excavationM3,
      };
    }
    case 'swale':
      return {
        kind: 'swale',
        chainageM,
        landCoverK: readNumber(measure.params.landCoverK, 12),
        lengthM: Math.max(10, summary.lengthM),
        bottomWidthM: readNumber(measure.params.bottomWidthM, 0.5),
        depthM: readNumber(measure.params.depthM, 0.5),
        sideSlopeM: readNumber(measure.params.sideSlopeM, 2),
        areaShare,
        elevationProfileM: parseElevationProfile(measure.params.elevationProfile),
        areaUsedHa: Math.max(0.01, summary.areaHa),
      };
    case 'stonefield': {
      const areaM2 = Math.max(25, Math.max(summary.areaHa, 0.01) * 1e4);
      const widthM = Math.sqrt(areaM2);
      return {
        kind: 'stonefield',
        chainageM,
        widthM,
        lengthFlowM: widthM,
        slope: readNumber(measure.params.slope, 0.03),
        areaShare,
        spacingM: readNumber(measure.params.spacingM, 2),
        holeDiameterM: readNumber(measure.params.holeDiameterM, 0.8),
        holeDepthM: readNumber(measure.params.holeDepthM, 1),
        porosity: readNumber(measure.params.porosity, 0.35),
        d50M: readNumber(measure.params.d50M, 0.08),
        kStone: readNumber(measure.params.kStone, 35),
        areaUsedHa: Math.max(0.01, summary.areaHa),
      };
    }
    case 'flowPathChange':
      return {
        kind: 'flowPathChange',
        flowPath: [
          {
            type: readFlowSegmentType(measure.params.segmentType),
            lengthM: Math.max(summary.lengthM, 20),
            slope: TODO_DATA_CHANGED_FLOWPATH_SLOPE,
            k: readNumber(measure.params.roughnessK, 25),
            rHydM: 0.1,
          },
        ],
      };
  }
}

export function buildEvaluableCatchment(
  catchment: Catchment,
  measures: MeasureState[],
  subcatchmentPolygons: SubcatchmentPolygon[],
  fallbackSubcatchmentId: string,
  measureSummaries: Map<string, MeasureSummaryLike>,
): Catchment {
  const measuresByAreaId = new Map<string, ScenarioMeasure[]>();

  for (const measure of measures) {
    if (!measure.enabled) {
      continue;
    }
    const targetSubcatchmentId = findMeasureSubcatchmentId(
      measure,
      subcatchmentPolygons,
      fallbackSubcatchmentId,
    );
    const summary = measureSummaries.get(measure.id);
    if (!summary) {
      continue;
    }
    const targetMeasureAreaId = selectTargetMeasureAreaId(catchment, targetSubcatchmentId, measure);
    if (!targetMeasureAreaId) {
      continue;
    }
    const converted = toScenarioMeasure(
      catchment,
      targetSubcatchmentId,
      targetMeasureAreaId,
      measure,
      summary,
    );
    if (!converted) {
      continue;
    }
    const bucket = measuresByAreaId.get(targetMeasureAreaId) ?? [];
    bucket.push(converted);
    measuresByAreaId.set(targetMeasureAreaId, bucket);
  }

  return {
    ...catchment,
    subcatchments: catchment.subcatchments.map((subcatchment) => ({
      ...subcatchment,
      measureAreas: subcatchment.measureAreas.map((measureArea) => ({
        ...measureArea,
        measures: [...measureArea.measures, ...(measuresByAreaId.get(measureArea.id) ?? [])],
      })),
    })),
  };
}

export function assumptionsForMeasure(measure: MeasureState): string[] {
  if (measure.kind === 'forestMulches') {
    return ['measure.assumption.todoData.forestMulchDelay'];
  }
  if (measure.kind === 'flowPathChange') {
    return ['measure.assumption.todoData.flowPathSlope'];
  }
  if (measure.kind === 'swale' || measure.kind === 'stonefield') {
    return ['measure.assumption.todoData.flowPathLocationShare'];
  }
  return [];
}
