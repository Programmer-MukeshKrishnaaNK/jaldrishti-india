import type { Accumulation } from './accumulation'
import { downstreamOf, D8_OUTLET } from './d8'

export interface HandResult {
  /** Height above the nearest drainage cell along the flow path, in metres; NaN if none is reached. */
  hand: Float32Array
  /** 1 where the cell is a drainage cell under the threshold. */
  drainage: Uint8Array
  /** Index of the drainage cell each cell drains to; -1 if none. */
  nearestDrainage: Int32Array
  drainageCells: number
  /** Valid cells whose flow path leaves the area without meeting a drainage cell. */
  unreached: number
}

/**
 * Height Above Nearest Drainage (Rennó et al. 2008; Nobre et al. 2011).
 *
 * A cell is a drainage cell when its contributing area reaches the threshold. Each
 * other cell follows its D8 flow path downstream to the first drainage cell, and its
 * HAND is its elevation minus that cell's elevation. Heights are taken from the
 * depression-filled surface, so values are never negative; inside filled depressions
 * they describe the fill level, which the fill-depth layer reports separately.
 *
 * Cells are visited downstream-first (reverse topological order), so each cell's
 * nearest drainage cell is known from its downstream neighbour in one pass.
 */
export function heightAboveNearestDrainage(
  width: number,
  filled: Float64Array,
  directions: Uint8Array,
  accumulation: Accumulation,
  thresholdM2: number,
): HandResult {
  const n = filled.length
  const hand = new Float32Array(n).fill(Number.NaN)
  const drainage = new Uint8Array(n)
  const nearestDrainage = new Int32Array(n).fill(-1)
  let drainageCells = 0
  let unreached = 0

  const { order, areaM2 } = accumulation
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]
    if (areaM2[i] >= thresholdM2) {
      drainage[i] = 1
      nearestDrainage[i] = i
      drainageCells++
    } else if (directions[i] !== D8_OUTLET) {
      nearestDrainage[i] = nearestDrainage[downstreamOf(width, i, directions[i])]
    }
    const target = nearestDrainage[i]
    if (target >= 0) hand[i] = filled[i] - filled[target]
    else unreached++
  }

  return { hand, drainage, nearestDrainage, drainageCells, unreached }
}
