import { effectiveRainMm } from './runoff';
import {
  hydrologyTables,
  type LowSeasonalityLandUse,
  type Month,
  type MonthlyLandUse,
  type SoilGroup,
} from './hydrologyTables';

export type TillageDirection = 'downslope' | 'contour_parallel' | 'terraced';
export type CurveNumberLandUse = LowSeasonalityLandUse | MonthlyLandUse;

export type CurveNumberWarningCode = 'missing-formula' | 'estimated-formula';

export type CurveNumberWarning = {
  code: CurveNumberWarningCode;
  step: string;
  message: string;
};

export type CurveNumberStep = {
  step: 'base' | 'mulch-direct-seeding' | 'soil-group-adjustment' | 'tillage-direction';
  beforeCn: number;
  afterCn: number;
  formula?: string;
  note?: string;
};

export type CnForPatchInput = {
  landUse: CurveNumberLandUse;
  soilGroup: SoilGroup;
  month: Month | 'low-seasonality';
  mulchCoverFraction?: number;
  tillage: TillageDirection;
};

export type CnForPatchResult = {
  cn: number;
  steps: CurveNumberStep[];
  warnings: CurveNumberWarning[];
};

export type AggregatePatch = {
  areaHa: number;
  cn: number;
};

export type AggregateMode = 'area_weighted' | 'runoff_weighted';

export type AggregateCnResult =
  | { mode: 'area_weighted'; cn: number }
  | { mode: 'runoff_weighted'; neffMm: (pCumMm: number) => number };

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite number >= 0`);
  }
}

function assertFraction(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number in [0, 1]`);
  }
}

function applySoilGroupFormula(formula: string, cnC: number): number {
  if (formula.trim() === 'CN_C') {
    return cnC;
  }

  const match = formula.match(/=\s*([0-9]+(?:\.[0-9]+)?)\s*\*\s*CN_C\s*([+-]\s*[0-9]+(?:\.[0-9]+)?)?/);
  if (!match) {
    throw new Error(`Unsupported soil-group formula: ${formula}`);
  }

  const coefficient = Number(match[1]);
  const offset = match[2] ? Number(match[2].replaceAll(' ', '')) : 0;
  return coefficient * cnC + offset;
}

function mulchAdjustedCn(cnC: number, coverFraction: number): number {
  const mulchFormula = hydrologyTables.adjustments.mulch_direct_seeding.formula;
  const match = mulchFormula.match(/CN_C\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)\s*\*\s*cover_fraction/);
  if (!match) {
    throw new Error(`Unsupported mulch formula: ${mulchFormula}`);
  }

  const intercept = Number(match[1]);
  const slope = Number(match[2]);
  const candidateCn = intercept - slope * coverFraction;
  return candidateCn < cnC ? candidateCn : cnC;
}

function isMonthlyLandUse(landUse: CurveNumberLandUse): landUse is MonthlyLandUse {
  return landUse in hydrologyTables.cn_monthly_soil_group_C;
}

function isLowSeasonalityLandUse(landUse: CurveNumberLandUse): landUse is LowSeasonalityLandUse {
  return landUse in hydrologyTables.cn_low_seasonality_by_soil_group;
}

