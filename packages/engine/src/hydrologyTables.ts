import hydrologyTablesJson from '../../../data/hydrology_tables.json';

function assertHasRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid hydrology tables at ${path}`);
  }
}

function validateHydrologyTables(value: unknown): void {
  assertHasRecord(value, 'root');
  assertHasRecord(value.cn_low_seasonality_by_soil_group, 'cn_low_seasonality_by_soil_group');
  assertHasRecord(value.cn_monthly_soil_group_C, 'cn_monthly_soil_group_C');
  assertHasRecord(value.adjustments, 'adjustments');

  const adjustments = value.adjustments;
  assertHasRecord(adjustments.soil_group_from_C, 'adjustments.soil_group_from_C');
  assertHasRecord(adjustments.mulch_direct_seeding, 'adjustments.mulch_direct_seeding');
  assertHasRecord(adjustments.tillage_direction, 'adjustments.tillage_direction');

  if (typeof adjustments.mulch_direct_seeding.formula !== 'string') {
    throw new Error('Invalid hydrology tables at adjustments.mulch_direct_seeding.formula');
  }

  if (typeof adjustments.tillage_direction.downslope !== 'number') {
    throw new Error('Invalid hydrology tables at adjustments.tillage_direction.downslope');
  }

  if (typeof adjustments.tillage_direction.contour_parallel !== 'number') {
    throw new Error('Invalid hydrology tables at adjustments.tillage_direction.contour_parallel');
  }

  if (adjustments.tillage_direction.terraced !== null) {
    throw new Error('Invalid hydrology tables at adjustments.tillage_direction.terraced');
  }
}

validateHydrologyTables(hydrologyTablesJson);

export const hydrologyTables = hydrologyTablesJson;

export type HydrologyTables = typeof hydrologyTables;
export type SoilGroup = keyof HydrologyTables['cn_low_seasonality_by_soil_group']['Weide'];
export type Month = keyof HydrologyTables['cn_monthly_soil_group_C']['Mais'];
export type LowSeasonalityLandUse = keyof HydrologyTables['cn_low_seasonality_by_soil_group'];
export type MonthlyLandUse = keyof HydrologyTables['cn_monthly_soil_group_C'];
