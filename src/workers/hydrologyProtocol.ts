import type { HydroStage, HydroSummary } from '../lib/hydrology/engine'
import type { HydroGrid } from '../lib/hydrology/grid'
import type { Depression } from '../lib/hydrology/storage'

export type HydroRequest =
  | { type: 'run'; id: number; grid: HydroGrid; drainageThresholdM2: number }
  | { type: 'threshold'; id: number; drainageThresholdM2: number }

/** Results the UI needs for drawing and inspection. */
export interface HydroPayload {
  directions: Uint8Array
  accumulationCells: Uint32Array
  accumulationAreaM2: Float64Array
  hand: Float32Array
  drainage: Uint8Array
  fillDepthM: Float32Array
  storageM3: Float32Array
  depressionLabels: Int32Array
  depressions: Depression[]
  summary: HydroSummary
}

export type HydroResponse =
  | { type: 'stage'; id: number; stage: HydroStage }
  | { type: 'result'; id: number; payload: HydroPayload }
  | { type: 'hand'; id: number; hand: Float32Array; drainage: Uint8Array; summary: HydroSummary }
  | { type: 'error'; id: number; message: string }
