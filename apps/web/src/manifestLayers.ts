import type * as maplibregl from 'maplibre-gl';

import type { Locale } from './i18n';
import { buildDataUrl, getLocalizedText, type LayerManifest } from './mapData';

export function buildManifestSource(
  layer: LayerManifest,
  baseUrl: string,
  catchmentId: string,
  locale: Locale,
): maplibregl.SourceSpecification {
  const attribution = getLocalizedText(layer.attribution, locale, '').trim() || undefined;
  const attributionSpec = attribution ? { attribution } : {};
  if (layer.type === 'geojson') {
    return {
      type: 'geojson',
      data: buildDataUrl(baseUrl, catchmentId, layer.path),
      ...attributionSpec,
    };
  }

  if (layer.type === 'image') {
    return {
      type: 'image',
      url: buildDataUrl(baseUrl, catchmentId, layer.path),
      coordinates: layer.coordinates,
      ...attributionSpec,
    };
  }

  return {
    type: 'raster',
    tiles: layer.tiles,
    tileSize: layer.tileSize ?? 256,
    ...attributionSpec,
  };
}

export function buildManifestLayer(
  layer: LayerManifest,
  layerId: string,
  sourceId: string,
): maplibregl.AddLayerObject {
  return {
    id: layerId,
    type: layer.layerType,
    source: sourceId,
    paint: layer.style?.paint as Record<string, unknown> | undefined,
    layout: {
      visibility: layer.visibleByDefault === false ? 'none' : 'visible',
      ...(layer.style?.layout ?? {}),
    } as Record<string, unknown>,
    minzoom: layer.minzoom,
    maxzoom: layer.maxzoom,
  } as maplibregl.AddLayerObject;
}
