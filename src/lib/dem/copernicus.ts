import { fromUrl } from 'geotiff'
import type { Bbox } from '../geo/bbox'
import { underDeadline } from '../net/deadline'
import { DemError, isAbort, throwIfAborted } from './errors'
import { searchItems, signHref, type StacItem } from './planetaryComputer'
import type { DemProgress, DemSourceInfo, ElevationGrid } from './types'

const COLLECTION = 'cop-dem-glo-30'

export const COPERNICUS_SOURCE: DemSourceInfo = {
  id: 'copernicus-glo30',
  name: 'Copernicus DEM GLO-30',
  spacingM: 30,
  accuracy:
    'Surface model: heights include buildings and trees, and water surfaces are edited flat. Stated absolute vertical accuracy better than 4 m (90% of points).',
  attribution: 'Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, via Microsoft Planetary Computer',
  url: 'https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30',
}

// GLO-30 spacing is one arc-second in latitude everywhere and in longitude below 50° N,
// which covers all of India.
const ARC_SECOND = 1 / 3600

// One read opens the tile header and fetches the few 64 KiB blocks covering the window,
// normally in a few seconds. A read that has not finished by then is treated as failed,
// and the retry below gets a fresh token.
export const READ_TIMEOUT_MS = 45_000

interface ItemGrid {
  item: StacItem
  width: number
  height: number
  /** Longitude of the western edge of column 0 and latitude of the northern edge of row 0. */
  originX: number
  originY: number
  dx: number
  dy: number
}

function itemGrid(item: StacItem): ItemGrid {
  // The STAC transform carries the exact cell geometry. GLO-30 cells are centred on whole
  // arc-seconds, so tile edges sit half a cell outside the nominal 1° square.
  const shape = item.properties['proj:shape']
  const transform = item.properties['proj:transform']
  if (!shape || !transform) {
    throw new DemError('DECODE', `Catalogue entry ${item.id} has no grid geometry.`)
  }
  const [height, width] = shape
  const [dx, , originX, , dy, originY] = transform
  if (Math.abs(dx - ARC_SECOND) > 1e-9 || Math.abs(-dy - ARC_SECOND) > 1e-9) {
    throw new DemError('DECODE', `Unexpected cell size in ${item.id}; expected one arc-second.`)
  }
  return { item, width, height, originX, originY, dx, dy: -dy }
}

/** Reads one tile's overlap with the output grid, refreshing the token once if the read fails. */
async function readWindow(
  grid: ItemGrid,
  window: [number, number, number, number],
  signal: AbortSignal | undefined,
): Promise<Float32Array> {
  const href = grid.item.assets.data?.href
  if (!href) throw new DemError('DECODE', `Catalogue entry ${grid.item.id} has no data asset.`)

  for (let attempt = 0; attempt < 2; attempt++) {
    const signed = await signHref(href, signal, attempt > 0)
    let timedOut = false
    try {
      return await underDeadline(signal, READ_TIMEOUT_MS, async (deadline) => {
        try {
          // Fetch in 64 KiB blocks so only the bytes covering the window are requested.
          // fromUrl forwards block options at runtime, but its declared type omits them.
          const tiff = await fromUrl(signed, { blockSize: 65536 } as Parameters<typeof fromUrl>[1], deadline.signal)
          const image = await tiff.getImage()
          if (image.getWidth() !== grid.width || image.getHeight() !== grid.height) {
            throw new DemError('DECODE', `${grid.item.id} does not match its catalogue dimensions.`)
          }
          const raster = await image.readRasters({ window, samples: [0], interleave: true, signal: deadline.signal })
          return Float32Array.from(raster as ArrayLike<number>)
        } catch (error) {
          timedOut = deadline.expired()
          throw error
        }
      })
    } catch (error) {
      if (signal?.aborted) throw new DemError('ABORTED', 'The request was cancelled.')
      if (error instanceof DemError) throw error
      if (isAbort(error) && !timedOut) throw new DemError('ABORTED', 'The request was cancelled.')
      // An expired or rejected token surfaces as a generic fetch error; retry once with a fresh one.
      if (attempt === 0) continue
      const reason = timedOut ? `did not finish within ${READ_TIMEOUT_MS / 1000} s` : 'failed'
      throw new DemError('NETWORK', `Reading elevation data from ${grid.item.id} ${reason}. Try again.`, { cause: error })
    }
  }
  throw new DemError('NETWORK', `Could not read elevation data from ${grid.item.id}.`)
}

/**
 * Reads the Copernicus GLO-30 cells covering a bounding box, mosaicking across
 * 1° tiles when the box straddles a tile edge. Only the needed byte ranges are fetched.
 */
export async function loadCopernicusGrid(
  bbox: Bbox,
  signal?: AbortSignal,
  onProgress?: DemProgress,
): Promise<ElevationGrid> {
  onProgress?.('discovering')
  const items = await searchItems(COLLECTION, bbox, signal)
  throwIfAborted(signal)
  if (items.length === 0) {
    throw new DemError(
      'NO_COVERAGE',
      'Copernicus GLO-30 has no tile here. The area may be open sea, or the tile has not been released.',
    )
  }
  const grids = items.map(itemGrid)

  // Output grid aligned to the GLO-30 cell lattice: edges at k·Δ − Δ/2.
  const d = ARC_SECOND
  const half = d / 2
  const [west, south, east, north] = bbox
  const col0 = Math.floor((west + half) / d)
  const col1 = Math.ceil((east + half) / d)
  const row0 = Math.ceil((north + half) / d) // northern edge index, counted upward
  const row1 = Math.floor((south + half) / d)
  const width = col1 - col0
  const height = row0 - row1
  const bounds: Bbox = [col0 * d - half, row1 * d - half, col1 * d - half, row0 * d - half]

  const values = new Float32Array(width * height).fill(Number.NaN)
  const used: string[] = []

  // Obtain the read token up front; the tile reads below reuse it from the cache.
  onProgress?.('signing')
  const firstHref = grids[0].item.assets.data?.href
  if (firstHref) await signHref(firstHref, signal)

  onProgress?.('reading')
  await Promise.all(
    grids.map(async (grid) => {
      // Output column c covers [bounds.west + c·d, …); map it to the tile's own column.
      const tileCol = (c: number) => Math.round((bounds[0] + c * d - grid.originX) / d)
      const tileRow = (r: number) => Math.round((grid.originY - (bounds[3] - r * d)) / d)

      const c0 = Math.max(0, -tileCol(0))
      const c1 = Math.min(width, grid.width - tileCol(0))
      const r0 = Math.max(0, -tileRow(0))
      const r1 = Math.min(height, grid.height - tileRow(0))
      if (c1 <= c0 || r1 <= r0) return

      const window: [number, number, number, number] = [tileCol(c0), tileRow(r0), tileCol(c1), tileRow(r1)]
      const block = await readWindow(grid, window, signal)
      const blockWidth = c1 - c0
      for (let r = r0; r < r1; r++) {
        const src = (r - r0) * blockWidth
        values.set(block.subarray(src, src + blockWidth), r * width + c0)
      }
      used.push(grid.item.id)
    }),
  )
  throwIfAborted(signal)
  onProgress?.('decoding')

  if (used.length === 0) {
    throw new DemError('NO_COVERAGE', 'No Copernicus GLO-30 cells overlap this area.')
  }

  return {
    width,
    height,
    bounds,
    crs: 'EPSG:4326',
    values,
    source: COPERNICUS_SOURCE,
    provenance: used.sort(),
    fetchedAt: new Date().toISOString(),
  }
}
