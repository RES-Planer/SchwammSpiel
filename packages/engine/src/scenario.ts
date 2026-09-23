import { aggregateCn } from './curveNumber';
import { type FlowSegment, travelTime } from './flowPath';
import { computeHydrograph, type HydrographResult, type RainShape } from './hydrograph';
import {
  applyRetentionElements,
  type RetentionElement,
  type RetentionInfiltrationMode,
  type RetentionMode,
} from './measures/retention';
import { analyzeStonefieldHydraulics, stonefieldGeometry } from './measures/stonefield';
import { applyToFlowPath, swaleGeometry, validateSwaleContourAlignment } from './measures/swale';
import { routeStorage, type Outlet, type StorageShape } from './storage';
import { STONEFIELD_POROSITY_DEFAULT } from './assumptions';
import type { SoilGroup } from './hydrologyTables';

export type ScenarioPatch = {
  id: string;
  areaHa: number;
  cn: number;
};

export type ScenarioRainEvent = {
  id: string;
  name?: string;
  pMm: number;
  durationH: number;
  rainShape: RainShape;
};

export type ScenarioCnReference = {
  cn: number;
  tcH: number;
  cn_status?: 'thesis' | 'estimated-from-B7';
  cn_warning?: string;
  todo?: string;
};

export type ScenarioCsvReference = {
  csv: string;
  todo?: string;
};

export type ScenarioReference = ScenarioCnReference | ScenarioCsvReference;

export type LandUseChangeMeasure = {
  kind: 'landUseChange';
  patchId: string;
  cn: number;
  areaUsedHa?: number;
};

export type StorageMeasure = {
  kind: 'storage';
  shape: StorageShape;
  outlet: Outlet;
  areaUsedHa?: number;
  excavationM3?: number;
};

export type RetentionGroupMeasure = {
  kind: 'retentionGroup';
  mode?: RetentionMode;
  infiltration?: RetentionInfiltrationMode;
  elements: RetentionElement[];
  areaUsedHa?: number;
  excavationM3?: number;
};

export type SwaleMeasure = {
  kind: 'swale';
  chainageM: number;
  landCoverK: number;
  lengthM: number;
  bottomWidthM?: number;
  depthM?: number;
  sideSlopeM?: number;
  areaShare: number;
  delayH?: number;
  infiltration?: RetentionInfiltrationMode;
  elevationProfileM?: number[];
  areaUsedHa?: number;
};

export type StonefieldMeasure = {
  kind: 'stonefield';
  chainageM: number;
  widthM: number;
  lengthFlowM: number;
  slope: number;
  areaShare: number;
  delayH?: number;
  infiltration?: RetentionInfiltrationMode;
  soilGroup?: SoilGroup;
  spacingM?: number;
  holeDiameterM?: number;
  holeDepthM?: number;
  porosity?: number;
  d50M?: number;
  kStone?: number;
  areaUsedHa?: number;
};

export type FlowPathChangeMeasure = {
  kind: 'flowPathChange';
  flowPath: FlowSegment[];
};

export type ScenarioMeasure =
  | LandUseChangeMeasure
  | StorageMeasure
  | RetentionGroupMeasure
  | SwaleMeasure
  | StonefieldMeasure
  | FlowPathChangeMeasure;

export type MeasureArea = {
  id: string;
  areaHa: number;
  patches: ScenarioPatch[];
  flowPath: FlowSegment[];
  lagToParentH: number;
  measures: ScenarioMeasure[];
};

export type Subcatchment = {
  id: string;
  areaHa: number;
  iaRatio: number;
  prf: number;
  tcFactor: number;
  lagToOutletH: number;
  reference: ScenarioReference;
  measureAreas: MeasureArea[];
};

export type Catchment = {
  id: string;
  name: string;
  mqLsKm2: number;
  rainEvents: ScenarioRainEvent[];
  subcatchments: Subcatchment[];
};

export type ScenarioWarning = {
  scope: string;
  code: string;
  message: string;
};

export type ScenarioHydrograph = {
  dtH: number;
  qM3s: number[];
  qMaxM3s: number;
  tPeakH: number;
  volumeM3: number;
};

