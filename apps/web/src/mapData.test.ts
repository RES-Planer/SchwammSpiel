import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import {
  buildDataUrl,
  buildManifestUrl,
  collectAttributions,
  createInitialVisibility,
  extractSubcatchmentDetails,
  getLocalizedText,
  resolveCatchmentId,
  type CatchmentManifest,
} from './mapData';

function listManifestPaths(directoryUrl: URL): string[] {
  const entries = readdirSync(directoryUrl, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);
    if (entry.isDirectory()) {
      return listManifestPaths(entryUrl);
    }
    return entry.name === 'manifest.json' ? [fileURLToPath(entryUrl)] : [];
  });
}

describe('map data helpers', () => {
  test('resolves the requested Gebiet from the query string', () => {
    expect(resolveCatchmentId('?gebiet=goldbach')).toBe('goldbach');
    expect(resolveCatchmentId('?gebiet=')).toBe('demo');
    expect(resolveCatchmentId('')).toBe('demo');
  });

  test('builds manifest and asset URLs relative to the configured base path', () => {
    expect(buildManifestUrl('/SchwammSpiel/', 'demo')).toBe('/SchwammSpiel/data/demo/manifest.json');
    expect(buildDataUrl('/SchwammSpiel', 'demo', '/subcatchments.geojson')).toBe(
      '/SchwammSpiel/data/demo/subcatchments.geojson',
    );
  });

  test('derives default layer visibility from the manifest', () => {
    const manifest: CatchmentManifest = {
      id: 'demo',
      name: { de: 'Demo' },
      bounds: [
        [11.9, 49.9],
        [12, 50],
      ],
      layers: [
        {
          id: 'basemap',
          name: { de: 'Basiskarte' },
          type: 'raster',
          layerType: 'raster',
          tiles: ['https://example.test/{z}/{x}/{y}.png'],
          visibleByDefault: false,
        },
        {
          id: 'visible',
          name: { de: 'Sichtbar' },
          type: 'vector-style',
          url: 'https://tiles.openfreemap.org/styles/liberty',
        },
        {
          id: 'overlay',
          name: { de: 'Overlay' },
          type: 'geojson',
          layerType: 'fill',
          path: 'visible.geojson',
        },
        {
          id: 'hidden',
          name: { de: 'Versteckt' },
          type: 'geojson',
          layerType: 'line',
          path: 'hidden.geojson',
          visibleByDefault: false,
        },
      ],
    };

    expect(createInitialVisibility(manifest.layers)).toEqual({
      basemap: false,
      visible: true,
      overlay: true,
      hidden: false,
    });
  });

  test('collects deduplicated localized attributions', () => {
    const manifest: CatchmentManifest = {
      id: 'demo',
      name: { de: 'Demo' },
      bounds: [
        [11.9, 49.9],
        [12, 50],
      ],
      layers: [
        {
          id: 'one',
          name: { de: 'Eins' },
          type: 'geojson',
          layerType: 'fill',
          path: 'one.geojson',
          attribution: { de: 'Demo-Daten', en: 'Demo data' },
        },
        {
          id: 'two',
          name: { de: 'Zwei' },
          type: 'geojson',
          layerType: 'line',
          path: 'two.geojson',
          attribution: 'Demo-Daten',
        },
      ],
    };

    expect(collectAttributions(manifest, 'de')).toEqual(['Demo-Daten']);
    expect(getLocalizedText(manifest.layers[0]?.attribution, 'en', '')).toBe('Demo data');
  });

  test('extracts subcatchment details from feature properties', () => {
    expect(
      extractSubcatchmentDetails({
        id: 'tgb-1',
        name: 'Teilgebiet 1',
        areaHa: '82',
        cn: 71,
        tcH: 1.3,
        shareForestPct: 35,
        shareGrasslandPct: '40',
        shareArablePct: 25,
      }),
    ).toEqual({
      id: 'tgb-1',
      name: 'Teilgebiet 1',
      areaHa: 82,
      cn: 71,
      tcH: 1.3,
      landuseShares: [
        { labelKey: 'map.landuse.forest', valuePct: 35 },
        { labelKey: 'map.landuse.grassland', valuePct: 40 },
        { labelKey: 'map.landuse.arable', valuePct: 25 },
      ],
    });
  });

  test('uses PNG or JPG assets for every manifest image layer', () => {
    const manifestPaths = listManifestPaths(new URL('../public/data/', import.meta.url));
    expect(manifestPaths.length).toBeGreaterThan(0);

    for (const manifestPath of manifestPaths) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CatchmentManifest;
      for (const layer of manifest.layers) {
        if (layer.type === 'image') {
          expect(layer.path, `${manifest.id}/${layer.id}`).toMatch(/\.(png|jpg)$/i);
        }
      }
    }
  });
});
