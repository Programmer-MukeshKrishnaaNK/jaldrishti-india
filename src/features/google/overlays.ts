import type { ElevationGrid } from '../../lib/dem/types'
import type { Bbox } from '../../lib/geo/bbox'
import { MIN_DRAWN_POND_M } from '../../lib/terrain3d/geometry'
import { gridToLngLat } from '../../map/analysisFeatures'

/** Depth classes for ponding shown on Google maps, matching the 2D ponding legend. */
export const POND_CLASSES = [
  { from: 0.01, label: '0.01–0.25 m', color: 'rgba(168, 201, 232, 0.70)' },
  { from: 0.25, label: '0.25–0.5 m', color: 'rgba(111, 163, 212, 0.75)' },
  { from: 0.5, label: '0.5–1 m', color: 'rgba(31, 111, 181, 0.80)' },
  { from: 1, label: '≥ 1 m', color: 'rgba(18, 63, 105, 0.85)' },
]

function classOf(depth: number): number {
  for (let k = POND_CLASSES.length - 1; k >= 0; k--) if (depth >= POND_CLASSES[k].from) return k
  return -1
}

export interface PondRectangle {
  /** Corner coordinates clockwise from the north-west, in degrees. */
  path: { lat: number; lng: number }[]
  depthClass: number
  cells: number
}

/**
 * Ponded cells as rectangles: consecutive cells in a row with the same depth class are
 * merged so a few hundred shapes describe a few thousand cells. Every rectangle covers
 * exactly the modelled cells; nothing is added or smoothed.
 */
export function pondRectangles(grid: ElevationGrid, pondDepthM: Float32Array): PondRectangle[] {
  const out: PondRectangle[] = []
  for (let row = 0; row < grid.height; row++) {
    let col = 0
    while (col < grid.width) {
      const i = row * grid.width + col
      const k = pondDepthM[i] >= MIN_DRAWN_POND_M && Number.isFinite(grid.values[i]) ? classOf(pondDepthM[i]) : -1
      if (k < 0) {
        col++
        continue
      }
      let end = col + 1
      while (end < grid.width) {
        const j = row * grid.width + end
        const kj = pondDepthM[j] >= MIN_DRAWN_POND_M && Number.isFinite(grid.values[j]) ? classOf(pondDepthM[j]) : -1
        if (kj !== k) break
        end++
      }
      const corner = (r: number, c: number) => {
        const [lng, lat] = gridToLngLat(grid, r, c)
        return { lat, lng }
      }
      out.push({ path: [corner(row, col), corner(row, end), corner(row + 1, end), corner(row + 1, col)], depthClass: k, cells: end - col })
      col = end
    }
  }
  return out
}

export function bboxPath([west, south, east, north]: Bbox): { lat: number; lng: number }[] {
  return [
    { lat: north, lng: west },
    { lat: north, lng: east },
    { lat: south, lng: east },
    { lat: south, lng: west },
    { lat: north, lng: west },
  ]
}
