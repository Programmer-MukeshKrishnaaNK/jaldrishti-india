import { cellSizeM, elevationStats, type ElevationStats } from './grid'
import type { ElevationGrid } from './types'

// Lightness rises steadily from low to high ground, so the ramp still reads in
// greyscale and avoids the blues reserved for simulated water.
export const ELEVATION_RAMP: [number, string][] = [
  [0, '#263238'],
  [0.25, '#4a6260'],
  [0.5, '#7f8f6e'],
  [0.75, '#bbae80'],
  [1, '#ece0bb'],
]

// Below this span the colour stretch would mostly show noise in the data.
const MIN_STRETCH_M = 2

const SUN_AZIMUTH_DEG = 315
const SUN_ALTITUDE_DEG = 45

export interface TerrainRender {
  width: number
  height: number
  rgba: Uint8ClampedArray
  stats: ElevationStats
  /** Elevations mapped to the ends of the colour ramp. */
  low: number
  high: number
}

const rampRgb = ELEVATION_RAMP.map(([t, hex]) => [
  t,
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
])

function rampAt(t: number): [number, number, number] {
  for (let i = 1; i < rampRgb.length; i++) {
    const [t1, r1, g1, b1] = rampRgb[i]
    if (t <= t1) {
      const [t0, r0, g0, b0] = rampRgb[i - 1]
      const f = (t - t0) / (t1 - t0)
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f]
    }
  }
  const [, r, g, b] = rampRgb[rampRgb.length - 1]
  return [r, g, b]
}

/** Horn-method hillshade in [0, 1]. Edge cells reuse their nearest valid neighbour. */
export function hillshade(grid: ElevationGrid): Float32Array {
  const { width, height, values } = grid
  const { dx, dy } = cellSizeM(grid)
  const zenith = ((90 - SUN_ALTITUDE_DEG) * Math.PI) / 180
  const azimuth = ((360 - SUN_AZIMUTH_DEG + 90) % 360) * (Math.PI / 180)
  const out = new Float32Array(width * height)

  const z = (col: number, row: number, fallback: number) => {
    const c = Math.min(width - 1, Math.max(0, col))
    const r = Math.min(height - 1, Math.max(0, row))
    const v = values[r * width + c]
    return Number.isFinite(v) ? v : fallback
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const centre = values[row * width + col]
      if (!Number.isFinite(centre)) {
        out[row * width + col] = 1
        continue
      }
      const a = z(col - 1, row - 1, centre), b = z(col, row - 1, centre), c = z(col + 1, row - 1, centre)
      const d = z(col - 1, row, centre), f = z(col + 1, row, centre)
      const g = z(col - 1, row + 1, centre), h = z(col, row + 1, centre), i = z(col + 1, row + 1, centre)
      const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * dx)
      const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * dy)
      const slope = Math.atan(Math.hypot(dzdx, dzdy))
      const aspect = Math.atan2(dzdy, -dzdx)
      const shade =
        Math.cos(zenith) * Math.cos(slope) + Math.sin(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect)
      out[row * width + col] = Math.max(0, shade)
    }
  }
  return out
}

/**
 * Colours elevation with a ramp stretched to this area's 2nd–98th percentile,
 * modulated by a hillshade derived from the same grid. Cells without data stay transparent.
 */
export function renderTerrain(grid: ElevationGrid): TerrainRender | null {
  const stats = elevationStats(grid.values)
  if (!stats) return null

  let low = stats.p2
  let high = stats.p98
  if (high - low < MIN_STRETCH_M) {
    const mid = (low + high) / 2
    low = mid - MIN_STRETCH_M / 2
    high = mid + MIN_STRETCH_M / 2
  }

  const shade = hillshade(grid)
  const rgba = new Uint8ClampedArray(grid.width * grid.height * 4)
  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i]
    if (!Number.isFinite(v)) continue
    const [r, g, b] = rampAt(Math.min(1, Math.max(0, (v - low) / (high - low))))
    // Keep shading gentle so colour, the measured quantity, stays dominant.
    const k = 0.6 + 0.4 * shade[i]
    rgba[i * 4] = r * k
    rgba[i * 4 + 1] = g * k
    rgba[i * 4 + 2] = b * k
    rgba[i * 4 + 3] = 255
  }
  return { width: grid.width, height: grid.height, rgba, stats, low, high }
}
