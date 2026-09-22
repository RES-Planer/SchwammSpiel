import { hydrologyTables } from './hydrologyTables';

type KRange = { min: number; max: number };

export type FlowSegmentType = 'sheet' | 'rill' | 'hollow' | 'trapezoid' | 'pipe' | 'stonefield';

type BaseFlowSegment = {
  type: FlowSegmentType;
  lengthM: number;
  slope: number;
  k?: number;
  rHydM?: number;
};

export type NonTrapezoidFlowSegment = BaseFlowSegment & {
  type: Exclude<FlowSegmentType, 'trapezoid'>;
};

export type TrapezoidFlowSegment = BaseFlowSegment & {
  type: 'trapezoid';
  bottomWidthM: number;
  sideSlopeM: number;
  areaHa: number;
  qSpecificLsHa?: number;
  neffMm?: number;
  durationH?: number;
};

export type FlowSegment = NonTrapezoidFlowSegment | TrapezoidFlowSegment;

export type TravelTimeOptions = {
  tcFactor?: number;
  legacyRounding?: boolean;
  qSpecificLsHa?: number;
  neffMm?: number;
  durationH?: number;
};

export type TravelTimeSegmentResult = {
  vMs: number;
  tMin: number;
  share: number;
};

export type TravelTimeResult = {
  tcH: number;
  perSegment: TravelTimeSegmentResult[];
};

function toRange(entry: unknown, path: string): KRange {
  if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
    return { min: entry, max: entry };
  }
  if (
    Array.isArray(entry) &&
    entry.length === 2 &&
    typeof entry[0] === 'number' &&
    typeof entry[1] === 'number' &&
    Number.isFinite(entry[0]) &&
    Number.isFinite(entry[1]) &&
    entry[0] > 0 &&
    entry[1] > 0
  ) {
    return { min: Math.min(entry[0], entry[1]), max: Math.max(entry[0], entry[1]) };
  }
  throw new Error(`Invalid k range at ${path}`);
}

function midpoint(range: KRange): number {
  return (range.min + range.max) / 2;
}

function aggregateRange(entries: unknown[], path: string): KRange {
  const ranges = entries.map((entry, i) => toRange(entry, `${path}[${i}]`));
  return {
    min: Math.min(...ranges.map((r) => r.min)),
    max: Math.max(...ranges.map((r) => r.max)),
  };
}

const concentrated = hydrologyTables.roughness_strickler_concentrated.values;
const sheetValues = Object.values(hydrologyTables.roughness_strickler_sheet_flow.values);
const MAX_TRAPEZOID_DEPTH_M = 100;
const TRAPEZOID_BISECTION_ITERATIONS = 80;
const PIPE_RADIUS_FALLBACK_M = hydrologyTables.hydraulic_radius_defaults_m.rills;
const STONEFIELD_RADIUS_FALLBACK_M = hydrologyTables.hydraulic_radius_defaults_m.sheet_flow;

/**
 * Table-derived Standardwerte für Fließwegsegmente nach SPEC Abschnitt 5.
 * Diese Zuordnung bildet Segmenttypen auf Tabellenwerte aus `hydrology_tables.json` ab.
 */
export const flowPathStandards = {
  hydraulicRadiusM: {
    sheet: hydrologyTables.hydraulic_radius_defaults_m.sheet_flow,
    rill: hydrologyTables.hydraulic_radius_defaults_m.rills,
    hollow: hydrologyTables.hydraulic_radius_defaults_m.swale_hollow,
  },
  hydraulicRadiusFallbackM: {
    // TODO(SPEC): eigene Tabellenwerte für pipe/stonefield ergänzen, sobald verfügbar.
    pipe: PIPE_RADIUS_FALLBACK_M,
    stonefield: STONEFIELD_RADIUS_FALLBACK_M,
  },
  missingHydraulicRadiusDefaults: ['pipe', 'stonefield'],
  kRange: {
    sheet: aggregateRange(sheetValues, 'roughness_strickler_sheet_flow.values'),
    rill: toRange(
      concentrated['Erosionsrinne Acker (kastenfoermig)'],
      'roughness_strickler_concentrated.values.Erosionsrinne Acker (kastenfoermig)',
    ),
    hollow: toRange(
      concentrated['Begruente Tiefenlinie (Grassed Waterway)'],
      'roughness_strickler_concentrated.values.Begruente Tiefenlinie (Grassed Waterway)',
    ),
    trapezoid: toRange(
      concentrated['Graben gleichfoermig, teils Bewuchs'],
      'roughness_strickler_concentrated.values.Graben gleichfoermig, teils Bewuchs',
    ),
    pipe: toRange(
      concentrated['PVC-Rohr'],
      'roughness_strickler_concentrated.values.PVC-Rohr',
    ),
    stonefield: toRange(
      concentrated['Grobe Steinschuettung ohne Bewuchs'],
      'roughness_strickler_concentrated.values.Grobe Steinschuettung ohne Bewuchs',
    ),
  },
} as const;

