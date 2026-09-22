const G = 9.81;

export type StorageShape =
  | { form: 'prism'; baseAreaM2: number; hMaxM: number }
  | { form: 'hollow'; lengthM: number; widthM: number; hMaxM: number };

export type Outlet =
  | { type: 'pipe'; lengthM: number; dnMm: number }
  | { type: 'constant'; qM3s: number };

export type RouteStorageResult = {
  qOutM3s: number[];
  qOutMaxM3s: number;
  hReachedM: number;
  vUsedM3: number;
  spillM3: number;
  fillRatio: number;
  tFullH: number | null;
};

type ShapeState = {
  vMaxM3: number;
  levelFromVolume: (vM3: number) => number;
};

function shapeState(shape: StorageShape): ShapeState {
  if (shape.hMaxM <= 0) {
    throw new Error('hMaxM must be > 0');
  }
  if (shape.form === 'prism') {
    if (shape.baseAreaM2 <= 0) {
      throw new Error('baseAreaM2 must be > 0');
    }
    return {
      vMaxM3: shape.baseAreaM2 * shape.hMaxM,
      levelFromVolume: (vM3) => vM3 / shape.baseAreaM2,
    };
  }
  if (shape.lengthM <= 0 || shape.widthM <= 0) {
    throw new Error('lengthM and widthM must be > 0');
  }
  const vMaxM3 = (2 / 3) * shape.lengthM * shape.widthM * shape.hMaxM;
  return {
    vMaxM3,
    levelFromVolume: (vM3) => shape.hMaxM * (vM3 / vMaxM3) ** (2 / 3),
  };
}

export function pipeOutflow(hM: number, lengthM: number, dnMm: number): number {
  if (hM <= 0) {
    return 0;
  }
  const dM = dnMm / 1000;
  const areaM2 = (Math.PI * dM * dM) / 4;
  return areaM2 * Math.sqrt((2 * G * hM) / (2.5 + (0.02 * lengthM) / dM));
}

function outletFlow(outlet: Outlet, hM: number): number {
  if (outlet.type === 'constant') {
    return Math.max(0, outlet.qM3s);
  }
  return pipeOutflow(hM, outlet.lengthM, outlet.dnMm);
}

export function routeStorage(
  qInM3s: number[],
  dDH: number,
  shape: StorageShape,
  outlet: Outlet,
): RouteStorageResult {
  const { vMaxM3, levelFromVolume } = shapeState(shape);
  const dtS = dDH * 3600;
  if (dtS <= 0) {
    throw new Error('dDH must be > 0');
  }

  let vM3 = 0;
  let vUsedM3 = 0;
  let hReachedM = 0;
  let spillM3 = 0;
  let tFullH: number | null = null;

  const qOutM3s: number[] = [];

  for (let i = 0; i < qInM3s.length; i += 1) {
    const qIn = Math.max(0, qInM3s[i] ?? 0);
    const hM = levelFromVolume(vM3);
    const qRaw = outletFlow(outlet, hM);
    const qOutCore = Math.min(qRaw, qIn + vM3 / dtS);

    vM3 = Math.max(0, vM3 + (qIn - qOutCore) * dtS);

    let spillQ = 0;
    if (vM3 > vMaxM3) {
      spillQ = (vM3 - vMaxM3) / dtS;
      vM3 = vMaxM3;
      if (tFullH === null) {
        tFullH = (i + 1) * dDH;
      }
    } else if (vM3 >= vMaxM3 && tFullH === null) {
      tFullH = (i + 1) * dDH;
    }

    spillM3 += spillQ * dtS;
    qOutM3s.push(qOutCore + spillQ);

    vUsedM3 = Math.max(vUsedM3, vM3);
    hReachedM = Math.max(hReachedM, levelFromVolume(vM3));
  }

  return {
    qOutM3s,
    qOutMaxM3s: qOutM3s.length ? Math.max(...qOutM3s) : 0,
    hReachedM,
    vUsedM3,
    spillM3,
    fillRatio: vMaxM3 > 0 ? Math.min(1, vUsedM3 / vMaxM3) : 0,
    tFullH,
  };
}

export function sizeStorageForTarget(
  qInM3s: number[],
  dDH: number,
  outlet: Outlet,
  hMaxM: number,
  targetQOutM3s: number,
): number {
  if (dDH <= 0) {
    throw new Error('dDH must be > 0');
  }
  if (hMaxM <= 0) {
    throw new Error('hMaxM must be > 0');
  }
  if (targetQOutM3s <= 0) {
    throw new Error('targetQOutM3s must be > 0');
  }
  if (
    outlet.type === 'constant' &&
    outlet.qM3s > targetQOutM3s &&
    qInM3s.some((q) => q > targetQOutM3s)
  ) {
    throw new Error('Infeasible target: constant outlet exceeds targetQOutM3s');
  }
  const qZeroLimit = outlet.type === 'constant' ? Math.max(0, outlet.qM3s) : 0;
  if (qInM3s.every((q) => q <= qZeroLimit && q <= targetQOutM3s)) {
    return 0;
  }

  let loV = 0;
  let hiV = 1;

  const solve = (vMaxM3: number) => {
    const shape: StorageShape = { form: 'prism', baseAreaM2: vMaxM3 / hMaxM, hMaxM };
    return routeStorage(qInM3s, dDH, shape, outlet);
  };

  while (true) {
    const result = solve(hiV);
    if (result.spillM3 <= 1e-9 && result.qOutMaxM3s <= targetQOutM3s + 1e-12) {
      break;
    }
    hiV *= 2;
    if (hiV > 1e9) {
      throw new Error('No feasible storage volume found up to 1e9 m3');
    }
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (loV + hiV) / 2;
    const result = solve(mid);
    if (result.spillM3 <= 1e-9 && result.qOutMaxM3s <= targetQOutM3s + 1e-12) {
      hiV = mid;
    } else {
      loV = mid;
    }
  }

  return hiV;
}
