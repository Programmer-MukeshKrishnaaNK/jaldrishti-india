import type { LandCoverGrid } from '../landcover/worldcover'
import { cellAreaM2, type HydroGrid } from './grid'

export const MAX_RAINFALL_MM = 1000

/** A cell needs at least this share of classified land-cover pixels to get a coefficient. */
export const MIN_CLASSIFIED_SHARE = 0.5

export class ScenarioInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScenarioInputError'
  }
}

export function validateRainfall(mm: number): void {
  if (!Number.isFinite(mm) || mm < 0 || mm > MAX_RAINFALL_MM) {
    throw new ScenarioInputError(`Rainfall must be between 0 and ${MAX_RAINFALL_MM} mm; got ${mm}.`)
  }
}

export function validateCoefficients(coefficients: ArrayLike<number>): void {
  for (let k = 0; k < coefficients.length; k++) {
    const c = coefficients[k]
    if (!Number.isFinite(c) || c < 0 || c > 1) {
      throw new ScenarioInputError(`Runoff coefficients must be between 0 and 1; class ${k} has ${c}.`)
    }
  }
}

/**
 * Area-weighted runoff coefficient for each elevation cell from its land-cover mix.
 * Cells with fewer than half their pixels classified are NaN: the model does not
 * guess a coefficient for them.
 */
export function coefficientGrid(landCover: LandCoverGrid, coefficients: ArrayLike<number>): Float32Array {
  validateCoefficients(coefficients)
  const n = landCover.width * landCover.height
  const classes = landCover.counts.length / n
  if (coefficients.length !== classes) {
    throw new ScenarioInputError(`Expected ${classes} coefficients, got ${coefficients.length}.`)
  }
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let classified = 0
    let weighted = 0
    for (let k = 0; k < classes; k++) {
      const count = landCover.counts[k * n + i]
      classified += count
      weighted += count * coefficients[k]
    }
    const total = classified + landCover.missing[i]
    out[i] = total > 0 && classified / total >= MIN_CLASSIFIED_SHARE ? weighted / classified : Number.NaN
  }
  return out
}

/** A single coefficient for every cell, for when land cover is unavailable and the user opts in. */
export function uniformCoefficientGrid(cells: number, coefficient: number): Float32Array {
  validateCoefficients([coefficient])
  return new Float32Array(cells).fill(coefficient)
}

export interface GeneratedRunoff {
  /** Runoff generated in each cell, m³; 0 where the coefficient or elevation is missing. */
  volumeM3: Float64Array
  totalM3: number
  /** Rain falling on cells with a coefficient, m³. */
  rainfallOnCoveredM3: number
  coveredCells: number
  /** Valid elevation cells without a runoff coefficient; they generate no runoff. */
  missingCoefficientCells: number
  /** Area-weighted mean coefficient over covered cells. */
  meanCoefficient: number
}

/**
 * Rational-method runoff volume per cell: rainfall depth (m) × coefficient × cell area (m²).
 * Rainfall is uniform over the area and given in millimetres.
 */
export function generateRunoff(grid: HydroGrid, coefficients: Float32Array, rainfallMm: number): GeneratedRunoff {
  validateRainfall(rainfallMm)
  const n = grid.width * grid.height
  if (coefficients.length !== n) throw new ScenarioInputError('The coefficient grid does not match the elevation grid.')
  const depthM = rainfallMm / 1000
  const volumeM3 = new Float64Array(n)
  let totalM3 = 0
  let rainfallOnCoveredM3 = 0
  let coveredCells = 0
  let missingCoefficientCells = 0
  let coveredArea = 0
  let weightedC = 0

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(grid.elevation[i])) continue
    const c = coefficients[i]
    if (!Number.isFinite(c)) {
      missingCoefficientCells++
      continue
    }
    const area = cellAreaM2(grid, Math.floor(i / grid.width))
    const v = depthM * c * area
    volumeM3[i] = v
    totalM3 += v
    rainfallOnCoveredM3 += depthM * area
    coveredCells++
    coveredArea += area
    weightedC += c * area
  }

  return {
    volumeM3,
    totalM3,
    rainfallOnCoveredM3,
    coveredCells,
    missingCoefficientCells,
    meanCoefficient: coveredArea > 0 ? weightedC / coveredArea : Number.NaN,
  }
}
