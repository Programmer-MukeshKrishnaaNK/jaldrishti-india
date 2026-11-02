import { useCallback, useEffect, useRef, useState } from 'react'
import type { ElevationGrid } from '../lib/dem/types'
import type { HydroStage } from '../lib/hydrology/engine'
import { fromElevationGrid } from '../lib/hydrology/grid'
import type { HydroPayload, HydroRequest, HydroResponse } from '../workers/hydrologyProtocol'

/** Contributing-area options for HAND drainage cells, in m². */
export const DRAINAGE_THRESHOLDS_M2 = [50_000, 100_000, 250_000, 500_000, 1_000_000]
export const DEFAULT_DRAINAGE_THRESHOLD_M2 = 100_000

export type HydrologyState =
  | { status: 'idle' }
  | { status: 'running'; stage: HydroStage }
  | { status: 'ready'; grid: ElevationGrid; result: HydroPayload; updating: boolean }
  | { status: 'error'; message: string }

type Tracked = HydrologyState & { forGrid: ElevationGrid | null; forAttempt: number }

/**
 * Runs the hydrology engine in a Web Worker for the given elevation grid. A new grid,
 * or none, terminates the running worker, so stale analyses are cancelled outright.
 * Changing the drainage threshold recomputes HAND only.
 */
export function useHydrology(grid: ElevationGrid | null) {
  const [tracked, setTracked] = useState<Tracked>({ status: 'idle', forGrid: null, forAttempt: 0 })
  const [thresholdM2, setThresholdState] = useState(DEFAULT_DRAINAGE_THRESHOLD_M2)
  const [attempt, setAttempt] = useState(0)
  const worker = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const threshold = useRef(thresholdM2)

  useEffect(() => {
    threshold.current = thresholdM2
  })

  useEffect(() => {
    if (!grid) return
    const instance = new Worker(new URL('../workers/hydrology.worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    const ids = requestId
    const id = ++ids.current
    const track = (state: HydrologyState) => setTracked({ ...state, forGrid: grid, forAttempt: attempt })

    instance.onmessage = (event: MessageEvent<HydroResponse>) => {
      const message = event.data
      if (message.id !== ids.current) return
      if (message.type === 'stage') {
        track({ status: 'running', stage: message.stage })
      } else if (message.type === 'result') {
        track({ status: 'ready', grid, result: message.payload, updating: false })
      } else if (message.type === 'hand') {
        setTracked((previous) =>
          previous.status === 'ready'
            ? {
                ...previous,
                updating: false,
                result: { ...previous.result, hand: message.hand, drainage: message.drainage, summary: message.summary },
              }
            : previous,
        )
      } else {
        track({ status: 'error', message: message.message })
      }
    }
    instance.onerror = (event) => {
      if (id !== ids.current) return
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
      ids.current++
      instance.terminate()
    }
  }, [grid, attempt])

  // State from an earlier grid or attempt is stale; until the worker reports, the
  // current grid's analysis is starting.
  let state: HydrologyState
  if (!grid) state = { status: 'idle' }
  else if (tracked.forGrid !== grid || tracked.forAttempt !== attempt) state = { status: 'running', stage: 'filling' }
  else state = tracked

  const setThreshold = useCallback(
    (value: number) => {
      setThresholdState(value)
      if (tracked.status !== 'ready' || tracked.forGrid !== grid || !worker.current) return
      const id = ++requestId.current
      setTracked({ ...tracked, updating: true })
      const request: HydroRequest = { type: 'threshold', id, drainageThresholdM2: value }
      worker.current.postMessage(request)
    },
    [tracked, grid],
  )

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { state, thresholdM2, setThreshold, retry }
}
