import { NEIGHBOURS, type HydroGrid } from './grid'

/**
 * Screening rules. Each criterion awards points at two documented tiers. The three
 * water-concentration criteria carry up to 2 points each; slope carries 1 because it
 * slows drainage rather than concentrating water. There is no calibration data, so
 * points are kept coarse and every one is shown to the user.
 */
export const HOTSPOT_RULES = {
  ponding: { strongM: 0.5, weakM: 0.1 },
  /** Runoff passing a cell, expressed as the runoff generated on this much area at the area's mean coefficient. */
  runoff: { strongM2: 500_000, weakM2: 100_000 },
  hand: { strongM: 1, weakM: 3 },
  flat: { maxSlopePct: 1 },
  higherMinPoints: 5,
  moderateMinPoints: 3,
} as const

export type Category = 'higher' | 'moderate' | 'lower'

export interface Criteria {
  ponding: 0 | 1 | 2
  runoff: 0 | 1 | 2
  hand: 0 | 1 | 2
  flat: 0 | 1
}

export interface HotspotInput {
  grid: HydroGrid
  rainfallMm: number
  meanCoefficient: number
  pondDepthM: Float32Array
  passingM3: Float64Array
  handM: Float32Array
  contributingAreaM2: Float64Array
  labels: Int32Array
  /** Max fill depth of each depression by rank − 1, from Phase 2 storage. */
  depressionMaxDepthM: number[]
  /** Share of each cell's land-cover pixels that are permanent water; optional. */
  waterShare?: Float32Array
  /** Runoff coefficient per cell; NaN marks missing land cover. */
  coefficients: Float32Array
  slopePct?: Float32Array
}

export interface CellScores {
  points: Uint8Array
  /** 2 higher, 1 moderate, 0 lower, 255 no data. */
  category: Uint8Array
  slopePct: Float32Array
}

export interface Hotspot {
  rank: number
  category: Exclude<Category, 'lower'>
  cells: number
  areaM2: number
  centreRow: number
  centreCol: number
  /** The highest-scoring cell, with the values behind its score. */
  peak: {
    index: number
    points: number
    criteria: Criteria
    elevationM: number
    pondDepthM: number
    passingM3: number
    contributingAreaM2: number
    handM: number
    slopePct: number
  }
  maxPondDepthM: number
  pondedVolumeM3: number
  /** Ranks of Phase 2 depressions the hotspot overlaps. */
  depressionRanks: number[]
  flags: {
    nearEdge: boolean
    deepHollow: boolean
    onWater: boolean
    /** Touches cells that are mostly permanent water, such as a river or tank. */
    besideWater: boolean
    missingLandCover: boolean
  }
  /**
   * Reduced when the hotspot overlaps a hollow deep enough to suggest a data artefact
   * or lies mostly on permanent water. It never changes the category, only the order.
   */
  confidence: 'standard' | 'reduced'
}

/** Depressions deeper than this are unusual for urban ground and often reflect walls, buildings or bridges in a surface model. */
export const DEEP_HOLLOW_M = 3

/** Slope of the measured surface in percent (Horn's method); NaN for no-data cells. */
export function slopePercent(grid: HydroGrid): Float32Array {
  const { width, height, elevation } = grid
  const out = new Float32Array(width * height).fill(Number.NaN)
  const z = (r: number, c: number, fallback: number) => {
    const v = elevation[Math.min(height - 1, Math.max(0, r)) * width + Math.min(width - 1, Math.max(0, c))]
    return Number.isFinite(v) ? v : fallback
  }
  for (let r = 0; r < height; r++) {
    const dx = grid.dxM[r]
    const dy = grid.dyM[r]
    for (let c = 0; c < width; c++) {
      const e = elevation[r * width + c]
      if (!Number.isFinite(e)) continue
      const a = z(r - 1, c - 1, e), b = z(r - 1, c, e), cc = z(r - 1, c + 1, e)
      const d = z(r, c - 1, e), f = z(r, c + 1, e)
      const g = z(r + 1, c - 1, e), h = z(r + 1, c, e), i = z(r + 1, c + 1, e)
      const dzdx = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * dx)
      const dzdy = (g + 2 * h + i - (a + 2 * b + cc)) / (8 * dy)
      out[r * width + c] = 100 * Math.hypot(dzdx, dzdy)
    }
  }
  return out
}

export function criteriaFor(input: HotspotInput, slope: Float32Array, i: number): Criteria {
  const r = HOTSPOT_RULES
  const pond = input.pondDepthM[i]
  const reference = (input.rainfallMm / 1000) * (Number.isFinite(input.meanCoefficient) ? input.meanCoefficient : 0)
  const passing = input.passingM3[i]
  const hand = input.handM[i]
  return {
    ponding: pond >= r.ponding.strongM ? 2 : pond >= r.ponding.weakM ? 1 : 0,
    runoff:
      reference > 0 && passing >= reference * r.runoff.strongM2
        ? 2
        : reference > 0 && passing >= reference * r.runoff.weakM2
          ? 1
          : 0,
    hand: hand <= r.hand.strongM ? 2 : hand <= r.hand.weakM ? 1 : 0,
    flat: slope[i] < r.flat.maxSlopePct ? 1 : 0,
  }
}