function defaultK(type: FlowSegmentType): number {
  if (type === 'trapezoid') {
    return midpoint(flowPathStandards.kRange.trapezoid);
  }
  return midpoint(flowPathStandards.kRange[type]);
}

function resolveHydraulicRadiusM(segment: NonTrapezoidFlowSegment): number {
  if (segment.rHydM !== undefined) {
    return segment.rHydM;
  }
  if (segment.type === 'sheet') {
    return flowPathStandards.hydraulicRadiusM.sheet;
  }
  if (segment.type === 'rill') {
    return flowPathStandards.hydraulicRadiusM.rill;
  }
  if (segment.type === 'hollow') {
    return flowPathStandards.hydraulicRadiusM.hollow;
  }
  if (segment.type === 'pipe') {
    return flowPathStandards.hydraulicRadiusFallbackM.pipe;
  }
  return flowPathStandards.hydraulicRadiusFallbackM.stonefield;
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number > 0`);
  }
}

function resolveQSpecificLsHa(segment: TrapezoidFlowSegment, options: TravelTimeOptions): number {
  if (segment.qSpecificLsHa !== undefined) {
    return segment.qSpecificLsHa;
  }
  if (options.qSpecificLsHa !== undefined) {
    return options.qSpecificLsHa;
  }

  const neffMm = segment.neffMm ?? options.neffMm;
  const durationH = segment.durationH ?? options.durationH;
  if (neffMm === undefined || durationH === undefined) {
    throw new Error(
      'trapezoid segment requires qSpecificLsHa or both neffMm and durationH (segment or options)',
    );
  }

  assertPositive('neffMm', neffMm);
  assertPositive('durationH', durationH);
  return (neffMm / durationH) * (10 / 3.6);
}

function trapezoidVelocityMs(segment: TrapezoidFlowSegment, options: TravelTimeOptions): number {
  const k = segment.k ?? defaultK('trapezoid');
  assertPositive('segment.k', k);
  assertPositive('segment.bottomWidthM', segment.bottomWidthM);
  assertPositive('segment.sideSlopeM', segment.sideSlopeM);
  assertPositive('segment.areaHa', segment.areaHa);
  assertPositive('segment.slope', segment.slope);

  const qSpecificLsHa = resolveQSpecificLsHa(segment, options);
  assertPositive('qSpecificLsHa', qSpecificLsHa);
  const qM3s = (qSpecificLsHa * segment.areaHa) / 1000;

  const sideRoot = Math.sqrt(1 + segment.sideSlopeM * segment.sideSlopeM);
  const dischargeForDepth = (hM: number): number => {
    const areaM2 = (segment.bottomWidthM + segment.sideSlopeM * hM) * hM;
    const wettedPerimeterM = segment.bottomWidthM + 2 * hM * sideRoot;
    const hydraulicRadiusM = areaM2 / wettedPerimeterM;
    return k * areaM2 * hydraulicRadiusM ** (2 / 3) * Math.sqrt(segment.slope);
  };

  let lo = 0;
  let hi = 1;
  while (dischargeForDepth(hi) < qM3s) {
    hi *= 2;
    if (hi > MAX_TRAPEZOID_DEPTH_M) {
      throw new Error('Could not bracket trapezoid flow depth');
    }
  }

  for (let i = 0; i < TRAPEZOID_BISECTION_ITERATIONS; i += 1) {
    const mid = (lo + hi) / 2;
    if (dischargeForDepth(mid) < qM3s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const hM = (lo + hi) / 2;
  const areaM2 = (segment.bottomWidthM + segment.sideSlopeM * hM) * hM;
  return qM3s / areaM2;
}

function roundVelocityLegacy(vMs: number): number {
  return Math.max(0.01, Math.round(vMs * 100) / 100);
}

export function travelTime(segments: FlowSegment[], options: TravelTimeOptions = {}): TravelTimeResult {
  if (segments.length === 0) {
    return { tcH: 0, perSegment: [] };
  }
  const tcFactor = options.tcFactor ?? 1;
  assertPositive('tcFactor', tcFactor);

  const legacyRounding = options.legacyRounding ?? false;
  const perSegment = segments.map((segment) => {
    assertPositive('segment.lengthM', segment.lengthM);
    assertPositive('segment.slope', segment.slope);

    const vRawMs =
      segment.type === 'trapezoid'
        ? trapezoidVelocityMs(segment, options)
        : (segment.k ?? defaultK(segment.type)) *
          resolveHydraulicRadiusM(segment) ** (2 / 3) *
          Math.sqrt(segment.slope);

    assertPositive('segment velocity', vRawMs);
    const vMs = legacyRounding ? roundVelocityLegacy(vRawMs) : vRawMs;
    const tMin = segment.lengthM / vMs / 60;
    return { vMs, tMin, share: 0 };
  });

  const totalMin = perSegment.reduce((sum, segment) => sum + segment.tMin, 0);
  const perSegmentWithShare = perSegment.map((segment) => ({
    ...segment,
    share: totalMin > 0 ? segment.tMin / totalMin : 0,
  }));

  return {
    tcH: (tcFactor * totalMin) / 60,
    perSegment: perSegmentWithShare,
  };
}
