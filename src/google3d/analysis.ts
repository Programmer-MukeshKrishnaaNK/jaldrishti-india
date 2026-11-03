import { loadCopernicusGrid } from '../lib/dem/copernicus'
import type { ElevationGrid } from '../lib/dem/types'
import { squareAround, type Bbox } from '../lib/geo/bbox'
import { runHydrology } from '../lib/hydrology/engine'
import { fromElevationGrid } from '../lib/hydrology/grid'
import { coefficientGrid } from '../lib/hydrology/runoff'
import { runScenario, type ScenarioResult } from '../lib/hydrology/scenario'
import { defaultCoefficients, WORLDCOVER_CLASSES } from '../lib/landcover/classes'
import { loadLandCover } from '../lib/landcover/worldcover'

/**
 * PaaniPulse analysis for the Google 3D page, built only from Copernicus DEM and ESA
 * WorldCover through the existing, unchanged engine. Google content never enters it.
 */

export interface Preset {
  id: string
  name: string
  lng: number
  lat: number
}

// City centres from the bundled OpenStreetMap gazetteer (src/data/gazetteer-in.json).
export const PRESETS: Preset[] = [
  { id: 'madurai', name: 'Madurai', lng: 78.1141, lat: 9.92612 },
  { id: 'guwahati', name: 'Guwahati', lng: 91.75394, lat: 26.1806 },
]

export interface Analysis {
  bbox: Bbox
  grid: ElevationGrid
  base: Parameters<typeof runScenario>[0]
  coefficients: Float32Array
  waterShare: Float32Array
}

export async function analyseArea(preset: Preset, signal?: AbortSignal): Promise<Analysis> {
  const bbox = squareAround(preset.lng, preset.lat)
  const grid = await loadCopernicusGrid(bbox, signal)
  const landCover = await loadLandCover(grid, signal)
  const hydroGrid = fromElevationGrid(grid)
  const hydro = runHydrology(hydroGrid, { drainageThresholdM2: 100_000 })
  const n = grid.width * grid.height
  const water = WORLDCOVER_CLASSES.findIndex((c) => c.code === 80)
  const waterShare = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let total = landCover.missing[i]
    for (let k = 0; k < WORLDCOVER_CLASSES.length; k++) total += landCover.counts[k * n + i]
    waterShare[i] = total ? landCover.counts[water * n + i] / total : 0
  }
  return {
    bbox,
    grid,
    base: {
      grid: hydroGrid,
      directions: hydro.directions,
      accumulation: hydro.accumulation,
      handM: hydro.hand.hand,
      storage: hydro.storage,
    },
    coefficients: coefficientGrid(landCover, defaultCoefficients()),
    waterShare,
  }
}

export function scenarioFor(analysis: Analysis, rainfallMm: number): ScenarioResult {
  return runScenario(analysis.base, analysis.coefficients, rainfallMm, analysis.waterShare)
}
