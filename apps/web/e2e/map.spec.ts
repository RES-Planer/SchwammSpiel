import { expect, test } from '@playwright/test';

test('renders production manifest layers without map load errors', async ({ page }) => {
  await page.goto('/SchwammSpiel/', { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const map = (window as Window & { __map?: unknown }).__map;
    return Boolean(map);
  });

  const state = await page.evaluate(async () => {
    const { __map: map, __mapErrors = [] } = window as Window & {
      __map?: {
        getLayer(id: string): unknown;
        loaded(): boolean;
      };
      __mapErrors?: Array<{ message: string; sourceId?: string }>;
    };
    if (!map) {
      return null;
    }

    const manifest = (await fetch('/SchwammSpiel/data/demo/manifest.json').then(async (response) => {
      return (await response.json()) as {
        layers: Array<{ id: string; type: string; layerType?: string }>;
      };
    })) as { layers: Array<{ id: string; type: string; layerType?: string }> };
    const manifestLayerIds = manifest.layers
      .filter((layer) => layer.type !== 'vector-style' && typeof layer.layerType === 'string')
      .map((layer) => layer.id);
    const missingLayerIds = manifestLayerIds.filter((layerId) => !map.getLayer(`catchment-layer-${layerId}`));
    const subcatchmentGeoJson = (await fetch('/SchwammSpiel/data/demo/subcatchments.geojson').then(async (response) => {
      return (await response.json()) as {
        features?: unknown[];
      };
    })) as { features?: unknown[] };

    return {
      missingLayerIds,
      subcatchmentFeatureCount: subcatchmentGeoJson.features?.length ?? 0,
      errors: __mapErrors,
    };
  });

  expect(state).not.toBeNull();
  expect(state?.missingLayerIds).toEqual([]);
  expect(state?.subcatchmentFeatureCount).toBe(3);
  expect(state?.errors).toEqual([]);
});