export type MeasureAreaResult = {
  id: string;
  lagToParentH: number;
  before: ScenarioHydrograph;
  after: ScenarioHydrograph;
  retainedVolumeM3: number;
  areaUsedHa: number;
  excavationM3: number;
  warnings: ScenarioWarning[];
};

export type SubcatchmentResult = {
  id: string;
  lagToOutletH: number;
  reference: ScenarioHydrograph;
  before: ScenarioHydrograph;
  after: ScenarioHydrograph;
  measureAreas: MeasureAreaResult[];
  retainedVolumeM3: number;
  areaUsedHa: number;
  excavationM3: number;
  warnings: ScenarioWarning[];
};

export type ScenarioEvaluationResult = {
  rainEventId: string;
  before: ScenarioHydrograph;
  after: ScenarioHydrograph;
  qMaxBeforeM3s: number;
  qMaxAfterM3s: number;
  deltaPct: number;
  peakDelayH: number;
  volumeBeforeM3: number;
  volumeAfterM3: number;
  retainedVolumeM3: number;
  areaUsedHa: number;
  excavationM3: number;
  warnings: ScenarioWarning[];
  subcatchments: SubcatchmentResult[];
};

type MeasureAreaComputation = {
  before: ScenarioHydrograph;
  after: ScenarioHydrograph;
  retainedVolumeM3: number;
  areaUsedHa: number;
  excavationM3: number;
  warnings: ScenarioWarning[];
};

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number > 0`);
  }
}

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number >= 0`);
  }
}

function assertFraction(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number in [0, 1]`);
  }
}

function assertCurveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be a finite number in [0, 100]`);
  }
}

function interpolateAt(series: number[], dtH: number, tH: number): number {
  if (series.length === 0 || tH < 0) {
    return 0;
  }
  const index = tH / dtH;
  const lo = Math.floor(index);
  const hi = lo + 1;
  const frac = index - lo;
  const loValue = lo >= 0 && lo < series.length ? (series[lo] ?? 0) : 0;
  const hiValue = hi >= 0 && hi < series.length ? (series[hi] ?? 0) : 0;
  return loValue + (hiValue - loValue) * frac;
}

function translateSeries(
  series: number[],
  sourceDtH: number,
  lagH: number,
  targetDtH: number,
  targetLength: number,
): number[] {
  return Array.from({ length: targetLength }, (_, i) => {
    const tH = i * targetDtH;
    return interpolateAt(series, sourceDtH, tH - lagH);
  });
}

function qPeak(series: number[]): { qMaxM3s: number; tPeakH: number } {
  let qMaxM3s = series[0] ?? 0;
  let index = 0;
  for (let i = 1; i < series.length; i += 1) {
    if ((series[i] ?? 0) > qMaxM3s) {
      qMaxM3s = series[i] ?? 0;
      index = i;
    }
  }
  return { qMaxM3s, tPeakH: index };
}

function integrateSeries(series: number[], dtH: number): number {
  const dtS = dtH * 3600;
  return series.reduce((sum, q) => sum + q * dtS, 0);
}

function toScenarioHydrograph(dtH: number, qM3s: number[]): ScenarioHydrograph {
  const peak = qPeak(qM3s);
  return {
    dtH,
    qM3s,
    qMaxM3s: peak.qMaxM3s,
    tPeakH: peak.tPeakH * dtH,
    volumeM3: integrateSeries(qM3s, dtH),
  };
}

function hydrographFromResult(result: HydrographResult): ScenarioHydrograph {
  return toScenarioHydrograph(result.dtH, result.qM3s);
}

function parseCsvReference(csv: string): ScenarioHydrograph {
  const rows = csv
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const pairs = rows
    .map((line) => line.split(/[;,\t]/u).map((value) => value.trim()))
    .filter((parts) => parts.length >= 2)
    .map((parts) => [Number(parts[0]), Number(parts[1])] as const)
    .filter(([tH, qM3s]) => Number.isFinite(tH) && Number.isFinite(qM3s));

  if (pairs.length < 2) {
    throw new Error('reference.csv must contain at least two numeric rows');
  }

  const dtH = pairs[1]![0] - pairs[0]![0];
  assertPositive('reference.csv dtH', dtH);

  const qM3s = pairs.map(([, q]) => q);
  return toScenarioHydrograph(dtH, qM3s);
}

