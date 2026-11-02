import { fromUrl } from 'geotiff'
import { cellAt } from '../dem/grid'
import { DemError, isAbort, throwIfAborted } from '../dem/errors'
import { searchItems, signHref } from '../dem/planetaryComputer'
import type { ElevationGrid } from '../dem/types'
import { classIndex, WORLDCOVER_CLASSES } from './classes'

export const WORLDCOVER_SOURCE = {
  name: 'ESA WorldCover 10 m 2021 v200',
  attribution: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
  licence: 'CC BY 4.0',
  url: 'https://planetarycomputer.microsoft.com/dataset/esa-worldcover',
}

/**
 * Land cover summarised onto an elevation grid: for each elevation cell, how many
 * WorldCover pixels of each class have their centre inside it, plus pixels without
 * a class. Counts rather than a single class keep mixed cells honest.
 */
export interface LandCoverGrid {
  width: number
  height: number
  /** counts[k * width * height + i] = pixels of WORLDCOVER_CLASSES[k] in cell i. */
  counts: Uint16Array
  /** WorldCover pixels in each cell with no data or an unrecognised class. */
  missing: Uint16Array
  provenance: string[]
}

/** Reads WorldCover 2021 for an elevation grid's extent and assigns each pixel to the cell containing its centre. */
export async function loadLandCover(grid: ElevationGrid, signal?: AbortSignal): Promise<LandCoverGrid> {
  const n = grid.width * grid.height
  const classes = WORLDCOVER_CLASSES.length
  const counts = new Uint16Array(classes * n)
  const missing = new Uint16Array(n)
  const [west, south, east, north] = grid.bounds

  const items = (await searchItems('esa-worldcover', grid.bounds, signal)).filter((item) => item.id.includes('2021'))
  throwIfAborted(signal)
  if (items.length === 0) {
    throw new DemError('NO_COVERAGE', 'ESA WorldCover 2021 has no tile for this area.')
  }

  const used: string[] = []
  await Promise.all(
    items.map(async (item) => {
      const href = item.assets.map?.href
      if (!href) return
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const signed = await signHref(href, signal, attempt > 0)
          const tiff = await fromUrl(signed, { blockSize: 65536 } as Parameters<typeof fromUrl>[1], signal)
          const image = await tiff.getImage()
          // WorldCover tiles are pixel-is-area GeoTIFFs, so the bounding box is exact.
          const [minX, , , maxY] = image.getBoundingBox()
          const [rx, ry] = image.getResolution()
          const x0 = Math.max(0, Math.floor((west - minX) / rx))
          const y0 = Math.max(0, Math.floor((north - maxY) / ry))
          const x1 = Math.min(image.getWidth(), Math.ceil((east - minX) / rx))
          const y1 = Math.min(image.getHeight(), Math.ceil((south - maxY) / ry))
          if (x1 <= x0 || y1 <= y0) return
          const raster = (await image.readRasters({ window: [x0, y0, x1, y1], samples: [0], interleave: true, signal })) as ArrayLike<number>
          const w = x1 - x0
          for (let py = 0; py < y1 - y0; py++) {
            const lat = maxY + (y0 + py + 0.5) * ry
            for (let px = 0; px < w; px++) {
              const cell = cellAt(grid, minX + (x0 + px + 0.5) * rx, lat)
              if (!cell) continue
              const i = cell.row * grid.width + cell.col
              const k = classIndex(raster[py * w + px])
              if (k < 0) missing[i]++
              else counts[k * n + i]++
            }
          }
          used.push(item.id)
          return
        } catch (error) {
          if (isAbort(error) || signal?.aborted) throw new DemError('ABORTED', 'The request was cancelled.')
          if (error instanceof DemError) throw error
          if (attempt === 1) throw new DemError('NETWORK', `Could not read land cover from ${item.id}.`, { cause: error })
        }
      }
    }),
  )
  throwIfAborted(signal)
  return { width: grid.width, height: grid.height, counts, missing, provenance: used.sort() }
}
