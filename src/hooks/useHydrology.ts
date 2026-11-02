import { useCallback, useEffect, useRef, useState } from 'react'
import type { ElevationGrid } from '../lib/dem/types'
import type { HydroStage } from '../lib/hydrology/engine'
import { fromElevationGrid } from '../lib/hydrology/grid'
import { PRESET_RAINFALL_MM } from '../lib/hydrology/scenario'
import type { HydroPayload, HydroRequest, HydroResponse, ScenarioPayload } from '../workers/hydrologyProtocol'

/** Contributing-area options for HAND drainage cells, in m². */
export const DRAINAGE_THRESHOLDS_M2 = [50_000, 100_000, 250_000, 500_000, 1_000_000]
export const DEFAULT_DRAINAGE_THRESHOLD_M2 = 100_000

export type HydrologyState =
  | { status: 'idle' }
  | { status: 'running'; stage: HydroStage }
  | { status: 'ready'; grid: ElevationGrid; result: HydroPayload; updating: boolean }
  | { status: 'error'; message: string }

export type ScenarioState =
  | { status: 'idle' }
  | { status: 'running'; rainfallMm: number; startedAt: number }
  | { status: 'ready'; result: ScenarioPayload; elapsedMs: number; stale: boolean }
  | { status: 'error'; message: string; rainfallMm: number }

export interface ScenarioRequest {
  rainfallMm: number
  coefficients: Float32Array
  waterShare: Float32Array | null
}

type Tracked = HydrologyState & { forGrid: ElevationGrid | null; forAttempt: number }
type TrackedScenario = ScenarioState & { forGrid: ElevationGrid | null }

/**
 * Runs the hydrology engine and rainfall scenarios in a Web Worker for the given
 * elevation grid. A new grid, or none, terminates the worker, which cancels anything
 * in progress. Each kind of request has its own counter, so only the latest reply of
 * each kind is applied.
 */
export function useHydrology(grid: ElevationGrid | null) {
  const [tracked, setTracked] = useState<Tracked>({ status: 'idle', forGrid: null, forAttempt: 0 })
  const [scenario, setScenario] = useState<TrackedScenario>({ status: 'idle', forGrid: null })
  const [thresholdM2, setThresholdState] = useState(DEFAULT_DRAINAGE_THRESHOLD_M2)
  const [attempt, setAttempt] = useState(0)
  const worker = useRef<Worker | null>(null)
  const ids = useRef({ run: 0, threshold: 0, scenario: 0 })
  const threshold = useRef(thresholdM2)

  useEffect(() => {
    threshold.current = thresholdM2
  })

  useEffect(() => {
    if (!grid) return
    const instance = new Worker(new URL('../workers/hydrology.worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    const counters = ids
    const id = ++counters.current.run
    const track = (state: HydrologyState) => setTracked({ ...state, forGrid: grid, forAttempt: attempt })

    instance.onmessage = (event: MessageEvent<HydroResponse>) => {
      const message = event.data
      if (message.type === 'stage' || message.type === 'result') {
        if (message.id !== counters.current.run) return
        if (message.type === 'stage') track({ status: 'running', stage: message.stage })
        else track({ status: 'ready', grid, result: message.payload, updating: false })
      } else if (message.type === 'hand') {
        if (message.id !== counters.current.threshold) return
        setTracked((previous) =>
          previous.status === 'ready'
            ? {
                ...previous,
                updating: false,
                result: { ...previous.result, hand: message.hand, drainage: message.drainage, summary: message.summary },
              }
            : previous,
        )
      } else if (message.type === 'scenario') {
        if (message.id !== counters.current.scenario) return
        setScenario((previous) => ({
          status: 'ready',
          result: message.payload,
          elapsedMs: previous.status === 'running' ? performance.now() - previous.startedAt : 0,
          stale: false,
          forGrid: grid,
        }))
      } else if (message.request === 'scenario') {
        if (message.id !== counters.current.scenario) return
        setScenario((previous) => ({
          status: 'error',
          message: message.message,
          rainfallMm: previous.status === 'running' ? previous.rainfallMm : 0,
          forGrid: grid,
        }))
      } else {
        if (message.id !== counters.current[message.request]) return
        track({ status: 'error', message: message.message })
      }
    }
    instance.onerror = (event) => {
      if (id !== counters.current.run) return
      track({ status: 'error', message: event.message || 'The analysis worker stopped unexpectedly.' })
    }

    const hydroGrid = fromElevationGrid(grid)
    // The UI keeps the original elevations, so the worker gets its own copy.
    const elevation = hydroGrid.elevation.slice()
    const request: HydroRequest = {
      type: 'run',
      id,
      grid: { ...hydroGrid, elevation },
      drainageThresholdM2: threshold.current,
    }
    instance.postMessage(request, [elevation.buffer, hydroGrid.dxM.buffer, hydroGrid.dyM.buffer])

    return () => {
      counters.current.run++
      counters.current.threshold++
      counters.current.scenario++
      instance.terminate()
    }
  }, [grid, attempt])

  // State from an earlier grid or attempt is stale; until the worker reports, the
  // current grid's analysis is starting.
  let state: HydrologyState
  if (!grid) state = { status: 'idle' }
  else if (tracked.forGrid !== grid || tracked.forAttempt !== attempt) state = { status: 'running', stage: 'filling' }
  else state = tracked

  const scenarioState: ScenarioState = grid && scenario.forGrid === grid ? scenario : { status: 'idle' }

  const setThreshold = useCallback(
    (value: number) => {
      setThresholdState(value)
      if (tracked.status !== 'ready' || tracked.forGrid !== grid || !worker.current) return
      const id = ++ids.current.threshold
      setTracked({ ...tracked, updating: true })
      // HAND feeds the screening, so an existing scenario result no longer matches.
      setScenario((previous) => (previous.status === 'ready' ? { ...previous, stale: true } : previous))
      const request: HydroRequest = { type: 'threshold', id, drainageThresholdM2: value }
      worker.current.postMessage(request)
    },
    [tracked, grid],
  )

  const runScenario = useCallback(
    (request: ScenarioRequest) => {
      if (state.status !== 'ready' || !worker.current) return
      const id = ++ids.current.scenario
      setScenario({ status: 'running', rainfallMm: request.rainfallMm, startedAt: performance.now(), forGrid: grid })
      const coefficients = request.coefficients.slice()
      const message: HydroRequest = {
        type: 'scenario',
        id,
        rainfallMm: request.rainfallMm,
        compareMm: [...PRESET_RAINFALL_MM],
        coefficients,
        waterShare: request.waterShare ? request.waterShare.slice() : null,
      }
      worker.current.postMessage(message, [coefficients.buffer])
    },
    [state.status, grid],
  )

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, scenario: scenarioState, thresholdM2, setThreshold, runScenario, retry }
}
