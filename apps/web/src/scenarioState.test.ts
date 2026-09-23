import { describe, expect, test } from 'vitest';

import {
  commitHistoryState,
  createHistoryState,
  createInitialScenarioState,
  decodeScenarioState,
  encodeScenarioState,
  fromShareFragment,
  loadSharedScenarioForCatchment,
  redoHistoryState,
  toShareFragment,
  undoHistoryState,
} from './scenarioState';

describe('scenario state helpers', () => {
  test('supports undo and redo', () => {
    const initial = createInitialScenarioState('demo');
    const withMeasure = {
      ...initial,
      measures: [
        {
          id: 'm-1',
          kind: 'forestMulches' as const,
          enabled: true,
          params: { count: 2, volumeEachM3: 10 },
          geometry: null,
        },
      ],
    };

    const history = commitHistoryState(createHistoryState(initial), withMeasure);
    const undone = undoHistoryState(history);
    const redone = redoHistoryState(undone);

    expect(undone.present).toEqual(initial);
    expect(redone.present).toEqual(withMeasure);
  });

  test('encodes and decodes scenario state payloads', async () => {
    const state = {
      version: 1 as const,
      catchmentId: 'demo',
      measures: [
        {
          id: 'm-1',
          kind: 'swale' as const,
          enabled: true,
          params: { depthM: 0.5, bottomWidthM: 0.5 },
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [11.93, 49.945] as [number, number],
              [11.931, 49.946] as [number, number],
            ],
          },
        },
      ],
    };

    const encoded = await encodeScenarioState(state);
    const decoded = await decodeScenarioState(encoded);

    expect(decoded).toEqual(state);
  });

  test('maps state to and from URL fragments', async () => {
    const state = createInitialScenarioState('goldbach');
    const fragment = await toShareFragment(state);
    const decoded = await fromShareFragment(`#${fragment}`);

    expect(decoded).toEqual(state);
  });

  test('ignores shared fragments from another catchment', async () => {
    const state = createInitialScenarioState('goldbach');
    const fragment = await toShareFragment(state);
    const forDemo = await loadSharedScenarioForCatchment(`#${fragment}`, 'demo');
    const forGoldbach = await loadSharedScenarioForCatchment(`#${fragment}`, 'goldbach');

    expect(forDemo).toBeNull();
    expect(forGoldbach).toEqual(state);
  });

  test('uses gz payload when compression streams are available', async () => {
    if (
      typeof globalThis.CompressionStream === 'undefined' ||
      typeof globalThis.DecompressionStream === 'undefined'
    ) {
      return;
    }

    const largeState = {
      version: 1 as const,
      catchmentId: 'demo',
      measures: Array.from({ length: 24 }, (_, index) => ({
        id: `m-${index}`,
        kind: 'landUseChange' as const,
        enabled: true,
        params: {
          landUse: 'arable',
          notes: 'repeated-text-for-compression-repeated-text-for-compression',
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [11.93, 49.945] as [number, number],
            [11.931, 49.945] as [number, number],
            [11.931, 49.946] as [number, number],
            [11.93, 49.946] as [number, number],
            [11.93, 49.945] as [number, number],
          ],
        },
      })),
    };

    const encoded = await encodeScenarioState(largeState);
    expect(encoded.startsWith('gz.')).toBe(true);
    await expect(decodeScenarioState(encoded)).resolves.toEqual(largeState);
  });

  test('fails with compressed payload when DecompressionStream is unavailable', async () => {
    const originalDecompressionStream = globalThis.DecompressionStream;
    try {
      // Simulate environments without stream-based gzip support.
      Object.defineProperty(globalThis, 'DecompressionStream', {
        configurable: true,
        writable: true,
        value: undefined,
      });

      await expect(decodeScenarioState('gz.AA')).rejects.toThrow(
        'Cannot decode compressed payload in this environment',
      );
    } finally {
      Object.defineProperty(globalThis, 'DecompressionStream', {
        configurable: true,
        writable: true,
        value: originalDecompressionStream,
      });
    }
  });
});
