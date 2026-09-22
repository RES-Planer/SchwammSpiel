import {
  STONEFIELD_D50_DEFAULT_M,
  STONEFIELD_H_OVERLOAD_LIMIT_M,
  STONEFIELD_HOLE_DEPTH_DEFAULT_M,
  STONEFIELD_HOLE_DIAMETER_DEFAULT_M,
  STONEFIELD_K_DEFAULT,
  STONEFIELD_K_OVERLOADED,
  STONEFIELD_POROSITY_DEFAULT,
  STONEFIELD_SPACING_DEFAULT_M,
} from '../assumptions';
import { hydrologyTables, type SoilGroup } from '../hydrologyTables';

const WATER_DENSITY_KG_M3 = 1000;
const STONE_DENSITY_KG_M3 = 2650;
const G = 9.81;
const SHIELDS_CRITICAL = 0.047;

export type StonefieldWarningCode =
  | 'overloaded'
  | 'stones-unstable'
  | 'low-infiltration-soil';

export type StonefieldWarning = {
  code: StonefieldWarningCode;
  message: string;
};

export type StonefieldGeometryInput = {
  widthM: number;
  lengthFlowM: number;
  spacingM?: number;
  holeDiameterM?: number;
  holeDepthM?: number;
  porosity?: number;
  soilGroup?: SoilGroup;
};

export type StonefieldGeometryResult = {
  holeCount: number;
  porosityStorageM3: number;
  aInfM2: number;
  warnings: StonefieldWarning[];
};

export type StonefieldHydraulicsInput = {
  qInMaxM3s: number;
  widthM: number;
  slope: number;
  kStone?: number;
  d50M?: number;
};

export type StonefieldHydraulicsResult = {
  hM: number;
  vMs: number;
  qSpecificM2s: number;
  kUsed: number;
  overloaded: boolean;
  warnings: StonefieldWarning[];
};

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number > 0`);
  }
}

function flowDepthM(qSpecificM2s: number, k: number, slope: number): number {
  return (qSpecificM2s / (k * Math.sqrt(slope))) ** (3 / 5);
}

function meanKfMs(soilGroup: SoilGroup): number {
  if (soilGroup === 'A') {
    return 0;
  }
  const values = hydrologyTables.soil_infiltration_by_group[soilGroup].kf_m_s;
  return (values[0] + values[1]) / 2;
}

export function stonefieldGeometry(input: StonefieldGeometryInput): StonefieldGeometryResult {
  const spacingM = input.spacingM ?? STONEFIELD_SPACING_DEFAULT_M.value;
  const holeDiameterM = input.holeDiameterM ?? STONEFIELD_HOLE_DIAMETER_DEFAULT_M.value;
  const holeDepthM = input.holeDepthM ?? STONEFIELD_HOLE_DEPTH_DEFAULT_M.value;
  const porosity = input.porosity ?? STONEFIELD_POROSITY_DEFAULT.value;

  assertPositive('widthM', input.widthM);
  assertPositive('lengthFlowM', input.lengthFlowM);
  assertPositive('spacingM', spacingM);
  assertPositive('holeDiameterM', holeDiameterM);
  assertPositive('holeDepthM', holeDepthM);
  if (!Number.isFinite(porosity) || porosity <= 0 || porosity > 1) {
    throw new Error('porosity must be a finite number in (0, 1]');
  }

  const holeCount = Math.floor(input.widthM / spacingM) * Math.floor(input.lengthFlowM / spacingM);
  const holeAreaM2 = (Math.PI / 4) * holeDiameterM ** 2;
  const holeMantleM2 = Math.PI * holeDiameterM * holeDepthM;
  const porosityStorageM3 = holeCount * holeAreaM2 * holeDepthM * porosity;
  const aInfM2 = holeCount * (holeAreaM2 + holeMantleM2);

  const warnings: StonefieldWarning[] = [];
  if (input.soilGroup === 'C' || input.soilGroup === 'D') {
    const kfMs = meanKfMs(input.soilGroup);
    if (kfMs <= 1e-6) {
      warnings.push({
        code: 'low-infiltration-soil',
        message: 'HBG C/D: geringe Versickerung, Wirkung vor allem über Fließzeitverlängerung',
      });
    }
  }

  return {
    holeCount,
    porosityStorageM3,
    aInfM2,
    warnings,
  };
}

export function analyzeStonefieldHydraulics(
  input: StonefieldHydraulicsInput,
): StonefieldHydraulicsResult {
  const kStone = input.kStone ?? STONEFIELD_K_DEFAULT.value;
  const d50M = input.d50M ?? STONEFIELD_D50_DEFAULT_M.value;

  assertPositive('qInMaxM3s', input.qInMaxM3s);
  assertPositive('widthM', input.widthM);
  assertPositive('slope', input.slope);
  assertPositive('kStone', kStone);
  assertPositive('d50M', d50M);

  const qSpecificM2s = input.qInMaxM3s / input.widthM;

  let kUsed = kStone;
  let hM = flowDepthM(qSpecificM2s, kUsed, input.slope);
  const overloaded = hM > STONEFIELD_H_OVERLOAD_LIMIT_M.value;
  const warnings: StonefieldWarning[] = [];

  if (overloaded) {
    kUsed = STONEFIELD_K_OVERLOADED.value;
    hM = flowDepthM(qSpecificM2s, kUsed, input.slope);
    warnings.push({
      code: 'overloaded',
      message: 'h > 0.03 m: Feld verbreitern',
    });
  }

  const tau = WATER_DENSITY_KG_M3 * G * hM * input.slope;
  const tauCritical = SHIELDS_CRITICAL * (STONE_DENSITY_KG_M3 - WATER_DENSITY_KG_M3) * G * d50M;
  if (tau > tauCritical) {
    warnings.push({
      code: 'stones-unstable',
      message: 'Steinlage instabil: Schubspannung über kritischem Wert',
    });
  }

  return {
    hM,
    vMs: qSpecificM2s / hM,
    qSpecificM2s,
    kUsed,
    overloaded,
    warnings,
  };
}
