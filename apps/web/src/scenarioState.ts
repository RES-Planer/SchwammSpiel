export type MeasureKind =
  | 'landUseChange'
  | 'storageWithPipe'
  | 'forestMulches'
  | 'swale'
  | 'stonefield'
  | 'flowPathChange';

export type MeasureGeometry =
  | { type: 'Polygon'; coordinates: [number, number][] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | null;

export type MeasureState = {
  id: string;
  kind: MeasureKind;
  enabled: boolean;
  params: Record<string, boolean | number | string>;
  geometry: MeasureGeometry;
};

export type ScenarioState = {
  version: 1;
  catchmentId: string;
  measures: MeasureState[];
};

export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

const MAX_HISTORY_ENTRIES = 100;
const SHARE_PREFIX_RAW = 'raw.';
const SHARE_PREFIX_GZIP = 'gz.';

function deepEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createInitialScenarioState(catchmentId: string): ScenarioState {
  return {
    version: 1,
    catchmentId,
    measures: [],
  };
}

export function createHistoryState<T>(initial: T): HistoryState<T> {
  return {
    past: [],
    present: initial,
    future: [],
  };
}

export function commitHistoryState<T>(history: HistoryState<T>, next: T): HistoryState<T> {
  if (deepEqual(history.present, next)) {
    return history;
  }

  const past = [...history.past, history.present];
  const trimmedPast = past.length > MAX_HISTORY_ENTRIES ? past.slice(-MAX_HISTORY_ENTRIES) : past;
  return {
    past: trimmedPast,
    present: next,
    future: [],
  };
}

export function undoHistoryState<T>(history: HistoryState<T>): HistoryState<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) {
    return history;
  }

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoHistoryState<T>(history: HistoryState<T>): HistoryState<T> {
  const [next, ...restFuture] = history.future;
  if (next === undefined) {
    return history;
  }

  return {
    past: [...history.past, history.present],
    present: next,
    future: restFuture,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function tryGzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') {
    return null;
  }

  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes.slice());
  await writer.close();
  const compressed = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(compressed);
}

async function tryGunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') {
    return null;
  }

  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes.slice());
  await writer.close();
  const uncompressed = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(uncompressed);
}

export async function encodeScenarioState(state: ScenarioState): Promise<string> {
  const rawBytes = new TextEncoder().encode(JSON.stringify(state));
  const compressed = await tryGzip(rawBytes);
  if (compressed && compressed.length < rawBytes.length) {
    return `${SHARE_PREFIX_GZIP}${bytesToBase64Url(compressed)}`;
  }
  return `${SHARE_PREFIX_RAW}${bytesToBase64Url(rawBytes)}`;
}

export async function decodeScenarioState(payload: string): Promise<ScenarioState> {
  if (payload.startsWith(SHARE_PREFIX_GZIP)) {
    const compressedBytes = base64UrlToBytes(payload.slice(SHARE_PREFIX_GZIP.length));
    const uncompressed = await tryGunzip(compressedBytes);
    if (!uncompressed) {
      throw new Error('Cannot decode compressed payload in this environment');
    }
    return JSON.parse(new TextDecoder().decode(uncompressed)) as ScenarioState;
  }

  const rawPart = payload.startsWith(SHARE_PREFIX_RAW)
    ? payload.slice(SHARE_PREFIX_RAW.length)
    : payload;
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(rawPart))) as ScenarioState;
}

export async function toShareFragment(state: ScenarioState): Promise<string> {
  return `scenario=${await encodeScenarioState(state)}`;
}

export async function fromShareFragment(fragment: string): Promise<ScenarioState | null> {
  const trimmed = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const params = new URLSearchParams(trimmed);
  const encoded = params.get('scenario');
  if (!encoded) {
    return null;
  }
  return decodeScenarioState(encoded);
}
