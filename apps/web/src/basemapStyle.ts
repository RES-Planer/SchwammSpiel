import type * as maplibregl from 'maplibre-gl';

import type { LayerManifest, SourceLayerManifest, VectorStyleLayerManifest } from './mapData';

export const defaultMapStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#f8fafc',
      },
    },
  ],
};

type BaseStyleEventName = 'error' | 'style.load';

type BaseStyleMap = {
  off: (type: BaseStyleEventName, listener: (event?: unknown) => void) => unknown;
  on: (type: BaseStyleEventName, listener: (event?: unknown) => void) => unknown;
  once: (type: BaseStyleEventName, listener: (event?: unknown) => void) => unknown;
  setStyle: (style: string | maplibregl.StyleSpecification) => unknown;
};

export function isSourceLayer(layer: LayerManifest): layer is SourceLayerManifest {
  return layer.type !== 'vector-style';
}

export function findVisibleVectorStyleLayer(
  layers: LayerManifest[],
  visibility: Record<string, boolean>,
): VectorStyleLayerManifest | null {
  const activeLayer = [...layers]
    .reverse()
    .find(
      (layer): layer is VectorStyleLayerManifest =>
        layer.type === 'vector-style' && (visibility[layer.id] ?? layer.visibleByDefault ?? true),
    );
  return activeLayer ?? null;
}

export function isActiveStyleLoadError(event: unknown, requestedStyleUrl: string | null): boolean {
  if (!requestedStyleUrl || !event || typeof event !== 'object') {
    return false;
  }

  const error = 'error' in event ? event.error : undefined;
  if (!error || typeof error !== 'object') {
    return false;
  }

  return 'url' in error && error.url === requestedStyleUrl;
}

export function applyBaseStyle(
  map: BaseStyleMap,
  requestedStyleUrl: string | null,
  onStyleReady: () => void,
): () => void {
  const handleStyleLoad = () => {
    if (requestedStyleUrl) {
      map.off('error', handleStyleError);
    }
    onStyleReady();
  };

  const handleStyleError = (event?: unknown) => {
    if (!isActiveStyleLoadError(event, requestedStyleUrl)) {
      return;
    }

    map.off('style.load', handleStyleLoad);
    map.off('error', handleStyleError);
    map.once('style.load', onStyleReady);
    map.setStyle(defaultMapStyle);
  };

  map.once('style.load', handleStyleLoad);
  if (requestedStyleUrl) {
    map.on('error', handleStyleError);
  }
  map.setStyle(requestedStyleUrl ?? defaultMapStyle);

  return () => {
    map.off('style.load', handleStyleLoad);
    map.off('error', handleStyleError);
  };
}
