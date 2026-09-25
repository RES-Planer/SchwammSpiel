import {
  analyzeStonefieldHydraulics,
  type Catchment,
  type ScenarioEvaluationResult,
  type ScenarioHydrograph,
  sizeStorageForTarget,
  stonefieldGeometry,
  swaleGeometry,
  validateSwaleContourAlignment,
} from '@schwammspiel/engine';
import * as maplibregl from 'maplibre-gl';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { AssumptionsModal } from './AssumptionsModal';
import {
  applyBaseStyle,
  defaultMapStyle,
  findVisibleVectorStyleLayer,
  isSourceLayer,
} from './basemapStyle';
import { geodesicLengthM, geodesicPolygonAreaM2, type LngLat } from './geodesy';
import { HydrographChart } from './HydrographChart';
import { locales, type Locale, t } from './i18n';
import { MeasureCard } from './MeasureCard';
import { defaultParams, MeasureForm } from './MeasureForm';
import { extractCnZones, inferCnZoneDefaults } from './cnZones';
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
  type SyntheticTerrainManifest,
} from './mapData';
import {
  analyzeBaselineTerrain,
  type LocalPointM,
  type LocalTerrainMeasure,
  type TerrainWindow,
} from './localFlowRouting';
import type {
  LocalFlowRoutingWorkerRequest,
  LocalFlowRoutingWorkerResponse,
} from './localFlowRouting.worker';
import { buildManifestLayer, buildManifestSource } from './manifestLayers';
import {
  buildRainChartSeries,
  estimateFillTimeH,
  estimateScenarioCost,
  findMeasureSubcatchmentId,
  getHydrographsForProtectionPoint,
  getPeakDelayH,
  getPeakReductionPct,
  getProtectionPointOptions,
  getStarRating,
  OUTLET_PROTECTION_POINT_ID,
  pointInPolygon,
  type MeasureSummaryLike,
  type SubcatchmentPolygon,
  type UnitCosts,
} from './scenarioResults';
import { buildEvaluableCatchment, evaluateLandUseChange } from './measureToScenario';
import {
  commitHistoryState,
  createHistoryState,
  createInitialScenarioState,
  isScenarioState,
  loadSharedScenarioForCatchment,
  redoHistoryState,
  toShareFragment,
  undoHistoryState,
  type HistoryState,
  type MeasureKind,
  type MeasureState,
  type ScenarioState,
} from './scenarioState';
import './app.css';

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
  cutM3: number | null;
  fillM3: number | null;
  massBalanceM3: number | null;
  capturedAreaShare: number | null;
};

type MapFeature =
  | {
      type: 'Feature';
      properties: Record<string, boolean | number | string>;
      geometry: { type: 'Polygon'; coordinates: [number, number][][] };
    }
  | {
      type: 'Feature';
      properties: Record<string, boolean | number | string>;
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    };

type MapFeatureCollection = {
  type: 'FeatureCollection';
  features: MapFeature[];
};

type LineFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
};

type PolygonFeature = {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
};

type FeatureCollection<TFeature> = {
  type: 'FeatureCollection';
  features: TFeature[];
};

type WorkerRequest = {
  id: number;
  catchment: Catchment;
  rainEventId: string;
  measuresOn: boolean;
};

