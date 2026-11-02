import type { HydroStage, HydroSummary } from '../lib/hydrology/engine'
import type { HydroGrid } from '../lib/hydrology/grid'
import type { Hotspot } from '../lib/hydrology/hotspots'
import type { ScenarioSummary } from '../lib/hydrology/scenario'
import type { DepressionFill } from '../lib/hydrology/spill'
import type { Depression } from '../lib/hydrology/storage'

export type HydroRequest =
  | { type: 'run'; id: number; grid: HydroGrid; drainageThresholdM2: number }
  | { type: 'threshold'; id: number; drainageThresholdM2: number }
  | {
      type: 'scenario'
      id: number
      rainfallMm: number
      /** Other rainfall depths to summarise for comparison. */
      compareMm: number[]
      coefficients: Float32Array
      waterShare: Float32Array | null
    }

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

export interface ScenarioPayload {
  rainfallMm: number
  runoffM3: Float64Array
  passingM3: Float64Array
  pondDepthM: Float32Array
  points: Uint8Array
  category: Uint8Array
  slopePct: Float32Array
  hotspots: Hotspot[]
  fills: DepressionFill[]
  summary: ScenarioSummary
  /** Summaries for the comparison scenarios, including this one. */
  comparison: ScenarioSummary[]
}

export type HydroResponse =
  | { type: 'stage'; id: number; stage: HydroStage }
  | { type: 'result'; id: number; payload: HydroPayload }
  | { type: 'hand'; id: number; hand: Float32Array; drainage: Uint8Array; summary: HydroSummary }
  | { type: 'scenario'; id: number; payload: ScenarioPayload }
  | { type: 'error'; id: number; message: string; request: HydroRequest['type'] }
