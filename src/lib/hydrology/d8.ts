import { NEIGHBOURS, type HydroGrid } from './grid'

/** Cell drains out of the analysed area, or into a no-data gap. */
export const D8_OUTLET = 0
/** Cell has no data. */
export const D8_NODATA = 255

const CODE_TO_NEIGHBOUR = new Map<number, number>(NEIGHBOURS.map((n, k) => [n.code, k]))

/** Index of the cell a direction code points to, or -1 for outlets and no-data. */
export function downstreamOf(width: number, index: number, code: number): number {
  const k = CODE_TO_NEIGHBOUR.get(code)
  if (k === undefined) return -1
  const { dr, dc } = NEIGHBOURS[k]
  return index + dr * width + dc
}

function codeTowards(width: number, from: number, to: number): number {
  const dr = Math.floor(to / width) - Math.floor(from / width)
  const dc = (to % width) - (from % width)
  const neighbour = NEIGHBOURS.find((n) => n.dr === dr && n.dc === dc)
  if (!neighbour) throw new Error(`Cells ${from} and ${to} are not neighbours.`)
  return neighbour.code
}

/**
 * D8 flow direction on a depression-filled surface.
 *
 * Each valid cell drains to the neighbour with the steepest downward slope, where
 * slope is the drop divided by the true centre-to-centre distance (the cell width
 * or height for cardinal neighbours, their hypotenuse for diagonals). Ties keep the
 * first neighbour in clockwise order from east, so results are deterministic.
 *
 * Cells with no lower neighbour lie on a flat, either an original flat or a filled
 * depression. They drain towards the neighbour the Priority-Flood reached them from,
 * which leads back towards the spill point. Every step is either strictly downhill
 * or level towards a cell that was flooded earlier, so no flow path can loop.
 * Seed cells with no lower neighbour are outlets.
 */
export function d8Directions(grid: HydroGrid, filled: Float64Array, parent: Int32Array): Uint8Array {
  const { width, height } = grid
  const directions = new Uint8Array(width * height).fill(D8_NODATA)

  for (let row = 0; row < height; row++) {
    const dx = grid.dxM[row]
    const dy = grid.dyM[row]
    const distances = NEIGHBOURS.map(({ dr, dc }) => (dr === 0 ? dx : dc === 0 ? dy : Math.hypot(dx, dy)))
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const z = filled[i]
      if (!Number.isFinite(z)) continue

      let best = -1
      let bestSlope = 0
      for (let k = 0; k < 8; k++) {
        const { dr, dc } = NEIGHBOURS[k]
        const r = row + dr
        const c = col + dc
        if (r < 0 || c < 0 || r >= height || c >= width) continue
        const zn = filled[r * width + c]
        if (!(zn < z)) continue // also skips no-data
        const slope = (z - zn) / distances[k]
        if (slope > bestSlope) {
          bestSlope = slope
          best = k
        }
      }

      if (best >= 0) directions[i] = NEIGHBOURS[best].code
      else if (parent[i] >= 0) directions[i] = codeTowards(width, i, parent[i])
      else directions[i] = D8_OUTLET
    }
  }
  return directions
}
