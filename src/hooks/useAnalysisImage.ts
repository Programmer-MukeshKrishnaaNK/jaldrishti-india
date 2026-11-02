import { useEffect, useState } from 'react'
import type { Bbox } from '../lib/geo/bbox'
import { renderAnalysisLayer, SCENARIO_LAYERS, type AnalysisLayerId } from '../lib/hydrology/layers'
import type { HydroPayload, ScenarioPayload } from '../workers/hydrologyProtocol'
import type { HydrologyState, ScenarioState } from './useHydrology'

type Image = { url: string; bounds: Bbox }

interface Rendered {
  result: HydroPayload | null
  scenario: ScenarioPayload | null
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
export function useAnalysisImage(state: HydrologyState, scenarioState: ScenarioState, layer: AnalysisLayerId): Image | null {
  const [rendered, setRendered] = useState<Rendered>({ result: null, scenario: null, urls: {} })
  const result = state.status === 'ready' ? state.result : null
  const grid = state.status === 'ready' ? state.grid : null
  const scenario = scenarioState.status === 'ready' ? scenarioState.result : null
  const needsScenario = SCENARIO_LAYERS.includes(layer)
  const drawable = layer !== 'elevation' && layer !== 'direction' && (!needsScenario || scenario !== null)
  const url = rendered.result === result && rendered.scenario === scenario ? rendered.urls[layer] : undefined

  useEffect(() => {
    if (!result || !grid || !drawable || url) return
    let cancelled = false
    const { rgba, width, height } = renderAnalysisLayer(layer as Exclude<AnalysisLayerId, 'elevation'>, grid, result, scenario)
    void toUrl(rgba, width, height).then((made) => {
      if (cancelled) return URL.revokeObjectURL(made)
      setRendered((previous) => {
        if (previous.result === result && previous.scenario === scenario) {
          return { result, scenario, urls: { ...previous.urls, [layer]: made } }
        }
        for (const old of Object.values(previous.urls)) if (old) URL.revokeObjectURL(old)
        return { result, scenario, urls: { [layer]: made } }
      })
    })
    return () => {
      cancelled = true
    }
  }, [result, scenario, grid, layer, drawable, url])

  return url && grid ? { url, bounds: grid.bounds } : null
}
