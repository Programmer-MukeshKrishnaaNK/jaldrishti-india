import { downstreamOf, D8_NODATA, D8_OUTLET } from './d8'
import { cellAreaM2, type HydroGrid } from './grid'

export class FlowGraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlowGraphError'
  }
}

export interface Accumulation {
  /** Number of cells draining through each cell, including itself; 0 for no-data. */
  cells: Uint32Array
  /** Ground area draining through each cell, including itself, in m²; 0 for no-data. */
  areaM2: Float64Array
  /** Valid cells in topological order: every cell appears before the cell it drains to. */
  order: Int32Array
}

/**
 * D8 flow accumulation by topological sort (Kahn's algorithm). Cells that receive no
 * flow are processed first; each passes its count and area downstream, and a cell is
 * processed once all of its upstream neighbours have been. Each cell is visited once.
 * If any valid cell is never processed, the direction raster contains a cycle.
 */
export function flowAccumulation(grid: HydroGrid, directions: Uint8Array): Accumulation {
  const { width, height } = grid
  const n = width * height
  const cells = new Uint32Array(n)
  const areaM2 = new Float64Array(n)
  const inflow = new Uint8Array(n)
  const downstream = new Int32Array(n).fill(-1)
  let valid = 0

  for (let i = 0; i < n; i++) {
    const code = directions[i]
    if (code === D8_NODATA) continue
    valid++
    cells[i] = 1
    areaM2[i] = cellAreaM2(grid, Math.floor(i / width))
    if (code === D8_OUTLET) continue
    const d = downstreamOf(width, i, code)
    if (d < 0 || d >= n || directions[d] === D8_NODATA) {
      throw new FlowGraphError(`Cell ${i} drains to ${d}, which is outside the grid or has no data.`)
    }
    downstream[i] = d
    inflow[d]++
  }

  const order = new Int32Array(valid)
  let head = 0
  let tail = 0
  for (let i = 0; i < n; i++) {
    if (directions[i] !== D8_NODATA && inflow[i] === 0) order[tail++] = i
  }
  while (head < tail) {
    const i = order[head++]
    const d = downstream[i]
    if (d < 0) continue
    cells[d] += cells[i]
    areaM2[d] += areaM2[i]
    if (--inflow[d] === 0) order[tail++] = d
  }

  if (tail !== valid) {
    throw new FlowGraphError(`${valid - tail} cells are part of a flow cycle and could not be ordered.`)
  }
  return { cells, areaM2, order }
}
