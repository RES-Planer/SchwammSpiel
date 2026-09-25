import type * as maplibregl from 'maplibre-gl';
import { describe, expect, test } from 'vitest';

import { resolveSourceIdFromMapError } from './layerLoadErrors';

describe('resolveSourceIdFromMapError', () => {
  test('prefers the explicit sourceId on the error event', () => {
    const event = {
      sourceId: 'catchment-source-subcatchments',
      target: { id: 'catchment-source-hillshade' },
    } as unknown as maplibregl.ErrorEvent;

    expect(resolveSourceIdFromMapError(event)).toBe('catchment-source-subcatchments');
  });

  test('falls back to the originating target id when sourceId is missing', () => {
    const event = {
      target: { id: 'catchment-source-hillshade' },
    } as unknown as maplibregl.ErrorEvent;

    expect(resolveSourceIdFromMapError(event)).toBe('catchment-source-hillshade');
  });

  test('returns undefined when no source identifier is available', () => {
    const event = {
      target: { url: '/SchwammSpiel/data/demo/hillshade.png' },
    } as unknown as maplibregl.ErrorEvent;

    expect(resolveSourceIdFromMapError(event)).toBeUndefined();
  });
});
