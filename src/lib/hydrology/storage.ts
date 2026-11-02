import { cellAreaM2, NEIGHBOURS, type HydroGrid } from './grid'

/** Fill depths below this are treated as numerical noise rather than a depression. */
export const MIN_DEPRESSION_DEPTH_M = 0.01

/** Depressions with a cell this close to the grid edge or no-data depend on terrain outside the area. */
const EDGE_MARGIN_CELLS = 2

export interface Depression {
  /** 1 for the largest volume. */
  rank: number
  cells: number
  areaM2: number
  volumeM3: number
  maxDepthM: number
  /** Level the depression fills to before spilling, in metres. */
  spillElevationM: number
  /** Volume-weighted centre, in fractional grid coordinates. */
  centreRow: number
  centreCol: number
  /** True if any cell lies near the area edge or no-data, where the fill level is less certain. */
  nearEdge: boolean
}

export interface StorageResult {
  /** Filled minus measured elevation, in metres; 0 outside depressions, NaN for no-data. */
  depthM: Float32Array
  /** Depth times cell area, in cubic metres; 0 outside depressions, NaN for no-data. */
  volumeM3: Float32Array
  /** Depression each cell belongs to (index into `depressions`), or -1. */
  labels: Int32Array
  totalVolumeM3: number
  /** All depressions, largest volume first. */
  depressions: Depression[]
  minDepthM: number
}

/**
 * Topographic depression storage from Priority-Flood results: the volume of space
 * below each depression's spill level. Cells deeper than `minDepthM` are grouped into
 * depressions by 8-connectivity and ranked by volume. This describes the shape of the
 * terrain model; it is not a measurement of water.
 */
export function depressionStorage(
  grid: HydroGrid,
  filled: Float64Array,
  minDepthM = MIN_DEPRESSION_DEPTH_M,
): StorageResult {
  const { width, height, elevation } = grid
  const n = width * height
  const depthM = new Float32Array(n)
  const volumeM3 = new Float32Array(n)
  const labels = new Int32Array(n).fill(-1)

  for (let i = 0; i < n; i++) {
    const z = elevation[i]
    if (!Number.isFinite(z)) {
      depthM[i] = Number.NaN
      volumeM3[i] = Number.NaN
      continue
    }
    const depth = filled[i] - z
    if (depth >= minDepthM) {
      depthM[i] = depth
      volumeM3[i] = depth * cellAreaM2(grid, Math.floor(i / width))
    }
  }

  const isEdge = (row: number, col: number) => {
    if (row < EDGE_MARGIN_CELLS || col < EDGE_MARGIN_CELLS) return true
    if (row >= height - EDGE_MARGIN_CELLS || col >= width - EDGE_MARGIN_CELLS) return true
    for (let k = 0; k < 8; k++) {
      const { dr, dc } = NEIGHBOURS[k]
      if (!Number.isFinite(elevation[(row + dr) * width + col + dc])) return true
    }
    return false
  }

  const found: Omit<Depression, 'rank'>[] = []
  const queue = new Int32Array(n)
  let totalVolumeM3 = 0

  for (let seed = 0; seed < n; seed++) {
    if (!(depthM[seed] > 0) || labels[seed] >= 0) continue
    const label = found.length
    const d: Omit<Depression, 'rank'> = {
      cells: 0,
      areaM2: 0,
      volumeM3: 0,
      maxDepthM: 0,
      spillElevationM: filled[seed],
      centreRow: 0,
      centreCol: 0,
      nearEdge: false,
    }
    let head = 0
    let tail = 0
    queue[tail++] = seed
    labels[seed] = label
    while (head < tail) {
      const i = queue[head++]
      const row = Math.floor(i / width)
      const col = i - row * width
      const v = volumeM3[i]
      d.cells++
      d.areaM2 += cellAreaM2(grid, row)
      d.volumeM3 += v
      d.maxDepthM = Math.max(d.maxDepthM, depthM[i])
      d.spillElevationM = Math.max(d.spillElevationM, filled[i])
      d.centreRow += row * v
      d.centreCol += col * v
      d.nearEdge ||= isEdge(row, col)
      for (let k = 0; k < 8; k++) {
        const { dr, dc } = NEIGHBOURS[k]
        const r = row + dr
        const c = col + dc
        if (r < 0 || c < 0 || r >= height || c >= width) continue
        const j = r * width + c
        if (labels[j] < 0 && depthM[j] > 0) {
          labels[j] = label
          queue[tail++] = j
        }
      }
    }
    d.centreRow /= d.volumeM3
    d.centreCol /= d.volumeM3
    totalVolumeM3 += d.volumeM3
    found.push(d)
  }

  const ranking = found.map((_, i) => i).sort((a, b) => found[b].volumeM3 - found[a].volumeM3)
  const rankOf = new Int32Array(found.length)
  ranking.forEach((label, position) => (rankOf[label] = position))
  for (let i = 0; i < n; i++) if (labels[i] >= 0) labels[i] = rankOf[labels[i]]
  const depressions = ranking.map((label, position) => ({ ...found[label], rank: position + 1 }))

  return { depthM, volumeM3, labels, totalVolumeM3, depressions, minDepthM }
}
