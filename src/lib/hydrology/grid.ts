import type { ElevationGrid } from '../dem/types'
import { kmPerDegLon } from '../geo/bbox'

/**
 * Input to the hydrology engine: a north-up, row-major elevation raster with the
 * ground size of its cells. Cell sizes vary by row because a degree of longitude
 * shrinks with latitude.
 */
export interface HydroGrid {
  width: number
  height: number
  /** Elevation in metres; NaN marks no-data cells. */
  elevation: Float32Array
  /** East–west cell size of each row, in metres. */
  dxM: Float64Array
  /** North–south cell size of each row, in metres. */
  dyM: Float64Array
}

// Mean length of one degree of latitude, in metres. It varies by under 1% between
// the equator and 35° N, which spans India.
const M_PER_DEG_LAT = 110_574

/**
 * The eight D8 neighbours, clockwise from east, with the conventional power-of-two
 * direction codes (as used by ESRI and many hydrology tools):
 *
 *    32  64  128
 *    16   ·    1
 *     8   4    2
 */
export const NEIGHBOURS = [
  { dr: 0, dc: 1, code: 1 }, // E
  { dr: 1, dc: 1, code: 2 }, // SE
  { dr: 1, dc: 0, code: 4 }, // S
  { dr: 1, dc: -1, code: 8 }, // SW
  { dr: 0, dc: -1, code: 16 }, // W
  { dr: -1, dc: -1, code: 32 }, // NW
  { dr: -1, dc: 0, code: 64 }, // N
  { dr: -1, dc: 1, code: 128 }, // NE
] as const

export function isValid(grid: HydroGrid, index: number): boolean {
  return Number.isFinite(grid.elevation[index])
}

export function cellAreaM2(grid: HydroGrid, row: number): number {
  return grid.dxM[row] * grid.dyM[row]
}

const mercatorY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return Math.log((1 + s) / (1 - s)) / 2
}
const inverseMercatorY = (y: number) => (Math.atan(Math.sinh(y)) * 180) / Math.PI

/**
 * Builds engine input from a Phase 1 elevation grid. The elevation array is
 * shared, not copied; the engine never writes to it.
 */
export function fromElevationGrid(grid: ElevationGrid): HydroGrid {
  const [west, south, east, north] = grid.bounds
  const lonPerCell = (east - west) / grid.width
  const dxM = new Float64Array(grid.height)
  const dyM = new Float64Array(grid.height)

  for (let row = 0; row < grid.height; row++) {
    let top: number
    let bottom: number
    if (grid.crs === 'EPSG:4326') {
      const latPerCell = (north - south) / grid.height
      top = north - row * latPerCell
      bottom = top - latPerCell
    } else {
      // Web Mercator rows are evenly spaced in projected y, not in latitude.
      const yTop = mercatorY(north)
      const yStep = (yTop - mercatorY(south)) / grid.height
      top = inverseMercatorY(yTop - row * yStep)
      bottom = inverseMercatorY(yTop - (row + 1) * yStep)
    }
    dxM[row] = lonPerCell * kmPerDegLon((top + bottom) / 2) * 1000
    dyM[row] = (top - bottom) * M_PER_DEG_LAT
  }

  return { width: grid.width, height: grid.height, elevation: grid.values, dxM, dyM }
}
