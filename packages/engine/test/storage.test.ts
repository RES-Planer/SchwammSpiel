import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  ASSUMPTION_A3,
  ASSUMPTION_A4,
  assumptions,
  computeHydrograph,
  type HydrographInput,
  routeStorage,
  sizeStorageForTarget,
  type Outlet,
  type StorageShape,
} from '../src/index';

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
  area_ha: number;
  cn: number;
  tc_h: number;
  p_mm: number;
  duration_h: number;
  ia_ratio: number;
  prf: number;
  rain_shape: HydrographInput['rainShape'];
  mq_l_s_km2: number;
  expected: { q_out_max_m3s: number; h_reached_m: number };
  storage?: FixtureStorage;
  overflow_case?: boolean;
  consistent: boolean;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturesPath = resolve(root, 'fixtures/thesis_b8_cases.json');
const cases = JSON.parse(readFileSync(fixturesPath, 'utf8')).cases as Case[];

function toHydrographInput(c: Case): HydrographInput {
  return {
    areaHa: c.area_ha,
    cn: c.cn,
    tcH: c.tc_h,
    pMm: c.p_mm,
    durationH: c.duration_h,
    iaRatio: c.ia_ratio,
    prf: c.prf,
    rainShape: c.rain_shape,
    mqLsKm2: c.mq_l_s_km2,
  };
}

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
    const hydro = computeHydrograph(toHydrographInput(c));
    const mapped = mapStorage(c.storage!);
    const result = routeStorage(hydro.qM3s, hydro.dtH, mapped.shape, mapped.outlet);

    expect(result.qOutMaxM3s).toBeGreaterThan(0);

    const qRel = Math.abs(result.qOutMaxM3s / c.expected.q_out_max_m3s - 1);
    const hRel = Math.abs(result.hReachedM / c.expected.h_reached_m - 1);

    expect(qRel).toBeLessThanOrEqual(0.04);
    expect(hRel).toBeLessThanOrEqual(0.07);
  });
});

describe('routeStorage overflow mass balance', () => {
  test('overflow happens with halved fixture volume and mass balance closes to 0.1%', () => {
    const baseCase = cases.find(
      (c) => c.id === 'T20_D18h_1abc_CN_mSp' && c.storage && c.overflow_case === false,
    );
    if (!baseCase || !baseCase.storage) {
      throw new Error('required fixture case not found');
    }

    const hydro = computeHydrograph(toHydrographInput(baseCase));
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

    const result = routeStorage(hydro.qM3s, hydro.dtH, halvedShape, mapped.outlet);

    expect(result.spillM3).toBeGreaterThan(0);

    const dtS = hydro.dtH * 3600;
    const inflowM3 = hydro.qM3s.reduce((acc, q) => acc + q * dtS, 0);
    const totalOutM3 = result.qOutM3s.reduce((acc, q) => acc + q * dtS, 0);
    const outletOutM3 = totalOutM3 - result.spillM3;
    const finalStoredM3 = inflowM3 - outletOutM3 - result.spillM3;
    const balanceRelError =
      Math.abs(inflowM3 - (outletOutM3 + result.spillM3 + finalStoredM3)) / inflowM3;

    expect(finalStoredM3).toBeGreaterThanOrEqual(-1e-9);
    expect(finalStoredM3).toBeLessThanOrEqual(baseCase.storage.v_max_m3 / 2 + 1e-6);
    expect(balanceRelError).toBeLessThanOrEqual(0.001);
  });
});

describe('sizeStorageForTarget', () => {
  test('considers outlet cap for constant outlets', () => {
    const qIn = [0.2, 0.2, 0.2];
    const dtH = 1 / 3600;
    const target = 0.2;
    const outlet: Outlet = { type: 'constant', qM3s: 0.1 };
    const v = sizeStorageForTarget(qIn, dtH, outlet, 1, target);
    expect(v).toBeGreaterThan(0);

    const routed = routeStorage(
      qIn,
      dtH,
      { form: 'prism', baseAreaM2: v / 1, hMaxM: 1 },
      outlet,
    );
    expect(routed.spillM3).toBeLessThanOrEqual(1e-9);
    expect(routed.qOutMaxM3s).toBeLessThanOrEqual(target + 1e-9);
  });

  test('throws for infeasible target with constant outlet', () => {
    expect(() =>
      sizeStorageForTarget([0.2, 0.05], 1 / 3600, { type: 'constant', qM3s: 0.15 }, 1, 0.1),
    ).toThrow(/Infeasible target/);
  });

  test('sizes T20_D18h_1abc_CN_mSp into expected volume range', () => {
    const c = cases.find((x) => x.id === 'T20_D18h_1abc_CN_mSp');
    if (!c) {
      throw new Error('required fixture case not found');
    }

    const hydro = computeHydrograph(toHydrographInput(c));
    const vM3 = sizeStorageForTarget(
      hydro.qM3s,
      hydro.dtH,
      { type: 'pipe', lengthM: 5, dnMm: 250 },
      1.6,
      0.153,
    );

    expect(vM3).toBeGreaterThanOrEqual(1400);
    expect(vM3).toBeLessThanOrEqual(1700);

    const routed = routeStorage(
      hydro.qM3s,
      hydro.dtH,
      { form: 'prism', baseAreaM2: vM3 / 1.6, hMaxM: 1.6 },
      { type: 'pipe', lengthM: 5, dnMm: 250 },
    );
    expect(routed.spillM3).toBeLessThanOrEqual(1e-9);
    expect(routed.qOutMaxM3s).toBeLessThanOrEqual(0.153 + 1e-9);
  });
});

describe('assumptions exports', () => {
  test('includes A3 and A4 and exports both via index', () => {
    expect(ASSUMPTION_A3.id).toBe('A3');
    expect(ASSUMPTION_A4.id).toBe('A4');
    expect(assumptions.map((a) => a.id)).toContain('A3');
    expect(assumptions.map((a) => a.id)).toContain('A4');
  });
});
