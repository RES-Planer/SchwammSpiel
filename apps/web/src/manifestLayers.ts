import type * as maplibregl from 'maplibre-gl';

import type { Locale } from './i18n';
import { buildDataUrl, getLocalizedText, type SourceLayerManifest } from './mapData';

export function buildManifestSource(
  layer: SourceLayerManifest,
  baseUrl: string,
  catchmentId: string,
  locale: Locale,
): maplibregl.SourceSpecification {
  const attribution = getLocalizedText(layer.attribution, locale, '').trim() || undefined;
  if (layer.type === 'geojson') {
    return {
      type: 'geojson',
      data: buildDataUrl(baseUrl, catchmentId, layer.path),
      ...(attribution ? { attribution } : {}),
    };
  }

  if (layer.type === 'image') {
    return {
      type: 'image',
      url: buildDataUrl(baseUrl, catchmentId, layer.path),
      coordinates: layer.coordinates,
    };
  }

  return {
    type: 'raster',
    tiles: layer.tiles,
    tileSize: layer.tileSize ?? 256,
    ...(attribution ? { attribution } : {}),
  };
}

export function buildManifestLayer(
  layer: SourceLayerManifest,
  layerId: string,
  sourceId: string,
): maplibregl.AddLayerObject {
  const layout =
    layer.visibleByDefault === false || layer.style?.layout
      ? ({
          visibility: layer.visibleByDefault === false ? 'none' : 'visible',
          ...(layer.style?.layout ?? {}),
        } as Record<string, unknown>)
      : undefined;

  return {
    id: layerId,
    type: layer.layerType,
    source: sourceId,
    ...(layer.style?.paint ? { paint: layer.style.paint as Record<string, unknown> } : {}),
    ...(layout ? { layout } : {}),
    ...(layer.minzoom !== undefined ? { minzoom: layer.minzoom } : {}),
    ...(layer.maxzoom !== undefined ? { maxzoom: layer.maxzoom } : {}),
  } as maplibregl.AddLayerObject;
}
