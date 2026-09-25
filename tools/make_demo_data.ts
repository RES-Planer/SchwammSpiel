import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

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
      path: 'hillshade.png',
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

const crcTable = createCrcTable();
const hillshadePng = buildHillshadePng(480, 360);

mkdirSync(outputDir, { recursive: true });
writeJson('manifest.json', manifest);
writeJson('subcatchments.geojson', subcatchments);
writeJson('flow_paths.geojson', flowPaths);
writeJson('sinks.geojson', sinks);
writeJson('cn_zones.geojson', cnZones);
writeJson('parcels.geojson', parcels);
rmSync(resolve(outputDir, 'hillshade.svg'), { force: true });
writeFileSync(resolve(outputDir, 'hillshade.png'), hillshadePng);

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

function buildHillshadePng(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const yNorm = y / Math.max(1, height - 1);
    const valleyCenter = 0.2 + 0.62 * yNorm;
    for (let x = 0; x < width; x += 1) {
      const xNorm = x / Math.max(1, width - 1);
      const valley = Math.exp(-Math.pow((xNorm - valleyCenter) * 5.2, 2));
      const ridges = 0.06 * Math.sin((xNorm * 11 + yNorm * 2.5) * Math.PI);
      const northLight = 0.26 * (1 - yNorm);
      const shade = Math.max(0, Math.min(1, 0.22 + northLight + ridges + valley * 0.38));
      const red = clampColor(239 - shade * 92);
      const green = clampColor(246 - shade * 118);
      const blue = clampColor(255 - shade * 136);
      const offset = (y * width + x) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = 255;
    }
  }

  return encodePng(width, height, pixels);
}

function encodePng(width: number, height: number, pixels: Buffer): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
