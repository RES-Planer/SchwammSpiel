import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const forbiddenRasterDomain = 'tile.openstreetmap.org';
const manifestDirectory = new URL('../public/data', import.meta.url);
const demoManifestPath = new URL('../public/data/demo/manifest.json', import.meta.url);
const sourceDirectory = new URL('.', import.meta.url);

type ManifestLayer = {
  id: string;
  type: string;
  attribution?: string;
  maxzoom?: number;
  tiles?: string[];
  url?: string;
};

function collectFiles(directoryPath: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(entryPath, predicate);
    }

    return predicate(entryPath) ? [entryPath] : [];
  });
}

describe('basemap source configuration', () => {
  test('uses the corrected external basemap definitions in the demo manifest', () => {
    const manifest = JSON.parse(readFileSync(demoManifestPath, 'utf8')) as { layers: ManifestLayer[] };
    const topPlusOpen = manifest.layers.find((layer) => layer.id === 'basemap-topplusopen');
    const openFreeMap = manifest.layers.find((layer) => layer.id === 'basemap-openfreemap');

    expect(topPlusOpen).toMatchObject({
      type: 'raster',
      tiles: ['https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web_grau/default/WEBMERCATOR/{z}/{y}/{x}.png'],
      maxzoom: 18,
      attribution: '© GeoBasis-DE / BKG (2026), Datenlizenz Deutschland – Namensnennung – Version 2.0',
    });
    expect(openFreeMap).toMatchObject({
      type: 'vector-style',
      url: 'https://tiles.openfreemap.org/styles/liberty',
      attribution: 'OpenFreeMap © OpenMapTiles, Daten © OpenStreetMap-Mitwirkende',
    });
  });

  test('does not reference OpenStreetMap raster tiles in app sources or manifests', () => {
    const sourceFiles = collectFiles(sourceDirectory.pathname, (filePath) => /\.(ts|tsx)$/.test(filePath));
    const manifestFiles = collectFiles(manifestDirectory.pathname, (filePath) => /manifest\.json$/.test(filePath));

    for (const filePath of [...sourceFiles, ...manifestFiles]) {
      expect(readFileSync(filePath, 'utf8'), filePath).not.toContain(forbiddenRasterDomain);
    }
  });
});
