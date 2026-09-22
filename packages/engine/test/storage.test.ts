import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  routeStorage,
  sizeStorageForTarget,
  type Outlet,
  type StorageShape,
} from '../src/storage';

type FixtureStorage = {
  form: 'Fläche' | 'Mulde';
  pipe_length_m: number;
  pipe_dn_mm: number;
  base_area_m2?: number;
  length_m?: number;
  width_m?: number;
  h_max_m: number;
  v_max_m3: number;
};

type Case = {
  id: string;
  expected: { q_out_max_m3s: number; h_reached_m: number };
  storage?: FixtureStorage;
  overflow_case?: boolean;
  consistent: boolean;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturesPath = resolve(root, 'fixtures/thesis_b8_cases.json');
const cases = JSON.parse(readFileSync(fixturesPath, 'utf8')).cases as Case[];
const hydroByCase = JSON.parse(
  readFileSync(resolve(root, 'fixtures/storage_hydrographs.json'), 'utf8'),
) as Record<string, { q: number[]; dD_h: number }>;

function mapStorage(s: FixtureStorage): { shape: StorageShape; outlet: Outlet } {
  const outlet: Outlet = {
    type: 'pipe',
    lengthM: s.pipe_length_m,
    dnMm: s.pipe_dn_mm,
  };

  if (s.form === 'Fläche') {
    return {
      shape: {
        form: 'prism',
        baseAreaM2: s.base_area_m2!,
        hMaxM: s.h_max_m,
      },
      outlet,
    };
  }

  return {
    shape: {
      form: 'hollow',
      lengthM: s.length_m!,
      widthM: s.width_m!,
      hMaxM: s.h_max_m,
    },
    outlet,
  };
}

describe('routeStorage fixture tolerance', () => {
  const fixtureCases = cases.filter(
    (c) => c.consistent && c.storage && c.overflow_case === false,
  );

  test.each(fixtureCases)('$id matches q_out_max and h_reached tolerances', (c) => {
    const hydro = hydroByCase[c.id];
    if (!hydro) {
      throw new Error(`missing hydrograph fixture for ${c.id}`);
    }

    const mapped = mapStorage(c.storage!);
    const result = routeStorage(hydro.q, hydro.dD_h, mapped.shape, mapped.outlet);

    expect(result.qOutMaxM3s).toBeGreaterThan(0);

    const qRel = Math.abs(result.qOutMaxM3s / c.expected.q_out_max_m3s - 1);
    const hRel = Math.abs(result.hReachedM / c.expected.h_reached_m - 1);

    expect(qRel).toBeLessThanOrEqual(0.04);
    expect(hRel).toBeLessThanOrEqual(0.07);
  });
});

describe('routeStorage overflow mass balance', () => {
  test('overflow happens when fixture storage volume is halved', () => {
    const baseCase = cases.find(
      (c) => c.id === 'T20_D18h_1abc_CN_mSp' && c.storage && c.overflow_case === false,
    );
    if (!baseCase || !baseCase.storage) {
      throw new Error('required fixture case not found');
    }

    const hydro = hydroByCase[baseCase.id];
    if (!hydro) {
      throw new Error(`missing hydrograph fixture for ${baseCase.id}`);
    }

    const mapped = mapStorage(baseCase.storage);

    const halvedShape: StorageShape =
      mapped.shape.form === 'prism'
        ? {
            form: 'prism',
            baseAreaM2: mapped.shape.baseAreaM2 / 2,
            hMaxM: mapped.shape.hMaxM,
          }
        : {
            form: 'hollow',
            lengthM: mapped.shape.lengthM,
            widthM: mapped.shape.widthM / 2,
            hMaxM: mapped.shape.hMaxM,
          };

    const result = routeStorage(hydro.q, hydro.dD_h, halvedShape, mapped.outlet);

    expect(result.spillM3).toBeGreaterThan(0);
  });

  test('mass balance closes in a halved-volume overflow setup', () => {
    const dtH = 1 / 3600;
    const dtS = 1;
    const qIn = [1, 1, 0];
    const result = routeStorage(
      qIn,
      dtH,
      { form: 'prism', baseAreaM2: 0.5, hMaxM: 1 },
      { type: 'constant', qM3s: 0 },
    );

    const sumInM3 = qIn.reduce((acc, q) => acc + q * dtS, 0);
    const sumOutM3 = result.qOutM3s.reduce((acc, q) => acc + q * dtS, 0);
    const finalStoredM3Expected = 0.5;
    const balanceError = Math.abs(sumInM3 - sumOutM3 - finalStoredM3Expected);

    expect(result.spillM3).toBeCloseTo(1.5, 12);
    expect(balanceError).toBeLessThanOrEqual(1e-12);
  });
});

describe('sizeStorageForTarget', () => {
  test('considers outlet cap for constant outlets', () => {
    const qIn = [0.2, 0.2, 0.2];
    const v = sizeStorageForTarget(qIn, 1 / 3600, { type: 'constant', qM3s: 0.1 }, 1, 0.2);
    expect(v).toBeGreaterThan(0);
  });

  test('throws for infeasible target with constant outlet', () => {
    expect(() =>
      sizeStorageForTarget([0.2, 0.05], 1 / 3600, { type: 'constant', qM3s: 0.15 }, 1, 0.1),
    ).toThrow(/Infeasible target/);
  });
});
