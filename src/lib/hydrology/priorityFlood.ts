import { NEIGHBOURS, type HydroGrid } from './grid'

/**
 * Binary min-heap of cell indices keyed by elevation. Ties are broken by insertion
 * order so results do not depend on heap internals.
 */
class CellHeap {
  private cells: Int32Array
  private keys: Float64Array
  private order: Float64Array
  private size = 0
  private counter = 0

  constructor(capacity: number) {
    this.cells = new Int32Array(capacity)
    this.keys = new Float64Array(capacity)
    this.order = new Float64Array(capacity)
  }

  get length(): number {
    return this.size
  }

  private less(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.order[a] < this.order[b])
  }

  private swap(a: number, b: number): void {
    const c = this.cells[a]
    this.cells[a] = this.cells[b]
    this.cells[b] = c
    const k = this.keys[a]
    this.keys[a] = this.keys[b]
    this.keys[b] = k
    const o = this.order[a]
    this.order[a] = this.order[b]
    this.order[b] = o
  }

  push(cell: number, key: number): void {
    let i = this.size++
    this.cells[i] = cell
    this.keys[i] = key
    this.order[i] = this.counter++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(i, parent)) break
      this.swap(i, parent)
      i = parent
    }
  }

  pop(): number {
    const top = this.cells[0]
    this.size--
    if (this.size > 0) {
      this.swap(0, this.size)
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let smallest = i
        if (left < this.size && this.less(left, smallest)) smallest = left
        if (right < this.size && this.less(right, smallest)) smallest = right
        if (smallest === i) break
        this.swap(i, smallest)
        i = smallest
      }
    }
    return top
  }
}

export interface FillResult {
  /**
   * Elevation after filling every depression up to its spill level, in metres.
   * Float64 so that equal levels compare exactly. NaN where the input has no data.
   */
  filled: Float64Array
  /**
   * For each cell, the neighbour from which the flood reached it; -1 for seed cells
   * and no-data. Within filled depressions and flats this traces a path to the outlet.
   */
  parent: Int32Array
  /** Number of seed cells: valid cells on the grid edge or next to no-data. */
  seeds: number
}

/**
 * Priority-Flood depression filling (Barnes, Lehman & Mulla 2014, with the plain
 * queue "pit" improvement). Flooding starts from every valid cell on the grid edge
 * or beside no-data, because water there can leave the analysed area; those cells
 * are never raised. Each newly reached cell is raised to the level of the cell that
 * reached it if it lies lower, which fills exactly the depressions and nothing else.
 */
export function priorityFlood(grid: HydroGrid): FillResult {
  const { width, height, elevation } = grid
  const n = width * height
  const filled = Float64Array.from(elevation)
  const parent = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const heap = new CellHeap(n)
  // Every cell enters the pit queue at most once, so a flat array suffices.
  const pit = new Int32Array(n)
  let pitHead = 0
  let pitTail = 0
  let seeds = 0

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      if (!Number.isFinite(filled[i])) {
        closed[i] = 1
        continue
      }
      let boundary = row === 0 || col === 0 || row === height - 1 || col === width - 1
      for (let k = 0; !boundary && k < 8; k++) {
        const { dr, dc } = NEIGHBOURS[k]
        if (!Number.isFinite(elevation[(row + dr) * width + col + dc])) boundary = true
      }
      if (boundary) {
        closed[i] = 1
        heap.push(i, filled[i])
        seeds++
      }
    }
  }

  while (pitHead < pitTail || heap.length > 0) {
    const c = pitHead < pitTail ? pit[pitHead++] : heap.pop()
    const row = (c / width) | 0
    const col = c - row * width
    const level = filled[c]
    for (let k = 0; k < 8; k++) {
      const { dr, dc } = NEIGHBOURS[k]
      const r = row + dr
      const q = col + dc
      if (r < 0 || q < 0 || r >= height || q >= width) continue
      const nb = r * width + q
      if (closed[nb]) continue
      closed[nb] = 1
      parent[nb] = c
      if (filled[nb] <= level) {
        filled[nb] = level
        pit[pitTail++] = nb
      } else {
        heap.push(nb, filled[nb])
      }
    }
  }

  return { filled, parent, seeds }
}
