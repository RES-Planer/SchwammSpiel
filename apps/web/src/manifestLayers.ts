import type * as maplibregl from 'maplibre-gl';

import { buildDataUrl, type LayerManifest } from './mapData';

export function buildManifestSource(
  layer: LayerManifest,
  baseUrl: string,
  catchmentId: string,
): maplibregl.SourceSpecification {
  if (layer.type === 'geojson') {
    return {
      type: 'geojson',
      data: buildDataUrl(baseUrl, catchmentId, layer.path),
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
  };
}

export function buildManifestLayer(
  layer: LayerManifest,
  sourceId: string,
): maplibregl.AddLayerObject {
  return {
    id: `catchment-layer-${layer.id}`,
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
