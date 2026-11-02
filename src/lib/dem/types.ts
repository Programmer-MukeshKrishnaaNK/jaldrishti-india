import type { Bbox } from '../geo/bbox'

export type DemSourceId = 'copernicus-glo30' | 'terrarium-srtm'

export interface DemSourceInfo {
  id: DemSourceId
  name: string
  /** Nominal ground spacing of the grid that was read, in metres. */
  spacingM: number
  /** What the vertical accuracy claim rests on, in plain words. */
  accuracy: string
  attribution: string
  url: string
}

/**
 * A regular elevation grid, north-up, row-major from the north-west corner.
 * Geographic grids are spaced evenly in degrees; Web Mercator grids are
 * spaced evenly in projected metres.
 */
export interface ElevationGrid {
  width: number
  height: number
  /** Outer edges of the grid cells, in degrees. */
  bounds: Bbox
  crs: 'EPSG:4326' | 'EPSG:3857'
  /** Elevation in metres. NaN marks cells with no data. */
  values: Float32Array
  source: DemSourceInfo
  /** Identifiers of the source files or tiles the grid was read from. */
  provenance: string[]
  fetchedAt: string
}

export type DemStage = 'discovering' | 'signing' | 'reading' | 'decoding'

export type DemProgress = (stage: DemStage) => void
