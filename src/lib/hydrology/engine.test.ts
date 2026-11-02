import { describe, expect, it } from 'vitest'
import { loadCopernicusGrid } from '../dem/copernicus'
import type { ElevationGrid } from '../dem/types'
import { D8_NODATA, D8_OUTLET } from './d8'
import { rerunHand, runHydrology } from './engine'
import { fromElevationGrid, type HydroGrid } from './grid'

const GLO30_STUB = {
  name: 'test',
  spacingM: 30,
  accuracy: '',
  attribution: '',
  url: '',
} as const

describe('fromElevationGrid', () => {
  it('derives per-row cell sizes for a one-arc-second grid near Madurai', () => {
    const d = 1 / 3600
    const grid: ElevationGrid = {
      width: 100,
      height: 99,
      bounds: [78.1, 9.9, 78.1 + 100 * d, 9.9 + 99 * d],
      crs: 'EPSG:4326',
      values: new Float32Array(9900),
      source: { id: 'copernicus-glo30', ...GLO30_STUB },
      provenance: [],
      fetchedAt: '',
    }
    const hydro = fromElevationGrid(grid)
    // One arc-second of longitude at 9.92° N is about 30.47 m; of latitude about 30.72 m.
    expect(hydro.dxM[50]).toBeCloseTo(30.47, 1)
    expect(hydro.dyM[50]).toBeCloseTo(30.72, 1)
    expect(hydro.elevation).toBe(grid.values) // shared, not copied
  })

  it('accounts for Web Mercator row spacing', () => {
    const grid: ElevationGrid = {
      width: 10,
      height: 10,
      bounds: [91.7, 26.1, 91.73, 26.13],
      crs: 'EPSG:3857',
      values: new Float32Array(100),
      source: { id: 'terrarium-srtm', ...GLO30_STUB },
      provenance: [],
      fetchedAt: '',
    }
    const hydro = fromElevationGrid(grid)
    const totalNorthSouth = hydro.dyM.reduce((a, b) => a + b, 0)
    expect(totalNorthSouth).toBeCloseTo(0.03 * 110_574, 0)
  })
})

/** Deterministic pseudo-random numbers so the benchmark terrain is reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Gently sloping, rough terrain with noise: many small pits and flats, like an urban DSM. */
function roughTerrain(width: number, height: number, seed = 7): HydroGrid {
  const random = mulberry32(seed)
  const elevation = new Float32Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      elevation[row * width + col] =
        140 -
        0.02 * row -
        0.01 * col +
        3 * Math.sin(row / 23) * Math.cos(col / 31) +
        Math.round(random() * 4) / 2 // 0.5 m steps, like rounded building heights
    }
  }
  return {
    width,
    height,
    elevation,
    dxM: new Float64Array(height).fill(30.47),
    dyM: new Float64Array(height).fill(30.72),
  }
}

function resultBytes(result: ReturnType<typeof runHydrology>): number {
  const { filled, directions, accumulation, hand, storage } = result
  return [
    filled,
    directions,
    accumulation.cells,
    accumulation.areaM2,
    accumulation.order,
    hand.hand,
    hand.drainage,
    hand.nearestDrainage,
    storage.depthM,
    storage.volumeM3,
    storage.labels,
  ].reduce((sum, array) => sum + array.byteLength, 0)
}

describe('engine on a full-size area', () => {
  // 5 × 5 km at GLO-30 spacing near Madurai: the 25 km² maximum.
  const grid = roughTerrain(164, 163)

  it('processes a 25 km² grid quickly and consistently', () => {
    const started = performance.now()
    const result = runHydrology(grid, { drainageThresholdM2: 100_000 })
    const elapsed = performance.now() - started
    const cells = grid.width * grid.height

    expect(result.summary.validCells).toBe(cells)
    let atOutlets = 0
    for (let i = 0; i < cells; i++) {
      expect(result.directions[i]).not.toBe(D8_NODATA)
      if (result.directions[i] === D8_OUTLET) atOutlets += result.accumulation.cells[i]
    }
    expect(atOutlets).toBe(cells)
    expect(result.summary.depressionCount).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(2000)

    console.info(
      `[benchmark] ${grid.width}×${grid.height} = ${cells} cells: ${elapsed.toFixed(0)} ms total`,
      Object.fromEntries(Object.entries(result.summary.timings).map(([k, v]) => [k, Math.round(v)])),
      `results ${(resultBytes(result) / 1024 / 1024).toFixed(2)} MiB,`,
      `${result.summary.depressionCount} depressions, ${result.summary.drainageCells} drainage cells`,
    )
  })

  it('recomputes HAND for a new threshold without rerouting', () => {
    const result = runHydrology(grid, { drainageThresholdM2: 100_000 })
    const coarser = rerunHand(grid, result, 500_000)
    expect(coarser.directions).toBe(result.directions)
    expect(coarser.summary.drainageCells).toBeLessThan(result.summary.drainageCells)
    expect(coarser.summary.maxHandM).toBeGreaterThanOrEqual(result.summary.maxHandM)
  })

  it('scales to a grid nine times larger', () => {
    const big = roughTerrain(492, 489, 11)
    const started = performance.now()
    const result = runHydrology(big, { drainageThresholdM2: 100_000 })
    const elapsed = performance.now() - started
    expect(result.summary.validCells).toBe(492 * 489)
    console.info(`[benchmark] 492×489 = ${492 * 489} cells: ${elapsed.toFixed(0)} ms, results ${(resultBytes(result) / 1024 / 1024).toFixed(2)} MiB`)
  })
})

// Uses the real Phase 1 loader against Microsoft Planetary Computer. Network-dependent,
// so it only runs when PAANIPULSE_LIVE=1.
describe.runIf(process.env.PAANIPULSE_LIVE === '1')('live Copernicus DEM input', () => {
  it('analyses a real 3 × 3 km area of Madurai', async () => {
    const dem = await loadCopernicusGrid([78.1004, 9.9126, 78.1278, 9.9397])
    const result = runHydrology(fromElevationGrid(dem), { drainageThresholdM2: 100_000 })
    expect(result.summary.validCells).toBe(dem.width * dem.height)
    const top = result.storage.depressions[0]
    console.info('[live] Madurai', dem.width, '×', dem.height, JSON.stringify({
      ...result.summary,
      timings: Object.fromEntries(Object.entries(result.summary.timings).map(([k, v]) => [k, Math.round(v)])),
      largestDepression: top && { cells: top.cells, volumeM3: Math.round(top.volumeM3), maxDepthM: +top.maxDepthM.toFixed(2), nearEdge: top.nearEdge },
    }))
  }, 60_000)
})
