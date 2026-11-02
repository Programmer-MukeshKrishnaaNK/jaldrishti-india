import { useEffect, useState } from 'react'
import { isAbort } from '../lib/dem/errors'
import type { ElevationGrid } from '../lib/dem/types'
import { WORLDCOVER_CLASSES } from '../lib/landcover/classes'
import { loadLandCover, type LandCoverGrid } from '../lib/landcover/worldcover'

export type LandCoverState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; landCover: LandCoverGrid; waterShare: Float32Array; classShare: number[]; missingShare: number }
  | { status: 'error'; message: string }

type Tracked = LandCoverState & { forGrid: ElevationGrid | null; forAttempt: number }

const WATER = WORLDCOVER_CLASSES.findIndex((c) => c.code === 80)

/** Loads ESA WorldCover for the elevation grid once terrain is available. */
export function useLandCover(grid: ElevationGrid | null) {
  const [tracked, setTracked] = useState<Tracked>({ status: 'idle', forGrid: null, forAttempt: 0 })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!grid) return
    const abort = new AbortController()
    loadLandCover(grid, abort.signal)
      .then((landCover) => {
        const n = landCover.width * landCover.height
        const classes = WORLDCOVER_CLASSES.length
        const waterShare = new Float32Array(n)
        const classTotals = new Array(classes).fill(0)
        let missingTotal = 0
        let all = 0
        for (let i = 0; i < n; i++) {
          let total = landCover.missing[i]
          missingTotal += landCover.missing[i]
          for (let k = 0; k < classes; k++) {
            const c = landCover.counts[k * n + i]
            total += c
            classTotals[k] += c
          }
          all += total
          waterShare[i] = total > 0 ? landCover.counts[WATER * n + i] / total : 0
        }
        setTracked({
          status: 'ready',
          landCover,
          waterShare,
          classShare: classTotals.map((c) => (all ? c / all : 0)),
          missingShare: all ? missingTotal / all : 1,
          forGrid: grid,
          forAttempt: attempt,
        })
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setTracked({
          status: 'error',
          message: error instanceof Error ? error.message : 'Land cover could not be loaded.',
          forGrid: grid,
          forAttempt: attempt,
        })
      })
    return () => abort.abort()
  }, [grid, attempt])

  let state: LandCoverState
  if (!grid) state = { status: 'idle' }
  else if (tracked.forGrid !== grid || tracked.forAttempt !== attempt) state = { status: 'loading' }
  else state = tracked

  return { state, retry: () => setAttempt((n) => n + 1) }
}
