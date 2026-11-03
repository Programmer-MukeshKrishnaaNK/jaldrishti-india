import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bbox } from '../geo/bbox'
import type { ElevationGrid } from './types'

/**
 * Failure paths of the Copernicus and WorldCover loaders, offline: the Planetary
 * Computer API is replaced by a fetch stub and GeoTIFF reads by a controllable fake.
 */

const ARC = 1 / 3600
const TILE = 3601

type Read = (signal?: AbortSignal) => Promise<ArrayLike<number>>
let read: Read

vi.mock('geotiff', () => ({
  fromUrl: async (_url: string, _options: unknown, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return {
      getImage: async () => ({
        getWidth: () => TILE,
        getHeight: () => TILE,
        getBoundingBox: () => [78, 9, 81, 12],
        getResolution: () => [1 / 1200, -1 / 1200],
        readRasters: (options: { signal?: AbortSignal }) => read(options.signal),
      }),
    }
  },
}))

/** A read that never finishes, rejecting only when its signal aborts, as a stalled fetch does. */
const hang: Read = (signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })

function item(id: string, west: number, north: number) {
  return {
    id,
    bbox: [west, north - 1, west + 1, north],
    properties: { 'proj:shape': [TILE, TILE], 'proj:transform': [ARC, 0, west - ARC / 2, 0, -ARC, north + ARC / 2] },
    assets: { data: { href: `https://elevation.blob.core.windows.net/dem/${id}.tif` }, map: { href: `https://lc.blob.core.windows.net/wc/${id}.tif` } },
  }
}

let items: ReturnType<typeof item>[]
let tokenRequests: number
let stac: () => Promise<Response>

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

beforeEach(() => {
  vi.resetModules()
  items = [item('N09E078', 78, 10)]
  tokenRequests = 0
  stac = () => json({ features: items })
  read = async () => new Float32Array(100 * 100).fill(140)
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    if (url.includes('/sas/v1/token/')) {
      tokenRequests++
      return json({ token: `sig=${tokenRequests}`, 'msft:expiry': new Date(Date.now() + 3_600_000).toISOString() })
    }
    return stac()
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Fully inside N09E078.
const BBOX: Bbox = [78.1, 9.9, 78.127, 9.927]

describe('Copernicus loader', () => {
  it('reads a grid when every request succeeds', async () => {
    const { loadCopernicusGrid } = await import('./copernicus')
    const grid = await loadCopernicusGrid(BBOX)
    expect(grid.values.every((v) => v === 140)).toBe(true)
    expect(grid.provenance).toEqual(['N09E078'])
  })

  it('reports no coverage when the catalogue has no tile', async () => {
    items = []
    const { loadCopernicusGrid } = await import('./copernicus')
    await expect(loadCopernicusGrid(BBOX)).rejects.toMatchObject({ code: 'NO_COVERAGE' })
  })

  it('fails with a network error, not an endless wait, when the catalogue never answers', async () => {
    vi.useFakeTimers()
    stac = () => new Promise(() => {})
    // A stalled fetch still rejects when its signal aborts.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    )
    const { loadCopernicusGrid } = await import('./copernicus')
    const { JSON_TIMEOUT_MS } = await import('./planetaryComputer')
    const result = loadCopernicusGrid(BBOX).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS)
    expect(await result).toMatchObject({ code: 'NETWORK', message: expect.stringContaining('did not answer') })
  })

  it('retries a stalled read once with a fresh token, then fails with a network error', async () => {
    vi.useFakeTimers()
    read = hang
    const { loadCopernicusGrid, READ_TIMEOUT_MS } = await import('./copernicus')
    const result = loadCopernicusGrid(BBOX).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS)
    expect(tokenRequests).toBe(2)
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS)
    expect(await result).toMatchObject({ code: 'NETWORK', message: expect.stringContaining('did not finish') })
  })

  it('recovers when only the first read fails', async () => {
    let calls = 0
    read = async () => {
      if (calls++ === 0) throw new TypeError('Failed to fetch')
      return new Float32Array(100 * 100).fill(141)
    }
    const { loadCopernicusGrid } = await import('./copernicus')
    const grid = await loadCopernicusGrid(BBOX)
    expect(grid.values[0]).toBe(141)
    expect(tokenRequests).toBe(2)
  })

  it('treats a cancellation during a read as a cancellation, not a failure', async () => {
    read = hang
    const { loadCopernicusGrid } = await import('./copernicus')
    const abort = new AbortController()
    const result = loadCopernicusGrid(BBOX, abort.signal).catch((error: unknown) => error)
    await new Promise((r) => setTimeout(r, 0))
    abort.abort()
    expect(await result).toMatchObject({ code: 'ABORTED' })
  })

  it('leaves cells outside the returned tiles as no data instead of inventing heights', async () => {
    // The box straddles 78° E but the catalogue returns only the eastern tile.
    const { loadCopernicusGrid } = await import('./copernicus')
    read = async () => new Float32Array(100 * 100).fill(150)
    const grid = await loadCopernicusGrid([77.99, 9.9, 78.01, 9.92])
    // GLO-30 tiles begin half a cell west of the whole degree.
    const westernCells = Math.round((78 - ARC / 2 - grid.bounds[0]) / ARC)
    expect(Number.isNaN(grid.values[westernCells - 1])).toBe(true)
    expect(grid.values[westernCells]).toBe(150)
    expect(grid.values.filter(Number.isNaN).length).toBe(westernCells * grid.height)
  })
})

describe('WorldCover loader', () => {
  const grid: ElevationGrid = {
    width: 3,
    height: 3,
    bounds: [78.1, 9.9, 78.1 + 3 * ARC, 9.9 + 3 * ARC],
    crs: 'EPSG:4326',
    values: new Float32Array(9).fill(140),
    source: { id: 'copernicus-glo30', name: '', spacingM: 30, accuracy: '', attribution: '', url: '' },
    provenance: [],
    fetchedAt: '',
  }

  beforeEach(() => {
    items = [{ ...item('ESA_WorldCover_10m_2021_v200_N09E078', 78, 12) }]
  })

  it('reports no coverage when there is no 2021 tile', async () => {
    items = [item('ESA_WorldCover_10m_2020_v100_N09E078', 78, 12)]
    const { loadLandCover } = await import('../landcover/worldcover')
    await expect(loadLandCover(grid)).rejects.toMatchObject({ code: 'NO_COVERAGE' })
  })

  it('counts unclassified pixels as missing rather than as a class', async () => {
    read = async () => new Uint8Array(9 * 9).fill(0)
    const { loadLandCover } = await import('../landcover/worldcover')
    const result = await loadLandCover(grid)
    expect(result.counts.every((c) => c === 0)).toBe(true)
    expect(result.missing.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })

  it('fails with a network error when reads stall', async () => {
    vi.useFakeTimers()
    read = hang
    const { loadLandCover } = await import('../landcover/worldcover')
    const { READ_TIMEOUT_MS } = await import('./copernicus')
    const result = loadLandCover(grid).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(2 * READ_TIMEOUT_MS)
    expect(await result).toMatchObject({ code: 'NETWORK', message: expect.stringContaining('did not finish') })
  })
})