function resolveReference(
  catchment: Catchment,
  subcatchment: Subcatchment,
  rainEvent: ScenarioRainEvent,
): ScenarioHydrograph {
  if ('csv' in subcatchment.reference) {
    return parseCsvReference(subcatchment.reference.csv);
  }

  const result = computeHydrograph({
    areaHa: subcatchment.areaHa,
    cn: subcatchment.reference.cn,
    tcH: subcatchment.reference.tcH,
    pMm: rainEvent.pMm,
    durationH: rainEvent.durationH,
    iaRatio: subcatchment.iaRatio,
    prf: subcatchment.prf,
    rainShape: rainEvent.rainShape,
    mqLsKm2: catchment.mqLsKm2,
  });
  return hydrographFromResult(result);
}

function replaceFlowPathSection(
  segments: FlowSegment[],
  chainageM: number,
  replaceLengthM: number,
  replacement: FlowSegment,
): FlowSegment[] {
  if (!Number.isFinite(chainageM) || chainageM < 0) {
    throw new Error('chainageM must be a finite number >= 0');
  }
  assertPositive('replaceLengthM', replaceLengthM);

  const result: FlowSegment[] = [];
  let pathPosM = 0;
  let inserted = false;

  for (const segment of segments) {
    const segStartM = pathPosM;
    const segEndM = pathPosM + segment.lengthM;
    const replaceStartM = chainageM;
    const replaceEndM = chainageM + replaceLengthM;
    const overlapStartM = Math.max(segStartM, replaceStartM);
    const overlapEndM = Math.min(segEndM, replaceEndM);

    const beforeM = Math.max(0, overlapStartM - segStartM);
    const overlapM = Math.max(0, overlapEndM - overlapStartM);
    const afterM = Math.max(0, segEndM - overlapEndM);

    if (beforeM > 0) {
      result.push({ ...segment, lengthM: beforeM });
    }
    if (overlapM > 0 && !inserted) {
      result.push({ ...replacement, lengthM: replaceLengthM });
      inserted = true;
    }
    if (afterM > 0) {
      result.push({ ...segment, lengthM: afterM });
    }

    pathPosM = segEndM;
  }

  return inserted ? result : [...segments, replacement];
}

