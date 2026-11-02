import type { FeatureCollection, LineString, Point } from 'geojson'
import type { ElevationGrid } from '../lib/dem/types'
import { downstreamOf, D8_NODATA, D8_OUTLET } from '../lib/hydrology/d8'
import type { Depression } from '../lib/hydrology/storage'

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const inverseMercatorY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90

/** Longitude and latitude of a fractional grid position, where (0.5, 0.5) is the first cell's centre. */
export function gridToLngLat(grid: ElevationGrid, row: number, col: number): [number, number] {
  const [west, south, east, north] = grid.bounds
  const lng = west + (col / grid.width) * (east - west)
  if (grid.crs === 'EPSG:4326') return [lng, north - (row / grid.height) * (north - south)]
  const top = mercatorY(north)
  return [lng, inverseMercatorY(top - (row / grid.height) * (top - mercatorY(south)))]
}

/**
 * One short line per cell from its centre towards the centre of the cell it drains to,
 * covering 80% of the distance so neighbouring lines do not touch.
 */
export function flowDirectionLines(grid: ElevationGrid, directions: Uint8Array): FeatureCollection<LineString> {
  const features: FeatureCollection<LineString>['features'] = []
  for (let i = 0; i < directions.length; i++) {
    const code = directions[i]
    if (code === D8_OUTLET || code === D8_NODATA) continue
    const row = Math.floor(i / grid.width)
    const col = i - row * grid.width
    const d = downstreamOf(grid.width, i, code)
    const toRow = Math.floor(d / grid.width)
    const toCol = d - toRow * grid.width
    const r1 = row + 0.5 + 0.8 * (toRow - row)
    const c1 = col + 0.5 + 0.8 * (toCol - col)
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [gridToLngLat(grid, row + 0.5, col + 0.5), gridToLngLat(grid, r1, c1)] },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** Numbered points at the volume-weighted centres of the largest depressions. */
export function depressionMarkers(grid: ElevationGrid, depressions: Depression[], count = 10): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: depressions.slice(0, count).map((d) => ({
      type: 'Feature',
      properties: { rank: d.rank },
      geometry: { type: 'Point', coordinates: gridToLngLat(grid, d.centreRow + 0.5, d.centreCol + 0.5) },
    })),
  }
}
