import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const forbiddenRasterDomain = ['tile', 'openstreetmap.org'].join('.');
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
  test('keeps the demo manifest self-contained for offline smoke tests', () => {
    const manifest = JSON.parse(readFileSync(demoManifestPath, 'utf8')) as { layers: ManifestLayer[] };
    const externalBasemapLayers = manifest.layers.filter(
      (layer) => layer.type === 'vector-style' || layer.tiles?.some((tile) => tile.startsWith('http')),
    );
    const hillshade = manifest.layers.find((layer) => layer.id === 'hillshade');

    expect(externalBasemapLayers).toEqual([]);
    expect(hillshade).toMatchObject({
      type: 'image',
      path: 'hillshade.png',
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
