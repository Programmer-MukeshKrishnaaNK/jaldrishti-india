import type { Accumulation } from './accumulation'
import type { HydroGrid } from './grid'
import { findHotspots, scoreCells, slopePercent, type CellScores, type Hotspot } from './hotspots'
import { generateRunoff, validateRainfall, type GeneratedRunoff } from './runoff'
import { fillAndSpill, type SpillResult } from './spill'
import type { StorageResult } from './storage'

export const PRESET_RAINFALL_MM = [50, 100, 150] as const

/** Phase 2 results a scenario builds on. */
export interface ScenarioBase {
  grid: HydroGrid
  directions: Uint8Array
  accumulation: Accumulation
  handM: Float32Array
  storage: StorageResult
  slopePct?: Float32Array
}

export interface ScenarioSummary {
  rainfallMm: number
  generatedM3: number
  storedM3: number
  exitedM3: number
  residualM3: number
  meanCoefficient: number
  missingCoefficientCells: number
  depressionsReached: number
  depressionsSpilling: number
  higherCells: number
  moderateCells: number
  higherAreaM2: number
  hotspotCount: number
  higherHotspotCount: number
  ms: number
}

export interface ScenarioResult {
  rainfallMm: number
  runoff: GeneratedRunoff
  spill: SpillResult
  scores: CellScores
  hotspots: Hotspot[]
  summary: ScenarioSummary
}

/** Runoff, fill-and-spill and hotspot screening for one hypothetical rainfall depth. */
export function runScenario(
  base: ScenarioBase,
  coefficients: Float32Array,
  rainfallMm: number,
  waterShare?: Float32Array,
): ScenarioResult {
  validateRainfall(rainfallMm)
  const started = performance.now()
  const { grid, storage } = base
  const runoff = generateRunoff(grid, coefficients, rainfallMm)
  const spill = fillAndSpill(grid, base.directions, storage.labels, storage.depressions, storage.depthM, runoff.volumeM3)
  const input = {
    grid,
    rainfallMm,
    meanCoefficient: runoff.meanCoefficient,
    pondDepthM: spill.pondDepthM,
    passingM3: spill.passingM3,
    handM: base.handM,
    contributingAreaM2: base.accumulation.areaM2,
    labels: storage.labels,
    depressionMaxDepthM: storage.depressions.map((d) => d.maxDepthM),
    waterShare,
    coefficients,
    slopePct: base.slopePct ?? slopePercent(grid),
  }
  const scores = scoreCells(input)
  const hotspots = findHotspots(input, scores)

  let higherCells = 0
  let moderateCells = 0
  let higherAreaM2 = 0
  for (let i = 0; i < scores.category.length; i++) {
    if (scores.category[i] === 2) {
      higherCells++
      higherAreaM2 += grid.dxM[Math.floor(i / grid.width)] * grid.dyM[Math.floor(i / grid.width)]
    } else if (scores.category[i] === 1) moderateCells++
  }

  return {
    rainfallMm,
    runoff,
    spill,
    scores,
    hotspots,
    summary: {
      rainfallMm,
      generatedM3: spill.generatedM3,
      storedM3: spill.storedM3,
      exitedM3: spill.exitedM3,
      residualM3: spill.residualM3,
      meanCoefficient: runoff.meanCoefficient,
      missingCoefficientCells: runoff.missingCoefficientCells,
      depressionsReached: spill.depressions.filter((d) => d.status !== 'dry').length,
      depressionsSpilling: spill.depressions.filter((d) => d.status === 'spilling').length,
      higherCells,
      moderateCells,
      higherAreaM2,
      hotspotCount: hotspots.length,
      higherHotspotCount: hotspots.filter((h) => h.category === 'higher').length,
      ms: performance.now() - started,
    },
  }
}
