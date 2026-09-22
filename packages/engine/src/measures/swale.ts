import { SWALE_L_SHEET_DEFAULT_M } from '../assumptions';
import type { FlowSegment } from '../flowPath';

export type SwaleGeometryInput = {
  lengthM: number;
  bottomWidthM?: number;
  depthM?: number;
  sideSlopeM?: number;
};

export type SwaleGeometry = {
  lengthM: number;
  bottomWidthM: number;
  depthM: number;
  sideSlopeM: number;
  vMaxM3: number;
  aInfM2: number;
  excavationM3: number;
};

export type SwaleWarningCode = 'not-contour-parallel';

export type SwaleWarning = {
  code: SwaleWarningCode;
  message: string;
};

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number > 0`);
  }
}

function cloneSegmentWithLength(segment: FlowSegment, lengthM: number): FlowSegment {
  return { ...segment, lengthM };
}

export function swaleGeometry(input: SwaleGeometryInput): SwaleGeometry {
  const bottomWidthM = input.bottomWidthM ?? 0.5;
  const depthM = input.depthM ?? 0.5;
  const sideSlopeM = input.sideSlopeM ?? 2;

  assertPositive('lengthM', input.lengthM);
  assertPositive('bottomWidthM', bottomWidthM);
  assertPositive('depthM', depthM);
  assertPositive('sideSlopeM', sideSlopeM);

  const vMaxM3 = input.lengthM * (bottomWidthM * depthM + sideSlopeM * depthM ** 2);
  const aInfM2 =
    input.lengthM *
    (bottomWidthM + 2 * depthM * Math.sqrt(1 + sideSlopeM ** 2));

  return {
    lengthM: input.lengthM,
    bottomWidthM,
    depthM,
    sideSlopeM,
    vMaxM3,
    aInfM2,
    excavationM3: vMaxM3,
  };
}

export function validateSwaleContourAlignment(elevationProfileM: number[]): SwaleWarning[] {
  if (elevationProfileM.length < 2) {
    return [];
  }
  const zStart = elevationProfileM[0] ?? 0;
  const zEnd = elevationProfileM[elevationProfileM.length - 1] ?? 0;
  const dzM = Math.abs(zEnd - zStart);
  if (dzM <= 0.3) {
    return [];
  }
  return [
    {
      code: 'not-contour-parallel',
      message: 'nicht höhenlinienparallel – wirkt als Graben',
    },
  ];
}

export function applyToFlowPath(
  segments: FlowSegment[],
  chainageM: number,
  landCoverK: number,
  lSheetM = SWALE_L_SHEET_DEFAULT_M.value,
): FlowSegment[] {
  assertPositive('landCoverK', landCoverK);
  if (!Number.isFinite(chainageM) || chainageM < 0) {
    throw new Error('chainageM must be a finite number >= 0');
  }
  assertPositive('lSheetM', lSheetM);

  const result: FlowSegment[] = [];
  let pathPosM = 0;

  for (const segment of segments) {
    assertPositive('segment.lengthM', segment.lengthM);

    const segStartM = pathPosM;
    const segEndM = pathPosM + segment.lengthM;

    const sheetStartM = chainageM;
    const sheetEndM = chainageM + lSheetM;

    const overlapStartM = Math.max(segStartM, sheetStartM);
    const overlapEndM = Math.min(segEndM, sheetEndM);

    const beforeM = Math.max(0, overlapStartM - segStartM);
    const overlapM = Math.max(0, overlapEndM - overlapStartM);
    const afterM = Math.max(0, segEndM - overlapEndM);

    if (beforeM > 0) {
      result.push(cloneSegmentWithLength(segment, beforeM));
    }

    if (overlapM > 0) {
      result.push({
        type: 'sheet',
        lengthM: overlapM,
        slope: segment.slope,
        k: landCoverK,
      });
    }

    if (afterM > 0) {
      result.push(cloneSegmentWithLength(segment, afterM));
    }

    pathPosM = segEndM;
  }

  return result;
}
