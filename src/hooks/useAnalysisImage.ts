import { useEffect, useState } from 'react'
import type { Bbox } from '../lib/geo/bbox'
import { renderAnalysisLayer, type AnalysisLayerId } from '../lib/hydrology/layers'
import type { HydroPayload } from '../workers/hydrologyProtocol'
import type { HydrologyState } from './useHydrology'

type Image = { url: string; bounds: Bbox }

interface Rendered {
  result: HydroPayload | null
  urls: Partial<Record<AnalysisLayerId, string>>
}

async function toUrl(rgba: Uint8ClampedArray, width: number, height: number): Promise<string> {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot draw the analysis image.')
  context.putImageData(new ImageData(rgba.slice(), width, height), 0, 0)
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
}

/**
 * Image for a derived analysis layer. Each layer is drawn once per result and kept,
 * so switching layers does not redraw; images for a replaced result are released.
 */
export function useAnalysisImage(state: HydrologyState, layer: AnalysisLayerId): Image | null {
  const [rendered, setRendered] = useState<Rendered>({ result: null, urls: {} })
  const result = state.status === 'ready' ? state.result : null
  const grid = state.status === 'ready' ? state.grid : null
  const drawable = layer !== 'elevation' && layer !== 'direction'
  const url = rendered.result === result ? rendered.urls[layer] : undefined

  useEffect(() => {
    if (!result || !grid || !drawable || url) return
    let cancelled = false
    const { rgba, width, height } = renderAnalysisLayer(layer as Exclude<AnalysisLayerId, 'elevation'>, grid, result)
    void toUrl(rgba, width, height).then((made) => {
      if (cancelled) return URL.revokeObjectURL(made)
      setRendered((previous) => {
        if (previous.result === result) return { result, urls: { ...previous.urls, [layer]: made } }
        for (const old of Object.values(previous.urls)) if (old) URL.revokeObjectURL(old)
        return { result, urls: { [layer]: made } }
      })
    })
    return () => {
      cancelled = true
    }
  }, [result, grid, layer, drawable, url])

  return url && grid ? { url, bounds: grid.bounds } : null
}
