import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bbox } from '../lib/geo/bbox'
import { DemError, isAbort, loadElevation, type DemSourceId, type DemStage, type ElevationGrid } from '../lib/dem'
import { renderTerrain, type TerrainRender } from '../lib/dem/render'

export type TerrainState =
  | { status: 'idle' }
  | { status: 'loading'; source: DemSourceId; stage: DemStage; bbox: Bbox }
  | {
      status: 'ready'
      bbox: Bbox
      grid: ElevationGrid
      render: TerrainRender
      image: { url: string; bounds: Bbox }
      elapsedMs: number
    }
  | { status: 'error'; source: DemSourceId; bbox: Bbox; code: DemError['code']; message: string }

async function toImageUrl(render: TerrainRender): Promise<string> {
  const canvas = new OffscreenCanvas(render.width, render.height)
  const context = canvas.getContext('2d')
  if (!context) throw new DemError('DECODE', 'This browser cannot draw the terrain image.')
  context.putImageData(new ImageData(render.rgba.slice(), render.width, render.height), 0, 0)
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
}

/**
 * Loads and renders elevation for an area. Each new request cancels the previous
 * one, and a result only lands if it belongs to the latest request.
 */
export function useTerrain() {
  const [state, setState] = useState<TerrainState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const latest = useRef(0)
  const imageUrl = useRef<string | null>(null)

  const releaseImage = () => {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
    imageUrl.current = null
  }

  const clear = useCallback(() => {
    latest.current++
    controller.current?.abort()
    releaseImage()
    setState({ status: 'idle' })
  }, [])

  const load = useCallback(async (source: DemSourceId, bbox: Bbox) => {
    const id = ++latest.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    const started = performance.now()
    setState({ status: 'loading', source, stage: 'discovering', bbox })

    try {
      const grid = await loadElevation(source, bbox, abort.signal, (stage) => {
        if (id === latest.current) setState({ status: 'loading', source, stage, bbox })
      })
      const render = renderTerrain(grid)
      if (!render) throw new DemError('NO_COVERAGE', 'The data for this area contains no valid elevation cells.')
      const url = await toImageUrl(render)
      if (id !== latest.current) {
        URL.revokeObjectURL(url)
        return
      }
      releaseImage()
      imageUrl.current = url
      setState({
        status: 'ready',
        bbox,
        grid,
        render,
        image: { url, bounds: grid.bounds },
        elapsedMs: Math.round(performance.now() - started),
      })
    } catch (error) {
      if (id !== latest.current || isAbort(error)) return
      console.error(error)
      setState({
        status: 'error',
        source,
        bbox,
        code: error instanceof DemError ? error.code : 'NETWORK',
        message: error instanceof Error ? error.message : 'Elevation data could not be loaded.',
      })
    }
  }, [])

  useEffect(() => () => {
    controller.current?.abort()
    releaseImage()
  }, [])

  return { state, load, clear }
}
