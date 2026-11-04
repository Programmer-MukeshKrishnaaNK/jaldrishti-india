import type { ElevationGrid } from '../dem/types'
import { fromElevationGrid } from '../hydrology/grid'
import { DEEP_HOLLOW_M, type Hotspot } from '../hydrology/hotspots'
import type { ScenarioSummary } from '../hydrology/scenario'
import type { DepressionFill } from '../hydrology/spill'
import { WORLDCOVER_CLASSES } from '../landcover/classes'
import type { LandCoverGrid } from '../landcover/worldcover'

/**
 * Plain-language explanation of the selected area and scenario for people without a
 * hydrology background. Every figure comes from the loaded grids and the model's own
 * results; nothing is estimated here that the model did not compute.
 */

export interface AreaScenario {
  rainfallMm: number
  summary: ScenarioSummary
  comparison: ScenarioSummary[]
  hotspots: Hotspot[]
  fills: DepressionFill[]
  /** Inputs have changed since the scenario ran, so it no longer matches the controls. */
  outdated: boolean
}

export interface AreaLandCover {
  grid: LandCoverGrid
  /** Share of all land-cover pixels in each WORLDCOVER_CLASSES entry. */
  classShare: number[]
  missingShare: number
}

export interface AreaInput {
  /** How the area was chosen, completing "This is a … km area …", e.g. "around Madurai" or "that you drew". */
  areaLabel: string
  grid: ElevationGrid
  landCover: AreaLandCover | null
  /** Set when one runoff share is used everywhere instead of land cover. */
  uniformCoefficient: number | null
  scenario: AreaScenario | null
  /** Rainfall chosen in the controls, which may differ from the scenario shown. */
  chosenRainfallMm: number
  selected: Hotspot | null
  view: '2d' | '3d'
}

export interface AreaSection {
  id: 'looking' | 'where' | 'why' | 'rain' | 'confidence'
  question: string
  paragraphs: string[]
  points?: string[]
  /** Cautions shown after the points. */
  notes?: string[]
}

export interface AreaExplanation {
  summary: string
  sections: AreaSection[]
}

// Everyday names for WorldCover classes, in the same order.
const PLAIN_CLASS: Record<number, string> = {
  10: 'trees',
  20: 'scrub',
  30: 'grass',
  40: 'farmland',
  50: 'built-up land (roofs, roads and paving)',
  60: 'bare ground',
  70: 'snow or ice',
  80: 'open water',
  90: 'wetland',
  95: 'mangroves',
  100: 'moss and lichen',
}
const BUILT_UP = WORLDCOVER_CLASSES.findIndex((c) => c.code === 50)
const WATER = WORLDCOVER_CLASSES.findIndex((c) => c.code === 80)

/** India Meteorological Department categories for rain in 24 hours, in mm. */
const IMD_DAILY: [number, string][] = [
  [204.5, 'extremely heavy rain'],
  [115.6, 'very heavy rain'],
  [64.5, 'heavy rain'],
  [15.6, 'moderate rain'],
  [2.5, 'light rain'],
]

const whole = (v: number) => Math.round(v).toLocaleString('en-IN')
const percent = (share: number) => `${Math.round(share * 100)}%`

/** Depth in words: centimetres under a metre, metres above. */
export function depth(m: number): string {
  if (m < 1) return `about ${Math.max(1, Math.round(m * 100))} cm`
  return `about ${m.toLocaleString('en-IN', { maximumFractionDigits: 1 })} m`
}

function areaText(m2: number): string {
  if (m2 >= 1e5) return `${(m2 / 1e6).toLocaleString('en-IN', { maximumFractionDigits: 2 })} km²`
  return `${whole(Math.round(m2 / 100) * 100)} m²`
}

/** Where a cell lies within the area, as a compass region. */
function position(grid: ElevationGrid, index: number): string {
  const row = Math.floor(index / grid.width)
  const col = index % grid.width
  const ns = ['north', '', 'south'][Math.min(2, Math.floor((3 * row) / grid.height))]
  const ew = ['west', '', 'east'][Math.min(2, Math.floor((3 * col) / grid.width))]
  if (!ns && !ew) return 'near the centre of the area'
  return `in the ${ns && ew ? `${ns}-${ew}` : ns || ew} of the area`
}

