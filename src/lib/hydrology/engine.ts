import { flowAccumulation, type Accumulation } from './accumulation'
import { d8Directions } from './d8'
import type { HydroGrid } from './grid'
import { heightAboveNearestDrainage, type HandResult } from './hand'
import { priorityFlood } from './priorityFlood'
import { depressionStorage, MIN_DEPRESSION_DEPTH_M, type StorageResult } from './storage'

export type HydroStage = 'filling' | 'directions' | 'accumulation' | 'hand' | 'storage'

export interface HydroOptions {
  /** Contributing area at which a cell counts as drainage for HAND, in m². */
  drainageThresholdM2: number
  minDepressionDepthM?: number
}

export interface HydroSummary {
  validCells: number
  noDataCells: number
  drainageThresholdM2: number
  maxContributingCells: number
  maxContributingAreaM2: number
  drainageCells: number
  unreachedCells: number
  maxHandM: number
  totalStorageM3: number
  depressionCount: number
  minDepressionDepthM: number
  /** Milliseconds spent in each stage. */
  timings: Record<HydroStage, number>
  totalMs: number
}

export interface HydroResult {
  filled: Float64Array
  directions: Uint8Array
  accumulation: Accumulation
  hand: HandResult
  storage: StorageResult
  summary: HydroSummary
}

function maxFinite(values: ArrayLike<number>): number {
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i]
  return Number.isFinite(max) ? max : Number.NaN
}

/** Runs the five stages in order on one grid. */
export function runHydrology(
  grid: HydroGrid,
  options: HydroOptions,
  onStage?: (stage: HydroStage) => void,
): HydroResult {
  const timings = {} as Record<HydroStage, number>
  const time = <T>(stage: HydroStage, work: () => T): T => {
    onStage?.(stage)
    const started = performance.now()
    const result = work()
    timings[stage] = performance.now() - started
    return result
  }

  const { filled, parent } = time('filling', () => priorityFlood(grid))
  const directions = time('directions', () => d8Directions(grid, filled, parent))
  const accumulation = time('accumulation', () => flowAccumulation(grid, directions))
  const hand = time('hand', () =>
    heightAboveNearestDrainage(grid.width, filled, directions, accumulation, options.drainageThresholdM2),
  )
  const storage = time('storage', () =>
    depressionStorage(grid, filled, options.minDepressionDepthM ?? MIN_DEPRESSION_DEPTH_M),
  )

  const validCells = accumulation.order.length
  let maxIndex = accumulation.order[validCells - 1] ?? -1
  for (let k = 0; k < validCells; k++) {
    const i = accumulation.order[k]
    if (maxIndex < 0 || accumulation.cells[i] > accumulation.cells[maxIndex]) maxIndex = i
  }

  return {
    filled,
    directions,
    accumulation,
    hand,
    storage,
    summary: {
      validCells,
      noDataCells: grid.width * grid.height - validCells,
      drainageThresholdM2: options.drainageThresholdM2,
      maxContributingCells: maxIndex >= 0 ? accumulation.cells[maxIndex] : 0,
      maxContributingAreaM2: maxIndex >= 0 ? accumulation.areaM2[maxIndex] : 0,
      drainageCells: hand.drainageCells,
      unreachedCells: hand.unreached,
      maxHandM: maxFinite(hand.hand),
      totalStorageM3: storage.totalVolumeM3,
      depressionCount: storage.depressions.length,
      minDepressionDepthM: storage.minDepthM,
      timings,
      totalMs: Object.values(timings).reduce((a, b) => a + b, 0),
    },
  }
}

/** Recomputes only HAND for a new drainage threshold, reusing the routing. */
export function rerunHand(grid: HydroGrid, result: HydroResult, drainageThresholdM2: number): HydroResult {
  const started = performance.now()
  const hand = heightAboveNearestDrainage(
    grid.width,
    result.filled,
    result.directions,
    result.accumulation,
    drainageThresholdM2,
  )
  const handMs = performance.now() - started
  return {
    ...result,
    hand,
    summary: {
      ...result.summary,
      drainageThresholdM2,
      drainageCells: hand.drainageCells,
      unreachedCells: hand.unreached,
      maxHandM: maxFinite(hand.hand),
      timings: { ...result.summary.timings, hand: handMs },
    },
  }
}
