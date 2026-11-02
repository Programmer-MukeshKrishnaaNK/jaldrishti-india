import { describe, expect, it } from 'vitest'
import { flowAccumulation, FlowGraphError } from './accumulation'
import { d8Directions, downstreamOf, D8_NODATA, D8_OUTLET } from './d8'
import type { HydroGrid } from './grid'
import { priorityFlood } from './priorityFlood'
import { syntheticGrid } from './testing'

const E = 1
const SE = 2

function route(grid: HydroGrid) {
  const { filled, parent } = priorityFlood(grid)
  const directions = d8Directions(grid, filled, parent)
  return { filled, directions, accumulation: flowAccumulation(grid, directions) }
}

describe('d8Directions', () => {
  it('points every cell of an east-dipping plane east', () => {
    const grid = syntheticGrid(12, 9, (_row, col) => 50 - 0.2 * col)
    const { directions } = route(grid)
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 12; col++) {
        expect(directions[row * 12 + col]).toBe(col === 11 ? D8_OUTLET : E)
      }
    }
  })

  it('uses diagonal distance, so an evenly tilted plane drains south-east', () => {
    // The drop to the SE neighbour is twice the cardinal drop, over √2 times the distance.
    const grid = syntheticGrid(10, 10, (row, col) => 50 - 0.1 * row - 0.1 * col)
    const { directions } = route(grid)
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) expect(directions[row * 10 + col]).toBe(SE)
    }
  })

  it('weighs cell sizes: on wide cells a mostly-southward slope beats the diagonal', () => {
    // Cells 30 m wide and 10 m tall with equal drops per cell in both directions.
    const grid = syntheticGrid(8, 8, (row, col) => 50 - row - col)
    grid.dxM.fill(30)
    const { directions } = route(grid)
    // Slopes: E 1/30, S 1/10, SE 2/√1000 ≈ 0.063, so south (code 4) is steepest.
    expect(directions[2 * 8 + 2]).toBe(4)
  })

  it('never routes into or out of no-data cells', () => {
    const grid = syntheticGrid(20, 20, (row, col) =>
      row >= 5 && row < 9 && col >= 5 && col < 15 ? Number.NaN : 60 - row * 0.5 - Math.abs(col - 10) * 0.2,
    )
    const { directions } = route(grid)
    for (let i = 0; i < 400; i++) {
      if (Number.isNaN(grid.elevation[i])) {
        expect(directions[i]).toBe(D8_NODATA)
      } else if (directions[i] !== D8_OUTLET) {
        expect(Number.isNaN(grid.elevation[downstreamOf(20, i, directions[i])])).toBe(false)
      }
    }
  })
})

describe('flowAccumulation', () => {
  // A V-shaped valley: side slopes of 1 m per cell towards the centre column, which
  // falls 0.1 m per cell southward. Side cells drain straight to the centre (cardinal
  // slope 1/d beats the diagonal (1 + 0.1)/(√2·d)), so the centre cell of row r
  // collects every cell in rows 0..r.
  const W = 11
  const H = 20
  const mid = (W - 1) / 2
  const valley = syntheticGrid(W, H, (row, col) => 100 + Math.abs(col - mid) - 0.1 * row, 10)

  it('collects whole rows along a converging valley', () => {
    const { accumulation } = route(valley)
    for (let row = 0; row < H; row++) {
      expect(accumulation.cells[row * W + mid]).toBe((row + 1) * W)
      expect(accumulation.areaM2[row * W + mid]).toBeCloseTo((row + 1) * W * 100, 6)
    }
    // Ridge-side cells on the valley walls receive only their own flow.
    expect(accumulation.cells[5 * W]).toBe(1)
  })

  it('accounts for every valid cell exactly once at the outlets', () => {
    const { directions, accumulation } = route(valley)
    let atOutlets = 0
    for (let i = 0; i < W * H; i++) if (directions[i] === D8_OUTLET) atOutlets += accumulation.cells[i]
    expect(atOutlets).toBe(W * H)
    expect(accumulation.order.length).toBe(W * H)
  })

  it('drains a filled pit through it rather than stopping inside it', () => {
    const grid = syntheticGrid(15, 15, (row, col) => (row === 7 && col === 7 ? 40 : 50 - 0.1 * row))
    const { directions, accumulation } = route(grid)
    expect(directions[7 * 15 + 7]).not.toBe(D8_OUTLET)
    let atOutlets = 0
    for (let i = 0; i < 225; i++) if (directions[i] === D8_OUTLET) atOutlets += accumulation.cells[i]
    expect(atOutlets).toBe(225)
  })

  it('rejects a direction raster that contains a cycle', () => {
    const grid = syntheticGrid(2, 1, () => 10)
    // Two cells pointing at each other.
    expect(() => flowAccumulation(grid, new Uint8Array([E, 16]))).toThrow(FlowGraphError)
  })
})

describe('flat terrain', () => {
  const N = 40
  const flat = syntheticGrid(N, N, () => 25, 30)

  it('terminates, fills nothing and routes every cell to the edge', () => {
    const { filled, directions, accumulation } = route(flat)
    for (let i = 0; i < N * N; i++) expect(filled[i]).toBe(25)
    let atOutlets = 0
    let outlets = 0
    for (let i = 0; i < N * N; i++) {
      if (directions[i] === D8_OUTLET) {
        outlets++
        atOutlets += accumulation.cells[i]
      }
    }
    expect(outlets).toBe(4 * N - 4)
    expect(atOutlets).toBe(N * N)
  })

  it('spreads flow towards the nearest edge instead of forming one long channel', () => {
    const { accumulation } = route(flat)
    let max = 0
    for (let i = 0; i < N * N; i++) max = Math.max(max, accumulation.cells[i])
    // Breadth-first routing gives each cell a path no longer than its distance to
    // the nearest edge, so no channel can collect more than a corridor's worth.
    expect(max).toBeLessThanOrEqual((N / 2) * 2)
  })
})