function stats(grid: ElevationGrid) {
  const { dxM, dyM } = fromElevationGrid(grid)
  let min = Infinity
  let max = -Infinity
  let valid = 0
  let validAreaM2 = 0
  for (let i = 0; i < grid.values.length; i++) {
    const v = grid.values[i]
    if (!Number.isFinite(v)) continue
    valid++
    const row = Math.floor(i / grid.width)
    validAreaM2 += dxM[row] * dyM[row]
    if (v < min) min = v
    if (v > max) max = v
  }
  let northSouthM = 0
  for (const dy of dyM) northSouthM += dy
  return {
    min,
    max,
    noDataShare: 1 - valid / grid.values.length,
    validAreaM2,
    eastWestKm: (dxM[Math.floor(grid.height / 2)] * grid.width) / 1000,
    northSouthKm: northSouthM / 1000,
  }
}

function reliefText(range: number): string {
  if (range < 10) return 'very flat'
  if (range < 30) return 'mostly flat, with gentle rises and dips'
  if (range < 100) return 'gently rolling'
  return 'hilly'
}

/** The land-cover class covering most of one elevation cell, or null without data. */
function coverAt(landCover: AreaLandCover | null, index: number): string | null {
  if (!landCover) return null
  const n = landCover.grid.width * landCover.grid.height
  let best = -1
  let bestCount = 0
  for (let k = 0; k < WORLDCOVER_CLASSES.length; k++) {
    const count = landCover.grid.counts[k * n + index]
    if (count > bestCount) {
      best = k
      bestCount = count
    }
  }
  return best >= 0 ? PLAIN_CLASS[WORLDCOVER_CLASSES[best].code] : null
}

/** One short line describing a hotspot by what the model found there. */
function hotspotLine(h: Hotspot, grid: ElevationGrid): string {
  const strength = h.category === 'higher' ? 'stands out more' : 'stands out somewhat'
  let what: string
  if (h.maxPondDepthM >= 0.1) what = `a dip in the ground that may hold water ${depth(h.maxPondDepthM)} deep`
  else if (h.peak.criteria.runoff > 0) what = `a low path that water from about ${areaText(h.peak.contributingAreaM2)} of land drains through`
  else what = 'low, flat ground where water would drain away slowly'
  return `Hotspot ${h.rank} (${strength}), ${position(grid, h.peak.index)}: ${what}.`
}

function looking(input: AreaInput, s: ReturnType<typeof stats>): AreaSection {
  const paragraphs = [
    `This is a ${s.eastWestKm.toFixed(1)} × ${s.northSouthKm.toFixed(1)} km area ${input.areaLabel}. ` +
      `The ground here is ${reliefText(s.max - s.min)}: it lies between ${whole(s.min)} m and ${whole(s.max)} m above sea level, ` +
      `a difference of ${whole(s.max - s.min)} m from the lowest to the highest point.`,
  ]
  if (input.scenario) {
    paragraphs.push(
      `It shows what could happen if ${whole(input.scenario.rainfallMm)} mm of rain fell on this area. ` +
        'The model follows the rain downhill and finds low spots where it could collect.',
    )
  } else {
    paragraphs.push('Choose a rainfall amount and run the scenario to see where rainwater could collect.')
  }
  paragraphs.push(
    input.view === '3d'
      ? 'In the 3D view, heights are stretched so that gentle slopes are visible. Blue shows water the model holds in low spots, and the numbered pins are hotspots.'
      : 'On the map, colours show the height of the ground. The layers under Terrain analysis show how water moves; blue shows water the model holds in low spots, and numbered circles are hotspots.',
  )
  return { id: 'looking', question: 'What am I looking at?', paragraphs }
}

function where(input: AreaInput): AreaSection {
  const question = 'Where might water collect?'
  const { scenario, grid } = input
  if (!scenario) return { id: 'where', question, paragraphs: ['Run a rainfall scenario first; this will then list the places to look at.'] }
  const { hotspots, summary } = scenario
  if (hotspots.length === 0) {
    return {
      id: 'where',
      question,
      paragraphs: [
        `With ${whole(scenario.rainfallMm)} mm of rain, no place in this area stands out. Low spots may still hold some water, but none combines collected water with low, flat ground strongly enough to be called a hotspot.`,
      ],
    }
  }
  const higher = summary.higherHotspotCount
  const paragraphs = [
    `The model found ${hotspots.length} ${hotspots.length === 1 ? 'place' : 'places'} where water is more likely to gather` +
      (higher > 0 ? `; ${higher} of them stand${higher === 1 ? 's' : ''} out more than the rest.` : '.') +
      ' Hotspots are numbered from the strongest down.',
  ]
  const shown = hotspots.slice(0, 3)
  if (input.selected && !shown.includes(input.selected)) shown.push(input.selected)
  paragraphs.push('These compare places within this area only. A hotspot is not a report of real flooding.')
  return { id: 'where', question, paragraphs, points: shown.map((h) => hotspotLine(h, grid)) }
}

