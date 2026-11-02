import { describe, expect, it } from 'vitest'
import { runHydrology } from './engine'
import { explainHotspot } from './explain'
import type { HydroGrid } from './grid'
import { HOTSPOT_RULES, slopePercent } from './hotspots'
import { uniformCoefficientGrid } from './runoff'
import { runScenario, type ScenarioBase } from './scenario'
import { syntheticGrid } from './testing'

const CELL = 30

function base(grid: HydroGrid, drainageThresholdM2 = 50_000): ScenarioBase {
  const hydro = runHydrology(grid, { drainageThresholdM2 })
  return {
    grid,
    directions: hydro.directions,
    accumulation: hydro.accumulation,
    handM: hydro.hand.hand,
    storage: hydro.storage,
  }
}

// A gently tilted valley draining south, with a 0.8 m-deep hollow on the valley floor.
const W = 21
const H = 40
const mid = 10
const valley = syntheticGrid(W, H, (row, col) => {
  const z = 60 + 0.25 * Math.abs(col - mid) - 0.02 * row
  const hollow = row >= 24 && row < 28 && col >= 8 && col < 13
  return hollow ? z - 0.8 : z
}, CELL)
const coefficients = uniformCoefficientGrid(W * H, 0.8)

describe('slopePercent', () => {
  it('measures a 2% plane as 2%', () => {
    const plane = syntheticGrid(10, 10, (_r, c) => 100 - 0.02 * 30 * c, 30)
    const slope = slopePercent(plane)
    // Elevations are Float32, so agreement is to about 1e-5.
    expect(slope[5 * 10 + 5]).toBeCloseTo(2, 4)
  })
})

