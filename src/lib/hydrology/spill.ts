import { FlowGraphError } from './accumulation'
import { downstreamOf, D8_NODATA, D8_OUTLET } from './d8'
import { cellAreaM2, type HydroGrid } from './grid'
import type { Depression } from './storage'

export type DepressionStatus = 'dry' | 'partial' | 'spilling'

export interface DepressionFill {
  rank: number
  capacityM3: number
  /** Runoff reaching the depression: generated on its cells plus inflow from upstream. */
  inflowM3: number
  storedM3: number
  spilledM3: number
  /** Stored as a share of capacity, 0–1. */
  fillFraction: number
  status: DepressionStatus
  /** Modelled water level after filling, in metres (NaN when dry). */
  waterLevelM: number
}

export interface SpillResult {
  /** Volume leaving each cell downstream, m³. For depression cells this is 0; their spill leaves from the exit. */
  passingM3: Float64Array
  /** Modelled ponding depth in each depression cell, m (bathtub fill of the terrain hollow); 0 elsewhere. */
  pondDepthM: Float32Array
  depressions: DepressionFill[]
  generatedM3: number
  storedM3: number
  /** Volume leaving the analysed area through outlet cells. */
  exitedM3: number
  /** generated − stored − exited; should be at rounding level. */
  residualM3: number
}

/**
 * Fill-and-spill routing of generated runoff over the D8 network.
 *
 * Each depression from Phase 2 is treated as a single reservoir with its terrain
 * storage capacity. Runoff is passed downstream in topological order; whatever
 * reaches a depression cell (including rain on the depression itself) joins that
 * reservoir. Once inflow exceeds capacity, the excess leaves through the depression's
 * exit: the first cell outside it on the D8 path from its deepest cell. Water reaching
 * an outlet cell leaves the area. Water within a partly filled depression is placed
 * by filling its lowest cells first (a "bathtub" fill).
 *
 * There is no timing, infiltration after runoff, evaporation or drainage network:
 * this is a volume balance on the terrain model, not a hydraulic simulation.
 */
export function fillAndSpill(
  grid: HydroGrid,
  directions: Uint8Array,
  labels: Int32Array,
  depressions: Depression[],
  fillDepthM: Float32Array,
  runoffM3: Float64Array,
): SpillResult {
  const { width } = grid
  const n = width * grid.height
  const count = depressions.length
  // Nodes 0..n-1 are cells; n + d is depression d (by rank − 1).
  const nodes = n + count
  const target = new Int32Array(nodes).fill(-1)
  const indegree = new Uint32Array(nodes)
  const inflow = new Float64Array(nodes)
  const own = new Float64Array(nodes)
  const active = new Uint8Array(nodes)
  const nodeOf = (cell: number) => (labels[cell] >= 0 ? n + labels[cell] : cell)

  // Exit of each depression: follow D8 from its deepest cell until leaving it.
  const deepest = new Int32Array(count).fill(-1)
  for (let i = 0; i < n; i++) {
    const d = labels[i]
    if (d >= 0 && (deepest[d] < 0 || fillDepthM[i] > fillDepthM[deepest[d]])) deepest[d] = i
  }
  for (let d = 0; d < count; d++) {
    active[n + d] = 1
    let cell = deepest[d]
    let guard = 0
    while (cell >= 0 && labels[cell] === d) {
      const code = directions[cell]
      cell = code === D8_OUTLET ? -1 : downstreamOf(width, cell, code)
      if (++guard > n) throw new FlowGraphError(`Depression ${d + 1} has no exit.`)
    }
    if (cell >= 0) target[n + d] = nodeOf(cell)
  }

  let generatedM3 = 0
  for (let i = 0; i < n; i++) {
    const code = directions[i]
    if (code === D8_NODATA) continue
    const v = runoffM3[i]
    generatedM3 += v
    if (labels[i] >= 0) {
      own[n + labels[i]] += v
      continue
    }
    active[i] = 1
    own[i] = v
    if (code !== D8_OUTLET) target[i] = nodeOf(downstreamOf(width, i, code))
  }
  for (let node = 0; node < nodes; node++) if (active[node] && target[node] >= 0) indegree[target[node]]++

  const capacity = depressions.map((d) => d.volumeM3)
  const stored = new Float64Array(count)
  const received = new Float64Array(count)
  const passingM3 = new Float64Array(n)
  let exitedM3 = 0
  let storedM3 = 0

  const queue = new Int32Array(nodes)
  let head = 0
  let tail = 0
  let expected = 0
  for (let node = 0; node < nodes; node++) {
    if (!active[node]) continue
    expected++
    if (indegree[node] === 0) queue[tail++] = node
  }
  while (head < tail) {
    const node = queue[head++]
    const total = inflow[node] + own[node]
    let out = total
    if (node >= n) {
      const d = node - n
      received[d] = total
      stored[d] = Math.min(total, capacity[d])
      storedM3 += stored[d]
      out = total - stored[d]
    } else {
      passingM3[node] = out
    }
    const next = target[node]
    if (next < 0) exitedM3 += out
    else {
      inflow[next] += out
      if (--indegree[next] === 0) queue[tail++] = next
    }
  }
  if (tail !== expected) {
    throw new FlowGraphError(`${expected - tail} cells or depressions form a cycle in the spill network.`)
  }

  // Bathtub fill: raise water over the depression's lowest cells until the stored volume is used.
  const pondDepthM = new Float32Array(n)
  const members: number[][] = Array.from({ length: count }, () => [])
  for (let i = 0; i < n; i++) if (labels[i] >= 0) members[labels[i]].push(i)
  const fills: DepressionFill[] = depressions.map((dep, d) => {
    const cells = members[d].sort((a, b) => grid.elevation[a] - grid.elevation[b])
    let level = Number.NaN
    if (stored[d] > 0) {
      let area = 0
      let volume = 0
      level = dep.spillElevationM
      for (let k = 0; k < cells.length; k++) {
        const z = grid.elevation[cells[k]]
        const next = k + 1 < cells.length ? Math.min(grid.elevation[cells[k + 1]], dep.spillElevationM) : dep.spillElevationM
        area += cellAreaM2(grid, Math.floor(cells[k] / width))
        const step = area * (next - z)
        if (volume + step >= stored[d]) {
          level = z + (stored[d] - volume) / area
          break
        }
        volume += step
      }
      level = Math.min(level, dep.spillElevationM)
      for (const i of cells) pondDepthM[i] = Math.max(0, level - grid.elevation[i])
    }
    const fillFraction = capacity[d] > 0 ? stored[d] / capacity[d] : 0
    return {
      rank: dep.rank,
      capacityM3: capacity[d],
      inflowM3: received[d],
      storedM3: stored[d],
      spilledM3: received[d] - stored[d],
      fillFraction,
      status: received[d] <= 0 ? 'dry' : received[d] >= capacity[d] ? 'spilling' : 'partial',
      waterLevelM: level,
    }
  })

  return {
    passingM3,
    pondDepthM,
    depressions: fills,
    generatedM3,
    storedM3,
    exitedM3,
    residualM3: generatedM3 - storedM3 - exitedM3,
  }
}
