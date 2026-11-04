import { describe, expect, it } from 'vitest'
import type { ElevationGrid } from '../dem/types'
import type { Hotspot } from '../hydrology/hotspots'
import type { ScenarioSummary } from '../hydrology/scenario'
import { WORLDCOVER_CLASSES } from '../landcover/classes'
import { depth, explainArea, type AreaInput, type AreaLandCover } from './area'

const ARC = 1 / 3600
const W = 30
const H = 30

function grid(): ElevationGrid {
  const values = new Float32Array(W * H)
  // 120 m in the north-west rising to 149 m in the south-east corner.
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) values[r * W + c] = 120 + (r + c) / 2
  return {
    width: W,
    height: H,
    bounds: [78.1, 9.9, 78.1 + W * ARC, 9.9 + H * ARC],
    crs: 'EPSG:4326',
    values,
    source: { id: 'copernicus-glo30', name: 'Copernicus DEM GLO-30', spacingM: 30, accuracy: '', attribution: '', url: '' },
    provenance: [],
    fetchedAt: '',
  }
}

function hotspot(rank: number, index: number, overrides: Partial<Hotspot> = {}, peak: Partial<Hotspot['peak']> = {}): Hotspot {
  return {
    rank,
    category: rank === 1 ? 'higher' : 'moderate',
    cells: 4,
    areaM2: 3600,
    centreRow: Math.floor(index / W),
    centreCol: index % W,
    peak: {
      index,
      points: 6,
      criteria: { ponding: 2, runoff: 2, hand: 2, flat: 0 },
      elevationM: 125,
      pondDepthM: 0.62,
      passingM3: 900,
      contributingAreaM2: 420_000,
      handM: 0.8,
      slopePct: 2.4,
      ...peak,
    },
    maxPondDepthM: 0.62,
    pondedVolumeM3: 1500,
    depressionRanks: [1],
    flags: { nearEdge: false, deepHollow: false, onWater: false, besideWater: false, missingLandCover: false },
    confidence: 'standard',
    ...overrides,
  }
}

function summary(rainfallMm: number, storedM3: number, hotspotCount: number): ScenarioSummary {
  return {
    rainfallMm,
    generatedM3: 40_000 * (rainfallMm / 100),
    storedM3,
    exitedM3: 40_000 * (rainfallMm / 100) - storedM3,
    residualM3: 0,
    meanCoefficient: 0.62,
    missingCoefficientCells: 0,
    depressionsReached: 3,
    depressionsSpilling: 1,
    higherCells: 10,
    moderateCells: 20,
    higherAreaM2: 9000,
    hotspotCount,
    higherHotspotCount: 1,
    ms: 1,
  }
}

/** Every cell built-up except one tree cell at index 0. */
function landCover(): AreaLandCover {
  const n = W * H
  const counts = new Uint16Array(WORLDCOVER_CLASSES.length * n)
  const built = WORLDCOVER_CLASSES.findIndex((c) => c.code === 50)
  const trees = WORLDCOVER_CLASSES.findIndex((c) => c.code === 10)
  for (let i = 1; i < n; i++) counts[built * n + i] = 9
  counts[trees * n] = 9
  const classShare = WORLDCOVER_CLASSES.map(() => 0)
  classShare[built] = 0.7
  classShare[trees] = 0.3
  return { grid: { width: W, height: H, counts, missing: new Uint16Array(n), provenance: [] }, classShare, missingShare: 0 }
}

const NW = 2 * W + 2 // row 2, column 2
const CENTRE = 15 * W + 15
const hotspots = [hotspot(1, NW), hotspot(2, CENTRE, { maxPondDepthM: 0, depressionRanks: [] }, { criteria: { ponding: 0, runoff: 1, hand: 0, flat: 1 }, pondDepthM: 0 }), hotspot(3, 28 * W + 28)]

function input(overrides: Partial<AreaInput> = {}): AreaInput {
  return {
    areaLabel: 'around Madurai',
    grid: grid(),
    landCover: landCover(),
    uniformCoefficient: null,
    scenario: {
      rainfallMm: 100,
      summary: summary(100, 12_345, 3),
      comparison: [summary(50, 6_000, 2), summary(100, 12_345, 3), summary(150, 18_000, 5)],
      hotspots,
      fills: [{ rank: 1, status: 'spilling' } as never],
      outdated: false,
    },
    chosenRainfallMm: 100,
    selected: null,
    view: '2d',
    ...overrides,
  }
}

const section = (e: ReturnType<typeof explainArea>, id: string) => e.sections.find((s) => s.id === id)!
const text = (e: ReturnType<typeof explainArea>, id: string) => {
  const s = section(e, id)
  return [...s.paragraphs, ...(s.points ?? []), ...(s.notes ?? [])].join(' ')
}

describe('depth', () => {
  it('uses centimetres under a metre and metres above', () => {
    expect(depth(0.62)).toBe('about 62 cm')
    expect(depth(0.004)).toBe('about 1 cm')
    expect(depth(1.24)).toBe('about 1.2 m')
  })
})

