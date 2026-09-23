import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeHydrograph, evaluateScenario, type Catchment } from '../packages/engine/src/index.ts';

type CalibrationSeed = {
  id: string;
  areaHa: number;
  cn: number;
  targetQMaxM3s: number;
  todo?: string;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'data/goldbach/catchment.json');

const mqLsKm2 = 15.53;
const rainEvent = {
  id: 'hq20-18h',
  name: 'HQ20 18h',
  pMm: 69.9,
  durationH: 18,
  rainShape: 'mittenbetont' as const,
};

const subcatchmentSeeds: CalibrationSeed[] = [
  { id: 'tgb-1', areaHa: 85, cn: 78, targetQMaxM3s: 0.91 },
  { id: 'tgb-2', areaHa: 80, cn: 80, targetQMaxM3s: 0.93 },
  { id: 'tgb-3', areaHa: 88, cn: 73, targetQMaxM3s: 0.64, todo: 'TODO(DATA): placeholder CN 73.0' },
  { id: 'tgb-4', areaHa: 84, cn: 74, targetQMaxM3s: 0.5, todo: 'TODO(DATA): placeholder CN 74.0' },
  { id: 'tgb-5', areaHa: 83, cn: 76, targetQMaxM3s: 0.42 },
  { id: 'tgb-6', areaHa: 90, cn: 82, targetQMaxM3s: 1.12 },
  { id: 'tgb-7', areaHa: 77, cn: 75, targetQMaxM3s: 0.22, todo: 'TODO(DATA): placeholder CN 75.0' },
];

const lagPattern = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5];
const targetCatchmentQMaxM3s = 4.46;

function calibrateTcH(seed: CalibrationSeed): number {
  const qAt = (tcH: number) =>
    computeHydrograph({
      areaHa: seed.areaHa,
      cn: seed.cn,
      tcH,
      pMm: rainEvent.pMm,
      durationH: rainEvent.durationH,
      iaRatio: 0.165,
      prf: 484,
      rainShape: rainEvent.rainShape,
      mqLsKm2,
    }).qMaxM3s;

  let lo = 0.05;
  let hi = 0.1;
  while (qAt(hi) > seed.targetQMaxM3s) {
    hi *= 2;
    if (hi > 48) {
      throw new Error(`Could not bracket tcH for ${seed.id}`);
    }
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

function buildCatchment(tcHs: number[], tcScale: number): Catchment {
  return {
    id: 'goldbach',
    name: 'Goldbach bei Ebnath',
    mqLsKm2,
    rainEvents: [rainEvent],
    subcatchments: subcatchmentSeeds.map((seed, index) => {
      const tcH = (tcHs[index] ?? 1) * tcScale;
      return {
        id: seed.id,
        areaHa: seed.areaHa,
        iaRatio: 0.165,
        prf: 484,
        tcFactor: 1,
        lagToOutletH: lagPattern[index]!,
        reference: {
          cn: seed.cn,
          tcH,
          ...(seed.todo ? { todo: seed.todo } : {}),
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

function calibrateTcScale(tcHs: number[]): number {
  const qAtScale = (tcScale: number) => {
    const result = evaluateScenario(buildCatchment(tcHs, tcScale), rainEvent.id, false);
    return result.qMaxBeforeM3s;
  };

  let lo = 0.1;
  let hi = 1;
  while (qAtScale(lo) < targetCatchmentQMaxM3s) {
    lo /= 2;
    if (lo < 1e-6) {
      throw new Error('Could not bracket tc scale for Goldbach calibration');
    }
  }
  while (qAtScale(hi) > targetCatchmentQMaxM3s) {
    hi *= 2;
    if (hi > 48) {
      throw new Error('Could not bracket tc scale for Goldbach calibration');
    }
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (qAtScale(mid) > targetCatchmentQMaxM3s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return hi;
}

const tcHs = subcatchmentSeeds.map(calibrateTcH);
const tcScale = calibrateTcScale(tcHs);
const catchment = buildCatchment(tcHs, tcScale);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(catchment, null, 2)}\n`, 'utf8');

const result = evaluateScenario(catchment, rainEvent.id, false);
console.log(
  JSON.stringify(
    {
      outputPath,
      catchmentQMaxM3s: result.qMaxBeforeM3s,
      tcScale,
      subcatchments: catchment.subcatchments.map((subcatchment) => ({
        id: subcatchment.id,
        tcH: 'tcH' in subcatchment.reference ? subcatchment.reference.tcH : null,
        lagToOutletH: subcatchment.lagToOutletH,
      })),
    },
    null,
    2,
  ),
);
