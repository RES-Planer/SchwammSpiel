import { describe, expect, test } from 'vitest';

import {
  commitHistoryState,
  createHistoryState,
  createInitialScenarioState,
  decodeScenarioState,
  encodeScenarioState,
  fromShareFragment,
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
});
