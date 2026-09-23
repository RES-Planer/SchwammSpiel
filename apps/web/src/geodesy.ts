const EARTH_RADIUS_M = 6_378_137;
const DEG_TO_RAD = Math.PI / 180;

export type LngLat = [lng: number, lat: number];

function toRad(value: number): number {
  return value * DEG_TO_RAD;
}

export function geodesicLengthM(path: LngLat[]): number {
  if (path.length < 2) {
    return 0;
  }

  let lengthM = 0;
  for (let i = 1; i < path.length; i += 1) {
    const [lng1, lat1] = path[i - 1] ?? [0, 0];
    const [lng2, lat2] = path[i] ?? [0, 0];
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    lengthM += EARTH_RADIUS_M * c;
  }

  return lengthM;
}

function normalizeRing(ring: LngLat[]): LngLat[] {
  if (ring.length < 3) {
    return [];
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) {
    return [];
  }
  if (first[0] === last[0] && first[1] === last[1]) {
    return ring;
  }
  return [...ring, first];
}

export function geodesicPolygonAreaM2(ring: LngLat[]): number {
  const normalized = normalizeRing(ring);
  if (normalized.length < 4) {
    return 0;
  }

  let areaSum = 0;
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const [lng1, lat1] = normalized[i] ?? [0, 0];
    const [lng2, lat2] = normalized[i + 1] ?? [0, 0];
    areaSum += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }

  return Math.abs((areaSum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}
