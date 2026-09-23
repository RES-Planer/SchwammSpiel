import * as maplibregl from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import {
  buildDataUrl,
  buildManifestUrl,
  collectAttributions,
  createInitialVisibility,
  extractSubcatchmentDetails,
  getLocalizedText,
  resolveCatchmentId,
  type CatchmentManifest,
  type LayerManifest,
  type SubcatchmentDetails,
} from './mapData';
import { locales, type Locale, t } from './i18n';
import './app.css';

const mapStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
};

export function App() {
  const [locale, setLocale] = useState<Locale>('de');
  const [mapReady, setMapReady] = useState(false);
  const [manifest, setManifest] = useState<CatchmentManifest | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [selectedSubcatchment, setSelectedSubcatchment] = useState<SubcatchmentDetails | null>(null);
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const scaleControlRef = useRef<maplibregl.ScaleControl | null>(null);
  const attributionControlRef = useRef<maplibregl.AttributionControl | null>(null);
  const addedLayerIdsRef = useRef<string[]>([]);
  const addedSourceIdsRef = useRef<string[]>([]);
  const catchmentId = useMemo(() => resolveCatchmentId(window.location.search), []);
  const localeTag = locale === 'cs' ? 'cs-CZ' : locale === 'en' ? 'en-US' : 'de-DE';
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 }),
    [localeTag],
  );

  useEffect(() => {
    const mapElement = mapElementRef.current;
    if (!mapElement) {
      return undefined;
    }

    const map = new maplibregl.Map({
      container: mapElement,
      style: mapStyle,
      center: [11.93, 49.945],
      zoom: 13,
      attributionControl: false,
    });

    const handleLoad = () => setMapReady(true);
    map.on('load', handleLoad);
    mapRef.current = map;

    const scaleControl = new maplibregl.ScaleControl({ maxWidth: 140, unit: 'metric' });
    map.addControl(scaleControl, 'bottom-left');
    scaleControlRef.current = scaleControl;

    return () => {
      map.off('load', handleLoad);
      mapRef.current = null;
      scaleControlRef.current = null;
      attributionControlRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoadingState('loading');
    setLoadError('');
    setSelectedSubcatchment(null);

    void fetch(buildManifestUrl(import.meta.env.BASE_URL, catchmentId))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as CatchmentManifest;
      })
      .then((data) => {
        if (cancelled) {
          return;
        }
        setManifest(data);
        setLayerVisibility(createInitialVisibility(data.layers));
        setLoadingState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setManifest(null);
        setLayerVisibility({});
        setLoadingState('error');
        setLoadError(error instanceof Error ? error.message : 'Unknown error');
      });

    return () => {
      cancelled = true;
    };
  }, [catchmentId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return undefined;
    }

    if (attributionControlRef.current) {
      map.removeControl(attributionControlRef.current);
    }

    const control = new maplibregl.AttributionControl({
      customAttribution: [t(locale, 'map.attribution'), ...collectAttributions(manifest, locale)],
    });

    map.addControl(control);
    attributionControlRef.current = control;

    return () => {
      if (attributionControlRef.current) {
        map.removeControl(attributionControlRef.current);
        attributionControlRef.current = null;
      }
    };
  }, [locale, manifest]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !manifest) {
      return undefined;
    }

    removeManifestLayers(map, addedLayerIdsRef.current, addedSourceIdsRef.current);
    const addedLayerIds: string[] = [];
    const addedSourceIds: string[] = [];

    for (const layer of manifest.layers) {
      const sourceId = sourceIdFor(layer.id);
      const layerId = layerIdFor(layer.id);
      const paint = layer.style?.paint as Record<string, unknown> | undefined;
      const layout = {
        visibility: layer.visibleByDefault === false ? 'none' : 'visible',
        ...(layer.style?.layout ?? {}),
      } as Record<string, unknown>;

      if (layer.type === 'geojson') {
        map.addSource(sourceId, {
          type: 'geojson',
          data: buildDataUrl(import.meta.env.BASE_URL, catchmentId, layer.path),
        });
        map.addLayer({
          id: layerId,
          type: layer.layerType,
          source: sourceId,
          paint,
          layout,
          minzoom: layer.minzoom,
          maxzoom: layer.maxzoom,
        } as maplibregl.AddLayerObject);
      } else {
        map.addSource(sourceId, {
          type: 'image',
          url: buildDataUrl(import.meta.env.BASE_URL, catchmentId, layer.path),
          coordinates: layer.coordinates,
        });
        map.addLayer({
          id: layerId,
          type: layer.layerType,
          source: sourceId,
          paint,
          layout,
          minzoom: layer.minzoom,
          maxzoom: layer.maxzoom,
        } as maplibregl.AddLayerObject);
      }

      addedLayerIds.push(layerId);
      addedSourceIds.push(sourceId);
    }

    addedLayerIdsRef.current = addedLayerIds;
    addedSourceIdsRef.current = addedSourceIds;
    map.fitBounds(manifest.bounds, { padding: { top: 72, right: 24, bottom: 72, left: 24 }, duration: 0 });

    return () => {
      removeManifestLayers(map, addedLayerIds, addedSourceIds);
      addedLayerIdsRef.current = [];
      addedSourceIdsRef.current = [];
    };
  }, [catchmentId, manifest, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !manifest) {
      return;
    }

    for (const layer of manifest.layers) {
      const layerId = layerIdFor(layer.id);
      if (!map.getLayer(layerId)) {
        continue;
      }
      const isVisible = layerVisibility[layer.id] ?? layer.visibleByDefault ?? true;
      map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
    }
  }, [layerVisibility, manifest, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const inspectableLayer = manifest?.layers.find(
      (layer): layer is Extract<LayerManifest, { type: 'geojson' }> =>
        layer.type === 'geojson' && layer.inspectable === true,
    );
    if (!mapReady || !map || !inspectableLayer) {
      return undefined;
    }

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point, {
        layers: [layerIdFor(inspectableLayer.id)],
      })[0];
      setSelectedSubcatchment(
        feature?.properties
          ? extractSubcatchmentDetails(feature.properties as Record<string, unknown>)
          : null,
      );
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [manifest, mapReady]);

  useEffect(() => {
    document.title = t(locale, 'app.title');
    document.documentElement.lang = locale;
  }, [locale]);

  const visibleLayers = manifest?.layers.filter((layer) => layerVisibility[layer.id] ?? layer.visibleByDefault ?? true) ?? [];

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div>
          <h1>{t(locale, 'app.title')}</h1>
          <p className="subtitle">
            {manifest ? getLocalizedText(manifest.name, locale, catchmentId) : catchmentId}
          </p>
        </div>
        <div className="toolbar-actions">
          <label htmlFor="language-select">{t(locale, 'app.language')}</label>
          <select
            id="language-select"
            value={locale}
            onChange={(event) => setLocale((event.target as HTMLSelectElement).value as Locale)}
          >
            {locales.map((option) => (
              <option key={option} value={option}>
                {t(locale, `app.language.${option}`)}
              </option>
            ))}
          </select>
        </div>
      </header>

      <p className="scenario-note">{t(locale, 'app.scenarioNote')}</p>

      <section className="map-layout">
        <aside className="panel">
          <h2>{t(locale, 'map.layers')}</h2>
          <fieldset className="layer-list">
            <legend className="sr-only">{t(locale, 'map.layers')}</legend>
            {manifest?.layers.map((layer) => (
              <label key={layer.id} className="layer-toggle">
                <input
                  type="checkbox"
                  checked={layerVisibility[layer.id] ?? layer.visibleByDefault ?? true}
                  onChange={() =>
                    setLayerVisibility((current) => ({
                      ...current,
                      [layer.id]: !(current[layer.id] ?? layer.visibleByDefault ?? true),
                    }))
                  }
                />
                <span>{getLocalizedText(layer.name, locale, layer.id)}</span>
              </label>
            ))}
          </fieldset>

          <h2>{t(locale, 'map.legend')}</h2>
          {visibleLayers.length > 0 ? (
            <ul className="legend-list">
              {visibleLayers.map((layer) => (
                <li key={layer.id} className="legend-item">
                  <span className={legendClassName(layer)} style={legendStyle(layer)} aria-hidden="true" />
                  <span>{getLocalizedText(layer.name, locale, layer.id)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="panel-empty">{t(locale, 'map.legend.empty')}</p>
          )}
        </aside>

        <div className="map-frame">
          <div
            ref={mapElementRef}
            id="map"
            aria-label={t(locale, 'app.mapLabel')}
            role="region"
          />
          {loadingState === 'loading' ? (
            <div className="map-overlay">{t(locale, 'map.loading')}</div>
          ) : null}
          {loadingState === 'error' ? (
            <div className="map-overlay map-overlay-error" role="alert">
              <strong>{t(locale, 'map.loadError')}</strong>
              <span>{loadError}</span>
            </div>
          ) : null}
        </div>

        <aside className={`panel details-panel${selectedSubcatchment ? ' is-open' : ''}`}>
          <h2>{t(locale, 'map.details.title')}</h2>
          {selectedSubcatchment ? (
            <dl className="details-list">
              <div>
                <dt>{t(locale, 'map.details.name')}</dt>
                <dd>{selectedSubcatchment.name}</dd>
              </div>
              <div>
                <dt>{t(locale, 'map.details.areaHa')}</dt>
                <dd>{formatValue(numberFormatter, selectedSubcatchment.areaHa, 'ha')}</dd>
              </div>
              <div>
                <dt>{t(locale, 'map.details.cn')}</dt>
                <dd>{formatValue(numberFormatter, selectedSubcatchment.cn)}</dd>
              </div>
              <div>
                <dt>{t(locale, 'map.details.tcH')}</dt>
                <dd>{formatValue(numberFormatter, selectedSubcatchment.tcH, 'h')}</dd>
              </div>
              <div>
                <dt>{t(locale, 'map.details.landuseShares')}</dt>
                <dd>
                  <ul className="share-list">
                    {selectedSubcatchment.landuseShares.map((share) => (
                      <li key={share.labelKey}>
                        <span>{t(locale, share.labelKey)}</span>
                        <span>{formatValue(numberFormatter, share.valuePct, '%')}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="panel-empty">{t(locale, 'map.details.empty')}</p>
          )}
        </aside>
      </section>
    </main>
  );
}

function sourceIdFor(layerId: string): string {
  return `catchment-source-${layerId}`;
}

function layerIdFor(layerId: string): string {
  return `catchment-layer-${layerId}`;
}

function removeManifestLayers(map: maplibregl.Map, layerIds: string[], sourceIds: string[]): void {
  for (const layerId of layerIds) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  for (const sourceId of sourceIds) {
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
  }
}

function formatValue(formatter: Intl.NumberFormat, value: number | null, unit?: string): string {
  if (value === null) {
    return '–';
  }
  const formatted = formatter.format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function legendClassName(layer: LayerManifest): string {
  if (!layer.legend) {
    return 'legend-swatch';
  }

  return `legend-swatch legend-${layer.legend.type}`;
}

function legendStyle(layer: LayerManifest): { background?: string; borderColor?: string } {
  if (!layer.legend) {
    return {};
  }

  switch (layer.legend.type) {
    case 'fill':
    case 'line':
    case 'circle':
      return { background: layer.legend.color, borderColor: layer.legend.color };
    case 'raster':
      return {
        background: `linear-gradient(90deg, ${layer.legend.colorRamp[0]}, ${layer.legend.colorRamp[1]})`,
      };
  }
}
