import { rampAt } from '../dem/render'
import { elevationStats } from '../dem/grid'
import type { ElevationGrid } from '../dem/types'
import { fromElevationGrid } from '../hydrology/grid'

/**
 * Geometry for the 3D view, built from real grids without any rendering library so it
 * can be tested. Coordinates are metres in a local frame centred on the area:
 * x points east, y up, and z south, so north is −z (Three.js's default "into the screen").
 * Each elevation cell becomes one vertex at its centre, at its real distance from its
 * neighbours using that row's cell size.
 */

/** Ponding shallower than this is not drawn; it matches the hollow-depth threshold of the model. */
export const MIN_DRAWN_POND_M = 0.01

export interface TerrainFrame {
  width: number
  height: number
  /** x of each column's cell centre, metres east of the area centre. */
  x: Float64Array
  /** z of each row's cell centre, metres south of the area centre. */
  z: Float64Array
  /** East–west and north–south extent, metres. */
  extentX: number
  extentZ: number
  /** Elevation that maps to y = 0, metres. */
  baseElevation: number
  minElevation: number
  maxElevation: number
  exaggeration: number
}

export interface TerrainGeometry {
  frame: TerrainFrame
  positions: Float32Array
  colors: Float32Array
  /** Triangles only between valid cells; no-data cells leave holes. */
  indices: Uint32Array
  validCells: number
}

export interface WaterGeometry {
  positions: Float32Array
  /** Water surface height of each vertex above its ground, scaled; used to animate the rise. */
  rise: Float32Array
  colors: Float32Array
  indices: Uint32Array
  cells: number
  maxDepthM: number
}

/** Local metric frame of an elevation grid. */
export function terrainFrame(grid: ElevationGrid, exaggeration: number): TerrainFrame {
  if (!(exaggeration > 0) || !Number.isFinite(exaggeration)) throw new Error('Vertical exaggeration must be a positive number.')
  const stats = elevationStats(grid.values)
  if (!stats) throw new Error('The elevation grid has no valid cells.')
  const { dxM, dyM } = fromElevationGrid(grid)
  // Row widths differ very slightly with latitude; the middle row sets the x spacing.
  const dx = dxM[Math.floor(grid.height / 2)]
  const x = new Float64Array(grid.width)
  for (let c = 0; c < grid.width; c++) x[c] = (c + 0.5 - grid.width / 2) * dx
  const z = new Float64Array(grid.height)
  let edge = 0
  for (let r = 0; r < grid.height; r++) {
    z[r] = edge + dyM[r] / 2
    edge += dyM[r]
  }
  for (let r = 0; r < grid.height; r++) z[r] -= edge / 2
  return {
    width: grid.width,
    height: grid.height,
    x,
    z,
    extentX: dx * grid.width,
    extentZ: edge,
    baseElevation: stats.min,
    minElevation: stats.min,
    maxElevation: stats.max,
    exaggeration,
  }
}

export function heightY(frame: TerrainFrame, elevationM: number): number {
  return (elevationM - frame.baseElevation) * frame.exaggeration
}

/** Terrain mesh: a vertex per cell, coloured with the PaaniPulse elevation ramp. */
export function buildTerrainGeometry(grid: ElevationGrid, exaggeration: number): TerrainGeometry {
  const frame = terrainFrame(grid, exaggeration)
  const { width, height } = grid
  const n = width * height
  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 3)
  const span = Math.max(frame.maxElevation - frame.minElevation, 2)
  let validCells = 0

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c
      const v = grid.values[i]
      const valid = Number.isFinite(v)
      if (valid) validCells++
      positions[i * 3] = frame.x[c]
      positions[i * 3 + 1] = valid ? heightY(frame, v) : 0
      positions[i * 3 + 2] = frame.z[r]
      const [red, green, blue] = rampAt(valid ? (v - frame.minElevation) / span : 0)
      colors[i * 3] = red / 255
      colors[i * 3 + 1] = green / 255
      colors[i * 3 + 2] = blue / 255
    }
  }

  // Two triangles per square of four valid cell centres, wound counter-clockwise from above.
  const triangles: number[] = []
  for (let r = 0; r < height - 1; r++) {
    for (let c = 0; c < width - 1; c++) {
      const a = r * width + c
      const b = a + 1
      const d = a + width
      const e = d + 1
      if (![a, b, d, e].every((k) => Number.isFinite(grid.values[k]))) continue
      triangles.push(a, d, b, b, d, e)
    }
  }
  return { frame, positions, colors, indices: Uint32Array.from(triangles), validCells }
}

const WATER_SHALLOW = [0x6f, 0xa3, 0xd4]
const WATER_DEEP = [0x12, 0x3f, 0x69]

/**
 * Water surface for modelled ponding: one flat quad per ponded cell, spanning the cell,
 * at the cell's modelled water level (ground + ponding depth). Neighbouring cells in the
 * same hollow share a level, so their quads join into one surface. Nothing is drawn where
 * the model holds no water.
 */
export function buildWaterGeometry(grid: ElevationGrid, frame: TerrainFrame, pondDepthM: Float32Array): WaterGeometry {
  const { width, height } = grid
  if (pondDepthM.length !== width * height) throw new Error('Ponding depths do not match the elevation grid.')
  const positions: number[] = []
  const rise: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  let cells = 0
  let maxDepthM = 0
  const half = (array: Float64Array, k: number) =>
    (k + 1 < array.length ? array[k + 1] - array[k] : array[k] - array[k - 1]) / 2

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c
      const depth = pondDepthM[i]
      const ground = grid.values[i]
      if (!(depth >= MIN_DRAWN_POND_M) || !Number.isFinite(ground)) continue
      maxDepthM = Math.max(maxDepthM, depth)
      const y = heightY(frame, ground + depth)
      const hx = half(frame.x, c)
      const hz = half(frame.z, r)
      const t = Math.min(1, depth / 1.5)
      const colour = WATER_SHALLOW.map((s, k) => (s + (WATER_DEEP[k] - s) * t) / 255)
      const base = positions.length / 3
      for (const [ox, oz] of [
        [-hx, -hz],
        [hx, -hz],
        [-hx, hz],
        [hx, hz],
      ]) {
        positions.push(frame.x[c] + ox, y, frame.z[r] + oz)
        rise.push(depth * frame.exaggeration)
        colors.push(...colour)
      }
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
      cells++
    }
  }
  return {
    positions: Float32Array.from(positions),
    rise: Float32Array.from(rise),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
    cells,
    maxDepthM,
  }
}

/** Nearest cell to a local x/z position, or null outside the grid. Rows are treated as evenly spaced. */
export function cellAtLocal(frame: TerrainFrame, x: number, z: number): { row: number; col: number } | null {
  const colStep = frame.width > 1 ? frame.x[1] - frame.x[0] : frame.extentX
  const rowStep = frame.height > 1 ? (frame.z[frame.height - 1] - frame.z[0]) / (frame.height - 1) : frame.extentZ
  const col = Math.round((x - frame.x[0]) / colStep)
  const row = Math.round((z - frame.z[0]) / rowStep)
  if (col < 0 || row < 0 || col >= frame.width || row >= frame.height) return null
  return { row, col }
}

/** Terrain height (scaled y) under a local x/z position; NaN off the grid or on no-data. */
export function terrainHeightAt(grid: ElevationGrid, frame: TerrainFrame, x: number, z: number): number {
  const cell = cellAtLocal(frame, x, z)
  if (!cell) return Number.NaN
  const v = grid.values[cell.row * frame.width + cell.col]
  return Number.isFinite(v) ? heightY(frame, v) : Number.NaN
}
