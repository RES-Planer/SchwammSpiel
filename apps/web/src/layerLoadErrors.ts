import type * as maplibregl from 'maplibre-gl';

export function resolveSourceIdFromMapError(event: maplibregl.ErrorEvent): string | undefined {
  const eventSourceId = (event as unknown as { sourceId?: unknown }).sourceId;
  if (typeof eventSourceId === 'string') {
    return eventSourceId;
  }

  const target = (event as unknown as { target?: unknown }).target;
  if (!target || typeof target !== 'object') {
    return undefined;
  }

  const targetId = (target as { id?: unknown }).id;
  return typeof targetId === 'string' ? targetId : undefined;
}