const total = (c: Criteria) => c.ponding + c.runoff + c.hand + c.flat

/** Points and category for every cell. A cell needs a water criterion (ponding or runoff) to be more than lower. */
export function scoreCells(input: HotspotInput): CellScores {
  const { grid } = input
  const n = grid.width * grid.height
  const slope = input.slopePct ?? slopePercent(grid)
  const points = new Uint8Array(n)
  const category = new Uint8Array(n).fill(255)
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(grid.elevation[i])) continue
    const c = criteriaFor(input, slope, i)
    const p = total(c)
    points[i] = p
    const water = c.ponding + c.runoff > 0
    category[i] = !water ? 0 : p >= HOTSPOT_RULES.higherMinPoints ? 2 : p >= HOTSPOT_RULES.moderateMinPoints ? 1 : 0
  }
  return { points, category, slopePct: slope }
}

/**
 * Groups adjacent higher- and moderate-category cells into hotspots and ranks them:
 * higher before moderate, standard confidence before reduced, then by points × area
 * (how much strongly scoring ground), then by ponded volume.
 */
export function findHotspots(input: HotspotInput, scores: CellScores): Hotspot[] {
  const { grid } = input
  const { width, height } = grid
  const n = width * height
  const seen = new Uint8Array(n)
  const queue = new Int32Array(n)
  const found: (Omit<Hotspot, 'rank' | 'confidence'> & { weight: number })[] = []

  for (let seed = 0; seed < n; seed++) {
    if (seen[seed] || scores.category[seed] === 255 || scores.category[seed] === 0) continue
    let head = 0
    let tail = 0
    queue[tail++] = seed
    seen[seed] = 1
    let cells = 0
    let areaM2 = 0
    let rowSum = 0
    let colSum = 0
    let weight = 0
    let best = seed
    let maxPond = 0
    let pondedVolume = 0
    let highest = 0
    let water = 0
    let missingLandCover = false
    let nearEdge = false
    let besideWater = false
    const ranks = new Set<number>()

    while (head < tail) {
      const i = queue[head++]
      const row = Math.floor(i / width)
      const col = i - row * width
      const area = grid.dxM[row] * grid.dyM[row]
      cells++
      areaM2 += area
      rowSum += row
      colSum += col
      weight += scores.points[i] * area
      highest = Math.max(highest, scores.category[i])
      maxPond = Math.max(maxPond, input.pondDepthM[i])
      pondedVolume += input.pondDepthM[i] * area
      if (input.labels[i] >= 0) ranks.add(input.labels[i] + 1)
      if ((input.waterShare?.[i] ?? 0) > 0.5) water++
      if (!Number.isFinite(input.coefficients[i])) missingLandCover = true
      if (row < 2 || col < 2 || row >= height - 2 || col >= width - 2) nearEdge = true
      // Peak cell: most points, then deepest ponding, then most runoff passing.
      const better =
        scores.points[i] - scores.points[best] ||
        input.pondDepthM[i] - input.pondDepthM[best] ||
        input.passingM3[i] - input.passingM3[best]
      if (better > 0) best = i
      for (let k = 0; k < 8; k++) {
        const { dr, dc } = NEIGHBOURS[k]
        const r = row + dr
        const c = col + dc
        if (r < 0 || c < 0 || r >= height || c >= width) continue
        const j = r * width + c
        if ((input.waterShare?.[j] ?? 0) > 0.5) besideWater = true
        if (!seen[j] && scores.category[j] !== 255 && scores.category[j] > 0) {
          seen[j] = 1
          queue[tail++] = j
        }
      }
    }

    const depressionRanks = [...ranks].sort((a, b) => a - b)
    found.push({
      category: highest === 2 ? 'higher' : 'moderate',
      cells,
      areaM2,
      centreRow: rowSum / cells,
      centreCol: colSum / cells,
      peak: {
        index: best,
        points: scores.points[best],
        criteria: criteriaFor(input, scores.slopePct, best),
        elevationM: grid.elevation[best],
        pondDepthM: input.pondDepthM[best],
        passingM3: input.passingM3[best],
        contributingAreaM2: input.contributingAreaM2[best],
        handM: input.handM[best],
        slopePct: scores.slopePct[best],
      },
      maxPondDepthM: maxPond,
      pondedVolumeM3: pondedVolume,
      depressionRanks,
      flags: {
        nearEdge,
        deepHollow: depressionRanks.some((r) => (input.depressionMaxDepthM[r - 1] ?? 0) > DEEP_HOLLOW_M),
        onWater: water > cells / 2,
        besideWater: besideWater || water > 0,
        missingLandCover,
      },
      weight,
    })
  }

  const withConfidence = found.map((h) => ({
    ...h,
    confidence: (h.flags.deepHollow || h.flags.onWater ? 'reduced' : 'standard') as Hotspot['confidence'],
  }))
  return withConfidence
    .sort(
      (a, b) =>
        (a.category === b.category ? 0 : a.category === 'higher' ? -1 : 1) ||
        (a.confidence === b.confidence ? 0 : a.confidence === 'standard' ? -1 : 1) ||
        b.weight - a.weight ||
        b.pondedVolumeM3 - a.pondedVolumeM3,
    )
    .map(({ weight: _weight, ...h }, k) => ({ ...h, rank: k + 1 }))
}
