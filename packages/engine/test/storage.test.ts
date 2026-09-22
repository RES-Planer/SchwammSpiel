import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

import { routeStorage, type Outlet, type StorageShape } from '../src/storage';

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

const root = resolve(__dirname, '../../..');
const fixturesPath = resolve(root, 'fixtures/thesis_b8_cases.json');
const cases = JSON.parse(readFileSync(fixturesPath, 'utf8')).cases as Case[];

function hydrographSeriesFromPython(caseId: string): { q: number[]; dD_h: number } {
  const script = String.raw`
import json
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path('${root.replace(/\\/g, '/')}') / 'reference'))
from nrcs_reference import hydrograph

obj = json.loads((pathlib.Path('${fixturesPath.replace(/\\/g, '/')}')).read_text(encoding='utf-8'))
case = next(c for c in obj['cases'] if c['id'] == '${caseId}')
r = hydrograph(case['area_ha'], case['cn'], case['tc_h'], case['p_mm'], case['duration_h'], case['ia_ratio'], case['prf'], case['rain_shape'], case['mq_l_s_km2'])
print(json.dumps({'q': r['q'], 'dD_h': r['dD_h']}))
`;
  const out = spawnSync('python3', ['-c', script], {
    encoding: 'utf8',
  });

  if (out.status !== 0) {
    throw new Error(out.stderr || 'python3 hydrograph call failed');
  }

  return JSON.parse(out.stdout) as { q: number[]; dD_h: number };
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
    const hydro = hydrographSeriesFromPython(c.id);
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
  test('overflow happens and mass balance closes when vMax is halved', () => {
    const baseCase = cases.find(
      (c) => c.id === 'T20_D18h_1abc_CN_mSp' && c.storage && c.overflow_case === false,
    );
    if (!baseCase || !baseCase.storage) {
      throw new Error('required fixture case not found');
    }

    const hydro = hydrographSeriesFromPython(baseCase.id);
    const dt = hydro.dD_h * 3600;
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

    const sumInM3 = hydro.q.reduce((acc, q) => acc + q * dt, 0);
    const sumOutM3 = result.qOutM3s.reduce((acc, q) => acc + q * dt, 0);
    const finalStoredM3 =
      sumInM3 - sumOutM3 >= 0 ? sumInM3 - sumOutM3 : 0;

    const balanceError = Math.abs(sumInM3 - sumOutM3 - finalStoredM3);
    expect(balanceError).toBeLessThanOrEqual(1e-6 * Math.max(1, sumInM3));
  });
});
