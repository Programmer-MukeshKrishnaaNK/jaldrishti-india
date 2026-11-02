import { rerunHand, runHydrology, type HydroResult } from '../lib/hydrology/engine'
import type { HydroGrid } from '../lib/hydrology/grid'
import type { HydroPayload, HydroRequest, HydroResponse } from './hydrologyProtocol'

// Typed view of the worker scope; the app's tsconfig uses the DOM library, not WebWorker.
const scope = self as unknown as {
  postMessage(message: HydroResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<HydroRequest>) => void) | null
}

// The latest grid and result stay here so a new drainage threshold reuses the routing.
let grid: HydroGrid | null = null
let result: HydroResult | null = null

function payload(r: HydroResult): { data: HydroPayload; transfer: Transferable[] } {
  // Arrays the worker keeps for later threshold changes are copied; the rest are
  // handed over without copying.
  const data: HydroPayload = {
    directions: r.directions.slice(),
    accumulationCells: r.accumulation.cells.slice(),
    accumulationAreaM2: r.accumulation.areaM2.slice(),
    hand: r.hand.hand,
    drainage: r.hand.drainage,
    fillDepthM: r.storage.depthM,
    storageM3: r.storage.volumeM3,
    depressionLabels: r.storage.labels,
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

scope.onmessage = (event) => {
  const request = event.data
  try {
    if (request.type === 'run') {
      grid = request.grid
      result = runHydrology(grid, { drainageThresholdM2: request.drainageThresholdM2 }, (stage) =>
        scope.postMessage({ type: 'stage', id: request.id, stage }),
      )
      const { data, transfer } = payload(result)
      scope.postMessage({ type: 'result', id: request.id, payload: data }, transfer)
    } else {
      if (!grid || !result) throw new Error('There is no analysis to update yet.')
      result = rerunHand(grid, result, request.drainageThresholdM2)
      const { hand, drainage } = result.hand
      // HAND is recomputed from the routing on every change and never read back here,
      // so its arrays can be handed over outright.
      scope.postMessage(
        { type: 'hand', id: request.id, hand, drainage, summary: result.summary },
        [hand.buffer, drainage.buffer],
      )
    }
  } catch (error) {
    scope.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'The terrain analysis failed.',
    })
  }
}