function why(input: AreaInput): AreaSection {
  const question = 'Why here?'
  const { scenario, grid } = input
  if (!scenario || scenario.hotspots.length === 0) {
    return {
      id: 'why',
      question,
      paragraphs: [
        scenario
          ? 'There are no hotspots to explain in this scenario.'
          : 'Once a scenario has run, this explains why the model picks out a place. Choose a hotspot to see its reasons.',
      ],
    }
  }
  const h = input.selected ?? scenario.hotspots[0]
  const intro = input.selected
    ? `Hotspot ${h.rank}, ${position(grid, h.peak.index)}:`
    : `Hotspot ${h.rank}, the strongest, ${position(grid, h.peak.index)}. Choose another hotspot to see its reasons.`
  const { criteria } = h.peak
  const points: string[] = []

  if (criteria.ponding > 0) {
    const fill = h.depressionRanks.map((r) => scenario.fills[r - 1]).find(Boolean)
    let sentence = `The ground here forms a shallow bowl. In this scenario it fills with water up to ${depth(h.maxPondDepthM)} deep`
    if (fill?.status === 'spilling') sentence += ', and then overflows towards lower ground'
    points.push(`${sentence}.`)
  }
  if (criteria.runoff > 0) {
    points.push(
      `Rainwater from about ${areaText(h.peak.contributingAreaM2)} of higher ground around it flows towards and through this spot.`,
    )
  }
  if (criteria.hand > 0 && Number.isFinite(h.peak.handM)) {
    points.push(
      h.peak.handM < 0.05
        ? 'It lies on a natural drainage line (the low path water follows across the land), the lowest ground nearby.'
        : `It sits only ${depth(h.peak.handM)} above the nearest natural drainage line (the low path water follows across the land), so it is among the lowest ground nearby.`,
    )
  }
  if (criteria.flat > 0) {
    points.push(`The land is almost flat here (a ${h.peak.slopePct.toFixed(1)}% slope), so water drains away slowly.`)
  }

  const cover = coverAt(input.landCover, h.peak.index)
  if (input.uniformCoefficient === null && cover) {
    if (cover === PLAIN_CLASS[50]) {
      points.push('The ground here is mostly built-up. Roofs, roads and paving let little water soak in, so more rainwater flows across the surface.')
    } else if (cover === PLAIN_CLASS[80]) {
      points.push('The ground here is mapped mainly as open water, such as a river or tank, where water is expected to gather.')
    } else {
      points.push(`The ground here is mapped mainly as ${cover}.`)
    }
  }

  const cautions: string[] = []
  if (h.flags.deepHollow) {
    cautions.push(
      `Part of this hollow is more than ${DEEP_HOLLOW_M} m deep. In this kind of elevation data, that often means a wall, building, embankment or bridge, not a real dip in the ground.`,
    )
  }
  if (h.flags.onWater) cautions.push('Most of it is mapped as permanent water, so water gathering here is normal and not a sign of street flooding.')
  else if (h.flags.besideWater) cautions.push('It is next to a river, lake or tank, so the low ground may be the channel or its banks.')
  if (h.flags.nearEdge) cautions.push('It touches the edge of the selected area; land just outside could change the result.')

  return { id: 'why', question, paragraphs: [intro], points, notes: cautions }
}