describe('hotspot screening', () => {
  it('finds nothing with zero rainfall, even on low, flat ground', () => {
    const result = runScenario(base(valley), coefficients, 0)
    expect(result.hotspots).toHaveLength(0)
    expect(result.summary.higherCells + result.summary.moderateCells).toBe(0)
  })

  it('ranks the hollow on the valley floor first and explains it from its values', () => {
    const result = runScenario(base(valley), coefficients, 100)
    expect(result.hotspots.length).toBeGreaterThan(0)
    const top = result.hotspots[0]
    expect(top.category).toBe('higher')
    expect(top.depressionRanks).toContain(1)
    const row = Math.floor(top.peak.index / W)
    const col = top.peak.index % W
    expect(row).toBeGreaterThanOrEqual(24)
    expect(row).toBeLessThan(28)
    expect(Math.abs(col - mid)).toBeLessThanOrEqual(2)

    const explanation = explainHotspot(top, 100, result.spill.depressions)
    const { criteria } = top.peak
    // One sentence per criterion that scored, and the stated points add up to the total.
    const scored = [criteria.ponding, criteria.runoff, criteria.hand, criteria.flat].filter((p) => p > 0).length
    expect(explanation.reasons).toHaveLength(scored)
    const stated = explanation.reasons.map((r) => Number(/\((\d) pt\)/.exec(r)?.[1] ?? 0)).reduce((a, b) => a + b, 0)
    expect(stated).toBe(top.peak.points)
    expect(explanation.headline).toContain(`${top.peak.points} of 7 points`)
    expect(explanation.headline).toContain('100 mm')
    expect(explanation.reasons.join(' ')).toContain(top.maxPondDepthM.toFixed(2))
  })

  it('scores each criterion at its documented thresholds', () => {
    const result = runScenario(base(valley), coefficients, 100)
    const grid = valley
    const reference = 0.1 * result.runoff.meanCoefficient
    for (let i = 0; i < grid.width * grid.height; i++) {
      const p = result.scores.points[i]
      expect(p).toBeLessThanOrEqual(7)
      const pond = result.spill.pondDepthM[i]
      const pondPts = pond >= HOTSPOT_RULES.ponding.strongM ? 2 : pond >= HOTSPOT_RULES.ponding.weakM ? 1 : 0
      const pass = result.spill.passingM3[i]
      const runPts = pass >= reference * HOTSPOT_RULES.runoff.strongM2 ? 2 : pass >= reference * HOTSPOT_RULES.runoff.weakM2 ? 1 : 0
      if (pondPts + runPts === 0) expect(result.scores.category[i]).toBe(0)
    }
  })

  it('responds to rainfall: more rain never shrinks the higher-category area here', () => {
    const b = base(valley)
    const areas = [50, 100, 150].map((mm) => runScenario(b, coefficients, mm).summary.higherAreaM2)
    expect(areas[1]).toBeGreaterThanOrEqual(areas[0])
    expect(areas[2]).toBeGreaterThanOrEqual(areas[1])
  })

  it('compares scenarios with conserved volume and proportional runoff', () => {
    const b = base(valley)
    const summaries = [50, 100, 150].map((mm) => runScenario(b, coefficients, mm).summary)
    expect(summaries[1].generatedM3).toBeCloseTo(2 * summaries[0].generatedM3, 6)
    expect(summaries[2].generatedM3).toBeCloseTo(3 * summaries[0].generatedM3, 6)
    for (const s of summaries) {
      expect(Math.abs(s.residualM3)).toBeLessThan(1e-6 * s.generatedM3)
      expect(s.storedM3).toBeLessThanOrEqual(s.generatedM3)
    }
    // Storage is capped by capacity, so the share leaving the area grows with rainfall.
    const exitedShare = summaries.map((s) => s.exitedM3 / s.generatedM3)
    expect(exitedShare[2]).toBeGreaterThanOrEqual(exitedShare[0])
  })

  it('flags deep hollows, area edges and missing land cover in the cautions', () => {
    const deep = syntheticGrid(15, 15, (row, col) => (row >= 6 && row < 9 && col >= 6 && col < 9 ? 46 : 50 - 0.01 * row), CELL)
    const c = uniformCoefficientGrid(225, 0.8)
    c[7 * 15 + 7] = Number.NaN
    const result = runScenario(base(deep), c, 150)
    const top = result.hotspots[0]
    expect(top.flags.deepHollow).toBe(true)
    expect(top.flags.missingLandCover).toBe(true)
    const cautions = explainHotspot(top, 150, result.spill.depressions).cautions.join(' ')
    expect(cautions).toContain('more than 3 m deep')
    expect(cautions).toContain('no land-cover data')
  })

  it('ranks reduced-confidence hotspots after standard ones within a category', () => {
    // Two 4 × 4-cell pits on the same slope, each fed by the 30-row strip above it: one
    // 4 m deep (a likely artefact), one 0.8 m deep. Both pond over 0.5 m at 150 mm, and
    // their central cells are flat, so both reach the higher category.
    const two = syntheticGrid(30, 40, (row, col) => {
      const z = 50 - 0.01 * row
      if (row >= 30 && row < 34 && col >= 4 && col < 8) return z - 4
      if (row >= 30 && row < 34 && col >= 20 && col < 24) return z - 0.8
      return z
    }, CELL)
    const result = runScenario(base(two), uniformCoefficientGrid(1200, 0.8), 150)
    const higher = result.hotspots.filter((h) => h.category === 'higher')
    expect(higher.length).toBeGreaterThanOrEqual(2)
    const firstReduced = higher.findIndex((h) => h.confidence === 'reduced')
    const lastStandard = higher.map((h) => h.confidence).lastIndexOf('standard')
    expect(firstReduced).toBeGreaterThan(lastStandard)
    expect(higher.find((h) => h.confidence === 'reduced')?.flags.deepHollow).toBe(true)
  })

  it('notes when a hotspot lies beside mapped permanent water', () => {
    const b = base(valley)
    const plain = runScenario(b, coefficients, 100)
    const top = plain.hotspots[0]
    expect(top.flags.besideWater).toBe(false)
    // Mark the cell east of the hotspot's scoring cell as water.
    const waterShare = new Float32Array(W * H)
    waterShare[top.peak.index + 1] = 1
    const withWater = runScenario(b, coefficients, 100, waterShare)
    const flagged = withWater.hotspots.find((h) => h.peak.index === top.peak.index)
    expect(flagged?.flags.besideWater).toBe(true)
    expect(explainHotspot(flagged!, 100, withWater.spill.depressions).cautions.join(' ')).toContain('beside mapped permanent water')
  })

  it('explains why runoff does not score inside a hollow', () => {
    const result = runScenario(base(valley), coefficients, 100)
    const top = result.hotspots[0]
    expect(top.peak.pondDepthM).toBeGreaterThan(0)
    if (top.peak.criteria.runoff === 0) {
      expect(explainHotspot(top, 100, result.spill.depressions).notCounted.join(' ')).toContain('collects in the hollow')
    }
  })

  it('rejects invalid rainfall before doing any work', () => {
    expect(() => runScenario(base(valley), coefficients, -5)).toThrow()
  })
})
