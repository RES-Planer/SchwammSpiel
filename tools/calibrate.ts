import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeHydrograph, evaluateScenario, type Catchment } from '../packages/engine/src/index.ts';

type CalibrationSeed = {
  id: string;
  areaHa: number;
  cn: number;
  cnStatus: 'thesis' | 'estimated-from-B7';
  iaRatio: number;
  prf: number;
  targetQMaxM3s: number;
  lagFixedToZero: boolean;
};

type CalibrationSeeds = {
  rainEvent: {
    id: string;
    name: string;
    pMm: number;
    durationH: number;
    rainShape: 'mittenbetont' | 'block';
  };
  mqLsKm2: number;
  targetCatchmentQMaxM3s: number;
  subcatchments: CalibrationSeed[];
  expectedTcHAfterCalibration: Record<string, number>;
};

type RawCalibrationSeed = {
  id: string;
  area_ha: number;
  cn: number;
  cn_status: 'thesis' | 'estimated-from-B7';
  ia_ratio: number;
  prf: number;
  target_q_max_m3s: number;
  lag_fixed_to_zero?: boolean;
};

type RawCalibrationSeeds = {
  rain_event: {
    id: string;
    name: string;
    p_mm: number;
    duration_h: number;
    rain_shape: 'mittenbetont' | 'block';
  };
  mq_l_s_km2: number;
  target_catchment_q_max_m3s: number;
  subcatchments: RawCalibrationSeed[];
  expected_tc_h_after_calibration: Record<string, number>;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedsPath = resolve(root, 'data/goldbach_seeds.json');
const outputPath = resolve(root, 'data/goldbach/catchment.json');
const EXPECTED_TC_TOLERANCE_FRACTION = 0.1;

function roundToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(2));
}

function readSeeds(): CalibrationSeeds {
  const raw = JSON.parse(readFileSync(seedsPath, 'utf8')) as RawCalibrationSeeds;
  return {
    rainEvent: {
      id: raw.rain_event.id,
      name: raw.rain_event.name,
      pMm: raw.rain_event.p_mm,
      durationH: raw.rain_event.duration_h,
      rainShape: raw.rain_event.rain_shape,
    },
    mqLsKm2: raw.mq_l_s_km2,
    targetCatchmentQMaxM3s: raw.target_catchment_q_max_m3s,
    subcatchments: raw.subcatchments.map((seed) => ({
      id: seed.id,
      areaHa: seed.area_ha,
      cn: seed.cn,
      cnStatus: seed.cn_status,
      iaRatio: seed.ia_ratio,
      prf: seed.prf,
      targetQMaxM3s: seed.target_q_max_m3s,
      lagFixedToZero: seed.lag_fixed_to_zero ?? false,
    })),
    expectedTcHAfterCalibration: raw.expected_tc_h_after_calibration,
  };
}

