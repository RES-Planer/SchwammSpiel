import { hydrologyTables, type SoilGroup } from '../hydrologyTables';

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export type RetentionMode = 'physical' | 'thesis_triangle';
export type RetentionInfiltrationMode = 'off' | 'on';

export type RetentionElement = {
  id: string;
  volumeM3: number;
  areaShare: number;
  delayH: number;
  infAreaM2?: number;
  soilGroup?: SoilGroup;
};

export type RetentionElementResult = {
  id: string;
  retainedM3: number;
  infiltratedM3: number;
  tFullH: number | null;
  warnings: RetentionWarningCode[];
};

export type RetentionWarningCode = 'missing-infiltration-data';

export type RetentionResult = {
  qM3s: number[];
  tPeakH: number;
  elements: RetentionElementResult[];
};

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number >= 0`);
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
  const loValue = lo >= 0 && lo < series.length ? series[lo] ?? 0 : 0;
  const hiValue = hi >= 0 && hi < series.length ? series[hi] ?? 0 : 0;
  return loValue + (hiValue - loValue) * frac;
}

function meanKfMs(soilGroup: SoilGroup | undefined): {
  kfMs: number;
  warning?: RetentionWarningCode;
} {
  if (soilGroup === undefined) {
    return { kfMs: 0 };
  }
  if (soilGroup === 'A') {
    return { kfMs: 0, warning: 'missing-infiltration-data' };
  }
  const table = hydrologyTables.soil_infiltration_by_group[soilGroup];
  const [kfLo, kfHi] = table.kf_m_s;
  return { kfMs: (kfLo + kfHi) / 2 };
}

function applyPhysicalRetention(
  qM3s: number[],
  dtH: number,
  baseFlowM3s: number,
  elements: RetentionElement[],
  infiltration: RetentionInfiltrationMode,
): RetentionResult {
  const dtS = dtH * 3600;
  const elementResults: RetentionElementResult[] = [];
  let qCurrentM3s = [...qM3s];

  for (const element of elements) {
    assertFiniteNonNegative(`elements.${element.id}.volumeM3`, element.volumeM3);
    assertFiniteNonNegative(`elements.${element.id}.areaShare`, element.areaShare);
    assertFiniteNonNegative(`elements.${element.id}.delayH`, element.delayH);
    if (element.areaShare > 1) {
      throw new Error(`elements.${element.id}.areaShare must be <= 1`);
    }

    const infAreaM2 = element.infAreaM2 ?? 0;
    assertFiniteNonNegative(`elements.${element.id}.infAreaM2`, infAreaM2);

    const kf = infiltration === 'on' ? meanKfMs(element.soilGroup) : { kfMs: 0 };
    const kfMs = kf.kfMs;
    const qInfM3s = kfMs * infAreaM2;

    let storedM3 = 0;
    let retainedM3 = 0;
    let infiltratedM3 = 0;
    let tFullH: number | null = null;
    const retainedRates: number[] = [];

    for (let i = 0; i < qCurrentM3s.length; i += 1) {
      const tH = i * dtH;
      const shiftedQ = interpolateAt(qCurrentM3s, dtH, tH + element.delayH);
      const qInElementM3s = Math.max(0, element.areaShare * (shiftedQ - baseFlowM3s));
      const inflowM3 = qInElementM3s * dtS;

      const availableM3 = storedM3 + inflowM3;
      const infiltratedStepM3 = Math.min(availableM3, qInfM3s * dtS);
      const afterInfiltrationM3 = availableM3 - infiltratedStepM3;
      const spillM3 = Math.max(0, afterInfiltrationM3 - element.volumeM3);

      storedM3 = Math.max(0, afterInfiltrationM3 - spillM3);
      const retainedStepM3 = Math.max(0, inflowM3 - spillM3);

      if (tFullH === null && storedM3 >= element.volumeM3 - 1e-9) {
        tFullH = (i + 1) * dtH;
      }

      retainedM3 += retainedStepM3;
      infiltratedM3 += infiltratedStepM3;
      retainedRates.push(retainedStepM3 / dtS);
    }

    qCurrentM3s = qCurrentM3s.map((q, i) => {
      const tH = i * dtH;
      const reduction = interpolateAt(retainedRates, dtH, tH - element.delayH);
      return Math.max(0, q - reduction);
    });

    elementResults.push({
      id: element.id,
      retainedM3,
      infiltratedM3,
      tFullH,
      warnings: kf.warning ? [kf.warning] : [],
    });
  }

  let qPeak = qCurrentM3s[0] ?? 0;
  let peakIndex = 0;
  for (let i = 1; i < qCurrentM3s.length; i += 1) {
    if ((qCurrentM3s[i] ?? 0) > qPeak) {
      qPeak = qCurrentM3s[i] ?? 0;
      peakIndex = i;
    }
  }

  return {
    qM3s: qCurrentM3s,
    tPeakH: peakIndex * dtH,
    elements: elementResults,
  };
}

export function applyRetentionElements(
  qM3s: number[],
  dtH: number,
  baseFlowM3s: number,
  elements: RetentionElement[],
  options: {
    mode: RetentionMode;
    infiltration?: RetentionInfiltrationMode;
  },
): RetentionResult {
  if (!Number.isFinite(dtH) || dtH <= 0) {
    throw new Error('dtH must be a finite number > 0');
  }
  assertFiniteNonNegative('baseFlowM3s', baseFlowM3s);
  const totalAreaShare = elements.reduce((sum, element) => sum + element.areaShare, 0);
  if (totalAreaShare > 1 + 1e-9) {
    throw new Error('sum of elements.areaShare must be <= 1');
  }

  if (options.mode === 'thesis_triangle') {
    throw new NotImplementedError('mode thesis_triangle is not implemented yet (TODO(SPEC))');
  }

  const infiltration = options.infiltration ?? 'off';
  return applyPhysicalRetention(qM3s, dtH, baseFlowM3s, elements, infiltration);
}
