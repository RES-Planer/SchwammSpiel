import {
  NRCS_DELTA_D_FROM_TC,
  NRCS_PRF_REFERENCE_RATIO,
  NRCS_TP_FROM_DELTA_D,
  NRCS_TP_FROM_TC,
  NRCS_UH_CUTOFF,
} from './assumptions';
import { cumulativeRainFraction, type RainShape } from './rain';
import { effectiveRainMm, initialAbstractionMm, storageMmFromCn } from './runoff';
import { gammaShape } from './unitHydrograph';

export type { RainShape } from './rain';

export type HydrographInput = {
  areaHa: number;
  cn: number;
  tcH: number;
  pMm: number;
  durationH: number;
  iaRatio: number;
  prf: number;
  rainShape: RainShape;
  mqLsKm2: number;
};

export type HydrographResult = HydrographInput & {
  qM3s: number[];
  dtH: number;
  tpH: number;
  neffMm: number;
  sMm: number;
  iaMm: number;
  baseFlowM3s: number;
  qMaxM3s: number;
  tPeakH: number;
};

export function computeHydrograph(input: HydrographInput): HydrographResult {
  const dtH = NRCS_DELTA_D_FROM_TC.value * input.tcH;
  const tpH = dtH * NRCS_TP_FROM_DELTA_D.value + NRCS_TP_FROM_TC.value * input.tcH;
  const n = Math.max(1, Math.round(input.durationH / dtH));

  const cumulativeEffectiveMm = Array.from({ length: n + 1 }, (_, i) => {
    const pCumMm = input.pMm * cumulativeRainFraction(i / n, input.rainShape);
    return effectiveRainMm(pCumMm, input.cn, input.iaRatio);
  });

  const effectiveIncrementMm = Array.from({ length: n }, (_, i) => {
    return cumulativeEffectiveMm[i + 1] - cumulativeEffectiveMm[i];
  });

  const areaM2 = input.areaHa * 1e4;
  const m = gammaShape(input.prf);
  const qpPerMm =
    areaM2 * 1e-3 / (tpH * 3600 * (NRCS_PRF_REFERENCE_RATIO.value / input.prf));

  const unitHydrographM3sPerMm: number[] = [0];
  for (let k = 1; ; k += 1) {
    const tau = (k * dtH) / tpH;
    const val = tau ** m * Math.exp(m * (1 - tau));
    unitHydrographM3sPerMm.push(qpPerMm * val);
    if (tau > 1 && val < NRCS_UH_CUTOFF.value) {
      break;
    }
  }

  const qDirectM3s = Array.from({ length: n + unitHydrographM3sPerMm.length }, () => 0);
  for (let i = 0; i < effectiveIncrementMm.length; i += 1) {
    const rMm = effectiveIncrementMm[i];
    if (rMm === 0) {
      continue;
    }
    for (let j = 0; j < unitHydrographM3sPerMm.length; j += 1) {
      qDirectM3s[i + j] += rMm * unitHydrographM3sPerMm[j];
    }
  }

  const baseFlowM3s = (input.mqLsKm2 * (input.areaHa / 100)) / 1000;
  const qM3s = qDirectM3s.map((q) => q + baseFlowM3s);
  const neffMm = cumulativeEffectiveMm[cumulativeEffectiveMm.length - 1] ?? 0;

  let qMaxM3s = qM3s[0] ?? 0;
  let iPeak = 0;
  for (let i = 1; i < qM3s.length; i += 1) {
    if (qM3s[i] > qMaxM3s) {
      qMaxM3s = qM3s[i];
      iPeak = i;
    }
  }

  return {
    ...input,
    qM3s,
    dtH,
    tpH,
    neffMm,
    sMm: storageMmFromCn(input.cn),
    iaMm: initialAbstractionMm(input.cn, input.iaRatio),
    baseFlowM3s,
    qMaxM3s,
    tPeakH: iPeak * dtH,
  };
}