function calibrateTcH(
  seed: CalibrationSeed,
  rainEvent: CalibrationSeeds['rainEvent'],
  mqLsKm2: number,
): number {
  const qAt = (tcH: number) =>
    computeHydrograph({
      areaHa: seed.areaHa,
      cn: seed.cn,
      tcH,
      pMm: rainEvent.pMm,
      durationH: rainEvent.durationH,
      iaRatio: seed.iaRatio,
      prf: seed.prf,
      rainShape: rainEvent.rainShape,
      mqLsKm2,
    }).qMaxM3s;

  let lo = 0.2;
  let hi = 30;
  const qLo = qAt(lo);
  const qHi = qAt(hi);

  if (qLo < seed.targetQMaxM3s || qHi > seed.targetQMaxM3s) {
    throw new Error(`Could not bracket tcH in [0.2, 30] for ${seed.id}`);
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (qAt(mid) > seed.targetQMaxM3s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return hi;
}

function buildCatchment(
  seeds: CalibrationSeeds,
  tcById: Map<string, number>,
  lagH: number,
  roundLag: boolean,
): Catchment {
  return {
    id: 'goldbach',
    name: 'Goldbach bei Ebnath',
    mqLsKm2: seeds.mqLsKm2,
    rainEvents: [
      {
        id: seeds.rainEvent.id,
        name: seeds.rainEvent.name,
        pMm: seeds.rainEvent.pMm,
        durationH: seeds.rainEvent.durationH,
        rainShape: seeds.rainEvent.rainShape,
      },
    ],
    subcatchments: seeds.subcatchments.map((seed) => {
      const tcH = tcById.get(seed.id);
      if (tcH === undefined) {
        throw new Error(`Missing calibrated tcH for ${seed.id}`);
      }

      const lagToOutletH = seed.lagFixedToZero ? 0 : lagH;
      const lagValue = roundLag ? roundToStep(lagToOutletH, 0.05) : lagToOutletH;

      return {
        id: seed.id,
        areaHa: seed.areaHa,
        iaRatio: seed.iaRatio,
        prf: seed.prf,
        tcFactor: 1,
        lagToOutletH: lagValue,
        reference: {
          cn: seed.cn,
          tcH,
          cn_status: seed.cnStatus,
          ...(seed.cnStatus === 'estimated-from-B7'
            ? { cn_warning: 'CN estimated-from-B7' }
            : {}),
        },
        measureAreas: [
          {
            id: `${seed.id}-a`,
            areaHa: seed.areaHa,
            patches: [
              {
                id: `${seed.id}-patch`,
                areaHa: seed.areaHa,
                cn: seed.cn,
              },
            ],
            flowPath: [
              {
                type: 'pipe' as const,
                lengthM: tcH * 3600,
                slope: 1,
                k: 1,
                rHydM: 1,
              },
            ],
            lagToParentH: 0,
            measures: [],
          },
        ],
      };
    }),
  };
}

function calibrateLagH(seeds: CalibrationSeeds, tcById: Map<string, number>): number {
  const qAt = (lagH: number) => {
    const result = evaluateScenario(buildCatchment(seeds, tcById, lagH, false), seeds.rainEvent.id, false);
    return result.qMaxBeforeM3s;
  };

  let lo = 0;
  let hi = 3;
  const qLo = qAt(lo);
  const qHi = qAt(hi);

  if (qLo < seeds.targetCatchmentQMaxM3s || qHi > seeds.targetCatchmentQMaxM3s) {
    throw new Error('Could not bracket common lag in [0, 3]');
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (qAt(mid) > seeds.targetCatchmentQMaxM3s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return hi;
}

function assertExpectedTcRange(seeds: CalibrationSeeds, tcById: Map<string, number>): void {
  for (const [id, expectedTcH] of Object.entries(seeds.expectedTcHAfterCalibration)) {
    const calibrated = tcById.get(id);
    if (calibrated === undefined) {
      throw new Error(`Missing calibrated tcH for expected entry ${id}`);
    }
    const relativeDeviation = Math.abs(calibrated - expectedTcH) / expectedTcH;
    if (relativeDeviation > EXPECTED_TC_TOLERANCE_FRACTION) {
      throw new Error(
        `tcH for ${id} out of expected ±10% range (got ${calibrated.toFixed(3)}, expected ${expectedTcH})`,
      );
    }
  }
}

const seeds = readSeeds();
const tcById = new Map(
  seeds.subcatchments.map((seed) => [seed.id, calibrateTcH(seed, seeds.rainEvent, seeds.mqLsKm2)]),
);

for (const seed of seeds.subcatchments) {
  if (seed.cnStatus === 'estimated-from-B7') {
    console.warn(`WARN: ${seed.id} uses cn_status=estimated-from-B7`);
  }
}

assertExpectedTcRange(seeds, tcById);
const lagH = calibrateLagH(seeds, tcById);
const catchment = buildCatchment(seeds, tcById, lagH, true);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(catchment, null, 2)}\n`, 'utf8');

const result = evaluateScenario(catchment, seeds.rainEvent.id, false);
console.log(
  JSON.stringify(
    {
      outputPath,
      catchmentQMaxM3s: result.qMaxBeforeM3s,
      lagH,
      subcatchments: catchment.subcatchments.map((subcatchment) => ({
        id: subcatchment.id,
        tcH: 'tcH' in subcatchment.reference ? subcatchment.reference.tcH : null,
        lagToOutletH: subcatchment.lagToOutletH,
        cn_status: 'cn_status' in subcatchment.reference ? subcatchment.reference.cn_status : null,
      })),
    },
    null,
    2,
  ),
);
