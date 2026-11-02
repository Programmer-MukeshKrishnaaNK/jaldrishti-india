import { describe, expect, it } from 'vitest'
import { loadCopernicusGrid } from '../dem/copernicus'
import type { Bbox } from '../geo/bbox'
import { defaultCoefficients, WORLDCOVER_CLASSES } from '../landcover/classes'
import { loadLandCover } from '../landcover/worldcover'
import { runHydrology } from './engine'
import { explainHotspot } from './explain'
import { fromElevationGrid } from './grid'
import { coefficientGrid } from './runoff'
import { PRESET_RAINFALL_MM, runScenario } from './scenario'

// Real Phase 1 inputs (Copernicus DEM and ESA WorldCover via Planetary Computer)
// through the full Phase 3 pipeline. Network-dependent: runs when PAANIPULSE_LIVE=1.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

const AREAS: Record<string, Bbox> = {
  Madurai: [78.1004, 9.9126, 78.1278, 9.9397],
  Guwahati: [91.7389, 26.167, 91.769, 26.1942],
}

describe.runIf(env.PAANIPULSE_LIVE === '1')('live scenario pipeline', () => {
  for (const [name, bbox] of Object.entries(AREAS)) {
    it(`screens ${name} under the preset scenarios`, async () => {
      const dem = await loadCopernicusGrid(bbox)
      const landCover = await loadLandCover(dem)
      const grid = fromElevationGrid(dem)
      const hydro = runHydrology(grid, { drainageThresholdM2: 100_000 })
      const coefficients = coefficientGrid(landCover, defaultCoefficients())
      const n = grid.width * grid.height
      const water = WORLDCOVER_CLASSES.findIndex((c) => c.code === 80)
      const waterShare = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let total = landCover.missing[i]
        for (let k = 0; k < WORLDCOVER_CLASSES.length; k++) total += landCover.counts[k * n + i]
        waterShare[i] = total ? landCover.counts[water * n + i] / total : 0
      }
      const base = {
        grid,
        directions: hydro.directions,
        accumulation: hydro.accumulation,
        handM: hydro.hand.hand,
        storage: hydro.storage,
      }

      const results = PRESET_RAINFALL_MM.map((mm) => runScenario(base, coefficients, mm, waterShare))
      for (const r of results) {
        expect(Math.abs(r.summary.residualM3)).toBeLessThan(1e-6 * Math.max(1, r.summary.generatedM3))
      }
      expect(results[2].summary.storedM3).toBeGreaterThanOrEqual(results[0].summary.storedM3)

      const top = results[1].hotspots[0]
      const explanation = top && explainHotspot(top, 100, results[1].spill.depressions)
      console.info(
        `[live] ${name} ${dem.width}×${dem.height}, land cover ${landCover.provenance.join(', ')}`,
        JSON.stringify(
          results.map((r) => ({
            mm: r.rainfallMm,
            generated: Math.round(r.summary.generatedM3),
            stored: Math.round(r.summary.storedM3),
            exited: Math.round(r.summary.exitedM3),
            residual: r.summary.residualM3,
            meanC: +r.summary.meanCoefficient.toFixed(3),
            missingC: r.summary.missingCoefficientCells,
            reached: r.summary.depressionsReached,
            spilling: r.summary.depressionsSpilling,
            higherHa: +(r.summary.higherAreaM2 / 1e4).toFixed(2),
            hotspots: r.summary.hotspotCount,
            higherHotspots: r.summary.higherHotspotCount,
            ms: Math.round(r.summary.ms),
          })),
        ),
        '\n[live] top hotspot at 100 mm:',
        JSON.stringify(explanation),
      )
    }, 90_000)
  }
})
