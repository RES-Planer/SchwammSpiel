import { expect, test } from '@playwright/test';

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoWHAAAAOEAeE2qCkcAAAAAElFTkSuQmCC',
  'base64',
);

test('renders production manifest layers without map load errors', async ({ page }, testInfo) => {
  await page.route('https://sgx.geodatenzentrum.de/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: {
        'access-control-allow-origin': '*',
      },
      body: transparentPng,
    });
  });

  await page.goto('/SchwammSpiel/', { waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const map = (window as Window & { __map?: unknown }).__map;
    return Boolean(map);
  });

  const state = await page.evaluate(async () => {
    const { __map: map, __mapErrors = [] } = window as Window & {
      __map?: {
        areTilesLoaded(): boolean;
        getCanvas(): HTMLCanvasElement;
        getCenter(): { lng: number; lat: number; toArray(): [number, number] };
        getLayer(id: string): unknown;
        isStyleLoaded(): boolean;
        loaded(): boolean;
        once(type: 'idle', listener: () => void): void;
        project(lngLat: [number, number]): { x: number; y: number };
        queryRenderedFeatures(options?: { layers?: string[] }): Array<{ properties?: unknown }>;
        querySourceFeatures(sourceId: string): Array<{ properties?: unknown }>;
        setBearing(bearing: number): void;
        setPitch(pitch: number): void;
        setZoom(zoom: number): void;
        triggerRepaint(): void;
      };
      __mapErrors?: Array<{ message: string; sourceId?: string }>;
    };
    if (!map) {
      return null;
    }

    if (!map.loaded() || !map.isStyleLoaded()) {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error('Timed out waiting for map idle')), 15_000);
        map.once('idle', () => {
          window.clearTimeout(timeoutId);
          resolve();
        });
      });
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
        features?: Array<{
          geometry?: {
            type?: string;
            coordinates?: number[][][];
          };
        }>;
      };
    })) as {
      features?: Array<{
        geometry?: {
          type?: string;
          coordinates?: number[][][];
        };
      }>;
    };
    const firstFeature = (subcatchmentGeoJson.features?.[0] as
      | {
          geometry?: {
            type?: string;
            coordinates?: number[][][];
          };
        }
      | undefined)?.geometry;
    if (firstFeature?.type !== 'Polygon' || !firstFeature.coordinates?.[0]?.length) {
      throw new Error('Expected first subcatchment polygon');
    }
    const firstRing = firstFeature.coordinates[0];
    const bbox = firstRing.reduce(
      (current, [lng, lat]) => ({
        minLng: Math.min(current.minLng, lng),
        maxLng: Math.max(current.maxLng, lng),
        minLat: Math.min(current.minLat, lat),
        maxLat: Math.max(current.maxLat, lat),
      }),
      { minLng: Number.POSITIVE_INFINITY, maxLng: Number.NEGATIVE_INFINITY, minLat: Number.POSITIVE_INFINITY, maxLat: Number.NEGATIVE_INFINITY },
    );
    const renderedSubcatchments = map.queryRenderedFeatures({ layers: ['catchment-layer-subcatchments'] });
    const sourceSubcatchments = map.querySourceFeatures('catchment-source-subcatchments');
    const probeLngLat: [number, number] = [(bbox.minLng + bbox.maxLng) / 2, (bbox.minLat + bbox.maxLat) / 2];
    const probePoint = map.project(probeLngLat);
    map.setPitch(0);
    map.setBearing(0);
    map.triggerRepaint();
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    const canvas = map.getCanvas();
    const gl =
      canvas.getContext('webgl', { preserveDrawingBuffer: true }) ??
      canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (!gl) {
      throw new Error('Expected WebGL context');
    }
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.max(0, Math.min(canvas.width - 1, Math.round(probePoint.x))),
      Math.max(0, Math.min(canvas.height - 1, Math.round(canvas.height - probePoint.y))),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );

    return {
      areTilesLoaded: map.areTilesLoaded(),
      canvasSize: { width: canvas.width, height: canvas.height },
      missingLayerIds,
      pixel: Array.from(pixel),
      probeLngLat,
      probePoint,
      renderedSubcatchmentCount: renderedSubcatchments.length,
      sourceSubcatchmentCount: sourceSubcatchments.length,
      subcatchmentFeatureCount: subcatchmentGeoJson.features?.length ?? 0,
      errors: __mapErrors,
    };
  });

  expect(state).not.toBeNull();
  expect(state?.missingLayerIds).toEqual([]);
  expect(state?.subcatchmentFeatureCount).toBe(3);
  expect(state?.sourceSubcatchmentCount).toBe(3);
  expect(state?.renderedSubcatchmentCount).toBeGreaterThanOrEqual(1);
  expect(state?.pixel).not.toEqual([248, 250, 252, 255]);
  expect(state?.errors).toEqual([]);

  const screenshotPath = testInfo.outputPath('map-render.png');
  await page.locator('.maplibregl-map').screenshot({ path: screenshotPath });
  await testInfo.attach('map-render', {
    path: screenshotPath,
    contentType: 'image/png',
  });
});
