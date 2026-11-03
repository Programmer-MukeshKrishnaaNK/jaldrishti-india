import { describe, expect, it } from 'vitest'
import type { ElevationGrid } from '../dem/types'
import { buildTerrainGeometry, buildWaterGeometry, cellAtLocal, heightY, terrainHeightAt } from './geometry'

const ARC = 1 / 3600

function grid(width: number, height: number, at: (row: number, col: number) => number, lat = 9.92): ElevationGrid {
  const values = new Float32Array(width * height)
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = at(r, c)
  return {
    width,
    height,
    bounds: [78.1, lat - (height * ARC) / 2, 78.1 + width * ARC, lat + (height * ARC) / 2],
    crs: 'EPSG:4326',
    values,
    source: { id: 'copernicus-glo30', name: 't', spacingM: 30, accuracy: '', attribution: '', url: '' },
    provenance: [],
    fetchedAt: '',
  }
}

describe('buildTerrainGeometry', () => {
  // Rises 1 m per column eastward and 0.5 m per row southward.
  const g = grid(5, 4, (r, c) => 100 + c + 0.5 * r)
  const geometry = buildTerrainGeometry(g, 2)

  it('keeps geographic orientation: east is +x, north is −z', () => {
    const { positions } = geometry
    const vertex = (r: number, c: number) => [positions[(r * 5 + c) * 3], positions[(r * 5 + c) * 3 + 2]]
    expect(vertex(0, 4)[0]).toBeGreaterThan(vertex(0, 0)[0])
    expect(vertex(0, 0)[1]).toBeLessThan(vertex(3, 0)[1])
  })

  it('places cell centres at their real metric spacing and centres the area', () => {
    const { frame } = geometry
    // One arc-second of longitude at 9.92° N ≈ 30.47 m; of latitude ≈ 30.72 m.
    expect(frame.x[1] - frame.x[0]).toBeCloseTo(30.47, 1)
    expect(frame.z[1] - frame.z[0]).toBeCloseTo(30.72, 1)
    expect(frame.x[0] + frame.x[4]).toBeCloseTo(0, 6)
    expect(frame.z[0] + frame.z[3]).toBeCloseTo(0, 6)
    expect(frame.extentX).toBeCloseTo(5 * 30.47, 0)
  })

  it('scales real elevations by the stated exaggeration above the lowest cell', () => {
    const { positions, frame } = geometry
    expect(frame.minElevation).toBe(100)
    expect(frame.maxElevation).toBeCloseTo(105.5, 4)
    // Row 3, column 4: 100 + 4 + 1.5 = 105.5 m → (105.5 − 100) × 2 = 11.
    expect(positions[(3 * 5 + 4) * 3 + 1]).toBeCloseTo(11, 4)
    expect(positions[1]).toBeCloseTo(0, 6)
  })

  it('makes two triangles per square of valid cells', () => {
    expect(geometry.indices.length).toBe((5 - 1) * (4 - 1) * 6)
    expect(geometry.validCells).toBe(20)
  })

  it('leaves holes at no-data cells instead of inventing heights', () => {
    const holed = grid(4, 4, (r, c) => (r === 1 && c === 1 ? Number.NaN : 50))
    const { indices, validCells } = buildTerrainGeometry(holed, 1)
    expect(validCells).toBe(15)
    // The four squares touching cell (1,1) are dropped: 9 − 4 = 5 squares remain.
    expect(indices.length).toBe(5 * 6)
    expect(Array.from(indices)).not.toContain(1 * 4 + 1)
  })

  it('rejects a meaningless exaggeration and an empty grid', () => {
    expect(() => buildTerrainGeometry(g, 0)).toThrow()
    expect(() => buildTerrainGeometry(grid(2, 2, () => Number.NaN), 1)).toThrow()
  })
})

describe('buildWaterGeometry', () => {
  const g = grid(6, 6, (r, c) => (r >= 2 && r < 4 && c >= 2 && c < 4 ? 98 : 100))
  const { frame } = buildTerrainGeometry(g, 3)

  it('draws water only on ponded cells, at ground plus modelled depth', () => {
    const pond = new Float32Array(36)
    pond[2 * 6 + 2] = 1.5
    pond[3 * 6 + 3] = 1.5
    pond[0] = 0.005 // below the drawing threshold
    const water = buildWaterGeometry(g, frame, pond)
    expect(water.cells).toBe(2)
    expect(water.indices.length).toBe(2 * 6)
    expect(water.maxDepthM).toBeCloseTo(1.5, 6)
    for (let v = 0; v < water.positions.length / 3; v++) {
      expect(water.positions[v * 3 + 1]).toBeCloseTo(heightY(frame, 98 + 1.5), 4)
      expect(water.rise[v]).toBeCloseTo(1.5 * 3, 4)
    }
  })

  it('draws nothing when the model holds no water', () => {
    const water = buildWaterGeometry(g, frame, new Float32Array(36))
    expect(water.cells).toBe(0)
    expect(water.positions.length).toBe(0)
  })

  it('makes each cell quad span the cell so neighbours join', () => {
    const pond = new Float32Array(36)
    pond[2 * 6 + 2] = 1
    pond[2 * 6 + 3] = 1
    const water = buildWaterGeometry(g, frame, pond)
    // Right edge of the first quad meets the left edge of the second.
    const xs = Array.from({ length: water.positions.length / 3 }, (_, v) => water.positions[v * 3])
    const firstRight = Math.max(...xs.slice(0, 4))
    const secondLeft = Math.min(...xs.slice(4, 8))
    expect(firstRight).toBeCloseTo(secondLeft, 4)
  })

  it('does not modify the model output it reads', () => {
    const pond = new Float32Array(36).fill(0.2)
    const before = pond.slice()
    buildWaterGeometry(g, frame, pond)
    expect(Array.from(pond)).toEqual(Array.from(before))
  })

  it('rejects ponding that does not match the grid', () => {
    expect(() => buildWaterGeometry(g, frame, new Float32Array(10))).toThrow()
  })
})

describe('local lookups', () => {
  const g = grid(5, 5, (r, c) => 10 * r + c)
  const { frame } = buildTerrainGeometry(g, 1)

  it('finds the cell and terrain height under a local position', () => {
    expect(cellAtLocal(frame, frame.x[3], frame.z[1])).toEqual({ row: 1, col: 3 })
    expect(terrainHeightAt(g, frame, frame.x[3], frame.z[1])).toBeCloseTo(heightY(frame, 13), 6)
    expect(cellAtLocal(frame, frame.x[4] + 1000, 0)).toBeNull()
    expect(terrainHeightAt(g, frame, 1e6, 0)).toBeNaN()
  })
})
