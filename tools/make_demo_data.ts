import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type FeatureCollection = GeoJSON.FeatureCollection;

type Position = [number, number];

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(rootDir, 'apps/web/public/data/demo');

const valleyBounds = {
  west: 11.916,
  east: 11.944,
  south: 49.934,
  north: 49.955,
};

const manifest = {
  id: 'demo',
  name: {
    de: 'Synthetisches Tal',
    cs: 'Syntetické údolí',
    en: 'Synthetic valley',
  },
  bounds: [
    [valleyBounds.west, valleyBounds.south],
    [valleyBounds.east, valleyBounds.north],
  ],
  terrain: {
    type: 'synthetic-plane',
    windowSizeM: 400,
    cellSizeM: 2,
    baseElevationM: 430,
    slopeXM: 0,
    slopeYM: -0.03,
  },
  layers: [
    {
      id: 'hillshade',
      name: {
        de: 'Schummerung',
        cs: 'Stínovaný reliéf',
        en: 'Hillshade',
      },
      type: 'image',
      layerType: 'raster',
      path: 'hillshade.svg',
      visibleByDefault: true,
      attribution: 'Demo-Daten',
      coordinates: [
        [valleyBounds.west, valleyBounds.north],
        [valleyBounds.east, valleyBounds.north],
        [valleyBounds.east, valleyBounds.south],
        [valleyBounds.west, valleyBounds.south],
      ],
      style: {
        paint: {
          'raster-opacity': 0.45,
        },
      },
      legend: {
        type: 'raster',
        colorRamp: ['#eff6ff', '#4b5563'],
      },
    },
    {
      id: 'subcatchments',
      name: {
        de: 'Teilgebiete',
        cs: 'Dílčí povodí',
        en: 'Subcatchments',
      },
      type: 'geojson',
      layerType: 'fill',
      path: 'subcatchments.geojson',
      visibleByDefault: true,
      attribution: 'Demo-Daten',
      inspectable: true,
      style: {
        paint: {
          'fill-color': '#60a5fa',
          'fill-opacity': 0.28,
          'fill-outline-color': '#1d4ed8',
        },
      },
      legend: {
        type: 'fill',
        color: '#60a5fa',
      },
    },
    {
      id: 'flow-paths',
      name: {
        de: 'Fließwege',
        cs: 'Odtokové dráhy',
        en: 'Flow paths',
      },
      type: 'geojson',
      layerType: 'line',
      path: 'flow_paths.geojson',
      visibleByDefault: true,
      attribution: 'Demo-Daten',
      style: {
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#0f766e',
          'line-opacity': 0.85,
          'line-width': ['interpolate', ['linear'], ['get', 'accumulation'], 10, 2, 45, 8],
        },
      },
      legend: {
        type: 'line',
        color: '#0f766e',
      },
    },
    {
      id: 'sinks',
      name: {
        de: 'Senken',
        cs: 'Deprese',
        en: 'Depressions',
      },
      type: 'geojson',
      layerType: 'circle',
      path: 'sinks.geojson',
      visibleByDefault: true,
      attribution: 'Demo-Daten',
      style: {
        paint: {
          'circle-radius': 5,
          'circle-color': '#7c3aed',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      },
      legend: {
        type: 'circle',
        color: '#7c3aed',
      },
    },
    {
      id: 'cn-zones',
      name: {
        de: 'Landnutzung × Bodengruppe',
        cs: 'Využití půdy × hydrologická skupina',
        en: 'Land use × soil group',
      },
      type: 'geojson',
      layerType: 'fill',
      path: 'cn_zones.geojson',
      visibleByDefault: false,
      attribution: 'Demo-Daten',
      style: {
        paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'cn'], 64, '#bbf7d0', 74, '#fef08a', 84, '#fdba74', 92, '#f87171'],
          'fill-opacity': 0.42,
          'fill-outline-color': '#854d0e',
        },
      },
      legend: {
        type: 'fill',
        color: '#f59e0b',
      },
    },
    {
      id: 'parcels',
      name: {
        de: 'Flurstücke',
        cs: 'Parcely',
        en: 'Parcels',
      },
      type: 'geojson',
      layerType: 'line',
      path: 'parcels.geojson',
      visibleByDefault: false,
      attribution: 'Demo-Daten',
      minzoom: 16,
      style: {
        paint: {
          'line-color': '#64748b',
          'line-width': 1,
          'line-opacity': 0.75,
        },
      },
      legend: {
        type: 'line',
        color: '#64748b',
      },
    },
  ],
} as const;

const subcatchments: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    polygonFeature('tgb-1', 'Teilgebiet 1', [
      [11.918, 49.954],
      [11.930, 49.954],
      [11.930, 49.946],
      [11.920, 49.944],
      [11.918, 49.954],
    ], { areaHa: 82, cn: 71, tcH: 1.3, shareForestPct: 35, shareGrasslandPct: 40, shareArablePct: 25 }),
    polygonFeature('tgb-2', 'Teilgebiet 2', [
      [11.930, 49.954],
      [11.942, 49.954],
      [11.942, 49.944],
      [11.932, 49.945],
      [11.930, 49.954],
    ], { areaHa: 74, cn: 78, tcH: 1.1, shareForestPct: 20, shareGrasslandPct: 45, shareArablePct: 35 }),
    polygonFeature('tgb-3', 'Teilgebiet 3', [
      [11.920, 49.944],
      [11.932, 49.945],
      [11.942, 49.944],
      [11.940, 49.936],
      [11.922, 49.936],
      [11.920, 49.944],
    ], { areaHa: 96, cn: 83, tcH: 0.9, shareForestPct: 15, shareGrasslandPct: 30, shareArablePct: 55 }),
  ],
};

