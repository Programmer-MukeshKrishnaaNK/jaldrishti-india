import { rerunHand, runHydrology, type HydroResult } from '../lib/hydrology/engine'
import type { HydroGrid } from '../lib/hydrology/grid'
import { slopePercent } from '../lib/hydrology/hotspots'
import { runScenario, type ScenarioBase } from '../lib/hydrology/scenario'
import type { HydroPayload, HydroRequest, HydroResponse, ScenarioPayload } from './hydrologyProtocol'

// Typed view of the worker scope; the app's tsconfig uses the DOM library, not WebWorker.
const scope = self as unknown as {
  postMessage(message: HydroResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<HydroRequest>) => void) | null
}

// The latest grid and analysis stay here, so a new drainage threshold or rainfall
// scenario reuses the routing instead of recomputing it.
let grid: HydroGrid | null = null
let result: HydroResult | null = null
let slope: Float32Array | null = null

function payload(r: HydroResult): { data: HydroPayload; transfer: Transferable[] } {
  // The worker keeps its own arrays for later requests, so the UI gets copies.
  const data: HydroPayload = {
    directions: r.directions.slice(),
    accumulationCells: r.accumulation.cells.slice(),
    accumulationAreaM2: r.accumulation.areaM2.slice(),
    hand: r.hand.hand.slice(),
    drainage: r.hand.drainage.slice(),
    fillDepthM: r.storage.depthM.slice(),
    storageM3: r.storage.volumeM3.slice(),
    depressionLabels: r.storage.labels.slice(),
    depressions: r.storage.depressions,
    summary: r.summary,
  }
  return {
    data,
    transfer: [
      data.directions.buffer,
      data.accumulationCells.buffer,
      data.accumulationAreaM2.buffer,
      data.hand.buffer,
      data.drainage.buffer,
      data.fillDepthM.buffer,
      data.storageM3.buffer,
      data.depressionLabels.buffer,
    ],
  }
}

function scenario(request: Extract<HydroRequest, { type: 'scenario' }>): { data: ScenarioPayload; transfer: Transferable[] } {
  if (!grid || !result) throw new Error('Run the terrain analysis before a rainfall scenario.')
  slope ??= slopePercent(grid)
  const base: ScenarioBase = {
    grid,
    directions: result.directions,
    accumulation: result.accumulation,
    handM: result.hand.hand,
    storage: result.storage,
    slopePct: slope,
  }
  const waterShare = request.waterShare ?? undefined
  const active = runScenario(base, request.coefficients, request.rainfallMm, waterShare)
  const comparison = [...new Set([...request.compareMm, request.rainfallMm])]
    .sort((a, b) => a - b)
    .map((mm) => (mm === request.rainfallMm ? active.summary : runScenario(base, request.coefficients, mm, waterShare).summary))

  const data: ScenarioPayload = {
    rainfallMm: request.rainfallMm,
    runoffM3: active.runoff.volumeM3,
    passingM3: active.spill.passingM3,
    pondDepthM: active.spill.pondDepthM,
    points: active.scores.points,
    category: active.scores.category,
    slopePct: slope.slice(),
    hotspots: active.hotspots,
    fills: active.spill.depressions,
    summary: active.summary,
    comparison,
  }
  return {
    data,
    transfer: [
      data.runoffM3.buffer,
      data.passingM3.buffer,
      data.pondDepthM.buffer,
      data.points.buffer,
      data.category.buffer,
      data.slopePct.buffer,
    ],
  }
}

scope.onmessage = (event) => {
  const request = event.data
  try {
    if (request.type === 'run') {
      grid = request.grid
      slope = null
      result = runHydrology(grid, { drainageThresholdM2: request.drainageThresholdM2 }, (stage) =>
        scope.postMessage({ type: 'stage', id: request.id, stage }),
      )
      const { data, transfer } = payload(result)
      scope.postMessage({ type: 'result', id: request.id, payload: data }, transfer)
    } else if (request.type === 'threshold') {
      if (!grid || !result) throw new Error('There is no analysis to update yet.')
      result = rerunHand(grid, result, request.drainageThresholdM2)
      const hand = result.hand.hand.slice()
      const drainage = result.hand.drainage.slice()
      scope.postMessage({ type: 'hand', id: request.id, hand, drainage, summary: result.summary }, [
        hand.buffer,
        drainage.buffer,
      ])
    } else {
      const { data, transfer } = scenario(request)
      scope.postMessage({ type: 'scenario', id: request.id, payload: data }, transfer)
    }
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id: request.id,
      request: request.type,
      message: error instanceof Error ? error.message : 'The terrain analysis failed.',
    })
  }
}