type WorkerResponse =
  | { id: number; ok: true; result: ScenarioEvaluationResult }
  | { id: number; ok: false; error: string };

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
  const [catchmentData, setCatchmentData] = useState<Catchment | null>(null);
  const [subcatchmentPolygons, setSubcatchmentPolygons] = useState<SubcatchmentPolygon[]>([]);
  const [cnZones, setCnZones] = useState<ReturnType<typeof extractCnZones>>([]);
  const [flowPathFeatures, setFlowPathFeatures] = useState<FeatureCollection<LineFeature> | null>(null);
  const [unitCosts, setUnitCosts] = useState<UnitCosts | null>(null);
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [shareMessageKey, setShareMessageKey] = useState('');
  const [resultError, setResultError] = useState('');
  const [evaluationState, setEvaluationState] = useState<'idle' | 'running' | 'ready' | 'error'>('idle');
  const [evaluationResult, setEvaluationResult] = useState<ScenarioEvaluationResult | null>(null);
  const [selectedRainEventId, setSelectedRainEventId] = useState('');
  const [selectedProtectionPointId, setSelectedProtectionPointId] =
    useState<string>(OUTLET_PROTECTION_POINT_ID);
  const [animationIndex, setAnimationIndex] = useState(0);
  const [animationPlaying, setAnimationPlaying] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [draftCoordinates, setDraftCoordinates] = useState<LngLat[]>([]);
  const [selectedMeasureId, setSelectedMeasureId] = useState<string | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const localRoutingWorkerRef = useRef<Worker | null>(null);
  const workerRequestIdRef = useRef(0);
  const localRoutingRequestIdRef = useRef(0);
  const localRoutingLatestRequestByMeasureRef = useRef(new Map<string, number>());
  const scaleControlRef = useRef<maplibregl.ScaleControl | null>(null);
  const attributionControlRef = useRef<maplibregl.AttributionControl | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const addedLayerIdsRef = useRef<string[]>([]);
  const addedSourceIdsRef = useRef<string[]>([]);
  const activeBaseStyleRef = useRef<string | null>(null);
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
  const activeBaseStyleUrl = useMemo(
    () => findVisibleVectorStyleLayer(manifest?.layers ?? [], layerVisibility)?.url ?? null,
    [layerVisibility, manifest],
  );

  useEffect(() => {
    let cancelled = false;
    const initialState = createInitialScenarioState(catchmentId);
    void loadSharedScenarioForCatchment(window.location.hash, catchmentId)
      .then((sharedState) => {
        if (cancelled) {
          return;
        }
        if (!sharedState) {
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
        setShareMessageKey('scenario.share.invalid');
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
      style: defaultMapStyle,
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
    const worker = new Worker(new URL('./evaluateScenario.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL('./localFlowRouting.worker.ts', import.meta.url), { type: 'module' });
    localRoutingWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent<LocalFlowRoutingWorkerResponse>) => {
      const response = event.data;
      if (!response.ok) {
        return;
      }
      const latestRequestId = localRoutingLatestRequestByMeasureRef.current.get(response.measureId) ?? 0;
      if (response.id < latestRequestId) {
        return;
      }
      updateMeasure(response.measureId, (measure) => {
        const nextWarningCodes = response.analysis.warningCodes.join(',');
        const nextParams = {
          ...measure.params,
          localAreaShare: Number(response.analysis.capturedAreaShare.toFixed(4)),
          localFlowPathChainageM:
            response.analysis.dominantFlowPathChainageM === null
              ? ''
              : Number(response.analysis.dominantFlowPathChainageM.toFixed(1)),
          localCutM3: Number(response.analysis.cutM3.toFixed(1)),
          localFillM3: Number(response.analysis.fillM3.toFixed(1)),
          localMassBalanceM3: Number(response.analysis.massBalanceM3.toFixed(1)),
          localWarningCodes: nextWarningCodes,
        };
        const changed =
          measure.params.localAreaShare !== nextParams.localAreaShare ||
          measure.params.localFlowPathChainageM !== nextParams.localFlowPathChainageM ||
          measure.params.localCutM3 !== nextParams.localCutM3 ||
          measure.params.localFillM3 !== nextParams.localFillM3 ||
          measure.params.localMassBalanceM3 !== nextParams.localMassBalanceM3 ||
          measure.params.localWarningCodes !== nextWarningCodes;
        if (!changed) {
          return measure;
        }
        return {
          ...measure,
          params: nextParams,
        };
      });
    };

    return () => {
      localRoutingWorkerRef.current = null;
      worker.terminate();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoadingState('loading');
    setLoadError('');
    setSelectedSubcatchment(null);
    setCatchmentData(null);
    setSubcatchmentPolygons([]);
    setCnZones([]);
    setFlowPathFeatures(null);
    setEvaluationResult(null);
    setEvaluationState('idle');
    setResultError('');

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
    let cancelled = false;

    void fetch(buildDataUrl(import.meta.env.BASE_URL, catchmentId, 'catchment.json'))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as Catchment;
      })
      .then((data) => {
        if (cancelled) {
          return;
        }
        setCatchmentData(data);
        setSelectedRainEventId(data.rainEvents[0]?.id ?? '');
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setCatchmentData(null);
      });

    void fetch(`${import.meta.env.BASE_URL}data/unit_costs.json`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as UnitCosts;
      })
      .then((data) => {
        if (!cancelled) {
          setUnitCosts(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnitCosts(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catchmentId]);

  useEffect(() => {
    const flowPathLayer = manifest?.layers.find(
      (layer): layer is Extract<LayerManifest, { type: 'geojson' }> =>
        layer.type === 'geojson' && layer.id === 'flow-paths',
    );
    const subcatchmentLayer = manifest?.layers.find(
      (layer): layer is Extract<LayerManifest, { type: 'geojson' }> =>
        layer.type === 'geojson' && layer.inspectable === true,
    );
    const cnZoneLayer = manifest?.layers.find(
      (layer): layer is Extract<LayerManifest, { type: 'geojson' }> =>
        layer.type === 'geojson' && layer.id === 'cn-zones',
    );
    if (!flowPathLayer || !subcatchmentLayer) {
      return;
    }

    let cancelled = false;

    void fetch(buildDataUrl(import.meta.env.BASE_URL, catchmentId, flowPathLayer.path))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as FeatureCollection<LineFeature>;
      })
      .then((data) => {
        if (!cancelled) {
          setFlowPathFeatures(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFlowPathFeatures(null);
        }
      });

    void fetch(buildDataUrl(import.meta.env.BASE_URL, catchmentId, subcatchmentLayer.path))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as FeatureCollection<PolygonFeature>;
      })
      .then((data) => {
        if (cancelled) {
          return;
        }
        setSubcatchmentPolygons(
          data.features.reduce<SubcatchmentPolygon[]>((entries, feature) => {
            const id = feature.properties.id;
            const polygon = feature.geometry.coordinates[0];
            if (typeof id === 'string' && polygon) {
              entries.push({ id, coordinates: polygon });
            }
            return entries;
          }, []),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSubcatchmentPolygons([]);
        }
      });

    if (cnZoneLayer) {
      void fetch(buildDataUrl(import.meta.env.BASE_URL, catchmentId, cnZoneLayer.path))
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return await response.json();
        })
        .then((data) => {
          if (!cancelled) {
            setCnZones(extractCnZones(data));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCnZones([]);
          }
        });
    } else {
      setCnZones([]);
    }

    return () => {
      cancelled = true;
    };
  }, [catchmentId, manifest]);

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

    const nextBaseStyleKey = activeBaseStyleUrl ?? '__default__';

    const applyManifestLayers = () => {
      removeManifestLayers(map, addedLayerIdsRef.current, addedSourceIdsRef.current);
      const addedLayerIds: string[] = [];
      const addedSourceIds: string[] = [];

      for (const layer of manifest.layers) {
        if (!isSourceLayer(layer)) {
          continue;
        }

        const sourceId = sourceIdFor(layer.id);
        const layerId = layerIdFor(layer.id);
        map.addSource(sourceId, buildManifestSource(layer, import.meta.env.BASE_URL, catchmentId, locale));
        map.addLayer(buildManifestLayer(layer, layerId, sourceId));

        const isVisible = layerVisibility[layer.id] ?? layer.visibleByDefault ?? true;
        map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');

        addedLayerIds.push(layerId);
        addedSourceIds.push(sourceId);
      }

      addedLayerIdsRef.current = addedLayerIds;
      addedSourceIdsRef.current = addedSourceIds;
      map.fitBounds(manifest.bounds, { padding: { top: 72, right: 24, bottom: 72, left: 24 }, duration: 0 });
    };

    if (activeBaseStyleRef.current !== nextBaseStyleKey) {
      return applyBaseStyle(map, activeBaseStyleUrl, (activeStyleKey) => {
        activeBaseStyleRef.current = activeStyleKey;
        applyManifestLayers();
      });
    }

    applyManifestLayers();

    return () => {
      removeManifestLayers(map, addedLayerIdsRef.current, addedSourceIdsRef.current);
      addedLayerIdsRef.current = [];
      addedSourceIdsRef.current = [];
    };
  }, [activeBaseStyleUrl, catchmentId, locale, manifest, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !manifest) {
      return;
    }

    for (const layer of manifest.layers) {
      if (!isSourceLayer(layer)) {
        continue;
      }
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
    const flowAnimationSourceId = 'scenario-flow-animation-source';
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
          'fill-color': [
            'case',
            ['boolean', ['get', 'overflowing'], false],
            '#f97316',
            [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'fillRatio'], 0],
              0,
              '#bae6fd',
              1,
              '#0284c7',
            ],
          ],
          'fill-outline-color': '#0369a1',
          'fill-opacity': [
            'case',
            ['boolean', ['get', 'enabled'], true],
            ['+', 0.14, ['*', 0.42, ['coalesce', ['get', 'fillRatio'], 0]]],
            0.08,
          ],
        },
      });
      map.addLayer({
        id: 'scenario-measures-line',
        type: 'line',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': [
            'case',
            ['boolean', ['get', 'overflowing'], false],
            '#ef4444',
            '#0369a1',
          ],
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

    if (!map.getSource(flowAnimationSourceId)) {
      map.addSource(flowAnimationSourceId, {
        type: 'geojson',
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: 'scenario-flow-animation-line',
        type: 'line',
        source: flowAnimationSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'currentQ'], 0],
            0,
            '#86efac',
            0.5,
            '#facc15',
            1,
            '#ef4444',
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'currentQ'], 0],
            0,
            2,
            1,
            10,
          ],
          'line-opacity': 0.92,
        },
      });
    }
  }, [mapReady]);

  const measureSummaries = useMemo(() => {
    return new Map<string, MeasureSummaryLike>(
      scenario.measures.map((measure) => [measure.id, summarizeMeasure(measure)]),
    );
  }, [scenario.measures]);

  const protectionPointOptions = useMemo(
    () => (catchmentData ? getProtectionPointOptions(catchmentData) : []),
    [catchmentData],
  );

  const selectedRainEvent = useMemo(
    () => catchmentData?.rainEvents.find((event) => event.id === selectedRainEventId) ?? null,
    [catchmentData, selectedRainEventId],
  );

  const rainChartSeries = useMemo(() => {
    if (!selectedRainEvent) {
      return null;
    }
    const dtH = evaluationResult?.after.dtH ?? Math.max(selectedRainEvent.durationH / 24, 0.1);
    return buildRainChartSeries(selectedRainEvent, dtH);
  }, [evaluationResult, selectedRainEvent]);

  const protectionPointMetrics = useMemo(() => {
    if (!evaluationResult) {
      return null;
    }
    const peakReductionPct = getPeakReductionPct(evaluationResult, selectedProtectionPointId);
    return {
      peakReductionPct,
      peakDelayH: getPeakDelayH(evaluationResult, selectedProtectionPointId),
      stars: getStarRating(peakReductionPct),
    };
  }, [evaluationResult, selectedProtectionPointId]);

  const selectedProtectionPointSummary = useMemo(() => {
    if (!evaluationResult) {
      return null;
    }
    if (selectedProtectionPointId === OUTLET_PROTECTION_POINT_ID) {
      return {
        retainedVolumeM3: evaluationResult.retainedVolumeM3,
        areaUsedHa: evaluationResult.areaUsedHa,
        excavationM3: evaluationResult.excavationM3,
      };
    }
    const subcatchment = evaluationResult.subcatchments.find((entry) => entry.id === selectedProtectionPointId);
    return {
      retainedVolumeM3: subcatchment?.retainedVolumeM3 ?? 0,
      areaUsedHa: subcatchment?.areaUsedHa ?? 0,
      excavationM3: subcatchment?.excavationM3 ?? 0,
    };
  }, [evaluationResult, selectedProtectionPointId]);

  const visibleWarnings = useMemo(() => {
    if (!evaluationResult) {
      return [];
    }
    const scopedWarnings =
      selectedProtectionPointId === OUTLET_PROTECTION_POINT_ID
        ? evaluationResult.warnings
        : [
            ...evaluationResult.warnings,
            ...(evaluationResult.subcatchments.find((entry) => entry.id === selectedProtectionPointId)?.warnings ??
              []),
          ];
    return scopedWarnings.filter((warning, index, warnings) => {
      const key = `${warning.scope}-${warning.code}-${warning.message}`;
      return warnings.findIndex((entry) => `${entry.scope}-${entry.code}-${entry.message}` === key) === index;
    });
  }, [evaluationResult, selectedProtectionPointId]);

  const costEstimate = useMemo(() => {
    if (!unitCosts) {
      return null;
    }
    return estimateScenarioCost(scenario.measures, measureSummaries, unitCosts);
  }, [measureSummaries, scenario.measures, unitCosts]);

  const currentAnimationTimeH = evaluationResult ? animationIndex * evaluationResult.after.dtH : 0;

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }

    const source = map.getSource('scenario-measures-source') as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      return;
    }

    source.setData(
      measuresToFeatureCollection(
        scenario.measures,
        catchmentData,
        evaluationResult,
        animationIndex,
        subcatchmentPolygons,
        measureSummaries,
      ),
    );
  }, [
    animationIndex,
    catchmentData,
    evaluationResult,
    mapReady,
    measureSummaries,
    scenario.measures,
    subcatchmentPolygons,
  ]);

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
    const source = map.getSource('scenario-flow-animation-source') as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      return;
    }
    source.setData(
      buildAnimatedFlowPathCollection(
        flowPathFeatures,
        subcatchmentPolygons,
        evaluationResult,
        currentAnimationTimeH,
      ),
    );
  }, [currentAnimationTimeH, evaluationResult, flowPathFeatures, mapReady, subcatchmentPolygons]);

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

  useEffect(() => {
    if (!animationPlaying || !evaluationResult) {
      return undefined;
    }
    const maxIndex = evaluationResult.after.qM3s.length - 1;
    const timeout = window.setTimeout(() => {
      setAnimationIndex((current) => (current >= maxIndex ? 0 : current + 1));
    }, 450);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [animationPlaying, evaluationResult, animationIndex]);

  useEffect(() => {
    if (!selectedSubcatchment) {
      return;
    }
    setSelectedProtectionPointId(selectedSubcatchment.id);
  }, [selectedSubcatchment]);

  useEffect(() => {
    if (!catchmentData) {
      setSelectedProtectionPointId(OUTLET_PROTECTION_POINT_ID);
      return;
    }
    setSelectedProtectionPointId((current) => {
      const exists =
        current === OUTLET_PROTECTION_POINT_ID ||
        catchmentData.subcatchments.some((subcatchment) => subcatchment.id === current);
      return exists ? current : OUTLET_PROTECTION_POINT_ID;
    });
  }, [catchmentData]);

  const visibleLayers = manifest?.layers.filter((layer) => layerVisibility[layer.id] ?? layer.visibleByDefault ?? true) ?? [];
  const selectedMeasure = scenario.measures.find((measure) => measure.id === selectedMeasureId) ?? null;

  const applyScenarioUpdate = (updater: (current: ScenarioState) => ScenarioState) => {
    setScenarioHistory((current) => commitHistoryState(current, updater(current.present)));
  };

  const addMeasure = (kind: MeasureKind, geometry: MeasureState['geometry']) => {
    const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
    const cnZoneDefaults = kind === 'landUseChange' ? inferCnZoneDefaults(geometry, cnZones) : null;
    const measure: MeasureState = {
      id,
      kind,
      enabled: true,
      geometry,
      params: {
        ...defaultParams(kind, cnZoneDefaults),
        targetSubcatchmentId:
          selectedSubcatchment?.id ?? catchmentData?.subcatchments[0]?.id ?? '',
        targetMeasureAreaId:
          catchmentData?.subcatchments.find((subcatchment) => subcatchment.id === selectedSubcatchment?.id)
            ?.measureAreas[0]?.id ??
          catchmentData?.subcatchments[0]?.measureAreas[0]?.id ??
          '',
      },
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

  useEffect(() => {
    const worker = localRoutingWorkerRef.current;
    const terrain = manifest?.terrain;
    if (!worker || !terrain) {
      return;
    }

    for (const measure of scenario.measures) {
      const signature = buildLocalRoutingSignature(measure, terrain);
      if (!signature || measure.params.localTerrainSignature === signature) {
        continue;
      }
      const request = buildLocalRoutingRequest(measure, terrain);
      if (!request) {
        continue;
      }
      updateMeasure(measure.id, (current) => ({
        ...current,
        params: {
          ...current.params,
          localTerrainSignature: signature,
        },
      }));
      const requestId = localRoutingRequestIdRef.current + 1;
      localRoutingRequestIdRef.current = requestId;
      localRoutingLatestRequestByMeasureRef.current.set(measure.id, requestId);
      const workerRequest: LocalFlowRoutingWorkerRequest = {
        id: requestId,
        measureId: measure.id,
        ...request,
      };
      worker.postMessage(workerRequest);
    }
  }, [manifest?.terrain, scenario.measures]);

  useEffect(() => {
    if (manifest?.terrain) {
      return;
    }
    const hasLocalOverrides = scenario.measures.some(
      (measure) =>
        measure.params.localAreaShare !== undefined ||
        measure.params.localFlowPathChainageM !== undefined ||
        measure.params.localCutM3 !== undefined ||
        measure.params.localFillM3 !== undefined ||
        measure.params.localMassBalanceM3 !== undefined ||
        measure.params.localWarningCodes !== undefined ||
        measure.params.localTerrainSignature !== undefined,
    );
    if (!hasLocalOverrides) {
      return;
    }
    applyScenarioUpdate((current) => {
      let changed = false;
      const measures = current.measures.map((measure) => {
        const hasMeasureOverrides =
          measure.params.localAreaShare !== undefined ||
          measure.params.localFlowPathChainageM !== undefined ||
          measure.params.localCutM3 !== undefined ||
          measure.params.localFillM3 !== undefined ||
          measure.params.localMassBalanceM3 !== undefined ||
          measure.params.localWarningCodes !== undefined ||
          measure.params.localTerrainSignature !== undefined;
        if (!hasMeasureOverrides) {
          return measure;
        }
        changed = true;
        const {
          localAreaShare,
          localFlowPathChainageM,
          localCutM3,
          localFillM3,
          localMassBalanceM3,
          localWarningCodes,
          localTerrainSignature,
          ...params
        } = measure.params;
        void localAreaShare;
        void localFlowPathChainageM;
        void localCutM3;
        void localFillM3;
        void localMassBalanceM3;
        void localWarningCodes;
        void localTerrainSignature;
        return {
          ...measure,
          params,
        };
      });
      return changed
        ? {
            ...current,
            measures,
          }
        : current;
    });
  }, [manifest?.terrain, scenario.measures]);

  const applyStorageSuggestion = () => {
    if (!selectedMeasure || selectedMeasure.kind !== 'storageWithPipe') {
      return;
    }

    const depthM = readNumber(selectedMeasure.params.depthM, 1.2);
    const pipeDnMm = readNumber(selectedMeasure.params.pipeDnMm, 300);
    const pipeLengthM = readNumber(selectedMeasure.params.pipeLengthM, 12);
    const inflow = parseHydrographSeries(selectedMeasure.params.inflowSeriesM3s);
    if (inflow.length < 2) {
      setShareMessageKey('measure.storageSuggestion.todoSpec');
      return;
    }
    const inflowDtH = readNumber(selectedMeasure.params.inflowDtH, 0.25);
    const targetQOutM3s = readNumber(selectedMeasure.params.targetQOutM3s, 0.18);
    const suggested = sizeStorageForTarget(
      inflow,
      inflowDtH,
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
        const parsed = JSON.parse(String(reader.result));
        if (!isScenarioState(parsed)) {
          throw new Error('invalid');
        }
        if (parsed.catchmentId !== catchmentId) {
          throw new Error('catchment-mismatch');
        }
        setScenarioHistory(createHistoryState(parsed));
        setSelectedMeasureId(null);
        setShareMessageKey('');
      } catch (error) {
        if (error instanceof Error && error.message === 'catchment-mismatch') {
          setShareMessageKey('scenario.file.catchmentMismatch');
          return;
        }
        setShareMessageKey('scenario.file.invalid');
      }
    };
    reader.readAsText(file);
  };

  const shareScenario = async () => {
    try {
      const fragment = await toShareFragment(scenario);
      const url = new URL(window.location.href);
      url.hash = fragment;
      window.history.replaceState(null, '', url.toString());
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url.toString());
          setShareMessageKey('scenario.share.copied');
          return;
        } catch {
          setShareMessageKey('scenario.share.updated');
          return;
        }
      }
      setShareMessageKey('scenario.share.updated');
    } catch {
      setShareMessageKey('scenario.share.invalid');
      return;
    }
  };

  const openSteckbrief = async () => {
    try {
      const fragment = await toShareFragment(scenario);
      const url = new URL(window.location.href);
      const params = new URLSearchParams(fragment);
      if (selectedRainEventId) {
        params.set('rainEventId', selectedRainEventId);
      }
      url.hash = `/steckbrief/?${params.toString()}`;
      url.searchParams.set('lang', locale);
      window.location.assign(url.toString());
    } catch {
      setShareMessageKey('scenario.share.invalid');
    }
  };

  const triggerRainScenario = () => {
    const worker = workerRef.current;
    if (!worker || !catchmentData || !selectedRainEventId) {
      return;
    }

    const requestId = workerRequestIdRef.current + 1;
    workerRequestIdRef.current = requestId;
    setEvaluationState('running');
    setResultError('');
    setAnimationPlaying(false);
    setAnimationIndex(0);

    const request: WorkerRequest = {
      id: requestId,
      catchment: buildEvaluableCatchment(
        catchmentData,
        scenario.measures,
        subcatchmentPolygons,
        selectedSubcatchment?.id ?? catchmentData.subcatchments[0]?.id ?? '',
        measureSummaries,
      ),
      rainEventId: selectedRainEventId,
      measuresOn: true,
    };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== requestId) {
        return;
      }
      if (event.data.ok) {
        setEvaluationResult(event.data.result);
        setEvaluationState('ready');
        setAnimationIndex(0);
        return;
      }
      setEvaluationResult(null);
      setEvaluationState('error');
      setResultError(event.data.error);
    };

    worker.postMessage(request);
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
            <button type="button" onClick={() => void openSteckbrief()}>
              {t(locale, 'scenario.steckbrief')}
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
            {shareMessageKey ? <p className="hint-text">{t(locale, shareMessageKey)}</p> : null}
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
                const landUseEvaluation = measure.kind === 'landUseChange' ? evaluateLandUseChange(measure) : null;
                return (
                  <MeasureCard
                    key={measure.id}
                    locale={locale}
                    numberFormatter={numberFormatter}
                    measure={measure}
                    summary={summary}
                    landUseEvaluation={landUseEvaluation}
                    onToggle={() =>
                      updateMeasure(measure.id, (current) => ({
                        ...current,
                        enabled: !current.enabled,
                      }))
                    }
                    onEdit={() => setSelectedMeasureId(measure.id)}
                    onDelete={() => deleteMeasure(measure.id)}
                  />
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
              <MeasureForm
                locale={locale}
                measure={selectedMeasure}
                updateMeasure={updateMeasure}
                applyStorageSuggestion={applyStorageSuggestion}
              />
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

          <section className="results-section">
            <h2>{t(locale, 'result.rain.title')}</h2>
            <label>
              {t(locale, 'result.rain.event')}
              <select
                value={selectedRainEventId}
                onChange={(event) =>
                  setSelectedRainEventId((event.target as HTMLSelectElement).value)
                }
                disabled={!catchmentData || catchmentData.rainEvents.length === 0}
              >
                {catchmentData?.rainEvents.map((rainEvent) => (
                  <option key={rainEvent.id} value={rainEvent.id}>
                    {rainEvent.name ?? rainEvent.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={triggerRainScenario}
              disabled={!catchmentData || !selectedRainEventId || evaluationState === 'running'}
            >
              {evaluationState === 'running'
                ? t(locale, 'result.rain.running')
                : t(locale, 'result.rain.trigger')}
            </button>
            {resultError ? <p className="warning-text">{resultError}</p> : null}
            {selectedRainEvent ? (
              <p className="subtitle">
                {formatValue(numberFormatter, selectedRainEvent.pMm, 'mm')} ·{' '}
                {formatValue(numberFormatter, selectedRainEvent.durationH, 'h')}
              </p>
            ) : null}
          </section>

          {evaluationResult ? (
            <>
              <section className="results-section">
                <div className="results-header">
                  <h2>{t(locale, 'result.animation.title')}</h2>
                  <span>{formatValue(numberFormatter, currentAnimationTimeH, 'h')}</span>
                </div>
                <div className="animation-controls">
                  <button type="button" onClick={() => setAnimationPlaying((current) => !current)}>
                    {animationPlaying ? t(locale, 'result.animation.pause') : t(locale, 'result.animation.play')}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, evaluationResult.after.qM3s.length - 1)}
                    value={animationIndex}
                    onInput={(event) => {
                      setAnimationPlaying(false);
                      setAnimationIndex(Number((event.target as HTMLInputElement).value));
                    }}
                  />
                </div>
                <ResultNote locale={locale} onOpenAssumptions={() => setShowAssumptions(true)} />
              </section>

              <section className="results-section">
                <h2>{t(locale, 'result.chart.title')}</h2>
                <label>
                  {t(locale, 'result.protectionPoint')}
                  <select
                    value={selectedProtectionPointId}
                    onChange={(event) =>
                      setSelectedProtectionPointId((event.target as HTMLSelectElement).value)
                    }
                  >
                    {protectionPointOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.id === OUTLET_PROTECTION_POINT_ID
                          ? t(locale, 'result.outlet')
                          : option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {rainChartSeries ? (
                  <HydrographChart
                    locale={localeTag}
                    labels={{
                      rainfallAxis: t(locale, 'result.axis.rainfall'),
                      timeAxis: t(locale, 'result.axis.time'),
                      dischargeAxis: t(locale, 'result.axis.discharge'),
                      before: t(locale, 'result.series.before'),
                      after: t(locale, 'result.series.after'),
                      rainfallAria: t(locale, 'result.chart.rainAria'),
                      hydrographAria: t(locale, 'result.chart.hydrographAria'),
                    }}
                    rainfall={rainChartSeries}
                    before={getHydrographsForProtectionPoint(evaluationResult, selectedProtectionPointId).before}
                    after={getHydrographsForProtectionPoint(evaluationResult, selectedProtectionPointId).after}
                  />
                ) : null}
                <ResultNote locale={locale} onOpenAssumptions={() => setShowAssumptions(true)} />
              </section>

              <section className="results-section">
                <h2>{t(locale, 'result.score.title')}</h2>
                {protectionPointMetrics ? (
                  <>
                    <div
                      className="star-rating"
                      aria-label={`${protectionPointMetrics.stars} ${t(locale, 'result.score.stars')}`}
                    >
                      {Array.from({ length: 3 }, (_, index) => (
                        <span key={index} className={index < protectionPointMetrics.stars ? 'star-on' : 'star-off'}>
                          ★
                        </span>
                      ))}
                    </div>
                    <dl className="score-grid">
                      <div>
                        <dt>{t(locale, 'result.metric.peakReduction')}</dt>
                        <dd>{formatValue(numberFormatter, protectionPointMetrics.peakReductionPct, '%')}</dd>
                      </div>
                      <div>
                        <dt>{t(locale, 'result.metric.peakDelay')}</dt>
                        <dd>{formatValue(numberFormatter, protectionPointMetrics.peakDelayH, 'h')}</dd>
                      </div>
                      <div>
                        <dt>{t(locale, 'result.metric.retainedVolume')}</dt>
                        <dd>{formatValue(numberFormatter, selectedProtectionPointSummary?.retainedVolumeM3 ?? null, 'm³')}</dd>
                      </div>
                      <div>
                        <dt>{t(locale, 'result.metric.fillAndPeak')}</dt>
                        <dd>
                          {buildFillAndPeakLabel(
                            locale,
                            numberFormatter,
                            scenario.measures,
                            measureSummaries,
                            catchmentData,
                            evaluationResult,
                            subcatchmentPolygons,
                            selectedProtectionPointId === OUTLET_PROTECTION_POINT_ID
                              ? selectedSubcatchment?.id ?? catchmentData?.subcatchments[0]?.id ?? ''
                              : selectedProtectionPointId,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>{t(locale, 'result.metric.areaUse')}</dt>
                        <dd>{formatValue(numberFormatter, selectedProtectionPointSummary?.areaUsedHa ?? null, 'ha')}</dd>
                      </div>
                      <div>
                        <dt>{t(locale, 'result.metric.excavation')}</dt>
                        <dd>{formatValue(numberFormatter, selectedProtectionPointSummary?.excavationM3 ?? null, 'm³')}</dd>
                      </div>
                      <div>
                        <dt>{t(locale, 'result.metric.cost')}</dt>
                        <dd>{costEstimate ? formatCurrency(localeTag, costEstimate.totalEur) : '–'}</dd>
                      </div>
                    </dl>
                    {unitCosts?.noteKey ? <p className="hint-text">{t(locale, unitCosts.noteKey)}</p> : null}
                    {visibleWarnings.length > 0 ? (
                      <ul className="warning-list">
                        {visibleWarnings.map((warning) => (
                          <li key={`${warning.scope}-${warning.code}-${warning.message}`}>{warning.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
                <ResultNote locale={locale} onOpenAssumptions={() => setShowAssumptions(true)} />
              </section>
            </>
          ) : null}
        </aside>
      </section>

      <AssumptionsModal
        locale={locale}
        open={showAssumptions}
        onClose={() => setShowAssumptions(false)}
      />
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

function measuresToFeatureCollection(
  measures: MeasureState[],
  catchmentData: Catchment | null,
  evaluationResult: ScenarioEvaluationResult | null,
  animationIndex: number,
  subcatchmentPolygons: SubcatchmentPolygon[],
  measureSummaries: Map<string, MeasureSummaryLike>,
): MapFeatureCollection {
  const features: MapFeature[] = [];
  for (const measure of measures) {
    if (!measure.geometry) {
      continue;
    }
    const visuals = evaluateMeasureVisualState(
      measure,
      measures,
      catchmentData,
      evaluationResult,
      animationIndex,
      subcatchmentPolygons,
      measureSummaries,
    );
    if (measure.geometry.type === 'Polygon') {
      features.push({
        type: 'Feature',
        properties: {
          id: measure.id,
          kind: measure.kind,
          enabled: measure.enabled,
          fillRatio: visuals.fillRatio,
          overflowing: visuals.overflowing,
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
        fillRatio: visuals.fillRatio,
        overflowing: visuals.overflowing,
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

function readOptionalNumber(value: string | number | boolean | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function readWarningCodes(value: string | number | boolean | undefined): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
  const cutM3 = readOptionalNumber(measure.params.localCutM3);
  const fillM3 = readOptionalNumber(measure.params.localFillM3);
  const massBalanceM3 = readOptionalNumber(measure.params.localMassBalanceM3);
  const capturedAreaShare = readOptionalNumber(measure.params.localAreaShare);

  try {
    if (measure.kind === 'storageWithPipe') {
      const depthM = readNumber(measure.params.depthM, 1.2);
      const areaM2 = areaHa * 1e4;
      const suggestedVolumeM3 = readNumber(measure.params.suggestedVolumeM3, 0);
      const formFactor = measure.params.form === 'hollow' ? 2 / 3 : 1;
      volumeM3 = suggestedVolumeM3 > 0 ? suggestedVolumeM3 : areaM2 * depthM * formFactor;
      excavationM3 = cutM3 ?? volumeM3;
    } else if (measure.kind === 'forestMulches') {
      const count = readNumber(measure.params.count, 3);
      const volumeEachM3 = readNumber(measure.params.volumeEachM3, 8);
      volumeM3 = count * volumeEachM3;
      excavationM3 = volumeM3;
    } else if (measure.kind === 'swale') {
      if (lengthM <= 0) {
        return {
          areaHa,
          lengthM,
          volumeM3: 0,
          excavationM3: 0,
          warnings,
          cutM3,
          fillM3,
          massBalanceM3,
          capturedAreaShare,
        };
      }
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
      excavationM3 = cutM3 ?? geometry.excavationM3;
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
  warnings.push(...readWarningCodes(measure.params.localWarningCodes));

  return {
    areaHa,
    lengthM,
    volumeM3,
    excavationM3,
    warnings,
    cutM3,
    fillM3,
    massBalanceM3,
    capturedAreaShare,
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

function parseHydrographSeries(value: string | number | boolean | undefined): number[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry >= 0);
}

function measureSupportsLocalRouting(measure: MeasureState): boolean {
  return measure.kind === 'swale' || measure.kind === 'storageWithPipe';
}

function polygonRingCoordinates(
  geometry: Extract<MeasureState['geometry'], { type: 'Polygon' }>,
): LngLat[] {
  return geometry.coordinates;
}

function geometryAnchor(geometry: MeasureState['geometry']): LngLat | null {
  if (!geometry) {
    return null;
  }
  if (geometry.type === 'LineString') {
    const middle = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
    return middle ?? null;
  }
  const ring = polygonRingCoordinates(geometry);
  if (ring.length === 0) {
    return null;
  }
  const [sumLng, sumLat] = ring.reduce(
    (sum, coordinate) => [sum[0] + coordinate[0], sum[1] + coordinate[1]] as [number, number],
    [0, 0],
  );
  return [sumLng / ring.length, sumLat / ring.length];
}

function toLocalMeters(origin: LngLat, coordinate: LngLat): LocalPointM {
  const meanLatRad = ((origin[1] + coordinate[1]) * Math.PI) / 360;
  const metersPerLat = 111_320;
  const metersPerLng = Math.cos(meanLatRad) * 111_320;
  return [(coordinate[0] - origin[0]) * metersPerLng, (coordinate[1] - origin[1]) * metersPerLat];
}

function shiftIntoWindow(coordinates: LocalPointM[], windowSizeM: number): LocalPointM[] {
  return coordinates.map(([xM, yM]) => [xM + windowSizeM / 2, yM + windowSizeM / 2]);
}

function buildTerrainWindow(terrain: SyntheticTerrainManifest): TerrainWindow {
  const width = Math.max(1, Math.round(terrain.windowSizeM / terrain.cellSizeM));
  const height = width;
  const elevationsM: number[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const xM = (col + 0.5) * terrain.cellSizeM - terrain.windowSizeM / 2;
      const yM = (row + 0.5) * terrain.cellSizeM - terrain.windowSizeM / 2;
      elevationsM.push(terrain.baseElevationM + terrain.slopeXM * xM + terrain.slopeYM * yM);
    }
  }
  const window: TerrainWindow = {
    width,
    height,
    cellSizeM: terrain.cellSizeM,
    elevationsM,
  };
  const baseline = analyzeBaselineTerrain(window);
  return {
    ...window,
    baseAccumulationCells: baseline.accumulationCells,
  };
}

function buildLocalRoutingRequest(
  measure: MeasureState,
  terrain: SyntheticTerrainManifest,
): Pick<LocalFlowRoutingWorkerRequest, 'window' | 'measure'> | null {
  if (!measureSupportsLocalRouting(measure) || !measure.geometry) {
    return null;
  }
  const anchor = geometryAnchor(measure.geometry);
  if (!anchor) {
    return null;
  }
  const window = buildTerrainWindow(terrain);
  const toWindowCoordinates = (coordinates: LngLat[]): LocalPointM[] =>
    shiftIntoWindow(
      coordinates.map((coordinate) => toLocalMeters(anchor, coordinate)),
      terrain.windowSizeM,
    );

  let routingMeasure: LocalTerrainMeasure | null = null;
  if (measure.kind === 'swale' && measure.geometry.type === 'LineString') {
    routingMeasure = {
      kind: 'swale',
      coordinates: toWindowCoordinates(measure.geometry.coordinates),
      bottomWidthM: readNumber(measure.params.bottomWidthM, 0.5),
      depthM: readNumber(measure.params.depthM, 0.5),
      sideSlopeM: readNumber(measure.params.sideSlopeM, 2),
    };
  } else if (measure.kind === 'storageWithPipe' && measure.geometry.type === 'Polygon') {
    const ring = polygonRingCoordinates(measure.geometry);
    routingMeasure = {
      kind: 'storageWithPipe',
      coordinates: toWindowCoordinates(ring),
      depthM: readNumber(measure.params.depthM, 1.2),
    };
  }

  if (!routingMeasure) {
    return null;
  }
  return {
    window,
    measure: routingMeasure,
  };
}

function buildLocalRoutingSignature(measure: MeasureState, terrain: SyntheticTerrainManifest): string | null {
  if (!measureSupportsLocalRouting(measure) || !measure.geometry) {
    return null;
  }
  return JSON.stringify({
    terrain,
    kind: measure.kind,
    geometry: measure.geometry,
    params:
      measure.kind === 'swale'
        ? {
            bottomWidthM: readNumber(measure.params.bottomWidthM, 0.5),
            depthM: readNumber(measure.params.depthM, 0.5),
            sideSlopeM: readNumber(measure.params.sideSlopeM, 2),
          }
        : {
            depthM: readNumber(measure.params.depthM, 1.2),
          },
  });
}

function formatCurrency(localeTag: string, value: number): string {
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function interpolateHydrographQ(hydrograph: ScenarioHydrograph, timeH: number): number {
  if (timeH < 0 || hydrograph.qM3s.length === 0) {
    return 0;
  }
  const rawIndex = timeH / hydrograph.dtH;
  const lo = Math.floor(rawIndex);
  const hi = lo + 1;
  const loQ = hydrograph.qM3s[lo] ?? 0;
  const hiQ = hydrograph.qM3s[hi] ?? loQ;
  const fraction = rawIndex - lo;
  return loQ + (hiQ - loQ) * fraction;
}

function measureAreaShare(summaryAreaHa: number, targetAreaHa: number): number {
  return Math.min(0.95, Math.max(0.05, Math.max(summaryAreaHa, 0.1) / Math.max(targetAreaHa, 0.1)));
}

function allocatedMeasureAreaShare(
  measure: MeasureState,
  measures: MeasureState[],
  measureSummaries: Map<string, MeasureSummaryLike>,
  catchmentData: Catchment | null,
  subcatchmentPolygons: SubcatchmentPolygon[],
  targetSubcatchmentId: string,
): number {
  const targetAreaHa =
    catchmentData?.subcatchments.find((entry) => entry.id === targetSubcatchmentId)?.areaHa ?? 0.1;
  const rawShares = measures
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      id: entry.id,
      targetSubcatchmentId: findMeasureSubcatchmentId(entry, subcatchmentPolygons, targetSubcatchmentId),
      rawShare: measureAreaShare(measureSummaries.get(entry.id)?.areaHa ?? 0.05, targetAreaHa),
    }))
    .filter((entry) => entry.targetSubcatchmentId === targetSubcatchmentId);

  const totalShare = rawShares.reduce((sum, entry) => sum + entry.rawShare, 0);
  const rawShare = rawShares.find((entry) => entry.id === measure.id)?.rawShare ?? 0.05;
  if (totalShare <= 1) {
    return rawShare;
  }
  return rawShare / totalShare;
}

function evaluateMeasureVisualState(
  measure: MeasureState,
  measures: MeasureState[],
  catchmentData: Catchment | null,
  evaluationResult: ScenarioEvaluationResult | null,
  animationIndex: number,
  subcatchmentPolygons: SubcatchmentPolygon[],
  measureSummaries: Map<string, MeasureSummaryLike>,
): { fillRatio: number; overflowing: boolean } {
  if (!evaluationResult) {
    return { fillRatio: 0, overflowing: false };
  }
  const summary = measureSummaries.get(measure.id);
  const storageVolumeM3 = summary?.volumeM3 ?? 0;
  if (storageVolumeM3 <= 0) {
    return { fillRatio: 0, overflowing: false };
  }
  const targetSubcatchmentId = findMeasureSubcatchmentId(
    measure,
    subcatchmentPolygons,
    evaluationResult.subcatchments[0]?.id ?? '',
  );
  const subcatchment = evaluationResult.subcatchments.find((entry) => entry.id === targetSubcatchmentId);
  if (!subcatchment) {
    return { fillRatio: 0, overflowing: false };
  }
  const areaShare = allocatedMeasureAreaShare(
    measure,
    measures,
    measureSummaries,
    catchmentData,
    subcatchmentPolygons,
    targetSubcatchmentId,
  );
  const dtS = subcatchment.after.dtH * 3600;
  let storedM3 = 0;
  for (let index = 0; index <= animationIndex; index += 1) {
    storedM3 += Math.max(0, subcatchment.after.qM3s[index] ?? 0) * dtS * areaShare;
  }
  const overflowing = storedM3 > storageVolumeM3;
  const fillRatio = Math.max(0, Math.min(1, storedM3 / storageVolumeM3));
  return {
    fillRatio,
    overflowing,
  };
}

function buildAnimatedFlowPathCollection(
  flowPathFeatures: FeatureCollection<LineFeature> | null,
  subcatchmentPolygons: SubcatchmentPolygon[],
  evaluationResult: ScenarioEvaluationResult | null,
  timeH: number,
): FeatureCollection<LineFeature> {
  if (!flowPathFeatures || !evaluationResult) {
    return emptyFeatureCollection() as FeatureCollection<LineFeature>;
  }

  const maxQ = Math.max(evaluationResult.after.qMaxM3s, 1e-6);
  const features = flowPathFeatures.features.map((feature, index) => {
    const anchor = feature.geometry.coordinates[0];
    const targetPolygon = anchor
      ? subcatchmentPolygons.find((polygon) => pointInPolygon(anchor, polygon.coordinates))
      : undefined;
    const hydrograph =
      index === flowPathFeatures.features.length - 1
        ? evaluationResult.after
        : (evaluationResult.subcatchments.find((entry) => entry.id === targetPolygon?.id)?.after ??
          evaluationResult.after);
    const qNorm = Math.max(0, Math.min(1, interpolateHydrographQ(hydrograph, timeH) / maxQ));
    return {
      ...feature,
      properties: {
        ...feature.properties,
        currentQ: qNorm,
      },
    };
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}

function buildFillAndPeakLabel(
  locale: Locale,
  formatter: Intl.NumberFormat,
  measures: MeasureState[],
  measureSummaries: Map<string, MeasureSummaryLike>,
  catchmentData: Catchment | null,
  evaluationResult: ScenarioEvaluationResult,
  subcatchmentPolygons: SubcatchmentPolygon[],
  fallbackSubcatchmentId: string,
): string {
  let earliestFillH: number | null = null;

  for (const measure of measures) {
    if (!measure.enabled) {
      continue;
    }
    const summary = measureSummaries.get(measure.id);
    if (!summary || summary.volumeM3 <= 0) {
      continue;
    }
    const targetId = findMeasureSubcatchmentId(measure, subcatchmentPolygons, fallbackSubcatchmentId);
    const hydrograph =
      evaluationResult.subcatchments.find((entry) => entry.id === targetId)?.after ?? evaluationResult.after;
    const areaShare = allocatedMeasureAreaShare(
      measure,
      measures,
      measureSummaries,
      catchmentData,
      subcatchmentPolygons,
      targetId,
    );
    const fillTimeH = estimateFillTimeH(hydrograph, summary.volumeM3, areaShare);
    if (fillTimeH !== null && (earliestFillH === null || fillTimeH < earliestFillH)) {
      earliestFillH = fillTimeH;
    }
  }

  const fillLabel = earliestFillH === null ? '–' : `${formatter.format(earliestFillH)} h`;
  return `${t(locale, 'result.metric.fullAfter')} ${fillLabel} / ${t(locale, 'result.metric.peakAfter')} ${formatter.format(evaluationResult.after.tPeakH)} h`;
}

function ResultNote({
  locale,
  onOpenAssumptions,
}: {
  locale: Locale;
  onOpenAssumptions: () => void;
}): JSX.Element {
  return (
    <p className="result-note">
      {t(locale, 'app.scenarioNote')}{' '}
      <button type="button" className="link-button" onClick={onOpenAssumptions}>
        {t(locale, 'result.assumptions')}
      </button>
    </p>
  );
}