const flowPaths: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    lineFeature('fp-1', [[11.924, 49.953], [11.927, 49.948], [11.930, 49.944]], { accumulation: 16 }),
    lineFeature('fp-2', [[11.936, 49.953], [11.935, 49.948], [11.932, 49.945]], { accumulation: 24 }),
    lineFeature('fp-3', [[11.930, 49.944], [11.931, 49.941], [11.932, 49.937]], { accumulation: 42 }),
  ],
};

const sinks: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    pointFeature('sink-1', [11.9285, 49.9476], { depthM: 0.7 }),
    pointFeature('sink-2', [11.9345, 49.9479], { depthM: 0.5 }),
    pointFeature('sink-3', [11.9317, 49.9397], { depthM: 0.9 }),
  ],
};

const cnZones: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    polygonFeature('cn-1', 'Wald / B', [
      [11.9185, 49.9532],
      [11.925, 49.9532],
      [11.926, 49.947],
      [11.9203, 49.946],
      [11.9185, 49.9532],
    ], { cn: 64 }),
    polygonFeature('cn-2', 'Grünland / C', [
      [11.925, 49.9532],
      [11.9302, 49.9532],
      [11.9298, 49.946],
      [11.926, 49.947],
      [11.925, 49.9532],
    ], { cn: 74 }),
    polygonFeature('cn-3', 'Acker / C', [
      [11.9303, 49.9532],
      [11.9415, 49.9532],
      [11.9405, 49.9463],
      [11.9325, 49.9459],
      [11.9303, 49.9532],
    ], { cn: 84 }),
    polygonFeature('cn-4', 'Acker / D', [
      [11.9225, 49.9435],
      [11.9395, 49.9435],
      [11.9388, 49.9367],
      [11.9232, 49.9367],
      [11.9225, 49.9435],
    ], { cn: 92 }),
  ],
};

const parcels: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    rectangleOutline('parcel-1', 11.9232, 49.9424, 0.0038, 0.0025),
    rectangleOutline('parcel-2', 11.928, 49.9421, 0.0036, 0.0022),
    rectangleOutline('parcel-3', 11.933, 49.9419, 0.0038, 0.0023),
    rectangleOutline('parcel-4', 11.9378, 49.9417, 0.003, 0.0024),
  ],
};

const hillshadeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" preserveAspectRatio="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="45%" stop-color="#dbeafe" />
      <stop offset="100%" stop-color="#d1d5db" />
    </linearGradient>
    <linearGradient id="valley" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0%" stop-color="#94a3b8" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0.35" />
    </linearGradient>
  </defs>
  <rect width="1200" height="900" fill="url(#bg)" />
  <path d="M180 130 C360 170, 420 300, 570 360 S850 520, 1010 760" fill="none" stroke="url(#valley)" stroke-width="230" stroke-linecap="round" />
  <g fill="none" stroke="#475569" stroke-opacity="0.35">
    <path d="M120 210 C300 140, 480 210, 720 160 S990 180, 1110 110" stroke-width="6" />
    <path d="M80 330 C250 270, 470 320, 700 270 S980 290, 1120 220" stroke-width="5" />
    <path d="M50 460 C260 400, 480 430, 700 380 S950 390, 1130 320" stroke-width="4" />
    <path d="M40 610 C270 540, 520 560, 760 510 S1000 520, 1160 450" stroke-width="4" />
    <path d="M60 760 C280 700, 520 710, 790 670 S1010 660, 1170 610" stroke-width="5" />
  </g>
</svg>
`.trim();

mkdirSync(outputDir, { recursive: true });
writeJson('manifest.json', manifest);
writeJson('subcatchments.geojson', subcatchments);
writeJson('flow_paths.geojson', flowPaths);
writeJson('sinks.geojson', sinks);
writeJson('cn_zones.geojson', cnZones);
writeJson('parcels.geojson', parcels);
writeFileSync(resolve(outputDir, 'hillshade.svg'), hillshadeSvg.concat('\n'));

function writeJson(filename: string, content: unknown): void {
  writeFileSync(resolve(outputDir, filename), `${JSON.stringify(content, null, 2)}\n`);
}

function polygonFeature(id: string, name: string, coordinates: Position[], properties: Record<string, number>): GeoJSON.Feature<GeoJSON.Polygon>;
function polygonFeature(id: string, coordinates: Position[], properties: Record<string, number>): GeoJSON.Feature<GeoJSON.Polygon>;
function polygonFeature(
  id: string,
  nameOrCoordinates: string | Position[],
  coordinatesOrProperties: Position[] | Record<string, number>,
  properties?: Record<string, number>,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const hasName = typeof nameOrCoordinates === 'string';
  const coordinates = (hasName ? coordinatesOrProperties : nameOrCoordinates) as Position[];
  const featureProperties = { ...(properties ?? (coordinatesOrProperties as Record<string, number>)), id };
  if (hasName) {
    Object.assign(featureProperties, { name: nameOrCoordinates });
  }

  return {
    type: 'Feature',
    properties: featureProperties,
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  };
}

function lineFeature(id: string, coordinates: Position[], properties: Record<string, number>): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: { id, ...properties },
    geometry: {
      type: 'LineString',
      coordinates,
    },
  };
}

function pointFeature(id: string, coordinates: Position, properties: Record<string, number>): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: { id, ...properties },
    geometry: {
      type: 'Point',
      coordinates,
    },
  };
}

function rectangleOutline(id: string, west: number, south: number, width: number, height: number): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: { id },
    geometry: {
      type: 'LineString',
      coordinates: [
        [west, south],
        [west + width, south],
        [west + width, south + height],
        [west, south + height],
        [west, south],
      ],
    },
  };
}
