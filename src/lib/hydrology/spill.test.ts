import { describe, expect, it } from 'vitest'
import { runHydrology } from './engine'
import type { HydroGrid } from './grid'
import { uniformCoefficientGrid, generateRunoff } from './runoff'
import { fillAndSpill } from './spill'
import { syntheticGrid } from './testing'

function scenario(grid: HydroGrid, rainfallMm: number, coefficient = 1) {
  const hydro = runHydrology(grid, { drainageThresholdM2: 1e9 })
  const runoff = generateRunoff(grid, uniformCoefficientGrid(grid.width * grid.height, coefficient), rainfallMm)
  const spill = fillAndSpill(
    grid,
    hydro.directions,
    hydro.storage.labels,
    hydro.storage.depressions,
    hydro.storage.depthM,
    runoff.volumeM3,
  )
  return { hydro, runoff, spill }
}

const CELL = 10
// A plane falling 0.05 m per row southward, with a 4 × 4-cell box pit 1 m deep near
// the top. Rows above the pit and the pit itself drain into it; it spills south.
const pitted = syntheticGrid(10, 20, (row, col) => {
  const z = 50 - 0.05 * row
  return row >= 3 && row < 7 && col >= 3 && col < 7 ? z - 1 : z
}, CELL)

describe('fillAndSpill', () => {
  it('conserves volume: generated = stored + left the area', () => {
    for (const mm of [0, 5, 50, 100, 150, 400]) {
      const { spill } = scenario(pitted, mm)
      expect(Math.abs(spill.residualM3)).toBeLessThan(1e-6 * Math.max(1, spill.generatedM3))
      expect(spill.storedM3 + spill.exitedM3).toBeCloseTo(spill.generatedM3, 6)
    }
  })

  it('stores everything until the depression is full, then spills the excess', () => {
    const { hydro, spill: small } = scenario(pitted, 5)
    const capacity = hydro.storage.depressions[0].volumeM3
    const [dep] = small.depressions
    expect(dep.capacityM3).toBeCloseTo(capacity, 6)
    expect(dep.inflowM3).toBeLessThan(capacity)
    expect(dep.status).toBe('partial')
    expect(dep.storedM3).toBeCloseTo(dep.inflowM3, 9)
    expect(dep.spilledM3).toBe(0)

    const { spill: big } = scenario(pitted, 400)
    const [full] = big.depressions
    expect(full.status).toBe('spilling')
    expect(full.storedM3).toBeCloseTo(capacity, 6)
    expect(full.spilledM3).toBeCloseTo(full.inflowM3 - capacity, 6)
    expect(full.fillFraction).toBeCloseTo(1, 9)
  })

  it('collects exactly the runoff of the cells that drain into the depression', () => {
    // Cells in rows 0–6 of columns 3–6 drain into the pit; others route around it. Count
    // them from the flow network rather than assuming, then compare volumes.
    const mm = 5
    const { hydro, runoff, spill } = scenario(pitted, mm)
    const labels = hydro.storage.labels
    let expected = 0
    for (let i = 0; i < labels.length; i++) {
      let cell = i
      while (cell >= 0 && labels[cell] < 0) {
        const code = hydro.directions[cell]
        if (code === 0) {
          cell = -1
          break
        }
        const k = [1, 2, 4, 8, 16, 32, 64, 128].indexOf(code)
        const offsets = [1, 11, 10, 9, -1, -11, -10, -9]
        cell += offsets[k]
      }
      if (cell >= 0) expected += runoff.volumeM3[i]
    }
    expect(spill.depressions[0].inflowM3).toBeCloseTo(expected, 9)
  })

  it('does not double count water spilled downstream', () => {
    // At 400 mm the pit spills; everything not stored must leave through outlets once.
    const { spill } = scenario(pitted, 400)
    expect(spill.exitedM3).toBeCloseTo(spill.generatedM3 - spill.storedM3, 6)
    expect(spill.exitedM3).toBeLessThanOrEqual(spill.generatedM3)
  })

  it('places stored water in the lowest cells first and never above the spill level', () => {
    const { hydro, spill } = scenario(pitted, 5)
    const dep = spill.depressions[0]
    const spillLevel = hydro.storage.depressions[0].spillElevationM
    expect(dep.waterLevelM).toBeLessThan(spillLevel)
    let ponded = 0
    for (let i = 0; i < pitted.elevation.length; i++) {
      if (spill.pondDepthM[i] > 0) {
        expect(hydro.storage.labels[i]).toBe(0)
        expect(pitted.elevation[i] + spill.pondDepthM[i]).toBeCloseTo(dep.waterLevelM, 4)
      }
      ponded += spill.pondDepthM[i] * CELL * CELL
    }
    // The bathtub volume matches what the reservoir stored.
    expect(ponded).toBeCloseTo(dep.storedM3, 1)
  })

  it('stores nothing and ponds nothing with zero rainfall', () => {
    const { spill } = scenario(pitted, 0)
    expect(spill.storedM3).toBe(0)
    expect(spill.exitedM3).toBe(0)
    expect(spill.depressions[0].status).toBe('dry')
    expect(spill.pondDepthM.every((d) => d === 0)).toBe(true)
  })

  it('stores more, and never less, as rainfall increases', () => {
    const stored = [50, 100, 150].map((mm) => scenario(pitted, mm, 0.05).spill.storedM3)
    expect(stored[1]).toBeGreaterThanOrEqual(stored[0])
    expect(stored[2]).toBeGreaterThanOrEqual(stored[1])
  })

  it('cascades from an upper depression into a lower one', () => {
    // Two pits in a line down the slope: the upper one's spill feeds the lower one.
    const cascade = syntheticGrid(8, 30, (row, col) => {
      const z = 80 - 0.1 * row
      const inUpper = row >= 4 && row < 6 && col >= 3 && col < 5
      const inLower = row >= 18 && row < 22 && col >= 2 && col < 6
      return inUpper ? z - 0.5 : inLower ? z - 1.5 : z
    }, CELL)
    const { spill } = scenario(cascade, 300)
    const byCapacity = [...spill.depressions].sort((a, b) => a.capacityM3 - b.capacityM3)
    const upper = byCapacity[0]
    const lower = byCapacity[1]
    expect(upper.status).toBe('spilling')
    expect(lower.inflowM3).toBeGreaterThan(upper.spilledM3 - 1e-6)
    expect(Math.abs(spill.residualM3)).toBeLessThan(1e-6)
  })
})
