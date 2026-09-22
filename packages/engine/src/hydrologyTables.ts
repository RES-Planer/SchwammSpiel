import hydrologyTablesJson from '../../../data/hydrology_tables.json';

export const hydrologyTables = hydrologyTablesJson;

export type HydrologyTables = typeof hydrologyTables;
export type SoilGroup = keyof HydrologyTables['cn_low_seasonality_by_soil_group']['Weide'];
export type Month = keyof HydrologyTables['cn_monthly_soil_group_C']['Mais'];
export type LowSeasonalityLandUse = keyof HydrologyTables['cn_low_seasonality_by_soil_group'];
export type MonthlyLandUse = keyof HydrologyTables['cn_monthly_soil_group_C'];