export function cnForPatch(input: CnForPatchInput): CnForPatchResult {
  const warnings: CurveNumberWarning[] = [];
  const steps: CurveNumberStep[] = [];

  let cn = 0;

  if (input.month === 'low-seasonality') {
    if (!isLowSeasonalityLandUse(input.landUse)) {
      throw new Error(`Land use '${input.landUse}' has no low-seasonality CN values`);
    }

    cn = hydrologyTables.cn_low_seasonality_by_soil_group[input.landUse][input.soilGroup];
    steps.push({ step: 'base', beforeCn: cn, afterCn: cn, note: 'low-seasonality table value' });
  } else {
    if (!isMonthlyLandUse(input.landUse)) {
      throw new Error(`Land use '${input.landUse}' has no monthly CN values`);
    }

    cn = hydrologyTables.cn_monthly_soil_group_C[input.landUse][input.month];
    steps.push({ step: 'base', beforeCn: cn, afterCn: cn, note: `monthly table value (${input.month}) in soil group C` });

    if (input.mulchCoverFraction !== undefined) {
      assertFraction('mulchCoverFraction', input.mulchCoverFraction);
      const beforeCn = cn;
      if (input.mulchCoverFraction >= 0.3) {
        cn = mulchAdjustedCn(cn, input.mulchCoverFraction);
      }
      steps.push({
        step: 'mulch-direct-seeding',
        beforeCn,
        afterCn: cn,
        formula: hydrologyTables.adjustments.mulch_direct_seeding.formula,
        note:
          input.mulchCoverFraction >= 0.3
            ? 'applied only if lower than monthly value'
            : 'not applied because cover_fraction < 0.30',
      });
    }

    if (input.soilGroup !== 'C') {
      const soilAdjustment = hydrologyTables.adjustments.soil_group_from_C[input.soilGroup];
      const beforeCn = cn;

      if (soilAdjustment.formula === null) {
        warnings.push({
          code: 'missing-formula',
          step: 'soil-group-adjustment',
          message: `Missing soil-group formula for ${input.soilGroup}; returning unadjusted CN`,
        });
        steps.push({
          step: 'soil-group-adjustment',
          beforeCn,
          afterCn: beforeCn,
          note: soilAdjustment.status,
        });
      } else {
        cn = applySoilGroupFormula(soilAdjustment.formula, cn);
        steps.push({
          step: 'soil-group-adjustment',
          beforeCn,
          afterCn: cn,
          formula: soilAdjustment.formula,
          note: soilAdjustment.status,
        });

        if (soilAdjustment.status?.includes('SCHAETZUNG')) {
          warnings.push({
            code: 'estimated-formula',
            step: 'soil-group-adjustment',
            message: `Soil-group formula for ${input.soilGroup} is marked as estimate`,
          });
        }
      }
    }
  }

  const tillageFactor = hydrologyTables.adjustments.tillage_direction[input.tillage];
  const beforeTillageCn = cn;

  if (tillageFactor === null) {
    warnings.push({
      code: 'missing-formula',
      step: 'tillage-direction',
      message: `Missing tillage formula for ${input.tillage}; returning unadjusted CN`,
    });
    steps.push({
      step: 'tillage-direction',
      beforeCn: beforeTillageCn,
      afterCn: beforeTillageCn,
      note: hydrologyTables.adjustments.tillage_direction.status,
    });
  } else {
    cn = cn * tillageFactor;
    steps.push({
      step: 'tillage-direction',
      beforeCn: beforeTillageCn,
      afterCn: cn,
      formula: `CN = CN * ${tillageFactor}`,
    });
  }

  return { cn, steps, warnings };
}

export function aggregateCn(
  patches: AggregatePatch[],
  mode: AggregateMode,
  options?: { iaRatio?: number },
): AggregateCnResult {
  if (patches.length === 0) {
    throw new Error('aggregateCn requires at least one patch');
  }

  for (const patch of patches) {
    assertNonNegative('patch.areaHa', patch.areaHa);
    assertNonNegative('patch.cn', patch.cn);
  }

  const totalAreaHa = patches.reduce((sum, patch) => sum + patch.areaHa, 0);
  if (totalAreaHa <= 0) {
    throw new Error('aggregateCn requires positive total area');
  }

  if (mode === 'area_weighted') {
    const cn =
      patches.reduce((sum, patch) => sum + patch.areaHa * patch.cn, 0) / totalAreaHa;
    return { mode, cn };
  }

  const iaRatio = options?.iaRatio;
  if (iaRatio === undefined) {
    throw new Error('runoff_weighted aggregation requires options.iaRatio');
  }

  return {
    mode,
    neffMm: (pCumMm: number) => {
      return patches.reduce((sum, patch) => {
        const areaWeight = patch.areaHa / totalAreaHa;
        return sum + areaWeight * effectiveRainMm(pCumMm, patch.cn, iaRatio);
      }, 0);
    },
  };
}
