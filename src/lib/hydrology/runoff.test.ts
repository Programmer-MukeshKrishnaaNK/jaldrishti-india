import { describe, expect, it } from 'vitest'
import { defaultCoefficients, WORLDCOVER_CLASSES } from '../landcover/classes'
import type { LandCoverGrid } from '../landcover/worldcover'
import { coefficientGrid, generateRunoff, ScenarioInputError, uniformCoefficientGrid } from './runoff'
import { syntheticGrid } from './testing'

const BUILT = WORLDCOVER_CLASSES.findIndex((c) => c.code === 50)
const TREES = WORLDCOVER_CLASSES.findIndex((c) => c.code === 10)

function landCover(width: number, height: number, fill: (i: number, counts: number[], setMissing: (m: number) => void) => void): LandCoverGrid {
  const n = width * height
  const counts = new Uint16Array(WORLDCOVER_CLASSES.length * n)
  const missing = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const c = new Array(WORLDCOVER_CLASSES.length).fill(0)
    fill(i, c, (m) => (missing[i] = m))
    c.forEach((v, k) => (counts[k * n + i] = v))
  }
  return { width, height, counts, missing, provenance: [] }
}

describe('coefficientGrid', () => {
  it('area-weights the coefficients of mixed cells', () => {
    // 6 built-up pixels (0.8) and 3 tree pixels (0.15) → (6·0.8 + 3·0.15) / 9.
    const lc = landCover(1, 1, (_i, c) => {
      c[BUILT] = 6
      c[TREES] = 3
    })
    expect(coefficientGrid(lc, defaultCoefficients())[0]).toBeCloseTo((6 * 0.8 + 3 * 0.15) / 9, 6)
  })

  it('leaves cells with mostly unclassified pixels missing instead of guessing', () => {
    const lc = landCover(3, 1, (i, c, setMissing) => {
      if (i === 0) {
        c[BUILT] = 4
        setMissing(5) // 4 of 9 classified: under half
      } else if (i === 1) {
        c[BUILT] = 5
        setMissing(4) // 5 of 9: just over half
      } else {
        setMissing(0) // no pixels at all
      }
    })
    const grid = coefficientGrid(lc, defaultCoefficients())
    expect(grid[0]).toBeNaN()
    expect(grid[1]).toBeCloseTo(0.8, 6)
    expect(grid[2]).toBeNaN()
  })

  it('rejects coefficients outside 0–1 and the wrong number of classes', () => {
    const lc = landCover(1, 1, (_i, c) => (c[BUILT] = 9))
    const bad = defaultCoefficients()
    bad[BUILT] = 1.2
    expect(() => coefficientGrid(lc, bad)).toThrow(ScenarioInputError)
    expect(() => coefficientGrid(lc, [0.5])).toThrow(ScenarioInputError)
    expect(() => uniformCoefficientGrid(4, Number.NaN)).toThrow(ScenarioInputError)
  })
})

describe('generateRunoff', () => {
  const grid = syntheticGrid(4, 5, () => 100, 30)

  it('converts millimetres of rain over a cell into cubic metres of runoff', () => {
    // 100 mm = 0.1 m; 0.1 m × 0.5 × 900 m² = 45 m³ per cell; 20 cells → 900 m³.
    const r = generateRunoff(grid, uniformCoefficientGrid(20, 0.5), 100)
    expect(r.volumeM3[0]).toBeCloseTo(45, 9)
    expect(r.totalM3).toBeCloseTo(900, 9)
    expect(r.rainfallOnCoveredM3).toBeCloseTo(1800, 9)
    expect(r.meanCoefficient).toBeCloseTo(0.5, 9)
  })

  it('produces no runoff from zero rainfall', () => {
    const r = generateRunoff(grid, uniformCoefficientGrid(20, 0.9), 0)
    expect(r.totalM3).toBe(0)
    expect(r.volumeM3.every((v) => v === 0)).toBe(true)
  })

  it('scales linearly with rainfall', () => {
    const c = uniformCoefficientGrid(20, 0.6)
    const totals = [50, 100, 150].map((mm) => generateRunoff(grid, c, mm).totalM3)
    expect(totals[1]).toBeCloseTo(2 * totals[0], 9)
    expect(totals[2]).toBeCloseTo(3 * totals[0], 9)
  })

  it('counts cells without a coefficient and generates nothing there', () => {
    const c = uniformCoefficientGrid(20, 0.5)
    c[3] = Number.NaN
    c[7] = Number.NaN
    const r = generateRunoff(grid, c, 100)
    expect(r.missingCoefficientCells).toBe(2)
    expect(r.coveredCells).toBe(18)
    expect(r.volumeM3[3]).toBe(0)
    expect(r.totalM3).toBeCloseTo(18 * 45, 9)
  })

  it('ignores no-data elevation cells entirely', () => {
    const holed = syntheticGrid(2, 1, (_r, col) => (col === 0 ? Number.NaN : 50), 30)
    const r = generateRunoff(holed, uniformCoefficientGrid(2, 1), 10)
    expect(r.coveredCells).toBe(1)
    expect(r.missingCoefficientCells).toBe(0)
    expect(r.totalM3).toBeCloseTo(0.01 * 900, 9)
  })

  it('rejects impossible rainfall', () => {
    const c = uniformCoefficientGrid(20, 0.5)
    for (const mm of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1001]) {
      expect(() => generateRunoff(grid, c, mm)).toThrow(ScenarioInputError)
    }
  })
})