describe('explainArea', () => {
  it('answers all five questions in order', () => {
    expect(explainArea(input()).sections.map((s) => s.question)).toEqual([
      'What am I looking at?',
      'Where might water collect?',
      'Why here?',
      'What does the rainfall scenario mean?',
      'How confident is this result?',
    ])
  })

  it('describes the area from its own elevation values', () => {
    const t = text(explainArea(input()), 'looking')
    expect(t).toContain('around Madurai')
    expect(t).toContain('between 120 m and 149 m')
    expect(t).toContain('100 mm of rain')
  })

  it('asks for a scenario before describing water', () => {
    const e = explainArea(input({ scenario: null }))
    expect(e.summary).toContain('Run a rainfall scenario')
    expect(text(e, 'where')).toContain('Run a rainfall scenario first')
    expect(text(e, 'rain')).not.toContain('m³')
  })

  it('names the strongest hotspots with their position and what the model found', () => {
    const e = explainArea(input())
    expect(e.summary).toContain('3 places')
    expect(e.summary).toContain('hotspot 1, in the north-west of the area')
    const points = section(e, 'where').points!
    expect(points[0]).toBe('Hotspot 1 (stands out more), in the north-west of the area: a dip in the ground that may hold water about 62 cm deep.')
    expect(points[1]).toContain('near the centre of the area: a low path that water from about 0.42 km² of land drains through')
    expect(text(e, 'where')).toContain('not a report of real flooding')
  })

  it('explains the top hotspot until another is chosen, using only criteria that scored', () => {
    const top = text(explainArea(input()), 'why')
    expect(top).toContain('Hotspot 1, the strongest')
    expect(top).toContain('up to about 62 cm deep, and then overflows')
    expect(top).toContain('about 0.42 km² of higher ground')
    expect(top).toContain('about 80 cm above the nearest natural drainage line')
    expect(top).not.toContain('almost flat')
    expect(top).toContain('mostly built-up')

    const chosen = text(explainArea(input({ selected: hotspots[1] })), 'why')
    expect(chosen).toContain('Hotspot 2, near the centre')
    expect(chosen).toContain('almost flat here (a 2.4% slope)')
    expect(chosen).not.toContain('shallow bowl')
  })

  it('states data cautions for a hotspot in plain words', () => {
    const odd = hotspot(1, NW, { flags: { nearEdge: true, deepHollow: true, onWater: false, besideWater: true, missingLandCover: false } })
    const t = text(explainArea(input({ selected: odd })), 'why')
    expect(t).toContain('wall, building, embankment or bridge')
    expect(t).toContain('next to a river, lake or tank')
    expect(t).toContain('edge of the selected area')
  })

  it('explains rainfall with the IMD category and the model’s own volumes', () => {
    const t = text(explainArea(input()), 'rain')
    expect(t).toContain('100 mm of rain is a layer of water 10 cm deep')
    expect(t).toContain('would call it heavy rain')
    expect(t).toContain('about 62% of it would run across the surface')
    expect(t).toContain('70% of the area is built-up')
    expect(t).toContain('about 12,345 m³')
    expect(t).toContain('50 mm: about 6,000 m³ held in low spots, 2 hotspots')
    expect(t).toContain('100 mm: about 12,345 m³ held in low spots, 3 hotspots (shown)')
    expect(explainArea(input({ scenario: { ...input().scenario!, rainfallMm: 150, summary: summary(150, 18_000, 5) }, chosenRainfallMm: 150 })).sections[3].paragraphs[0]).toContain(
      'very heavy rain',
    )
  })

  it('points out a chosen rainfall that has not been run yet', () => {
    expect(text(explainArea(input({ chosenRainfallMm: 150 })), 'rain')).toContain('You have chosen 150 mm; run the scenario again')
  })

  it('does not credit land cover when one runoff share is used everywhere', () => {
    const e = explainArea(input({ uniformCoefficient: 0.5 }))
    expect(text(e, 'rain')).not.toContain('built-up')
    expect(text(e, 'why')).not.toContain('built-up')
    expect(text(e, 'confidence')).toContain('same runoff share (50%) is used everywhere')
  })

  it('is clear about what the result is and is not', () => {
    const e = explainArea(input({ scenario: { ...input().scenario!, outdated: true } }))
    const t = text(e, 'confidence')
    expect(t).toContain('not for predicting real flooding')
    expect(t).toContain('Copernicus DEM GLO-30, with one value every 30 m')
    expect(t).toContain('Drains, culverts and channels')
    expect(t).toContain('run it again')
  })

  it('handles a scenario with no hotspots', () => {
    const e = explainArea(input({ scenario: { ...input().scenario!, hotspots: [] } }))
    expect(e.summary).toContain('no place in this area stands out')
    expect(text(e, 'why')).toContain('no hotspots to explain')
  })
})
