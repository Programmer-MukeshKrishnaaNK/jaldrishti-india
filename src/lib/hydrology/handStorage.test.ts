import { describe, expect, it } from 'vitest'
import { runHydrology } from './engine'
import { syntheticGrid } from './testing'

describe('heightAboveNearestDrainage', () => {
  // V-shaped valley: walls rise 1 m per cell from the centre column, which falls
  // 0.1 m per cell southward. Side cells drain straight across to the centre of
  // their own row, so with the centre column as drainage, HAND = |col − mid| m.
  const W = 11
  const H = 30
  const mid = (W - 1) / 2
  const CELL = 10
  const valley = syntheticGrid(W, H, (row, col) => 200 + Math.abs(col - mid) - 0.1 * row, CELL)

  it('equals the height above the channel cell the flow path reaches', () => {
    // The centre cell of row r drains (r + 1)·W cells; from row 4 that is ≥ 55 cells.
    const result = runHydrology(valley, { drainageThresholdM2: 55 * CELL * CELL })
    const { hand, drainage, nearestDrainage } = result.hand
    for (let row = 4; row < H; row++) {
      expect(drainage[row * W + mid]).toBe(1)
      for (let col = 0; col < W; col++) {
        const i = row * W + col
        expect(nearestDrainage[i]).toBe(row * W + mid)
        expect(hand[i]).toBeCloseTo(Math.abs(col - mid), 4)
      }
    }
    // Upstream of the first channel cell, flow runs down the centre to row 4.
    expect(hand[mid]).toBeCloseTo(0.4, 4) // row 0
    expect(result.summary.drainageCells).toBe(H - 4)
    expect(result.summary.unreachedCells).toBe(0)
  })

  it('reports cells that never reach drainage instead of guessing', () => {
    const result = runHydrology(valley, { drainageThresholdM2: 1e12 })
    expect(result.summary.drainageCells).toBe(0)
    expect(result.summary.unreachedCells).toBe(W * H)
    expect(Number.isNaN(result.hand.hand[0])).toBe(true)
  })
})

describe('depressionStorage', () => {
  const CELL = 30
  // Two rectangular pits in a gently tilted plateau: 5 × 4 cells, 2 m deep, and
  // 3 × 3 cells, 0.5 m deep, both well inside the edges.
  const plateau = (_row: number, col: number) => 100 - 0.001 * col
  const grid = syntheticGrid(40, 30, (row, col) => {
    if (row >= 10 && row < 14 && col >= 10 && col < 15) return plateau(row, col) - 2
    if (row >= 20 && row < 23 && col >= 28 && col < 31) return plateau(row, col) - 0.5
    return plateau(row, col)
  }, CELL)

  it('finds both pits, ranks them by volume and measures them', () => {
    const { storage } = runHydrology(grid, { drainageThresholdM2: 1e6 })
    expect(storage.depressions).toHaveLength(2)
    const [big, small] = storage.depressions
    expect(big.rank).toBe(1)
    expect(big.cells).toBe(20)
    expect(big.areaM2).toBeCloseTo(20 * CELL * CELL, 6)
    // Each pit fills to its lowest rim cell. The plateau tilts 0.001 m per column, so
    // the expected depths are computed from the rim rather than assumed to be 2 m.
    const bigRim = plateau(0, 15) // eastern rim column, the lowest around the pit
    let expectedBig = 0
    for (let row = 10; row < 14; row++) {
      for (let col = 10; col < 15; col++) expectedBig += (bigRim - Math.fround(plateau(row, col) - 2)) * CELL * CELL
    }
    expect(big.volumeM3).toBeCloseTo(expectedBig, 0)
    expect(Math.abs(big.volumeM3 - 20 * 2 * CELL * CELL) / (20 * 2 * CELL * CELL)).toBeLessThan(0.01)
    expect(small.cells).toBe(9)
    expect(Math.abs(small.volumeM3 - 9 * 0.5 * CELL * CELL) / (9 * 0.5 * CELL * CELL)).toBeLessThan(0.01)
    expect(storage.totalVolumeM3).toBeCloseTo(big.volumeM3 + small.volumeM3, 3)
    expect(big.nearEdge).toBe(false)
  })

  it('labels every pit cell with its depression and nothing else', () => {
    const { storage } = runHydrology(grid, { drainageThresholdM2: 1e6 })
    let labelled = 0
    for (let i = 0; i < storage.labels.length; i++) if (storage.labels[i] >= 0) labelled++
    expect(labelled).toBe(29)
  })

  it('stores nothing on a tilted plane', () => {
    const plane = syntheticGrid(20, 20, (row, col) => 50 - 0.3 * row - 0.2 * col)
    const { storage } = runHydrology(plane, { drainageThresholdM2: 1e6 })
    expect(storage.totalVolumeM3).toBe(0)
    expect(storage.depressions).toHaveLength(0)
  })

  it('keeps no-data cells out of every result', () => {
    const holed = syntheticGrid(25, 25, (row, col) =>
      row >= 8 && row < 12 && col >= 8 && col < 12 ? Number.NaN : 60 - 0.2 * row + (row === 18 && col === 18 ? -3 : 0),
    )
    const result = runHydrology(holed, { drainageThresholdM2: 20 * 100 })
    for (let i = 0; i < 625; i++) {
      if (!Number.isNaN(holed.elevation[i])) continue
      expect(result.accumulation.cells[i]).toBe(0)
      expect(result.hand.drainage[i]).toBe(0)
      expect(result.hand.hand[i]).toBeNaN()
      expect(result.storage.depthM[i]).toBeNaN()
      expect(result.storage.labels[i]).toBe(-1)
    }
    expect(result.summary.noDataCells).toBe(16)
    expect(result.summary.validCells).toBe(625 - 16)
    // The 3 m pit is enclosed, so it is the only depression. It spills over its
    // southern rim, which the 0.2 m-per-row slope puts 0.2 m below its own row.
    expect(result.storage.depressions).toHaveLength(1)
    expect(result.storage.depressions[0].maxDepthM).toBeCloseTo(2.8, 4)
  })
})