function rain(input: AreaInput, s: ReturnType<typeof stats>): AreaSection {
  const question = 'What does the rainfall scenario mean?'
  const { scenario } = input
  const mm = scenario?.rainfallMm ?? input.chosenRainfallMm
  const category = IMD_DAILY.find(([min]) => mm >= min)?.[1]
  const paragraphs = [
    `${whole(mm)} mm of rain is a layer of water ${mm >= 10 ? `${(mm / 10).toLocaleString('en-IN', { maximumFractionDigits: 1 })} cm` : `${mm} mm`} deep, if none of it soaked in or flowed away.` +
      (category ? ` If it fell within 24 hours, the India Meteorological Department would call it ${category}.` : ''),
  ]
  if (scenario) {
    const { summary } = scenario
    const rainM3 = (mm / 1000) * s.validAreaM2
    let runoff = `Over this area that is about ${whole(rainM3)} m³ of water (1 m³ is 1,000 litres). The model estimates that about ${percent(summary.meanCoefficient)} of it would run across the surface instead of soaking in`
    const built = input.landCover && input.uniformCoefficient === null ? input.landCover.classShare[BUILT_UP] : 0
    if (built >= 0.3) runoff += `, mainly because ${percent(built)} of the area is built-up and hard surfaces let less water soak into the ground`
    paragraphs.push(`${runoff}.`)
    if (summary.generatedM3 > 0) {
      paragraphs.push(
        `Of that runoff, about ${whole(summary.storedM3)} m³ (${percent(summary.storedM3 / summary.generatedM3)}) ends up held in low spots; the rest flows on and leaves the area.`,
      )
    }
    paragraphs.push(
      'The model treats all the rain as arriving at once. It does not include how fast the rain falls, or drains, pipes and pumps that carry water away, so in reality water could be lower and drain away sooner.',
    )
    if (input.chosenRainfallMm !== mm) {
      paragraphs.push(`You have chosen ${whole(input.chosenRainfallMm)} mm; run the scenario again to update these results.`)
    }
    const others = scenario.comparison.filter((c) => c.rainfallMm !== mm)
    if (others.length) {
      return {
        id: 'rain',
        question,
        paragraphs,
        points: [...others, summary]
          .sort((a, b) => a.rainfallMm - b.rainfallMm)
          .map(
            (c) =>
              `${whole(c.rainfallMm)} mm: about ${whole(c.storedM3)} m³ held in low spots, ${c.hotspotCount} ${c.hotspotCount === 1 ? 'hotspot' : 'hotspots'}${c.rainfallMm === mm ? ' (shown)' : ''}`,
          ),
      }
    }
  }
  return { id: 'rain', question, paragraphs }
}

function confidence(input: AreaInput, s: ReturnType<typeof stats>): AreaSection {
  const source = input.grid.source
  const points: string[] = []
  if (source.id === 'copernicus-glo30') {
    points.push(
      `Heights come from ${source.name}, with one value every ${source.spacingM} m. It measures the top of whatever is there, including buildings and trees, so streets between tall buildings can look like dips.`,
    )
  } else {
    points.push(
      `Heights come from ${source.name}, an older and coarser backup source used because the main source was unavailable, so results are rougher than usual.`,
    )
  }
  if (s.noDataShare > 0.01) points.push(`${percent(s.noDataShare)} of the area has no height data and is left out.`)

  if (input.uniformCoefficient !== null) {
    points.push(`The same runoff share (${percent(input.uniformCoefficient)}) is used everywhere, instead of land cover, because you chose that setting.`)
  } else if (input.landCover) {
    points.push(
      'How much rain soaks in is estimated from ESA WorldCover land-cover maps, using typical values for each type of surface. These are reasonable assumptions, not local measurements.',
    )
    if (input.landCover.missingShare > 0.02) {
      points.push(`${percent(input.landCover.missingShare)} of the area has no land-cover data; no runoff is counted there.`)
    }
    if (input.landCover.classShare[WATER] > 0.05) {
      points.push(`${percent(input.landCover.classShare[WATER])} of the area is open water, where gathering water is expected.`)
    }
  } else {
    points.push('Land cover has not loaded yet, so the scenario cannot judge how much rain soaks in.')
  }
  points.push('Drains, culverts and channels narrower than about 30 m are not in the data.')
  if (input.selected?.confidence === 'reduced') {
    points.push(`Hotspot ${input.selected.rank} has reduced confidence because of the caution noted under "Why here?".`)
  }
  if (input.scenario?.outdated) points.push('Some settings have changed since this scenario ran; run it again for results that match.')

  return {
    id: 'confidence',
    question: 'How confident is this result?',
    paragraphs: [
      'Useful for comparing places within this area, but not for predicting real flooding. This is a simplified "what if" scenario, not a forecast or a record of past floods.',
    ],
    points,
  }
}

export function explainArea(input: AreaInput): AreaExplanation {
  const s = stats(input.grid)
  const { scenario } = input
  let summary: string
  if (!scenario) summary = 'Terrain loaded. Run a rainfall scenario to see where water could collect.'
  else if (scenario.hotspots.length === 0) summary = `With ${whole(scenario.rainfallMm)} mm of rain, no place in this area stands out.`
  else {
    const top = scenario.hotspots[0]
    summary =
      `With ${whole(scenario.rainfallMm)} mm of rain, the model points to ${scenario.hotspots.length} ${scenario.hotspots.length === 1 ? 'place' : 'places'} where water could collect. ` +
      `The strongest is hotspot ${top.rank}, ${position(input.grid, top.peak.index)}.`
  }
  return {
    summary,
    sections: [looking(input, s), where(input), why(input), rain(input, s), confidence(input, s)],
  }
}