function measureAreaInput(
  catchment: Catchment,
  subcatchment: Subcatchment,
  measureArea: MeasureArea,
  rainEvent: ScenarioRainEvent,
  enabled: boolean,
): MeasureAreaComputation {
  const warnings: ScenarioWarning[] = [];
  let retainedVolumeM3 = 0;
  let areaUsedHa = 0;
  let excavationM3 = 0;

  const patches = measureArea.patches.map((patch) => ({ ...patch }));
  let flowPath = measureArea.flowPath.map((segment) => ({ ...segment }));
  const routingMeasures: Exclude<
    ScenarioMeasure,
    LandUseChangeMeasure | FlowPathChangeMeasure
  >[] = [];

  if (enabled) {
    for (const measure of measureArea.measures) {
      if (measure.kind === 'landUseChange') {
        const patch = patches.find((candidate) => candidate.id === measure.patchId);
        if (!patch) {
          throw new Error(`Unknown patch '${measure.patchId}' in measureArea '${measureArea.id}'`);
        }
        assertCurveNumber(`measureAreas.${measureArea.id}.measures.${measure.patchId}.cn`, measure.cn);
        patch.cn = measure.cn;
        areaUsedHa += measure.areaUsedHa ?? patch.areaHa;
        continue;
      }

      if (measure.kind === 'flowPathChange') {
        flowPath = measure.flowPath.map((segment) => ({ ...segment }));
        continue;
      }

      if (measure.kind === 'swale') {
        flowPath = applyToFlowPath(flowPath, measure.chainageM, measure.landCoverK);
      } else if (measure.kind === 'stonefield') {
        flowPath = replaceFlowPathSection(flowPath, measure.chainageM, measure.lengthFlowM, {
          type: 'stonefield',
          lengthM: measure.lengthFlowM,
          slope: measure.slope,
          k: measure.kStone,
        });
      }

      routingMeasures.push(measure);
    }
  }

  const totalPatchAreaHa = patches.reduce((sum, patch) => sum + patch.areaHa, 0);
  assertPositive(`measureAreas.${measureArea.id}.areaHa`, measureArea.areaHa);
  if (Math.abs(totalPatchAreaHa - measureArea.areaHa) > 1e-6) {
    throw new Error(
      `measureArea '${measureArea.id}' patch areas (${totalPatchAreaHa}) must sum to areaHa (${measureArea.areaHa})`,
    );
  }

  const aggregation = aggregateCn(
    patches.map((patch) => ({ areaHa: patch.areaHa, cn: patch.cn })),
    'runoff_weighted',
    { iaRatio: subcatchment.iaRatio },
  );

  if (aggregation.mode !== 'runoff_weighted') {
    throw new Error('Expected runoff_weighted aggregation');
  }

  const tcH = travelTime(flowPath, { tcFactor: subcatchment.tcFactor }).tcH;
  const baselineHydrograph = computeHydrograph({
    areaHa: measureArea.areaHa,
    neffMm: aggregation.neffMm,
    tcH,
    pMm: rainEvent.pMm,
    durationH: rainEvent.durationH,
    iaRatio: subcatchment.iaRatio,
    prf: subcatchment.prf,
    rainShape: rainEvent.rainShape,
    mqLsKm2: catchment.mqLsKm2,
  });

  let currentQM3s = [...baselineHydrograph.qM3s];

  if (enabled) {
    for (const measure of routingMeasures) {
      if (measure.kind === 'storage') {
        const routed = routeStorage(currentQM3s, baselineHydrograph.dtH, measure.shape, measure.outlet);
        currentQM3s = routed.qOutM3s;
        retainedVolumeM3 += routed.vUsedM3;
        areaUsedHa += measure.areaUsedHa ?? 0;
        excavationM3 += measure.excavationM3 ?? 0;
        continue;
      }

      if (measure.kind === 'retentionGroup') {
        const retention = applyRetentionElements(
          currentQM3s,
          baselineHydrograph.dtH,
          baselineHydrograph.baseFlowM3s,
          measure.elements,
          {
            mode: measure.mode ?? 'physical',
            infiltration: measure.infiltration ?? 'off',
          },
        );
        currentQM3s = retention.qM3s;
        retainedVolumeM3 += retention.elements.reduce((sum, element) => sum + element.retainedM3, 0);
        areaUsedHa += measure.areaUsedHa ?? 0;
        excavationM3 += measure.excavationM3 ?? 0;
        for (const element of retention.elements) {
          for (const warningCode of element.warnings) {
            warnings.push({
              scope: `measureAreas.${measureArea.id}.retentionGroup.${element.id}`,
              code: warningCode,
              message: `Retention element '${element.id}' reported ${warningCode}`,
            });
          }
        }
        continue;
      }

      if (measure.kind === 'swale') {
        const geometry = swaleGeometry(measure);
        const contourWarnings = validateSwaleContourAlignment(measure.elevationProfileM ?? []);
        for (const warning of contourWarnings) {
          warnings.push({
            scope: `measureAreas.${measureArea.id}.swale`,
            code: warning.code,
            message: 'Swale line is not contour-parallel and may act as a ditch',
          });
        }

        const retention = applyRetentionElements(
          currentQM3s,
          baselineHydrograph.dtH,
          baselineHydrograph.baseFlowM3s,
          [
            {
              id: `${measureArea.id}:swale`,
              volumeM3: geometry.vMaxM3,
              areaShare: measure.areaShare,
              delayH: measure.delayH ?? 0,
              infAreaM2: geometry.aInfM2,
            },
          ],
          {
            mode: 'physical',
            infiltration: measure.infiltration ?? 'off',
          },
        );
        currentQM3s = retention.qM3s;
        retainedVolumeM3 += retention.elements.reduce((sum, element) => sum + element.retainedM3, 0);
        areaUsedHa +=
          measure.areaUsedHa ??
          (geometry.lengthM * (geometry.bottomWidthM + 2 * geometry.sideSlopeM * geometry.depthM)) / 1e4;
        excavationM3 += geometry.excavationM3;
        continue;
      }

      if (measure.kind === 'stonefield') {
        const geometry = stonefieldGeometry(measure);
        const hydraulics = analyzeStonefieldHydraulics({
          qInMaxM3s: Math.max(...currentQM3s),
          widthM: measure.widthM,
          slope: measure.slope,
          kStone: measure.kStone,
          d50M: measure.d50M,
        });

        for (const warning of [...geometry.warnings, ...hydraulics.warnings]) {
          warnings.push({
            scope: `measureAreas.${measureArea.id}.stonefield`,
            code: warning.code,
            message: `Stonefield reported ${warning.code}`,
          });
        }

        const retention = applyRetentionElements(
          currentQM3s,
          baselineHydrograph.dtH,
          baselineHydrograph.baseFlowM3s,
          [
            {
              id: `${measureArea.id}:stonefield`,
              volumeM3: geometry.porosityStorageM3,
              areaShare: measure.areaShare,
              delayH: measure.delayH ?? 0,
              infAreaM2: geometry.aInfM2,
              soilGroup: measure.soilGroup,
            },
          ],
          {
            mode: 'physical',
            infiltration: measure.infiltration ?? 'on',
          },
        );

        currentQM3s = retention.qM3s;
        retainedVolumeM3 += retention.elements.reduce((sum, element) => sum + element.retainedM3, 0);
        areaUsedHa += measure.areaUsedHa ?? (measure.widthM * measure.lengthFlowM) / 1e4;
        excavationM3 += geometry.porosityStorageM3 / (measure.porosity ?? STONEFIELD_POROSITY_DEFAULT.value);
      }
    }
  }

  return {
    before: hydrographFromResult(baselineHydrograph),
    after: toScenarioHydrograph(baselineHydrograph.dtH, currentQM3s),
    retainedVolumeM3,
    areaUsedHa,
    excavationM3,
    warnings,
  };
}

