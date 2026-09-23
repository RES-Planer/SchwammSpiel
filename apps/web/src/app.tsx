import {
  analyzeStonefieldHydraulics,
  sizeStorageForTarget,
  stonefieldGeometry,
  swaleGeometry,
  validateSwaleContourAlignment,
} from '@schwammspiel/engine';
import * as maplibregl from 'maplibre-gl';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { geodesicLengthM, geodesicPolygonAreaM2, type LngLat } from './geodesy';
import { locales, type Locale, t } from './i18n';
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
import {
  commitHistoryState,
  createHistoryState,
  createInitialScenarioState,
  fromShareFragment,
  redoHistoryState,
  toShareFragment,
  undoHistoryState,
  type HistoryState,
  type MeasureKind,
  type MeasureState,
  type ScenarioState,
} from './scenarioState';
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

type DrawMode = {
  kind: MeasureKind;
  geometryType: 'Polygon' | 'LineString' | null;
};

type MeasureSummary = {
  areaHa: number;
  lengthM: number;
  volumeM3: number;
  excavationM3: number;
  warnings: string[];
};

type MapFeature =
  | {
      type: 'Feature';
      properties: Record<string, boolean | string>;
      geometry: { type: 'Polygon'; coordinates: [number, number][][] };
    }
  | {
      type: 'Feature';
      properties: Record<string, boolean | string>;
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    };

type MapFeatureCollection = {
  type: 'FeatureCollection';
  features: MapFeature[];
};

const toolOrder: DrawMode[] = [
  { kind: 'landUseChange', geometryType: 'Polygon' },
  { kind: 'storageWithPipe', geometryType: 'Polygon' },
  { kind: 'forestMulches', geometryType: null },
  { kind: 'swale', geometryType: 'LineString' },
  { kind: 'stonefield', geometryType: 'Polygon' },
  { kind: 'flowPathChange', geometryType: 'LineString' },
];

