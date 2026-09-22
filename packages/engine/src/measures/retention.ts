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
};

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

function meanKfMs(soilGroup: SoilGroup | undefined): number {
  if (soilGroup === undefined) {
    return 0;
  }
  if (soilGroup === 'A') {
    return 0;
  }
  const table = hydrologyTables.soil_infiltration_by_group[soilGroup];
  const [kfLo, kfHi] = table.kf_m_s;
  return (kfLo + kfHi) / 2;
}

function applyPhysicalRetention(
  qM3s: number[],
  dtH: number,
  baseFlowM3s: number,
  elements: RetentionElement[],
  infiltration: RetentionInfiltrationMode,
): RetentionResult {
  const dtS = dtH * 3600;
  const retainedRatesPerElement: number[][] = [];
  const elementResults: RetentionElementResult[] = [];

  for (const element of elements) {
    assertFiniteNonNegative(`elements.${element.id}.volumeM3`, element.volumeM3);
    assertFiniteNonNegative(`elements.${element.id}.areaShare`, element.areaShare);
    assertFiniteNonNegative(`elements.${element.id}.delayH`, element.delayH);
    if (element.areaShare > 1) {
      throw new Error(`elements.${element.id}.areaShare must be <= 1`);
    }

    const infAreaM2 = element.infAreaM2 ?? 0;
    assertFiniteNonNegative(`elements.${element.id}.infAreaM2`, infAreaM2);

    const kfMs = infiltration === 'on' ? meanKfMs(element.soilGroup) : 0;
    const qInfM3s = kfMs * infAreaM2;

    let storedM3 = 0;
    let retainedM3 = 0;
    let infiltratedM3 = 0;
    let tFullH: number | null = null;
    const retainedRates: number[] = [];

    for (let i = 0; i < qM3s.length; i += 1) {
      const tH = i * dtH;
      const shiftedQ = interpolateAt(qM3s, dtH, tH + element.delayH);
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

    retainedRatesPerElement.push(retainedRates);
    elementResults.push({
      id: element.id,
      retainedM3,
      infiltratedM3,
      tFullH,
    });
  }

  const qNewM3s = qM3s.map((q, i) => {
    const tH = i * dtH;
    const reduction = retainedRatesPerElement.reduce((sum, retainedRates, index) => {
      const delayH = elements[index]?.delayH ?? 0;
      return sum + interpolateAt(retainedRates, dtH, tH - delayH);
    }, 0);
    return Math.max(0, q - reduction);
  });

  let qPeak = qNewM3s[0] ?? 0;
  let peakIndex = 0;
  for (let i = 1; i < qNewM3s.length; i += 1) {
    if ((qNewM3s[i] ?? 0) > qPeak) {
      qPeak = qNewM3s[i] ?? 0;
      peakIndex = i;
    }
  }

  return {
    qM3s: qNewM3s,
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

  if (options.mode === 'thesis_triangle') {
    throw new NotImplementedError('mode thesis_triangle is not implemented yet (TODO(SPEC))');
  }

  const infiltration = options.infiltration ?? 'off';
  return applyPhysicalRetention(qM3s, dtH, baseFlowM3s, elements, infiltration);
}
