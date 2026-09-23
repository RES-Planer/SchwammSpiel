import type { Locale } from './i18n';

export const DEFAULT_CATCHMENT_ID = 'demo';

type LocalizedText = Partial<Record<Locale, string>>;
type LocalizedValue = LocalizedText | string | undefined;

type LegendSpec =
  | { type: 'fill'; color: string }
  | { type: 'line'; color: string }
  | { type: 'circle'; color: string }
  | { type: 'raster'; colorRamp: [string, string] };

type LayerStyle = {
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

type BaseLayerManifest = {
  id: string;
  name: LocalizedText;
  attribution?: LocalizedValue;
  visibleByDefault?: boolean;
  legend?: LegendSpec;
  style?: LayerStyle;
  minzoom?: number;
  maxzoom?: number;
};

export type GeoJsonLayerManifest = BaseLayerManifest & {
  type: 'geojson';
  path: string;
  layerType: 'fill' | 'line' | 'circle';
  inspectable?: boolean;
};

export type ImageLayerManifest = BaseLayerManifest & {
  type: 'image';
  path: string;
  layerType: 'raster';
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
};

export type LayerManifest = GeoJsonLayerManifest | ImageLayerManifest;

export type CatchmentManifest = {
  id: string;
  name: LocalizedText;
  bounds: [[number, number], [number, number]];
  layers: LayerManifest[];
};

export type SubcatchmentDetails = {
  id: string;
  name: string;
  areaHa: number | null;
  cn: number | null;
  tcH: number | null;
  landuseShares: Array<{ labelKey: string; valuePct: number }>;
};

const landuseShareFields = [
  { property: 'shareForestPct', labelKey: 'map.landuse.forest' },
  { property: 'shareGrasslandPct', labelKey: 'map.landuse.grassland' },
  { property: 'shareArablePct', labelKey: 'map.landuse.arable' },
] as const;

export function resolveCatchmentId(search: string): string {
  const catchmentId = new URLSearchParams(search).get('gebiet')?.trim();
  return catchmentId ? catchmentId : DEFAULT_CATCHMENT_ID;
}

export function buildDataUrl(baseUrl: string, catchmentId: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizedBaseUrl}data/${catchmentId}/${normalizedPath}`;
}

export function buildManifestUrl(baseUrl: string, catchmentId: string): string {
  return buildDataUrl(baseUrl, catchmentId, 'manifest.json');
}

export function getLocalizedText(value: LocalizedValue, locale: Locale, fallback: string): string {
  if (typeof value === 'string') {
    return value;
  }

  return value?.[locale] ?? value?.de ?? fallback;
}

export function createInitialVisibility(layers: LayerManifest[]): Record<string, boolean> {
  return Object.fromEntries(layers.map((layer) => [layer.id, layer.visibleByDefault ?? true]));
}

export function collectAttributions(manifest: CatchmentManifest | null, locale: Locale): string[] {
  if (!manifest) {
    return [];
  }

  return manifest.layers
    .map((layer) => getLocalizedText(layer.attribution, locale, '').trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function extractSubcatchmentDetails(properties: Record<string, unknown>): SubcatchmentDetails | null {
  const id = typeof properties.id === 'string' ? properties.id : null;
  const name = typeof properties.name === 'string' ? properties.name : id;
  if (!id || !name) {
    return null;
  }

  const landuseShares = landuseShareFields.reduce<SubcatchmentDetails['landuseShares']>((shares, field) => {
    const valuePct = parseNumber(properties[field.property]);
    if (valuePct !== null) {
      shares.push({ labelKey: field.labelKey, valuePct });
    }
    return shares;
  }, []);

  return {
    id,
    name,
    areaHa: parseNumber(properties.areaHa),
    cn: parseNumber(properties.cn),
    tcH: parseNumber(properties.tcH),
    landuseShares,
  };
}
