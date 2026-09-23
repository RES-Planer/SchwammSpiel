import { describe, expect, test } from 'vitest';

import { buildManifestLayer, buildManifestSource } from './manifestLayers';
import type { SourceLayerManifest } from './mapData';

function expectNoUndefinedValues(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectNoUndefinedValues);
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      expect(nestedValue, `expected ${key} not to be undefined`).not.toBeUndefined();
      expectNoUndefinedValues(nestedValue);
    }
  }
}

describe('manifest layer builders', () => {
  test('builds a raster tile source from manifest layer definitions', () => {
    const layer: SourceLayerManifest = {
      id: 'basemap',
      name: { de: 'Basiskarte' },
      type: 'raster',
      layerType: 'raster',
      tiles: ['https://tiles.example/{z}/{x}/{y}.png'],
      visibleByDefault: true,
    };

    expect(buildManifestSource(layer, '/base/', 'demo', 'en')).toEqual({
      type: 'raster',
      tiles: ['https://tiles.example/{z}/{x}/{y}.png'],
      tileSize: 256,
    });
  });

  test('builds geojson and image sources using catchment-relative asset URLs', () => {
    const geojsonLayer: SourceLayerManifest = {
      id: 'subcatchments',
      name: { de: 'Teilgebiete' },
      type: 'geojson',
      layerType: 'fill',
      path: 'subcatchments.geojson',
      attribution: { de: 'GeoJSON Quelle', en: 'GeoJSON source' },
    };
    const imageLayer: SourceLayerManifest = {
      id: 'hillshade',
      name: { de: 'Schummerung' },
      type: 'image',
      layerType: 'raster',
      path: 'hillshade.png',
      attribution: { de: 'Schummerung Quelle', en: 'Hillshade source' },
      coordinates: [
        [11.9, 50.0],
        [12.0, 50.0],
        [12.0, 49.9],
        [11.9, 49.9],
      ],
    };

    expect(buildManifestSource(geojsonLayer, '/SchwammSpiel/', 'demo', 'de')).toEqual({
      type: 'geojson',
      data: '/SchwammSpiel/data/demo/subcatchments.geojson',
      attribution: 'GeoJSON Quelle',
    });
    expect(buildManifestSource(imageLayer, '/SchwammSpiel/', 'demo', 'de')).toEqual({
      type: 'image',
      url: '/SchwammSpiel/data/demo/hillshade.png',
      coordinates: imageLayer.coordinates,
    });
  });

  test('builds map layer definitions with default visibility and custom style', () => {
    const layer: SourceLayerManifest = {
      id: 'flow-paths',
      name: { de: 'Fließwege' },
      type: 'geojson',
      layerType: 'line',
      path: 'flow_paths.geojson',
      visibleByDefault: false,
      style: {
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#0f766e' },
      },
    };

    expect(buildManifestLayer(layer, 'catchment-layer-flow-paths', 'catchment-source-flow-paths')).toEqual({
      id: 'catchment-layer-flow-paths',
      type: 'line',
      source: 'catchment-source-flow-paths',
      paint: { 'line-color': '#0f766e' },
      layout: { visibility: 'none', 'line-cap': 'round' },
    });
  });

  test('keeps localized raster attributions in generated map sources', () => {
    const layer: SourceLayerManifest = {
      id: 'basemap-openfreemap',
      name: { de: 'Basiskarte OpenFreeMap' },
      type: 'raster',
      layerType: 'raster',
      tiles: ['https://tiles.example/{z}/{x}/{y}.png'],
      attribution: {
        de: 'OpenFreeMap, OpenMapTiles, OpenStreetMap-Mitwirkende (ODbL)',
        en: 'OpenFreeMap, OpenMapTiles, OpenStreetMap contributors (ODbL)',
      },
    };

    expect(buildManifestSource(layer, '/', 'demo', 'en')).toEqual({
      type: 'raster',
      tiles: ['https://tiles.example/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: 'OpenFreeMap, OpenMapTiles, OpenStreetMap contributors (ODbL)',
    });
  });

  test('omits invalid undefined layer properties and image attributions', () => {
    const layer: SourceLayerManifest = {
      id: 'hillshade',
      name: { de: 'Schummerung' },
      type: 'image',
      layerType: 'raster',
      path: 'hillshade.png',
      attribution: { de: 'Schummerung Quelle' },
      coordinates: [
        [11.9, 50.0],
        [12.0, 50.0],
        [12.0, 49.9],
        [11.9, 49.9],
      ],
    };

    const source = buildManifestSource(layer, '/SchwammSpiel/', 'demo', 'de');
    const mapLayer = buildManifestLayer(layer, 'catchment-layer-hillshade', 'catchment-source-hillshade');

    expectNoUndefinedValues(source);
    expectNoUndefinedValues(mapLayer);
    expect(source).not.toHaveProperty('attribution');
    expect(mapLayer).not.toHaveProperty('paint');
    expect(mapLayer).not.toHaveProperty('layout');
    expect(mapLayer).not.toHaveProperty('minzoom');
    expect(mapLayer).not.toHaveProperty('maxzoom');
  });
});
