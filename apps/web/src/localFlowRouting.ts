export type LocalPointM = [number, number];

export type TerrainWindow = {
  width: number;
  height: number;
  cellSizeM: number;
  elevationsM: number[];
  baseAccumulationCells?: number[];
};

export type LocalTerrainMeasure =
  | {
      kind: 'swale';
      coordinates: LocalPointM[];
      bottomWidthM: number;
      depthM: number;
      sideSlopeM: number;
    }
  | {
      kind: 'storageWithPipe';
      coordinates: LocalPointM[];
      depthM: number;
    }
  | {
      kind: 'flowPathChange';
      coordinates: LocalPointM[];
      wallHeightM: number;
      sideSlopeM: number;
    };

export type LocalTerrainAnalysis = {
  accumulationCells: number[];
  cutM3: number;
  fillM3: number;
  massBalanceM3: number;
  capturedAreaM2: number;
  capturedAreaShare: number;
  dominantFlowPathChainageM: number | null;
  dominantFlowPathM: LocalPointM[];
  editedElevationsM: number[];
  filledElevationsM: number[];
  warningCodes: string[];
};

export type LocalTerrainBaseline = {
  filledElevationsM: number[];
  accumulationCells: number[];
};

type ClosestLinePoint = {
  distanceM: number;
  signedDistanceM: number;
  tangent: LocalPointM;
};

type RasterEditResult = {
  editedElevationsM: number[];
  editedCellIndexes: number[];
  cutM3: number;
  fillM3: number;
};

type HeapEntry = {
  elevationM: number;
  index: number;
};

const EPSILON_M = 1e-6;

const D8_OFFSETS: Array<{ dx: number; dy: number; distance: number }> = [
  { dx: -1, dy: -1, distance: Math.SQRT2 },
  { dx: 0, dy: -1, distance: 1 },
  { dx: 1, dy: -1, distance: Math.SQRT2 },
  { dx: -1, dy: 0, distance: 1 },
  { dx: 1, dy: 0, distance: 1 },
  { dx: -1, dy: 1, distance: Math.SQRT2 },
  { dx: 0, dy: 1, distance: 1 },
  { dx: 1, dy: 1, distance: Math.SQRT2 },
];

function assertFinitePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number > 0`);
  }
}

function assertWindow(window: TerrainWindow): void {
  assertFinitePositive('width', window.width);
  assertFinitePositive('height', window.height);
  assertFinitePositive('cellSizeM', window.cellSizeM);
  if (window.elevationsM.length !== window.width * window.height) {
    throw new Error('elevationsM length must match width*height');
  }
  if (
    window.baseAccumulationCells &&
    window.baseAccumulationCells.length !== window.width * window.height
  ) {
    throw new Error('baseAccumulationCells length must match width*height');
  }
}

function isBoundaryCell(window: TerrainWindow, col: number, row: number): boolean {
  return col === 0 || row === 0 || col === window.width - 1 || row === window.height - 1;
}

function toIndex(window: TerrainWindow, col: number, row: number): number {
  return row * window.width + col;
}

function fromIndex(window: TerrainWindow, index: number): { col: number; row: number } {
  return {
    col: index % window.width,
    row: Math.floor(index / window.width),
  };
}

function cellCenterM(window: TerrainWindow, col: number, row: number): LocalPointM {
  return [(col + 0.5) * window.cellSizeM, (row + 0.5) * window.cellSizeM];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointInPolygon(point: LocalPointM, polygon: LocalPointM[]): boolean {
  let inside = false;
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (!current || !previous) {
      continue;
    }
    const intersects =
      current[1] > point[1] !== previous[1] > point[1] &&
      point[0] <
        ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) +
          current[0];
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function meanLineSlopeDropM(window: TerrainWindow, coordinates: LocalPointM[]): number {
  if (coordinates.length < 2) {
    return 0;
  }
  const start = sampleElevationM(window, coordinates[0]);
  const end = sampleElevationM(window, coordinates[coordinates.length - 1]);
  return Math.abs(end - start);
}

function sampleElevationM(window: TerrainWindow, point: LocalPointM): number {
  const rawCol = clamp(point[0] / window.cellSizeM - 0.5, 0, window.width - 1);
  const rawRow = clamp(point[1] / window.cellSizeM - 0.5, 0, window.height - 1);
  const col = Math.round(rawCol);
  const row = Math.round(rawRow);
  return window.elevationsM[toIndex(window, col, row)] ?? 0;
}

function descentVector(window: TerrainWindow, coordinates: LocalPointM[]): LocalPointM {
  let sumX = 0;
  let sumY = 0;
  let samples = 0;
  for (const coordinate of coordinates) {
    const rawCol = clamp(coordinate[0] / window.cellSizeM - 0.5, 0, window.width - 1);
    const rawRow = clamp(coordinate[1] / window.cellSizeM - 0.5, 0, window.height - 1);
    const col = Math.round(rawCol);
    const row = Math.round(rawRow);
    const left = window.elevationsM[toIndex(window, Math.max(0, col - 1), row)] ?? 0;
    const right = window.elevationsM[toIndex(window, Math.min(window.width - 1, col + 1), row)] ?? 0;
    const top = window.elevationsM[toIndex(window, col, Math.max(0, row - 1))] ?? 0;
    const bottom = window.elevationsM[toIndex(window, col, Math.min(window.height - 1, row + 1))] ?? 0;
    sumX += -(right - left);
    sumY += -(bottom - top);
    samples += 1;
  }
  if (samples === 0) {
    return [0, 1];
  }
  const vector: LocalPointM = [sumX / samples, sumY / samples];
  const length = Math.hypot(vector[0], vector[1]);
  return length > 0 ? [vector[0] / length, vector[1] / length] : [0, 1];
}

function closestPointOnLine(point: LocalPointM, coordinates: LocalPointM[], downslope: LocalPointM): ClosestLinePoint {
  let best: ClosestLinePoint | null = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    if (!start || !end) {
      continue;
    }
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length <= 0) {
      continue;
    }
    const ratio = clamp(
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (length * length),
      0,
      1,
    );
    const closestX = start[0] + dx * ratio;
    const closestY = start[1] + dy * ratio;
    const offsetX = point[0] - closestX;
    const offsetY = point[1] - closestY;
    const tangent: LocalPointM = [dx / length, dy / length];
    const normal: LocalPointM = [-tangent[1], tangent[0]];
    const orientation = Math.sign(normal[0] * downslope[0] + normal[1] * downslope[1]) || 1;
    const signedDistanceM = (offsetX * normal[0] + offsetY * normal[1]) * orientation;
    const candidate: ClosestLinePoint = {
      distanceM: Math.hypot(offsetX, offsetY),
      signedDistanceM,
      tangent,
    };
    if (!best || candidate.distanceM < best.distanceM) {
      best = candidate;
    }
  }
  if (!best) {
    return {
      distanceM: Number.POSITIVE_INFINITY,
      signedDistanceM: Number.POSITIVE_INFINITY,
      tangent: [1, 0],
    };
  }
  return best;
}

function swaleCutDepthM(
  signedDistanceM: number,
  bottomWidthM: number,
  depthM: number,
  sideSlopeM: number,
): number {
  const halfBottomWidthM = bottomWidthM / 2;
  const absDistanceM = Math.abs(signedDistanceM);
  if (absDistanceM <= halfBottomWidthM) {
    return depthM;
  }
  const slopeRunM = absDistanceM - halfBottomWidthM;
  const slopeHeightM = depthM - slopeRunM / sideSlopeM;
  return Math.max(0, slopeHeightM);
}

function analyzeLineEdit(window: TerrainWindow, measure: LocalTerrainMeasure): RasterEditResult {
  const editedElevationsM = [...window.elevationsM];
  const editedCellIndexes: number[] = [];
  const cellAreaM2 = window.cellSizeM * window.cellSizeM;
  const downslope = descentVector(window, measure.coordinates);
  let cutM3 = 0;
  let fillM3 = 0;

  const depthM = measure.kind === 'flowPathChange' ? measure.wallHeightM : measure.depthM;
  const bottomWidthM = measure.kind === 'swale' ? measure.bottomWidthM : window.cellSizeM;
  const sideSlopeM = measure.sideSlopeM;
  const cutSectionAreaM2 =
    measure.kind === 'swale' ? bottomWidthM * depthM + sideSlopeM * depthM * depthM : 0;
  const fillWidthM = measure.kind === 'swale' ? (2 * cutSectionAreaM2) / Math.max(depthM, EPSILON_M) : sideSlopeM * depthM;
  const maxInfluenceM =
    measure.kind === 'swale'
      ? Math.max(bottomWidthM / 2 + sideSlopeM * depthM, fillWidthM)
      : sideSlopeM * depthM;

  for (let row = 0; row < window.height; row += 1) {
    for (let col = 0; col < window.width; col += 1) {
      const center = cellCenterM(window, col, row);
      const closest = closestPointOnLine(center, measure.coordinates, downslope);
      if (closest.distanceM > maxInfluenceM + window.cellSizeM) {
        continue;
      }
      let deltaM = 0;
      if (measure.kind === 'swale') {
        const cutDepthM = swaleCutDepthM(
          closest.signedDistanceM,
          bottomWidthM,
          depthM,
          sideSlopeM,
        );
        const fillHeightM =
          closest.signedDistanceM >= 0 && closest.signedDistanceM <= fillWidthM
            ? depthM * (1 - closest.signedDistanceM / Math.max(fillWidthM, EPSILON_M))
            : 0;
        deltaM = fillHeightM - cutDepthM;
      } else {
        const absDistanceM = Math.abs(closest.signedDistanceM);
        const wallHeightM = Math.max(0, depthM - absDistanceM / Math.max(sideSlopeM, EPSILON_M));
        deltaM = wallHeightM;
      }

      if (Math.abs(deltaM) < EPSILON_M) {
        continue;
      }

      const index = toIndex(window, col, row);
      editedElevationsM[index] = (editedElevationsM[index] ?? 0) + deltaM;
      editedCellIndexes.push(index);
      if (deltaM < 0) {
        cutM3 += -deltaM * cellAreaM2;
      } else {
        fillM3 += deltaM * cellAreaM2;
      }
    }
  }

  return {
    editedElevationsM,
    editedCellIndexes,
    cutM3,
    fillM3,
  };
}

function analyzePolygonEdit(
  window: TerrainWindow,
  measure: Extract<LocalTerrainMeasure, { kind: 'storageWithPipe' }>,
): RasterEditResult {
  const editedElevationsM = [...window.elevationsM];
  const editedCellIndexes: number[] = [];
  const cellAreaM2 = window.cellSizeM * window.cellSizeM;
  let cutM3 = 0;

  for (let row = 0; row < window.height; row += 1) {
    for (let col = 0; col < window.width; col += 1) {
      const center = cellCenterM(window, col, row);
      if (!pointInPolygon(center, measure.coordinates)) {
        continue;
      }
      const index = toIndex(window, col, row);
      editedElevationsM[index] = (editedElevationsM[index] ?? 0) - measure.depthM;
      editedCellIndexes.push(index);
      cutM3 += measure.depthM * cellAreaM2;
    }
  }

  return {
    editedElevationsM,
    editedCellIndexes,
    cutM3,
    fillM3: 0,
  };
}

function applyMeasureToTerrain(window: TerrainWindow, measure: LocalTerrainMeasure): RasterEditResult {
  if (measure.kind === 'storageWithPipe') {
    return analyzePolygonEdit(window, measure);
  }
  return analyzeLineEdit(window, measure);
}

class MinHeap {
  private entries: HeapEntry[] = [];

  push(entry: HeapEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const current = this.entries[index];
      const parentEntry = this.entries[parent];
      if (!current || !parentEntry || parentEntry.elevationM <= current.elevationM) {
        break;
      }
      this.entries[index] = parentEntry;
      this.entries[parent] = current;
      index = parent;
    }
  }

  pop(): HeapEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last) {
      return first ?? last;
    }
    if (this.entries.length === 0) {
      return first;
    }
    this.entries[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (
        this.entries[left] &&
        this.entries[smallest] &&
        this.entries[left]!.elevationM < this.entries[smallest]!.elevationM
      ) {
        smallest = left;
      }
      if (
        this.entries[right] &&
        this.entries[smallest] &&
        this.entries[right]!.elevationM < this.entries[smallest]!.elevationM
      ) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }
      const current = this.entries[index];
      this.entries[index] = this.entries[smallest]!;
      this.entries[smallest] = current!;
      index = smallest;
    }
    return first;
  }

  get size(): number {
    return this.entries.length;
  }
}

function priorityFlood(window: TerrainWindow, elevationsM: number[]): number[] {
  const filled = [...elevationsM];
  const visited = new Array(window.width * window.height).fill(false);
  const heap = new MinHeap();

  for (let row = 0; row < window.height; row += 1) {
    for (let col = 0; col < window.width; col += 1) {
      if (!isBoundaryCell(window, col, row)) {
        continue;
      }
      const index = toIndex(window, col, row);
      heap.push({ elevationM: filled[index] ?? 0, index });
      visited[index] = true;
    }
  }

  while (heap.size > 0) {
    const entry = heap.pop();
    if (!entry) {
      break;
    }
    const { col, row } = fromIndex(window, entry.index);
    for (const offset of D8_OFFSETS) {
      const nextCol = col + offset.dx;
      const nextRow = row + offset.dy;
      if (nextCol < 0 || nextRow < 0 || nextCol >= window.width || nextRow >= window.height) {
        continue;
      }
      const nextIndex = toIndex(window, nextCol, nextRow);
      if (visited[nextIndex]) {
        continue;
      }
      visited[nextIndex] = true;
      const raisedElevationM = Math.max(filled[nextIndex] ?? 0, entry.elevationM + EPSILON_M);
      filled[nextIndex] = raisedElevationM;
      heap.push({ elevationM: raisedElevationM, index: nextIndex });
    }
  }

  return filled;
}

function computeD8Directions(window: TerrainWindow, elevationsM: number[]): Int32Array {
  const directions = new Int32Array(window.width * window.height).fill(-1);

  for (let row = 0; row < window.height; row += 1) {
    for (let col = 0; col < window.width; col += 1) {
      const index = toIndex(window, col, row);
      const elevationM = elevationsM[index] ?? 0;
      let bestIndex = -1;
      let bestDrop = 0;
      for (const offset of D8_OFFSETS) {
        const nextCol = col + offset.dx;
        const nextRow = row + offset.dy;
        if (nextCol < 0 || nextRow < 0 || nextCol >= window.width || nextRow >= window.height) {
          continue;
        }
        const nextIndex = toIndex(window, nextCol, nextRow);
        const nextElevationM = elevationsM[nextIndex] ?? elevationM;
        const drop = (elevationM - nextElevationM) / offset.distance;
        if (drop > bestDrop + EPSILON_M) {
          bestDrop = drop;
          bestIndex = nextIndex;
        }
      }
      directions[index] = bestIndex;
    }
  }

  return directions;
}

function computeAccumulation(window: TerrainWindow, directions: Int32Array): number[] {
  const accumulation = new Array(window.width * window.height).fill(1);
  const indegree = new Int32Array(window.width * window.height);

  for (let index = 0; index < directions.length; index += 1) {
    const downstream = directions[index];
    if (downstream >= 0) {
      indegree[downstream] += 1;
    }
  }

  if (window.baseAccumulationCells) {
    for (let row = 0; row < window.height; row += 1) {
      for (let col = 0; col < window.width; col += 1) {
        if (!isBoundaryCell(window, col, row)) {
          continue;
        }
        const index = toIndex(window, col, row);
        accumulation[index] = Math.max(1, window.baseAccumulationCells[index] ?? 1);
      }
    }
  }

  const queue: number[] = [];
  for (let index = 0; index < indegree.length; index += 1) {
    if (indegree[index] === 0) {
      queue.push(index);
    }
  }

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const index = queue[queueIndex]!;
    const downstream = directions[index];
    if (downstream >= 0) {
      accumulation[downstream] += accumulation[index] ?? 0;
      indegree[downstream] -= 1;
      if (indegree[downstream] === 0) {
        queue.push(downstream);
      }
    }
  }

  return accumulation;
}

function reverseGraph(directions: Int32Array): number[][] {
  const upstream = Array.from({ length: directions.length }, () => [] as number[]);
  for (let index = 0; index < directions.length; index += 1) {
    const downstream = directions[index];
    if (downstream >= 0) {
      upstream[downstream]!.push(index);
    }
  }
  return upstream;
}

function upstreamCaptureCells(directions: Int32Array, targetIndexes: number[]): Set<number> {
  const upstream = reverseGraph(directions);
  const captured = new Set<number>(targetIndexes);
  const queue = [...targetIndexes];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const index = queue[queueIndex]!;
    for (const source of upstream[index] ?? []) {
      if (captured.has(source)) {
        continue;
      }
      captured.add(source);
      queue.push(source);
    }
  }
  return captured;
}

function traceDominantPath(window: TerrainWindow, directions: Int32Array, accumulation: number[]): LocalPointM[] {
  let startIndex = 0;
  let bestAccumulation = -1;
  for (let col = 0; col < window.width; col += 1) {
    const index = toIndex(window, col, 0);
    const current = accumulation[index] ?? 0;
    if (current > bestAccumulation) {
      bestAccumulation = current;
      startIndex = index;
    }
  }
  const path: LocalPointM[] = [];
  const seen = new Set<number>();
  let currentIndex = startIndex;
  while (currentIndex >= 0 && !seen.has(currentIndex)) {
    seen.add(currentIndex);
    const { col, row } = fromIndex(window, currentIndex);
    path.push(cellCenterM(window, col, row));
    currentIndex = directions[currentIndex] ?? -1;
  }
  return path;
}

function pathChainageAtEditedCell(
  window: TerrainWindow,
  directions: Int32Array,
  accumulation: number[],
  editedCells: Set<number>,
): number | null {
  const path = traceDominantPath(window, directions, accumulation);
  if (path.length < 2) {
    return null;
  }
  let chainageM = 0;
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index];
    if (!point) {
      continue;
    }
    const col = clamp(Math.floor(point[0] / window.cellSizeM), 0, window.width - 1);
    const row = clamp(Math.floor(point[1] / window.cellSizeM), 0, window.height - 1);
    if (editedCells.has(toIndex(window, col, row))) {
      return chainageM;
    }
    const next = path[index + 1];
    if (next) {
      chainageM += Math.hypot(next[0] - point[0], next[1] - point[1]);
    }
  }
  return null;
}

export function analyzeLocalFlowRouting(
  window: TerrainWindow,
  measure: LocalTerrainMeasure,
): LocalTerrainAnalysis {
  assertWindow(window);
  if (measure.kind === 'storageWithPipe') {
    assertFinitePositive('depthM', measure.depthM);
  } else {
    assertFinitePositive('sideSlopeM', measure.sideSlopeM);
    if (measure.kind === 'swale') {
      assertFinitePositive('bottomWidthM', measure.bottomWidthM);
      assertFinitePositive('depthM', measure.depthM);
    } else {
      assertFinitePositive('wallHeightM', measure.wallHeightM);
    }
  }

  const rasterEdit = applyMeasureToTerrain(window, measure);
  const filledElevationsM = priorityFlood(window, rasterEdit.editedElevationsM);
  const directions = computeD8Directions(window, filledElevationsM);
  const accumulation = computeAccumulation(window, directions);
  const editedCellSet = new Set<number>(rasterEdit.editedCellIndexes);
  const capturedCells = upstreamCaptureCells(directions, rasterEdit.editedCellIndexes);
  const cellAreaM2 = window.cellSizeM * window.cellSizeM;
  const capturedAreaM2 = capturedCells.size * cellAreaM2;
  const dominantFlowPathM = traceDominantPath(window, directions, accumulation);
  const dominantFlowPathChainageM = pathChainageAtEditedCell(window, directions, accumulation, editedCellSet);
  const warningCodes =
    measure.kind === 'swale' && meanLineSlopeDropM(window, measure.coordinates) > 0.3
      ? ['not-contour-parallel']
      : [];

  return {
    accumulationCells: accumulation,
    cutM3: rasterEdit.cutM3,
    fillM3: rasterEdit.fillM3,
    massBalanceM3: rasterEdit.fillM3 - rasterEdit.cutM3,
    capturedAreaM2,
    capturedAreaShare: capturedCells.size / Math.max(1, window.width * window.height),
    dominantFlowPathChainageM,
    dominantFlowPathM,
    editedElevationsM: rasterEdit.editedElevationsM,
    filledElevationsM,
    warningCodes,
  };
}

export function analyzeBaselineTerrain(window: TerrainWindow): LocalTerrainBaseline {
  assertWindow(window);
  const filledElevationsM = priorityFlood(window, window.elevationsM);
  const directions = computeD8Directions(window, filledElevationsM);
  const accumulationCells = computeAccumulation(window, directions);
  return {
    filledElevationsM,
    accumulationCells,
  };
}
