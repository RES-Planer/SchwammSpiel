import { hydrologyTables, type CurveNumberLandUse, type SoilGroup } from '@schwammspiel/engine';

import { pointInPolygon } from './scenarioResults';
import type { MeasureState } from './scenarioState';

type CnZoneFeature = {
  rings: [number, number][][];
  bounds: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  };
  landUse: CurveNumberLandUse | null;
  soilGroup: SoilGroup | null;
  cn: number | null;
};

const fallbackLandUseByName: Record<string, CurveNumberLandUse> = {
  Wald: 'Wald (mittlere Abflussneigung)',
  Gruenland: 'Grünland',
  Grünland: 'Grünland',
  Acker: 'Mais',
};

function asLandUse(value: unknown): CurveNumberLandUse | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value in hydrologyTables.cn_monthly_soil_group_C || value in hydrologyTables.cn_low_seasonality_by_soil_group) {
    return value as CurveNumberLandUse;
  }
  return fallbackLandUseByName[value] ?? null;
}

function asSoilGroup(value: unknown): SoilGroup | null {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D' ? value : null;
}

function readLandUseFromProperties(properties: Record<string, unknown>): CurveNumberLandUse | null {
  const direct =
    asLandUse(properties.landUse) ??
    asLandUse(properties.land_use) ??
    asLandUse(properties.nutzung) ??
    asLandUse(properties.landuse);
  if (direct) {
    return direct;
  }

  const name = typeof properties.name === 'string' ? properties.name : '';
  const [landUsePart] = name.split('/').map((entry) => entry.trim());
  return asLandUse(landUsePart);
}

function readSoilGroupFromProperties(properties: Record<string, unknown>): SoilGroup | null {
  const direct =
    asSoilGroup(properties.soilGroup) ??
    asSoilGroup(properties.soil_group) ??
    asSoilGroup(properties.hsg) ??
    asSoilGroup(properties.group);
  if (direct) {
    return direct;
  }
  const name = typeof properties.name === 'string' ? properties.name : '';
  const match = name.match(/\b([ABCD])\b/);
  return asSoilGroup(match?.[1]);
}

export function extractCnZones(data: unknown): CnZoneFeature[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const features = (data as { features?: unknown[] }).features;
  if (!Array.isArray(features)) {
    return [];
  }
  return features.reduce<CnZoneFeature[]>((entries, feature) => {
    if (!feature || typeof feature !== 'object') {
      return entries;
    }
    const properties = ((feature as { properties?: unknown }).properties ?? {}) as Record<string, unknown>;
    const geometry = (feature as { geometry?: unknown }).geometry as { type?: unknown; coordinates?: unknown } | undefined;
    if (!geometry || !Array.isArray(geometry.coordinates)) {
      return entries;
    }
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates
          : [];

    for (const polygonCoordinates of polygons) {
      if (!Array.isArray(polygonCoordinates)) {
        continue;
      }
      const rings = polygonCoordinates
        .filter((ring): ring is unknown[] => Array.isArray(ring))
        .map((ring) =>
          ring.filter(
            (entry): entry is [number, number] =>
              Array.isArray(entry) &&
              entry.length === 2 &&
              typeof entry[0] === 'number' &&
              Number.isFinite(entry[0]) &&
              typeof entry[1] === 'number' &&
              Number.isFinite(entry[1]),
          ),
        )
        .filter((ring) => ring.length >= 4);
      if (rings.length === 0) {
        continue;
      }
      entries.push({
        rings,
        bounds: polygonBounds(rings[0]!),
        landUse: readLandUseFromProperties(properties),
        soilGroup: readSoilGroupFromProperties(properties),
        cn: typeof properties.cn === 'number' && Number.isFinite(properties.cn) ? properties.cn : null,
      });
    }
    return entries;
  }, []);
}

function polygonBounds(coordinates: [number, number][]): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of coordinates) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLon, minLat, maxLon, maxLat };
}

function pointInZone(point: [number, number], zone: CnZoneFeature): boolean {
  const [outerRing, ...innerRings] = zone.rings;
  if (!outerRing || !pointInPolygon(point, outerRing)) {
    return false;
  }
  return !innerRings.some((ring) => pointInPolygon(point, ring));
}

function polygonCenter(polygon: [number, number][]): [number, number] {
  const sums = polygon.reduce<[number, number]>(
    (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
    [0, 0],
  );
  return [sums[0] / polygon.length, sums[1] / polygon.length];
}

function overlapScore(polygon: [number, number][], zone: CnZoneFeature): number {
  const bounds = polygonBounds(polygon);
  const samples = 10;
  if (polygon.every((point) => pointInZone(point, zone)) && pointInZone(polygonCenter(polygon), zone)) {
    return samples * samples;
  }
  let hits = 0;
  for (let x = 0; x < samples; x += 1) {
    for (let y = 0; y < samples; y += 1) {
      const lon = bounds.minLon + ((x + 0.5) / samples) * (bounds.maxLon - bounds.minLon);
      const lat = bounds.minLat + ((y + 0.5) / samples) * (bounds.maxLat - bounds.minLat);
      if (pointInPolygon([lon, lat], polygon) && pointInZone([lon, lat], zone)) {
        hits += 1;
      }
    }
  }
  return hits;
}

function boundsIntersect(
  left: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  right: { minLon: number; minLat: number; maxLon: number; maxLat: number },
): boolean {
  return (
    left.minLon <= right.maxLon &&
    left.maxLon >= right.minLon &&
    left.minLat <= right.maxLat &&
    left.maxLat >= right.minLat
  );
}

export type CnZoneDefaults = {
  landUse: CurveNumberLandUse;
  soilGroup: SoilGroup;
  cn: number;
};

export function inferCnZoneDefaults(
  geometry: MeasureState['geometry'],
  zones: CnZoneFeature[],
): CnZoneDefaults | null {
  if (!geometry || geometry.type !== 'Polygon') {
    return null;
  }
  if (zones.length === 0) {
    return null;
  }
  const polygonBoundsValue = polygonBounds(geometry.coordinates);

  let best: CnZoneFeature | null = null;
  let bestScore = 0;
  for (const zone of zones) {
    if (!boundsIntersect(polygonBoundsValue, zone.bounds)) {
      continue;
    }
    const score = overlapScore(geometry.coordinates, zone);
    if (score > bestScore) {
      best = zone;
      bestScore = score;
    }
  }

  if (!best || bestScore <= 0) {
    return null;
  }
  if (!best.landUse || !best.soilGroup || best.cn === null) {
    return null;
  }

  return {
    landUse: best.landUse,
    soilGroup: best.soilGroup,
    cn: best.cn,
  };
}
