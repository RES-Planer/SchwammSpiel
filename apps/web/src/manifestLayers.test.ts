import { describe, expect, test } from 'vitest';

import { buildManifestLayer, buildManifestSource } from './manifestLayers';
import type { LayerManifest } from './mapData';

describe('manifest layer builders', () => {
  test('builds a raster tile source from manifest layer definitions', () => {
    const layer: LayerManifest = {
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
    const geojsonLayer: LayerManifest = {
      id: 'subcatchments',
      name: { de: 'Teilgebiete' },
      type: 'geojson',
      layerType: 'fill',
      path: 'subcatchments.geojson',
    };
    const imageLayer: LayerManifest = {
      id: 'hillshade',
      name: { de: 'Schummerung' },
      type: 'image',
      layerType: 'raster',
      path: 'hillshade.png',
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
    });
    expect(buildManifestSource(imageLayer, '/SchwammSpiel/', 'demo', 'de')).toEqual({
      type: 'image',
      url: '/SchwammSpiel/data/demo/hillshade.png',
      coordinates: imageLayer.coordinates,
    });
  });

  test('builds map layer definitions with default visibility and custom style', () => {
    const layer: LayerManifest = {
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
      minzoom: undefined,
      maxzoom: undefined,
    });
  });

  test('keeps localized raster attributions in generated map sources', () => {
    const layer: LayerManifest = {
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
});
