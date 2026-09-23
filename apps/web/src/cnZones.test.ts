import { describe, expect, test } from 'vitest';

import { extractCnZones, inferCnZoneDefaults } from './cnZones';
import type { MeasureState } from './scenarioState';

const polygonGeometry: NonNullable<MeasureState['geometry']> = {
  type: 'Polygon',
  coordinates: [
    [11.91, 49.91],
    [11.94, 49.91],
    [11.94, 49.94],
    [11.91, 49.94],
    [11.91, 49.91],
  ],
};

describe('cnZones', () => {
  test('returns null when polygon does not overlap any CN zone', () => {
    const zones = extractCnZones({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Wald / B', cn: 60 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [11.95, 49.95],
                [11.99, 49.95],
                [11.99, 49.99],
                [11.95, 49.99],
                [11.95, 49.95],
              ],
            ],
          },
        },
      ],
    });

    expect(inferCnZoneDefaults(polygonGeometry, zones)).toBeNull();
  });

  test('returns null when overlap exists but land-use/soil parsing is incomplete', () => {
    const zones = extractCnZones({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Unbekannt', cn: 70 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [11.9, 49.9],
                [11.95, 49.9],
                [11.95, 49.95],
                [11.9, 49.95],
                [11.9, 49.9],
              ],
            ],
          },
        },
      ],
    });

    expect(inferCnZoneDefaults(polygonGeometry, zones)).toBeNull();
  });

  test('supports CN zones in MultiPolygon geometries', () => {
    const zones = extractCnZones({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Wald / B', cn: 60 },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [11.9, 49.9],
                  [11.95, 49.9],
                  [11.95, 49.95],
                  [11.9, 49.95],
                  [11.9, 49.9],
                ],
              ],
            ],
          },
        },
      ],
    });

    expect(inferCnZoneDefaults(polygonGeometry, zones)).toEqual({
      landUse: 'Wald',
      soilGroup: 'B',
      cn: 60,
    });
  });

  test('does not treat polygon holes as valid CN zone area', () => {
    const zones = extractCnZones({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Wald / B', cn: 60 },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [11.9, 49.9],
                [11.95, 49.9],
                [11.95, 49.95],
                [11.9, 49.95],
                [11.9, 49.9],
              ],
              [
                [11.91, 49.91],
                [11.94, 49.91],
                [11.94, 49.94],
                [11.91, 49.94],
                [11.91, 49.91],
              ],
            ],
          },
        },
      ],
    });

    expect(inferCnZoneDefaults(polygonGeometry, zones)).toBeNull();
  });
});
