export const RAIN_SHAPES = {
  block: [
    [0, 0],
    [1, 1],
  ],
  mittenbetont: [
    [0, 0],
    [0.3, 0.2],
    [0.5, 0.7],
    [1, 1],
  ],
  anfangsbetont: [
    [0, 0],
    [0.2, 0.5],
    [0.5, 0.8],
    [1, 1],
  ],
  endbetont: [
    [0, 0],
    [0.5, 0.2],
    [0.8, 0.5],
    [1, 1],
  ],
} as const;

export type RainShape = keyof typeof RAIN_SHAPES;

export function cumulativeRainFraction(x: number, shape: RainShape): number {
  const points = RAIN_SHAPES[shape];
  const xClamped = Math.min(Math.max(x, 0), 1);

  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (xClamped <= x1) {
      return y0 + ((y1 - y0) * (xClamped - x0)) / (x1 - x0);
    }
  }

  return 1;
}
