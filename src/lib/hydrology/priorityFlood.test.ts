import { describe, expect, it } from 'vitest'
import { priorityFlood } from './priorityFlood'
import { syntheticGrid } from './testing'

const PLATEAU = 100

describe('priorityFlood', () => {
  // A paraboloid pit of radius R and depth D sunk into a flat plateau. Its exact
  // continuous volume is π·R²·D / 2.
  const R = 400
  const D = 5
  const CELL = 10
  const SIZE = 121
  const centre = (SIZE - 1) / 2
  const pitDepth = (row: number, col: number) => {
    const r2 = ((row - centre) * CELL) ** 2 + ((col - centre) * CELL) ** 2
    return r2 < R * R ? D * (1 - r2 / (R * R)) : 0
  }
  const bowl = syntheticGrid(SIZE, SIZE, (row, col) => PLATEAU - pitDepth(row, col), CELL)

  it('fills a paraboloid pit to its rim', () => {
    const { filled } = priorityFlood(bowl)
    let volume = 0
    let expectedDiscrete = 0
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const i = row * SIZE + col
        expect(filled[i]).toBe(PLATEAU)
        volume += (filled[i] - bowl.elevation[i]) * CELL * CELL
        expectedDiscrete += (PLATEAU - Math.fround(PLATEAU - pitDepth(row, col))) * CELL * CELL
      }
    }
    const analytic = (Math.PI * R * R * D) / 2
    expect(volume).toBeCloseTo(expectedDiscrete, 6)
    expect(Math.abs(volume - analytic) / analytic).toBeLessThan(0.01)
  })

  it('leaves terrain outside the depression untouched', () => {
    const { filled } = priorityFlood(bowl)
    for (let i = 0; i < filled.length; i++) {
      const row = Math.floor(i / SIZE)
      if (pitDepth(row, i % SIZE) === 0) expect(filled[i]).toBe(bowl.elevation[i])
    }
  })

  it('does not fill a depression that opens onto the grid edge', () => {
    // A trough running into the northern edge drains out of the area.
    const grid = syntheticGrid(20, 20, (row, col) => (col >= 8 && col <= 11 && row < 12 ? 95 : PLATEAU))
    const { filled } = priorityFlood(grid)
    for (let i = 0; i < filled.length; i++) expect(filled[i]).toBe(grid.elevation[i])
  })

  it('treats cells beside no-data as outlets and never invents values', () => {
    // A no-data hole with a pit beside it, and a separate enclosed pit.
    const grid = syntheticGrid(30, 30, (row, col) => {
      if (row >= 10 && row < 14 && col >= 10 && col < 14) return Number.NaN
      if (row === 12 && col === 14) return 90 // touches the hole
      if (row === 22 && col === 22) return 90 // enclosed
      return PLATEAU
    })
    const { filled, parent } = priorityFlood(grid)
    for (let i = 0; i < filled.length; i++) {
      if (Number.isNaN(grid.elevation[i])) {
        expect(filled[i]).toBeNaN()
        expect(parent[i]).toBe(-1)
      }
    }
    expect(filled[12 * 30 + 14]).toBe(90)
    expect(filled[22 * 30 + 22]).toBe(PLATEAU)
  })

  it('reaches every valid cell from a seed', () => {
    const grid = syntheticGrid(15, 15, (row, col) => (row * 7 + col * 13) % 5)
    const { parent, seeds } = priorityFlood(grid)
    expect(seeds).toBe(15 * 4 - 4)
    const reached = Array.from(parent).filter((p) => p >= 0).length
    expect(reached + seeds).toBe(15 * 15)
  })
})
