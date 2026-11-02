import { DEEP_HOLLOW_M, HOTSPOT_RULES, type Hotspot } from './hotspots'
import type { DepressionFill } from './spill'

export interface Explanation {
  headline: string
  reasons: string[]
  /** Criteria that did not contribute, stated so the score is fully accounted for. */
  notCounted: string[]
  cautions: string[]
}

const CATEGORY_TEXT = {
  higher: 'Higher relative concentration potential',
  moderate: 'Moderate relative concentration potential',
} as const

const fmt = (v: number, digits = 1) => v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })
const km2 = (m2: number) => (m2 / 1e6).toLocaleString('en-IN', { maximumFractionDigits: m2 < 1e5 ? 3 : 2 })
const m3 = (v: number) => Math.round(v).toLocaleString('en-IN')

/**
 * Plain-language reasons for a hotspot, built only from its computed values. Each
 * sentence corresponds to one scoring criterion, so the explanation and the score agree.
 */
export function explainHotspot(hotspot: Hotspot, rainfallMm: number, fills: DepressionFill[]): Explanation {
  const { peak, flags } = hotspot
  const { criteria } = peak
  const reasons: string[] = []
  const notCounted: string[] = []

  const depression = hotspot.depressionRanks.map((r) => fills[r - 1]).find(Boolean)
  if (criteria.ponding > 0) {
    let sentence = `The model holds water here: a terrain hollow fills to ${fmt(hotspot.maxPondDepthM, 2)} m at its deepest point (${criteria.ponding} pt)`
    if (depression) {
      sentence += `. Depression #${depression.rank} receives ${m3(depression.inflowM3)} m³ against a capacity of ${m3(depression.capacityM3)} m³`
      sentence += depression.status === 'spilling' ? ', so it fills and overflows' : `, filling it to ${Math.round(depression.fillFraction * 100)}%`
    }
    reasons.push(`${sentence}.`)
  } else {
    notCounted.push(`No modelled ponding of ${HOTSPOT_RULES.ponding.weakM} m or more.`)
  }

  if (criteria.runoff > 0) {
    reasons.push(
      `Runoff from about ${km2(peak.contributingAreaM2)} km² upslope passes through, roughly ${m3(peak.passingM3)} m³ in this scenario (${criteria.runoff} pt).`,
    )
  } else if (peak.pondDepthM > 0) {
    notCounted.push('Runoff collects in the hollow here rather than passing through, so the passing-runoff criterion does not apply.')
  } else {
    notCounted.push('Little scenario runoff passes through the highest-scoring cell.')
  }

  if (criteria.hand > 0) {
    reasons.push(`The ground is ${fmt(peak.handM, 1)} m above the nearest modelled drainage line (${criteria.hand} pt).`)
  } else if (Number.isFinite(peak.handM)) {
    notCounted.push(`At ${fmt(peak.handM, 1)} m above the nearest drainage line, it is not low-lying by this measure.`)
  } else {
    notCounted.push('Its flow path leaves the area before reaching a drainage line, so HAND is unknown.')
  }

  if (criteria.flat > 0) reasons.push(`The slope is gentle (${fmt(peak.slopePct, 1)}%), so water would drain away slowly (1 pt).`)
  else notCounted.push(`The slope (${fmt(peak.slopePct, 1)}%) is steep enough for water to move on.`)

  const cautions: string[] = []
  if (flags.onWater) cautions.push('Most of this hotspot is mapped as permanent water, where concentration is expected; it is not evidence of street waterlogging.')
  if (flags.besideWater && !flags.onWater) {
    cautions.push(
      'It lies beside mapped permanent water such as a river or tank. Low ground there may reflect the channel, its banks or embankments in the surface model.',
    )
  }
  if (flags.deepHollow) {
    cautions.push(
      `It overlaps a hollow more than ${DEEP_HOLLOW_M} m deep. In a surface model that often comes from walls, buildings, embankments or bridges rather than ground that holds water.`,
    )
  }
  if (flags.nearEdge) cautions.push('It touches the edge of the selected area, so terrain outside the selection could change the result.')
  if (flags.missingLandCover) cautions.push('Some cells have no land-cover data and generate no runoff in the model.')
  if (hotspot.confidence === 'reduced') cautions.unshift('Reduced confidence: ranked after hotspots without these data caveats.')
  cautions.push('Based on 30 m surface elevation; drains, culverts and channels narrower than a cell are not represented.')

  return {
    headline: `${CATEGORY_TEXT[hotspot.category]} under the ${fmt(rainfallMm, 0)} mm scenario (${peak.points} of 7 points).`,
    reasons,
    notCounted,
    cautions,
  }
}
