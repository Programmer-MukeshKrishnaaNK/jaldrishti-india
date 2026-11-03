import { describe, expect, it } from 'vitest'
import type { ElevationGrid } from '../lib/dem/types'
import { bboxPath, pondRectangles } from './overlays'

const ARC = 1 / 3600

function grid(width: number, height: number): ElevationGrid {
  return {
    width,
    height,
    bounds: [78.1, 9.9, 78.1 + width * ARC, 9.9 + height * ARC],
    crs: 'EPSG:4326',
    values: new Float32Array(width * height).fill(100),
    source: { id: 'copernicus-glo30', name: 't', spacingM: 30, accuracy: '', attribution: '', url: '' },
    provenance: [],
    fetchedAt: '',
  }
}

describe('pondRectangles', () => {
  it('merges runs of the same depth class and covers exactly the ponded cells', () => {
    const g = grid(6, 3)
    const pond = new Float32Array(18)
    // Row 0: three cells of one class, then a different class.
    pond.set([0.3, 0.3, 0.4, 1.2], 0)
    // Row 2: an isolated shallow cell; 0.005 m is below the drawing threshold.
    pond[2 * 6 + 5] = 0.05
    pond[2 * 6 + 1] = 0.005
    const rects = pondRectangles(g, pond)
    expect(rects.map((r) => [r.cells, r.depthClass])).toEqual([
      [3, 1],
      [1, 3],
      [1, 0],
    ])
    expect(rects.reduce((sum, r) => sum + r.cells, 0)).toBe(5)
  })

  it('places rectangle corners on the cell edges, north-west first', () => {
    const g = grid(4, 2)
    const pond = new Float32Array(8)
    pond[1] = 0.6
    const [r] = pondRectangles(g, pond)
    expect(r.path[0].lng).toBeCloseTo(78.1 + ARC, 9)
    expect(r.path[0].lat).toBeCloseTo(9.9 + 2 * ARC, 9)
    expect(r.path[2].lng).toBeCloseTo(78.1 + 2 * ARC, 9)
    expect(r.path[2].lat).toBeCloseTo(9.9 + ARC, 9)
  })

  it('skips no-data cells and leaves the model array unchanged', () => {
    const g = grid(3, 1)
    g.values[1] = Number.NaN
    const pond = new Float32Array([0.5, 0.5, 0.5])
    const before = pond.slice()
    const rects = pondRectangles(g, pond)
    expect(rects.map((r) => r.cells)).toEqual([1, 1])
    expect(Array.from(pond)).toEqual(Array.from(before))
  })

  it('closes the area outline', () => {
    const path = bboxPath([78, 9, 79, 10])
    expect(path[0]).toEqual(path[path.length - 1])
    expect(path).toHaveLength(5)
  })
})