function sumTranslatedHydrographs(
  sources: { hydrograph: ScenarioHydrograph; lagH: number }[],
): ScenarioHydrograph {
  if (sources.length === 0) {
    return { dtH: 1, qM3s: [], qMaxM3s: 0, tPeakH: 0, volumeM3: 0 };
  }

  const dtH = Math.min(...sources.map((source) => source.hydrograph.dtH));
  const maxTimeH = Math.max(
    ...sources.map(
      (source) => source.lagH + Math.max(0, source.hydrograph.qM3s.length - 1) * source.hydrograph.dtH,
    ),
  );
  const length = Math.ceil(maxTimeH / dtH) + 1;
  const qM3s = Array.from({ length }, () => 0);

  for (const source of sources) {
    const shifted = translateSeries(source.hydrograph.qM3s, source.hydrograph.dtH, source.lagH, dtH, length);
    for (let i = 0; i < length; i += 1) {
      qM3s[i] += shifted[i] ?? 0;
    }
  }

  return toScenarioHydrograph(dtH, qM3s);
}

export function evaluateScenario(
  catchment: Catchment,
  rainEventId: string,
  measuresOn: boolean,
): ScenarioEvaluationResult {
  const rainEvent = catchment.rainEvents.find((event) => event.id === rainEventId);
  if (!rainEvent) {
    throw new Error(`Unknown rainEventId '${rainEventId}'`);
  }

  const warnings: ScenarioWarning[] = [];
  const subcatchments = catchment.subcatchments.map((subcatchment) => {
    assertPositive(`subcatchments.${subcatchment.id}.areaHa`, subcatchment.areaHa);
    assertFraction(`subcatchments.${subcatchment.id}.iaRatio`, subcatchment.iaRatio);
    assertPositive(`subcatchments.${subcatchment.id}.prf`, subcatchment.prf);
    assertPositive(`subcatchments.${subcatchment.id}.tcFactor`, subcatchment.tcFactor);
    assertNonNegative(`subcatchments.${subcatchment.id}.lagToOutletH`, subcatchment.lagToOutletH);

    const measureAreaTotalHa = subcatchment.measureAreas.reduce((sum, area) => sum + area.areaHa, 0);
    if (measureAreaTotalHa - subcatchment.areaHa > 1e-6) {
      throw new Error(
        `Subcatchment '${subcatchment.id}' measureAreas (${measureAreaTotalHa}) exceed areaHa (${subcatchment.areaHa})`,
      );
    }

    const reference = resolveReference(catchment, subcatchment, rainEvent);
    const measureAreas = subcatchment.measureAreas.map((measureArea) => {
      const result = measureAreaInput(catchment, subcatchment, measureArea, rainEvent, measuresOn);
      return {
        id: measureArea.id,
        lagToParentH: measureArea.lagToParentH,
        ...result,
      };
    });

    const maxTimeH = Math.max(
      Math.max(0, reference.qM3s.length - 1) * reference.dtH,
      ...measureAreas.map((measureArea) =>
        measureArea.lagToParentH +
        Math.max(measureArea.before.qM3s.length - 1, measureArea.after.qM3s.length - 1) *
          Math.max(measureArea.before.dtH, measureArea.after.dtH),
      ),
    );
    const targetLength = Math.ceil(maxTimeH / reference.dtH) + 1;
    const paddedReference = Array.from(
      { length: targetLength },
      (_, i) => reference.qM3s[i] ?? 0,
    );
    let afterSeries = [...paddedReference];
    for (const measureArea of measureAreas) {
      const shiftedBefore = translateSeries(
        measureArea.before.qM3s,
        measureArea.before.dtH,
        measureArea.lagToParentH,
        reference.dtH,
        targetLength,
      );
      const shiftedAfter = translateSeries(
        measureArea.after.qM3s,
        measureArea.after.dtH,
        measureArea.lagToParentH,
        reference.dtH,
        targetLength,
      );
      afterSeries = afterSeries.map((qRef, i) =>
        Math.max(0, qRef - (shiftedBefore[i] ?? 0) + (shiftedAfter[i] ?? 0)),
      );
    }

    const retainedVolumeM3 = measureAreas.reduce((sum, area) => sum + area.retainedVolumeM3, 0);
    const areaUsedHa = measureAreas.reduce((sum, area) => sum + area.areaUsedHa, 0);
    const excavationM3 = measureAreas.reduce((sum, area) => sum + area.excavationM3, 0);
    const subWarnings = measureAreas.flatMap((area) => area.warnings);
    warnings.push(...subWarnings);

    return {
      id: subcatchment.id,
      lagToOutletH: subcatchment.lagToOutletH,
      reference: toScenarioHydrograph(reference.dtH, paddedReference),
      before: toScenarioHydrograph(reference.dtH, paddedReference),
      after: toScenarioHydrograph(reference.dtH, afterSeries),
      measureAreas,
      retainedVolumeM3,
      areaUsedHa,
      excavationM3,
      warnings: subWarnings,
    };
  });

  const before = sumTranslatedHydrographs(
    subcatchments.map((subcatchment) => ({
      hydrograph: subcatchment.before,
      lagH: subcatchment.lagToOutletH,
    })),
  );
  const after = sumTranslatedHydrographs(
    subcatchments.map((subcatchment) => ({
      hydrograph: subcatchment.after,
      lagH: subcatchment.lagToOutletH,
    })),
  );

  const retainedVolumeM3 = subcatchments.reduce((sum, subcatchment) => sum + subcatchment.retainedVolumeM3, 0);
  const areaUsedHa = subcatchments.reduce((sum, subcatchment) => sum + subcatchment.areaUsedHa, 0);
  const excavationM3 = subcatchments.reduce((sum, subcatchment) => sum + subcatchment.excavationM3, 0);
  const qMaxBeforeM3s = before.qMaxM3s;
  const qMaxAfterM3s = after.qMaxM3s;
  const deltaPct = qMaxBeforeM3s === 0 ? 0 : ((qMaxAfterM3s - qMaxBeforeM3s) / qMaxBeforeM3s) * 100;

  return {
    rainEventId,
    before,
    after,
    qMaxBeforeM3s,
    qMaxAfterM3s,
    deltaPct,
    peakDelayH: after.tPeakH - before.tPeakH,
    volumeBeforeM3: before.volumeM3,
    volumeAfterM3: after.volumeM3,
    retainedVolumeM3,
    areaUsedHa,
    excavationM3,
    warnings,
    subcatchments,
  };
}
