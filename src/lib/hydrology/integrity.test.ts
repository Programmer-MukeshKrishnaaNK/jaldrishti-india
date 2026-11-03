import { describe, expect, it } from 'vitest'
import { runHydrology } from './engine'
import type { HydroGrid } from './grid'
import { slopePercent } from './hotspots'
import { uniformCoefficientGrid } from './runoff'
import { PRESET_RAINFALL_MM, runScenario, type ScenarioBase } from './scenario'
import { syntheticGrid } from './testing'

// A tilted valley with two hollows and a block of no-data cells, at 30 m spacing.
const grid: HydroGrid = syntheticGrid(
  24,
  30,
  (row, col) => {
    if (row >= 2 && row < 5 && col >= 18 && col < 21) return Number.NaN
    const z = 80 + 0.3 * Math.abs(col - 11) - 0.05 * row
    if (row >= 10 && row < 13 && col >= 9 && col < 13) return z - 1.2
    if (row >= 20 && row < 24 && col >= 8 && col < 14) return z - 0.6
    return z
  },
  30,
)

function analyse(input: HydroGrid): ScenarioBase {
  const hydro = runHydrology(input, { drainageThresholdM2: 50_000 })
  return {
    grid: input,
    directions: hydro.directions,
    accumulation: hydro.accumulation,
    handM: hydro.hand.hand,
    storage: hydro.storage,
    slopePct: slopePercent(input),
  }
}

describe('data integrity', () => {
  it('never modifies the elevation, coefficients or water shares it is given', () => {
    const elevation = grid.elevation.slice()
    const coefficients = uniformCoefficientGrid(grid.width * grid.height, 0.6)
    const coefficientsBefore = coefficients.slice()
    const waterShare = new Float32Array(grid.width * grid.height).fill(0.1)
    const waterBefore = waterShare.slice()

    const base = analyse(grid)
    for (const mm of [...PRESET_RAINFALL_MM, 73]) runScenario(base, coefficients, mm, waterShare)

    expect(grid.elevation).toEqual(elevation)
    expect(coefficients).toEqual(coefficientsBefore)
    expect(waterShare).toEqual(waterBefore)
  })

  it('gives identical results for identical inputs, whatever ran in between', () => {
    const coefficients = uniformCoefficientGrid(grid.width * grid.height, 0.6)
    const base = analyse(grid)
    const first = runScenario(base, coefficients, 100)
    runScenario(base, coefficients, 150)
    runScenario(base, coefficients, 50)
    const again = runScenario(base, coefficients, 100)

    expect(again.spill.pondDepthM).toEqual(first.spill.pondDepthM)
    expect(again.spill.passingM3).toEqual(first.spill.passingM3)
    expect(again.scores.category).toEqual(first.scores.category)
    expect(again.hotspots).toEqual(first.hotspots)
    expect({ ...again.summary, ms: 0 }).toEqual({ ...first.summary, ms: 0 })

    // A fresh analysis of the same terrain gives the same scenario too.
    const rerun = runScenario(analyse(grid), coefficients, 100)
    expect(rerun.spill.pondDepthM).toEqual(first.spill.pondDepthM)
  })

  it('balances volume for every preset and a custom rainfall total', () => {
    const coefficients = uniformCoefficientGrid(grid.width * grid.height, 0.7)
    const base = analyse(grid)
    for (const mm of [...PRESET_RAINFALL_MM, 37.5, 240]) {
      const { summary } = runScenario(base, coefficients, mm)
      expect(summary.rainfallMm).toBe(mm)
      expect(summary.generatedM3).toBeGreaterThan(0)
      expect(Math.abs(summary.generatedM3 - summary.storedM3 - summary.exitedM3)).toBeLessThan(1e-6 * summary.generatedM3)
      expect(Math.abs(summary.residualM3)).toBeLessThan(1e-6 * summary.generatedM3)
    }
  })

  it('keeps no-data cells out of every scenario output', () => {
    const coefficients = uniformCoefficientGrid(grid.width * grid.height, 0.6)
    const result = runScenario(analyse(grid), coefficients, 150)
    for (let i = 0; i < grid.elevation.length; i++) {
      if (Number.isFinite(grid.elevation[i])) continue
      expect(result.runoff.volumeM3[i]).toBe(0)
      expect(result.spill.pondDepthM[i] > 0).toBe(false)
      // 255 is the documented no-data category, never a screening class.
      expect(result.scores.category[i]).toBe(255)
      expect(result.hotspots.some((h) => h.peak.index === i)).toBe(false)
    }
  })

  it('reports the same summary in a comparison row as in a run of that rainfall alone', () => {
    // The worker builds the comparison table from separate runs; each must match a direct run.
    const coefficients = uniformCoefficientGrid(grid.width * grid.height, 0.6)
    const base = analyse(grid)
    const active = runScenario(base, coefficients, 100).summary
    for (const mm of PRESET_RAINFALL_MM) {
      const row = runScenario(base, coefficients, mm).summary
      if (mm === 100) expect({ ...row, ms: 0 }).toEqual({ ...active, ms: 0 })
      expect(row.storedM3).toBeLessThanOrEqual(row.generatedM3)
    }
  })
})
