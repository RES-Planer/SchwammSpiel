import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const blankPng = readFileSync(new URL('../public/data/demo/hillshade.png', import.meta.url));

test('renders production manifest layers without map load errors', async ({ page }) => {
  await page.route('https://sgx.geodatenzentrum.de/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: blankPng,
    });
  });

  await page.goto('/SchwammSpiel/', { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const map = (window as Window & { __map?: { loaded(): boolean } }).__map;
    return Boolean(map?.loaded());
  });

  const state = await page.evaluate(async () => {
    const { __map: map, __mapErrors = [] } = window as Window & {
      __map?: {
        getCenter(): { lng: number; lat: number };
        getLayer(id: string): unknown;
        loaded(): boolean;
        project(point: { lng: number; lat: number }): { x: number; y: number };
        queryRenderedFeatures(point: { x: number; y: number }): Array<{ layer: { id: string } }>;
        querySourceFeatures(sourceId: string): unknown[];
      };
      __mapErrors?: Array<{ message: string; sourceId?: string }>;
    };
    if (!map) {
      return null;
    }

    const manifest = (await fetch('/SchwammSpiel/data/demo/manifest.json').then(async (response) => {
      return (await response.json()) as {
        layers: Array<{ id: string; type: string }>;
      };
    })) as { layers: Array<{ id: string; type: string }> };
    const manifestLayerIds = manifest.layers
      .filter((layer) => layer.type !== 'vector-style')
      .map((layer) => layer.id);
    const missingLayerIds = manifestLayerIds.filter((layerId) => !map.getLayer(`catchment-layer-${layerId}`));
    const renderedLayerIds = map
      .queryRenderedFeatures(map.project(map.getCenter()))
      .map((feature) => feature.layer.id);

    return {
      missingLayerIds,
      renderedLayerIds,
      subcatchmentFeatureCount: map.querySourceFeatures('catchment-source-subcatchments').length,
      errors: __mapErrors,
    };
  });

  expect(state).not.toBeNull();
  expect(state?.missingLayerIds).toEqual([]);
  expect(state?.subcatchmentFeatureCount).toBe(3);
  expect(state?.renderedLayerIds).toContain('catchment-layer-subcatchments');
  expect(state?.errors).toEqual([]);
});
