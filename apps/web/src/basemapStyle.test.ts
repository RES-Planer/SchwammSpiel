import { describe, expect, test, vi } from 'vitest';

import { applyBaseStyle, defaultMapStyle, isActiveStyleLoadError } from './basemapStyle';

type EventName = 'error' | 'style.load';
type Listener = ((event?: unknown) => void) & { original?: (event?: unknown) => void };

function createMapStub() {
  const listeners: Record<EventName, Listener[]> = {
    error: [],
    'style.load': [],
  };

  const map = {
    listeners,
    setStyle: vi.fn(),
    on(type: EventName, listener: Listener) {
      listeners[type].push(listener);
      return map;
    },
    once(type: EventName, listener: Listener) {
      const wrapped: Listener = (event) => {
        map.off(type, wrapped);
        listener(event);
      };
      wrapped.original = listener;
      listeners[type].push(wrapped);
      return map;
    },
    off(type: EventName, listener: Listener) {
      listeners[type] = listeners[type].filter((entry) => entry !== listener && entry.original !== listener);
      return map;
    },
    emit(type: EventName, event?: unknown) {
      for (const listener of [...listeners[type]]) {
        listener(event);
      }
    },
  };

  return map;
}

describe('basemap style helpers', () => {
  test('loads a visible remote vector style and clears its temporary error listener after success', () => {
    const map = createMapStub();
    const onStyleReady = vi.fn();
    const requestedStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';

    const cleanup = applyBaseStyle(map, requestedStyleUrl, onStyleReady);

    expect(map.setStyle).toHaveBeenCalledWith(requestedStyleUrl);
    expect(map.listeners.error).toHaveLength(1);

    map.emit('style.load');

    expect(onStyleReady).toHaveBeenCalledTimes(1);
    expect(map.listeners.error).toHaveLength(0);

    cleanup();
  });

  test('falls back to the default style when the active remote style request fails', () => {
    const map = createMapStub();
    const onStyleReady = vi.fn();
    const requestedStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';

    applyBaseStyle(map, requestedStyleUrl, onStyleReady);
    map.emit('error', { error: { url: 'https://tiles.example.invalid/style.json' } });
    expect(map.setStyle).toHaveBeenCalledTimes(1);

    map.emit('error', { error: { url: requestedStyleUrl } });

    expect(map.setStyle).toHaveBeenNthCalledWith(1, requestedStyleUrl);
    expect(map.setStyle).toHaveBeenNthCalledWith(2, defaultMapStyle);

    map.emit('style.load');
    expect(onStyleReady).toHaveBeenCalledTimes(1);
  });

  test('recognizes only active style load errors for fallback handling', () => {
    const requestedStyleUrl = 'https://tiles.openfreemap.org/styles/liberty';

    expect(isActiveStyleLoadError({ error: { url: requestedStyleUrl } }, requestedStyleUrl)).toBe(true);
    expect(isActiveStyleLoadError({ error: { url: 'https://tiles.example.invalid/style.json' } }, requestedStyleUrl)).toBe(
      false,
    );
    expect(isActiveStyleLoadError({}, requestedStyleUrl)).toBe(false);
  });
});
