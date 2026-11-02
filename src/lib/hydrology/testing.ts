import type { HydroGrid } from './grid'

/** Builds a synthetic grid with square cells for tests and benchmarks. */
export function syntheticGrid(
  width: number,
  height: number,
  elevationAt: (row: number, col: number) => number,
  cellM = 10,
): HydroGrid {
  const elevation = new Float32Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) elevation[row * width + col] = elevationAt(row, col)
  }
  return {
    width,
    height,
    elevation,
    dxM: new Float64Array(height).fill(cellM),
    dyM: new Float64Array(height).fill(cellM),
  }
}