export function App() {
  const [locale, setLocale] = useState<Locale>('de');
  const [mapReady, setMapReady] = useState(false);
  const [manifest, setManifest] = useState<CatchmentManifest | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [selectedSubcatchment, setSelectedSubcatchment] = useState<SubcatchmentDetails | null>(null);
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [draftCoordinates, setDraftCoordinates] = useState<LngLat[]>([]);
  const [selectedMeasureId, setSelectedMeasureId] = useState<string | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const scaleControlRef = useRef<maplibregl.ScaleControl | null>(null);
  const attributionControlRef = useRef<maplibregl.AttributionControl | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addedLayerIdsRef = useRef<string[]>([]);
  const addedSourceIdsRef = useRef<string[]>([]);
  const catchmentId = useMemo(() => resolveCatchmentId(window.location.search), []);
  const [scenarioHistory, setScenarioHistory] = useState<HistoryState<ScenarioState>>(() =>
    createHistoryState(createInitialScenarioState(catchmentId)),
  );
  const scenario = scenarioHistory.present;
  const localeTag = locale === 'cs' ? 'cs-CZ' : locale === 'en' ? 'en-US' : 'de-DE';
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 }),
    [localeTag],
  );

  useEffect(() => {
    let cancelled = false;
    const initialState = createInitialScenarioState(catchmentId);
    void fromShareFragment(window.location.hash)
      .then((sharedState) => {
        if (cancelled) {
          return;
        }
        if (!sharedState || sharedState.catchmentId !== catchmentId) {
          setScenarioHistory(createHistoryState(initialState));
          return;
        }
        setScenarioHistory(createHistoryState(sharedState));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setScenarioHistory(createHistoryState(initialState));
        setShareMessage(t(locale, 'scenario.share.invalid'));
      });

    return () => {
      cancelled = true;
    };
  }, [catchmentId]);

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
      if (drawMode) {
        const clicked: LngLat = [event.lngLat.lng, event.lngLat.lat];
        setDraftCoordinates((current) => [...current, clicked]);
        return;
      }
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
  }, [drawMode, manifest, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }

    const sourceId = 'scenario-measures-source';
    const draftSourceId = 'scenario-draft-source';
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: 'scenario-measures-fill',
        type: 'fill',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#0ea5e9',
          'fill-outline-color': '#0369a1',
          'fill-opacity': ['case', ['boolean', ['get', 'enabled'], true], 0.22, 0.08],
        },
      });
      map.addLayer({
        id: 'scenario-measures-line',
        type: 'line',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#0369a1',
          'line-width': 3,
          'line-opacity': ['case', ['boolean', ['get', 'enabled'], true], 0.95, 0.35],
        },
      });
    }

    if (!map.getSource(draftSourceId)) {
      map.addSource(draftSourceId, {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: 'scenario-draft-line',
        type: 'line',
        source: draftSourceId,
        paint: {
          'line-color': '#f97316',
          'line-width': 3,
          'line-dasharray': [2, 2],
        },
      });
      map.addLayer({
        id: 'scenario-draft-fill',
        type: 'fill',
        source: draftSourceId,
        paint: {
          'fill-color': '#fb923c',
          'fill-opacity': 0.2,
        },
      });
    }
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }

    const source = map.getSource('scenario-measures-source') as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      return;
    }

    source.setData(measuresToFeatureCollection(scenario.measures));
  }, [mapReady, scenario.measures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }

    const source = map.getSource('scenario-draft-source') as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      return;
    }

    source.setData(draftToFeatureCollection(drawMode, draftCoordinates));
  }, [drawMode, draftCoordinates, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }

    if (drawMode) {
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = 'crosshair';
      return () => {
        map.doubleClickZoom.enable();
        map.getCanvas().style.cursor = '';
      };
    }

    map.getCanvas().style.cursor = '';
    return undefined;
  }, [drawMode, mapReady]);

  useEffect(() => {
    document.title = t(locale, 'app.title');
    document.documentElement.lang = locale;
  }, [locale]);

  const visibleLayers = manifest?.layers.filter((layer) => layerVisibility[layer.id] ?? layer.visibleByDefault ?? true) ?? [];
  const selectedMeasure = scenario.measures.find((measure) => measure.id === selectedMeasureId) ?? null;

  const applyScenarioUpdate = (updater: (current: ScenarioState) => ScenarioState) => {
    setScenarioHistory((current) => commitHistoryState(current, updater(current.present)));
  };

  const addMeasure = (kind: MeasureKind, geometry: MeasureState['geometry']) => {
    const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
    const measure: MeasureState = {
      id,
      kind,
      enabled: true,
      geometry,
      params: defaultParams(kind),
    };

    applyScenarioUpdate((current) => ({
      ...current,
      measures: [...current.measures, measure],
    }));
    setSelectedMeasureId(id);
  };

  const startTool = (mode: DrawMode) => {
    if (mode.geometryType === null) {
      addMeasure(mode.kind, null);
      return;
    }
    setDrawMode(mode);
    setDraftCoordinates([]);
  };

  const finishDrawing = () => {
    if (!drawMode || !drawMode.geometryType) {
      return;
    }

    if (drawMode.geometryType === 'Polygon') {
      if (draftCoordinates.length < 3) {
        return;
      }
      addMeasure(drawMode.kind, {
        type: 'Polygon',
        coordinates: closeRing(draftCoordinates),
      });
    } else {
      if (draftCoordinates.length < 2) {
        return;
      }
      addMeasure(drawMode.kind, {
        type: 'LineString',
        coordinates: draftCoordinates,
      });
    }

    setDrawMode(null);
    setDraftCoordinates([]);
  };

  const cancelDrawing = () => {
    setDrawMode(null);
    setDraftCoordinates([]);
  };

  const deleteMeasure = (id: string) => {
    applyScenarioUpdate((current) => ({
      ...current,
      measures: current.measures.filter((measure) => measure.id !== id),
    }));
    if (selectedMeasureId === id) {
      setSelectedMeasureId(null);
    }
  };

  const updateMeasure = (id: string, updater: (measure: MeasureState) => MeasureState) => {
    applyScenarioUpdate((current) => ({
      ...current,
      measures: current.measures.map((measure) => (measure.id === id ? updater(measure) : measure)),
    }));
  };

  const applyStorageSuggestion = () => {
    if (!selectedMeasure || selectedMeasure.kind !== 'storageWithPipe') {
      return;
    }

    const depthM = readNumber(selectedMeasure.params.depthM, 1.2);
    const pipeDnMm = readNumber(selectedMeasure.params.pipeDnMm, 300);
    const pipeLengthM = readNumber(selectedMeasure.params.pipeLengthM, 12);
    const areaHa = selectedSubcatchment?.areaHa ?? 50;
    const qPeak = Math.max(0.05, areaHa * 0.0045);
    const inflow = [0, qPeak * 0.25, qPeak * 0.65, qPeak, qPeak * 0.75, qPeak * 0.4, qPeak * 0.1, 0];
    const targetQOutM3s = readNumber(selectedMeasure.params.targetQOutM3s, Math.max(0.03, qPeak * 0.35));
    const suggested = sizeStorageForTarget(
      inflow,
      0.25,
      { type: 'pipe', dnMm: pipeDnMm, lengthM: pipeLengthM },
      depthM,
      targetQOutM3s,
    );

    updateMeasure(selectedMeasure.id, (measure) => ({
      ...measure,
      params: {
        ...measure.params,
        suggestedVolumeM3: Number(suggested.toFixed(1)),
      },
    }));
  };

  const saveScenario = () => {
    const json = JSON.stringify(scenario, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${scenario.catchmentId}-scenario.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const loadScenarioFromFile = (file: File | null) => {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as ScenarioState;
        if (parsed.version !== 1 || !Array.isArray(parsed.measures)) {
          throw new Error('invalid');
        }
        if (parsed.catchmentId !== catchmentId) {
          throw new Error('catchment-mismatch');
        }
        setScenarioHistory(createHistoryState(parsed));
        setSelectedMeasureId(null);
        setShareMessage('');
      } catch (error) {
        if (error instanceof Error && error.message === 'catchment-mismatch') {
          setShareMessage(t(locale, 'scenario.file.catchmentMismatch'));
          return;
        }
        setShareMessage(t(locale, 'scenario.file.invalid'));
      }
    };
    reader.readAsText(file);
  };

  const shareScenario = async () => {
    const fragment = await toShareFragment(scenario);
    const url = new URL(window.location.href);
    url.hash = fragment;
    window.history.replaceState(null, '', url.toString());
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url.toString());
      setShareMessage(t(locale, 'scenario.share.copied'));
      return;
    }
    setShareMessage(t(locale, 'scenario.share.updated'));
  };

  const draftLengthM = geodesicLengthM(draftCoordinates);
  const draftAreaHa = drawMode?.geometryType === 'Polygon' ? geodesicPolygonAreaM2(closeRing(draftCoordinates)) / 1e4 : 0;

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
        <aside className="panel measures-panel">
          <h2>{t(locale, 'measure.toolbar.title')}</h2>
          <div className="measure-tool-grid">
            {toolOrder.map((tool) => (
              <button
                key={tool.kind}
                type="button"
                className={`tool-button${drawMode?.kind === tool.kind ? ' is-active' : ''}`}
                onClick={() => startTool(tool)}
              >
                {t(locale, `measure.tool.${tool.kind}`)}
              </button>
            ))}
          </div>

          {drawMode ? (
            <div className="draw-status">
              <p>
                {t(locale, 'measure.draw.active')}: {t(locale, `measure.tool.${drawMode.kind}`)}
              </p>
              <p>
                {drawMode.geometryType === 'Polygon'
                  ? `${t(locale, 'measure.metric.areaHa')}: ${formatValue(numberFormatter, draftAreaHa, 'ha')}`
                  : `${t(locale, 'measure.metric.lengthM')}: ${formatValue(numberFormatter, draftLengthM, 'm')}`}
              </p>
              <div className="draw-actions">
                <button type="button" onClick={finishDrawing}>
                  {t(locale, 'measure.draw.finish')}
                </button>
                <button type="button" onClick={cancelDrawing}>
                  {t(locale, 'measure.draw.cancel')}
                </button>
              </div>
            </div>
          ) : null}

          <div className="scenario-actions">
            <button
              type="button"
              onClick={() => setScenarioHistory((current) => undoHistoryState(current))}
              disabled={scenarioHistory.past.length === 0}
            >
              {t(locale, 'scenario.undo')}
            </button>
            <button
              type="button"
              onClick={() => setScenarioHistory((current) => redoHistoryState(current))}
              disabled={scenarioHistory.future.length === 0}
            >
              {t(locale, 'scenario.redo')}
            </button>
            <button type="button" onClick={saveScenario}>
              {t(locale, 'scenario.save')}
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              {t(locale, 'scenario.load')}
            </button>
            <button type="button" onClick={() => void shareScenario()}>
              {t(locale, 'scenario.share')}
            </button>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="application/json"
              onChange={(event) => {
                const input = event.target as HTMLInputElement;
                loadScenarioFromFile(input.files?.[0] ?? null);
                input.value = '';
              }}
            />
            {shareMessage ? <p className="hint-text">{shareMessage}</p> : null}
          </div>

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

          <h2>{t(locale, 'measure.cards.title')}</h2>
          {scenario.measures.length > 0 ? (
            <ul className="measure-list">
              {scenario.measures.map((measure) => {
                const summary = summarizeMeasure(measure);
                return (
                  <li key={measure.id} className="measure-card">
                    <label className="layer-toggle">
                      <input
                        type="checkbox"
                        checked={measure.enabled}
                        onChange={() =>
                          updateMeasure(measure.id, (current) => ({
                            ...current,
                            enabled: !current.enabled,
                          }))
                        }
                      />
                      <span>{t(locale, `measure.tool.${measure.kind}`)}</span>
                    </label>
                    <div className="measure-card-actions">
                      <button type="button" onClick={() => setSelectedMeasureId(measure.id)}>
                        {t(locale, 'measure.card.edit')}
                      </button>
                      <button type="button" onClick={() => deleteMeasure(measure.id)}>
                        {t(locale, 'measure.card.delete')}
                      </button>
                    </div>
                    <dl className="measure-metrics">
                      <div>
                        <dt>{t(locale, 'measure.metric.areaHa')}</dt>
                        <dd>{formatValue(numberFormatter, summary.areaHa, 'ha')}</dd>
                      </div>
                      <div>
                        <dt>{t(locale, 'measure.metric.lengthM')}</dt>
                        <dd>{formatValue(numberFormatter, summary.lengthM, 'm')}</dd>
                      </div>
                      <div>
                        <dt>{t(locale, 'measure.metric.volumeM3')}</dt>
                        <dd>{formatValue(numberFormatter, summary.volumeM3, 'm³')}</dd>
                      </div>
                      <div>
                        <dt>{t(locale, 'measure.metric.excavationM3')}</dt>
                        <dd>{formatValue(numberFormatter, summary.excavationM3, 'm³')}</dd>
                      </div>
                    </dl>
                    {summary.warnings.length > 0 ? (
                      <ul className="warning-list">
                        {summary.warnings.map((warning) => (
                          <li key={warning}>{t(locale, `measure.warning.${warning}`)}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="panel-empty">{t(locale, 'measure.cards.empty')}</p>
          )}

          {selectedMeasure ? (
            <section className="measure-editor" aria-labelledby="measure-editor-title">
              <h3 id="measure-editor-title">
                {t(locale, 'measure.editor.title')}: {t(locale, `measure.tool.${selectedMeasure.kind}`)} (
                {selectedMeasure.id})
              </h3>
              {renderMeasureEditor(locale, selectedMeasure, updateMeasure, applyStorageSuggestion)}
            </section>
          ) : null}
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

function emptyFeatureCollection(): MapFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

function measuresToFeatureCollection(measures: MeasureState[]): MapFeatureCollection {
  const features: MapFeature[] = [];
  for (const measure of measures) {
    if (!measure.geometry) {
      continue;
    }
    if (measure.geometry.type === 'Polygon') {
      features.push({
        type: 'Feature',
        properties: {
          id: measure.id,
          kind: measure.kind,
          enabled: measure.enabled,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [measure.geometry.coordinates],
        },
      });
      continue;
    }
    features.push({
      type: 'Feature',
      properties: {
        id: measure.id,
        kind: measure.kind,
        enabled: measure.enabled,
      },
      geometry: {
        type: 'LineString',
        coordinates: measure.geometry.coordinates,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

function draftToFeatureCollection(
  drawMode: DrawMode | null,
  coordinates: LngLat[],
): MapFeatureCollection {
  if (!drawMode?.geometryType || coordinates.length === 0) {
    return emptyFeatureCollection();
  }

  if (drawMode.geometryType === 'Polygon') {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { draft: true },
          geometry: {
            type: 'Polygon',
            coordinates: [closeRing(coordinates)],
          },
        },
      ],
    };
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { draft: true },
        geometry: {
          type: 'LineString',
          coordinates,
        },
      },
    ],
  };
}

function closeRing(coordinates: LngLat[]): LngLat[] {
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (!first || !last) {
    return coordinates;
  }
  if (first[0] === last[0] && first[1] === last[1]) {
    return coordinates;
  }
  return [...coordinates, first];
}

function readNumber(value: string | number | boolean | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function geometryAreaHa(geometry: MeasureState['geometry']): number {
  if (!geometry || geometry.type !== 'Polygon') {
    return 0;
  }
  return geodesicPolygonAreaM2(geometry.coordinates) / 1e4;
}

function geometryLengthM(geometry: MeasureState['geometry']): number {
  if (!geometry || geometry.type !== 'LineString') {
    return 0;
  }
  return geodesicLengthM(geometry.coordinates);
}

function summarizeMeasure(measure: MeasureState): MeasureSummary {
  const areaHa = geometryAreaHa(measure.geometry);
  const lengthM = geometryLengthM(measure.geometry);
  const warnings: string[] = [];
  let volumeM3 = 0;
  let excavationM3 = 0;

  try {
    if (measure.kind === 'storageWithPipe') {
      const depthM = readNumber(measure.params.depthM, 1.2);
      const areaM2 = areaHa * 1e4;
      const suggestedVolumeM3 = readNumber(measure.params.suggestedVolumeM3, 0);
      volumeM3 = suggestedVolumeM3 > 0 ? suggestedVolumeM3 : areaM2 * depthM;
      excavationM3 = volumeM3;
    } else if (measure.kind === 'forestMulches') {
      const count = readNumber(measure.params.count, 3);
      const volumeEachM3 = readNumber(measure.params.volumeEachM3, 8);
      volumeM3 = count * volumeEachM3;
      excavationM3 = volumeM3;
    } else if (measure.kind === 'swale') {
      const geometry = swaleGeometry({
        lengthM: Math.max(1, lengthM),
        bottomWidthM: readNumber(measure.params.bottomWidthM, 0.5),
        depthM: readNumber(measure.params.depthM, 0.5),
        sideSlopeM: readNumber(measure.params.sideSlopeM, 2),
      });
      const elevationProfile = parseElevationProfile(measure.params.elevationProfile);
      const contourWarnings = validateSwaleContourAlignment(elevationProfile).map((warning) => warning.code);
      warnings.push(...contourWarnings);
      volumeM3 = geometry.vMaxM3;
      excavationM3 = geometry.excavationM3;
    } else if (measure.kind === 'stonefield') {
      const areaM2 = Math.max(1, areaHa * 1e4);
      const widthM = Math.max(0.5, readNumber(measure.params.widthM, Math.sqrt(areaM2)));
      const lengthFlowM = Math.max(0.5, readNumber(measure.params.lengthFlowM, Math.sqrt(areaM2)));
      const geometry = stonefieldGeometry({
        widthM,
        lengthFlowM,
        spacingM: readNumber(measure.params.spacingM, 2),
        holeDiameterM: readNumber(measure.params.holeDiameterM, 0.8),
        holeDepthM: readNumber(measure.params.holeDepthM, 1),
        porosity: readNumber(measure.params.porosity, 0.35),
      });
      const hydraulics = analyzeStonefieldHydraulics({
        qInMaxM3s: readNumber(measure.params.qInMaxM3s, 0.3),
        widthM,
        slope: readNumber(measure.params.slope, 0.03),
        kStone: readNumber(measure.params.kStone, 35),
        d50M: readNumber(measure.params.d50M, 0.08),
      });
      warnings.push(...geometry.warnings.map((warning) => warning.code));
      warnings.push(...hydraulics.warnings.map((warning) => warning.code));
      volumeM3 = geometry.porosityStorageM3;
      excavationM3 = volumeM3 / Math.max(0.01, readNumber(measure.params.porosity, 0.35));
    }
  } catch {
    warnings.push('invalid-parameters');
  }

  return {
    areaHa,
    lengthM,
    volumeM3,
    excavationM3,
    warnings,
  };
}

function parseElevationProfile(value: string | number | boolean | undefined): number[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}

function defaultParams(kind: MeasureKind): Record<string, number | string> {
  switch (kind) {
    case 'landUseChange':
      return {
        landUse: 'arable',
        month: '4',
        mulchDirectSeed: 'no',
        tillageDirection: 'contour-parallel',
      };
    case 'storageWithPipe':
      return {
        form: 'prism',
        depthM: 1.2,
        pipeDnMm: 300,
        pipeLengthM: 12,
        targetQOutM3s: 0.18,
      };
    case 'forestMulches':
      return {
        count: 3,
        volumeEachM3: 8,
        location: 'mid',
      };
    case 'swale':
      return {
        bottomWidthM: 0.5,
        depthM: 0.5,
        sideSlopeM: 2,
        landCoverK: 12,
        elevationProfile: '',
      };
    case 'stonefield':
      return {
        spacingM: 2,
        holeDiameterM: 0.8,
        holeDepthM: 1,
        porosity: 0.35,
        qInMaxM3s: 0.3,
        slope: 0.03,
        kStone: 35,
        d50M: 0.08,
      };
    case 'flowPathChange':
      return {
        segmentType: 'hollow',
        roughnessK: 25,
      };
  }
}

function renderMeasureEditor(
  locale: Locale,
  measure: MeasureState,
  updateMeasure: (id: string, updater: (measure: MeasureState) => MeasureState) => void,
  applyStorageSuggestion: () => void,
): JSX.Element {
  const setParam = (key: string, value: string | number) => {
    updateMeasure(measure.id, (current) => ({
      ...current,
      params: {
        ...current.params,
        [key]: value,
      },
    }));
  };

  switch (measure.kind) {
    case 'landUseChange':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.landUse')}
            <select
              value={String(measure.params.landUse ?? 'arable')}
              onChange={(event) => setParam('landUse', (event.target as HTMLSelectElement).value)}
            >
              <option value="forest">{t(locale, 'map.landuse.forest')}</option>
              <option value="grassland">{t(locale, 'map.landuse.grassland')}</option>
              <option value="arable">{t(locale, 'map.landuse.arable')}</option>
            </select>
          </label>
          <label>
            {t(locale, 'measure.param.month')}
            <input
              type="number"
              min={1}
              max={12}
              value={String(measure.params.month ?? '')}
              onInput={(event) => setParam('month', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.mulchDirectSeed')}
            <select
              value={String(measure.params.mulchDirectSeed ?? 'no')}
              onChange={(event) => setParam('mulchDirectSeed', (event.target as HTMLSelectElement).value)}
            >
              <option value="yes">{t(locale, 'common.yes')}</option>
              <option value="no">{t(locale, 'common.no')}</option>
            </select>
          </label>
          <label>
            {t(locale, 'measure.param.tillageDirection')}
            <select
              value={String(measure.params.tillageDirection ?? 'contour-parallel')}
              onChange={(event) => setParam('tillageDirection', (event.target as HTMLSelectElement).value)}
            >
              <option value="contour-parallel">{t(locale, 'measure.param.tillageDirection.contour')}</option>
              <option value="downslope">{t(locale, 'measure.param.tillageDirection.downslope')}</option>
              <option value="terraced">{t(locale, 'measure.param.tillageDirection.terraced')}</option>
            </select>
          </label>
        </div>
      );
    case 'storageWithPipe':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.form')}
            <select
              value={String(measure.params.form ?? 'prism')}
              onChange={(event) => setParam('form', (event.target as HTMLSelectElement).value)}
            >
              <option value="prism">{t(locale, 'measure.param.form.prism')}</option>
              <option value="hollow">{t(locale, 'measure.param.form.hollow')}</option>
            </select>
          </label>
          <label>
            {t(locale, 'measure.param.depthM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.depthM ?? 1.2)}
              onInput={(event) => setParam('depthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.pipeDnMm')}
            <input
              type="number"
              min={50}
              step={10}
              value={String(measure.params.pipeDnMm ?? 300)}
              onInput={(event) => setParam('pipeDnMm', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.pipeLengthM')}
            <input
              type="number"
              min={1}
              step={1}
              value={String(measure.params.pipeLengthM ?? 12)}
              onInput={(event) => setParam('pipeLengthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.targetQOutM3s')}
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={String(measure.params.targetQOutM3s ?? 0.18)}
              onInput={(event) => setParam('targetQOutM3s', (event.target as HTMLInputElement).value)}
            />
          </label>
          <button type="button" onClick={applyStorageSuggestion}>
            {t(locale, 'measure.param.suggestSize')}
          </button>
        </div>
      );
    case 'forestMulches':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.count')}
            <input
              type="number"
              min={1}
              step={1}
              value={String(measure.params.count ?? 3)}
              onInput={(event) => setParam('count', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.volumeEachM3')}
            <input
              type="number"
              min={1}
              step={1}
              value={String(measure.params.volumeEachM3 ?? 8)}
              onInput={(event) => setParam('volumeEachM3', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.location')}
            <select
              value={String(measure.params.location ?? 'mid')}
              onChange={(event) => setParam('location', (event.target as HTMLSelectElement).value)}
            >
              <option value="top">{t(locale, 'measure.param.location.top')}</option>
              <option value="mid">{t(locale, 'measure.param.location.mid')}</option>
              <option value="low">{t(locale, 'measure.param.location.low')}</option>
            </select>
          </label>
        </div>
      );
    case 'swale':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.bottomWidthM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.bottomWidthM ?? 0.5)}
              onInput={(event) => setParam('bottomWidthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.depthM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.depthM ?? 0.5)}
              onInput={(event) => setParam('depthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.sideSlopeM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.sideSlopeM ?? 2)}
              onInput={(event) => setParam('sideSlopeM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.elevationProfile')}
            <input
              value={String(measure.params.elevationProfile ?? '')}
              onInput={(event) => setParam('elevationProfile', (event.target as HTMLInputElement).value)}
              placeholder={t(locale, 'measure.param.elevationProfile.placeholder')}
            />
          </label>
        </div>
      );
    case 'stonefield':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.spacingM')}
            <input
              type="number"
              min={0.2}
              step={0.1}
              value={String(measure.params.spacingM ?? 2)}
              onInput={(event) => setParam('spacingM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.holeDiameterM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.holeDiameterM ?? 0.8)}
              onInput={(event) => setParam('holeDiameterM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.holeDepthM')}
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={String(measure.params.holeDepthM ?? 1)}
              onInput={(event) => setParam('holeDepthM', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.porosity')}
            <input
              type="number"
              min={0.1}
              max={1}
              step={0.05}
              value={String(measure.params.porosity ?? 0.35)}
              onInput={(event) => setParam('porosity', (event.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      );
    case 'flowPathChange':
      return (
        <div className="editor-grid">
          <label>
            {t(locale, 'measure.param.segmentType')}
            <input
              value={String(measure.params.segmentType ?? 'hollow')}
              onInput={(event) => setParam('segmentType', (event.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            {t(locale, 'measure.param.roughnessK')}
            <input
              type="number"
              min={1}
              step={1}
              value={String(measure.params.roughnessK ?? 25)}
              onInput={(event) => setParam('roughnessK', (event.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      );
  }
}
