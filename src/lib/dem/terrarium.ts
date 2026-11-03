import type { Bbox } from '../geo/bbox'
import { underDeadline } from '../net/deadline'
import { DemError, isAbort, throwIfAborted } from './errors'
import { JSON_TIMEOUT_MS } from './planetaryComputer'
import type { DemProgress, DemSourceInfo, ElevationGrid } from './types'

// Fallback only: SRTM-derived terrain tiles from the AWS Open Data registry.
const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const ZOOM = 12
const TILE_SIZE = 256
const WORLD_PX = TILE_SIZE * 2 ** ZOOM
const EARTH_CIRCUMFERENCE_M = 40_075_016.686

export function terrariumSpacingM(lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / WORLD_PX
}

export const TERRARIUM_SOURCE: Omit<DemSourceInfo, 'spacingM'> = {
  id: 'terrarium-srtm',
  name: 'Terrain Tiles (Terrarium)',
  accuracy:
    'Over India these tiles are derived mainly from SRTM (c. 2000) and resampled to a coarser web-map grid, so detail and accuracy are lower than Copernicus GLO-30.',
  attribution: 'Terrain Tiles via AWS Open Data; contains SRTM data (NASA/USGS) and GMTED2010',
  url: 'https://registry.opendata.aws/terrain-tiles/',
}

const lngToPx = (lng: number) => ((lng + 180) / 360) * WORLD_PX
const latToPx = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD_PX
}
const pxToLng = (x: number) => (x / WORLD_PX) * 360 - 180
const pxToLat = (y: number) => {
  const n = Math.PI - (2 * Math.PI * y) / WORLD_PX
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

async function decodeTile(x: number, y: number, signal?: AbortSignal): Promise<Float32Array> {
  // A tile is one PNG of a few hundred kilobytes; the same bound as a catalogue request applies.
  const blob = await underDeadline(signal, JSON_TIMEOUT_MS, async (deadline) => {
    try {
      const response = await fetch(`${TILE_URL}/${ZOOM}/${x}/${y}.png`, { signal: deadline.signal })
      if (!response.ok) throw new DemError('NETWORK', `Terrain tile ${ZOOM}/${x}/${y} answered HTTP ${response.status}.`)
      return await response.blob()
    } catch (error) {
      if (error instanceof DemError) throw error
      if (signal?.aborted) throw new DemError('ABORTED', 'The request was cancelled.')
      if (deadline.expired()) {
        throw new DemError('NETWORK', `Terrain tile ${ZOOM}/${x}/${y} did not arrive within ${JSON_TIMEOUT_MS / 1000} s.`, { cause: error })
      }
      if (isAbort(error)) throw new DemError('ABORTED', 'The request was cancelled.')
      throw new DemError('NETWORK', 'Could not reach the Terrain Tiles service.', { cause: error })
    }
  })

  // Colour management or premultiplication would corrupt the encoded heights.
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new DemError('DECODE', 'This browser cannot decode terrain tiles.')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const rgba = context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data

  const heights = new Float32Array(TILE_SIZE * TILE_SIZE)
  for (let i = 0; i < heights.length; i++) {
    const p = i * 4
    heights[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768
  }
  return heights
}

/** Reads Terrarium tiles at zoom 12 covering the box, cropped to the box on the tile pixel grid. */
export async function loadTerrariumGrid(
  bbox: Bbox,
  signal?: AbortSignal,
  onProgress?: DemProgress,
): Promise<ElevationGrid> {
  const [west, south, east, north] = bbox
  const x0 = Math.floor(lngToPx(west))
  const x1 = Math.ceil(lngToPx(east))
  const y0 = Math.floor(latToPx(north))
  const y1 = Math.ceil(latToPx(south))
  const width = x1 - x0
  const height = y1 - y0
  const values = new Float32Array(width * height).fill(Number.NaN)

  onProgress?.('reading')
  const tiles: string[] = []
  const jobs: Promise<void>[] = []
  for (let ty = Math.floor(y0 / TILE_SIZE); ty <= Math.floor((y1 - 1) / TILE_SIZE); ty++) {
    for (let tx = Math.floor(x0 / TILE_SIZE); tx <= Math.floor((x1 - 1) / TILE_SIZE); tx++) {
      tiles.push(`${ZOOM}/${tx}/${ty}`)
      jobs.push(
        decodeTile(tx, ty, signal).then((tile) => {
          for (let py = Math.max(y0, ty * TILE_SIZE); py < Math.min(y1, (ty + 1) * TILE_SIZE); py++) {
            for (let px = Math.max(x0, tx * TILE_SIZE); px < Math.min(x1, (tx + 1) * TILE_SIZE); px++) {
              values[(py - y0) * width + (px - x0)] = tile[(py - ty * TILE_SIZE) * TILE_SIZE + (px - tx * TILE_SIZE)]
            }
          }
        }),
      )
    }
  }
  await Promise.all(jobs)
  throwIfAborted(signal)
  onProgress?.('decoding')

  const midLat = (south + north) / 2
  return {
    width,
    height,
    bounds: [pxToLng(x0), pxToLat(y1), pxToLng(x1), pxToLat(y0)],
    crs: 'EPSG:3857',
    values,
    source: { ...TERRARIUM_SOURCE, spacingM: Math.round(terrariumSpacingM(midLat)) },
    provenance: tiles,
    fetchedAt: new Date().toISOString(),
  }
}
