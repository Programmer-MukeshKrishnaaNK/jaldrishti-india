import { kmPerDegLon } from '../geo/bbox'
import type { ElevationGrid } from './types'

const mercatorY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return Math.log((1 + s) / (1 - s)) / 2
}

/** Row and column of the cell containing a point, or null outside the grid. */
export function cellAt(grid: ElevationGrid, lng: number, lat: number): { col: number; row: number } | null {
  const [west, south, east, north] = grid.bounds
  if (lng < west || lng >= east || lat <= south || lat > north) return null
  const col = Math.floor(((lng - west) / (east - west)) * grid.width)
  const row =
    grid.crs === 'EPSG:4326'
      ? Math.floor(((north - lat) / (north - south)) * grid.height)
      : Math.floor(((mercatorY(north) - mercatorY(lat)) / (mercatorY(north) - mercatorY(south))) * grid.height)
  return { col: Math.min(col, grid.width - 1), row: Math.min(row, grid.height - 1) }
}

/** Elevation in metres at a point; NaN where the cell has no data; null outside the grid. */
export function elevationAt(grid: ElevationGrid, lng: number, lat: number): number | null {
  const cell = cellAt(grid, lng, lat)
  return cell ? grid.values[cell.row * grid.width + cell.col] : null
}

/** Average ground size of one cell, in metres. */
export function cellSizeM(grid: ElevationGrid): { dx: number; dy: number } {
  const [west, south, east, north] = grid.bounds
  const midLat = (south + north) / 2
  return {
    dx: ((east - west) * kmPerDegLon(midLat) * 1000) / grid.width,
    dy: ((north - south) * 110_574) / grid.height,
  }
}

export interface ElevationStats {
  valid: number
  total: number
  /** Cells exactly 0 m. In GLO-30 these are typically flattened water surfaces. */
  exactZero: number
  min: number
  max: number
  p2: number
  p50: number
  p98: number
}

export function elevationStats(values: Float32Array): ElevationStats | null {
  const finite = values.filter(Number.isFinite).sort()
  if (finite.length === 0) return null
  const at = (q: number) => finite[Math.min(finite.length - 1, Math.floor(q * finite.length))]
  let exactZero = 0
  for (const v of finite) if (v === 0) exactZero++
  return {
    valid: finite.length,
    total: values.length,
    exactZero,
    min: finite[0],
    max: finite[finite.length - 1],
    p2: at(0.02),
    p50: at(0.5),
    p98: at(0.98),
  }
}
