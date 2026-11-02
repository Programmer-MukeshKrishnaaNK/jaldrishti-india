import type { Bbox } from '../geo/bbox'
import { loadCopernicusGrid } from './copernicus'
import { loadTerrariumGrid } from './terrarium'
import type { DemProgress, DemSourceId, ElevationGrid } from './types'

export { DemError, isAbort } from './errors'
export { COPERNICUS_SOURCE } from './copernicus'
export { TERRARIUM_SOURCE } from './terrarium'
export type { DemSourceId, DemSourceInfo, DemStage, ElevationGrid } from './types'

/**
 * Loads an elevation grid from the named source. There is deliberately no automatic
 * fallback: switching to the coarser Terrarium source is the user's explicit choice.
 */
export function loadElevation(
  source: DemSourceId,
  bbox: Bbox,
  signal?: AbortSignal,
  onProgress?: DemProgress,
): Promise<ElevationGrid> {
  return source === 'copernicus-glo30'
    ? loadCopernicusGrid(bbox, signal, onProgress)
    : loadTerrariumGrid(bbox, signal, onProgress)
}
