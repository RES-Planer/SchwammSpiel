import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeHydrograph, evaluateScenario, type Catchment } from '../packages/engine/src/index.ts';

type CalibrationSeed = {
  id: string;
  area_ha: number;
  cn: number;
  cn_status: string;
  ia_ratio: number;
  prf: number;
  target_q_max_m3s: number;
  lag_fixed_to_zero?: boolean;
};

type CalibrationSeeds = {
  rain_event: {
    id: string;
    name: string;
    p_mm: number;
    duration_h: number;
    rain_shape: 'mittenbetont' | 'block';
  };
  mq_l_s_km2: number;
  target_catchment_q_max_m3s: number;
  subcatchments: CalibrationSeed[];
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
  return JSON.parse(readFileSync(seedsPath, 'utf8')) as CalibrationSeeds;
}

function calibrateTcH(
  seed: CalibrationSeed,
  rainEvent: CalibrationSeeds['rain_event'],
  mqLsKm2: number,
): number {
  const qAt = (tcH: number) =>
    computeHydrograph({
      areaHa: seed.area_ha,
      cn: seed.cn,
      tcH,
      pMm: rainEvent.p_mm,
      durationH: rainEvent.duration_h,
      iaRatio: seed.ia_ratio,
      prf: seed.prf,
      rainShape: rainEvent.rain_shape,
      mqLsKm2,
    }).qMaxM3s;

  let lo = 0.2;
  let hi = 30;
  const qLo = qAt(lo);
  const qHi = qAt(hi);

  if (qLo < seed.target_q_max_m3s || qHi > seed.target_q_max_m3s) {
    throw new Error(`Could not bracket tcH in [0.2, 30] for ${seed.id}`);
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (qAt(mid) > seed.target_q_max_m3s) {
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
    mqLsKm2: seeds.mq_l_s_km2,
    rainEvents: [
      {
        id: seeds.rain_event.id,
        name: seeds.rain_event.name,
        pMm: seeds.rain_event.p_mm,
        durationH: seeds.rain_event.duration_h,
        rainShape: seeds.rain_event.rain_shape,
      },
    ],
    subcatchments: seeds.subcatchments.map((seed) => {
      const tcH = tcById.get(seed.id);
      if (tcH === undefined) {
        throw new Error(`Missing calibrated tcH for ${seed.id}`);
      }

      const lagToOutletH = seed.lag_fixed_to_zero ? 0 : lagH;
      const lagValue = roundLag ? roundToStep(lagToOutletH, 0.05) : lagToOutletH;

      return {
        id: seed.id,
        areaHa: seed.area_ha,
        iaRatio: seed.ia_ratio,
        prf: seed.prf,
        tcFactor: 1,
        lagToOutletH: lagValue,
        reference: {
          cn: seed.cn,
          tcH,
          cn_status: seed.cn_status,
          ...(seed.cn_status === 'estimated-from-B7'
            ? { todo: 'WARN(DATA): CN estimated-from-B7' }
            : {}),
        },
        measureAreas: [
          {
            id: `${seed.id}-a`,
            areaHa: seed.area_ha,
            patches: [
              {
                id: `${seed.id}-patch`,
                areaHa: seed.area_ha,
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
    const result = evaluateScenario(buildCatchment(seeds, tcById, lagH, false), seeds.rain_event.id, false);
    return result.qMaxBeforeM3s;
  };

  let lo = 0;
  let hi = 3;
  const qLo = qAt(lo);
  const qHi = qAt(hi);

  if (qLo < seeds.target_catchment_q_max_m3s || qHi > seeds.target_catchment_q_max_m3s) {
    throw new Error('Could not bracket common lag in [0, 3]');
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (qAt(mid) > seeds.target_catchment_q_max_m3s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return hi;
}

function assertExpectedTcRange(seeds: CalibrationSeeds, tcById: Map<string, number>): void {
  for (const [id, expectedTcH] of Object.entries(seeds.expected_tc_h_after_calibration)) {
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
  seeds.subcatchments.map((seed) => [seed.id, calibrateTcH(seed, seeds.rain_event, seeds.mq_l_s_km2)]),
);

for (const seed of seeds.subcatchments) {
  if (seed.cn_status === 'estimated-from-B7') {
    console.warn(`WARN: ${seed.id} uses cn_status=estimated-from-B7`);
  }
}

assertExpectedTcRange(seeds, tcById);
const lagH = calibrateLagH(seeds, tcById);
const catchment = buildCatchment(seeds, tcById, lagH, true);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(catchment, null, 2)}\n`, 'utf8');

const result = evaluateScenario(catchment, seeds.rain_event.id, false);
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
