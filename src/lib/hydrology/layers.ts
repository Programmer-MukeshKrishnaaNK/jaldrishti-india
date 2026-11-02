import { hillshade } from '../dem/render'
import type { ElevationGrid } from '../dem/types'
import type { HydroPayload, ScenarioPayload } from '../../workers/hydrologyProtocol'

export type AnalysisLayerId =
  | 'elevation'
  | 'fillDepth'
  | 'direction'
  | 'accumulation'
  | 'hand'
  | 'storage'
  | 'runoff'
  | 'ponding'
  | 'hotspots'

export interface LegendClass {
  /** Inclusive lower bound in the layer's unit. */
  from: number
  label: string
  color: string
}

export interface AnalysisLayer {
  id: AnalysisLayerId
  name: string
  /** Measured source data, derived from it, or the output of a rainfall scenario. */
  kind: 'source' | 'derived' | 'scenario'
  unit: string
  explanation: string
  caveat: string
  classes: LegendClass[]
  /** Description of cells drawn with only the grey hillshade. */
  uncoloured?: string
}

export const ANALYSIS_LAYERS: AnalysisLayer[] = [
  {
    id: 'elevation',
    name: 'Elevation',
    kind: 'source',
    unit: 'm',
    explanation: 'Copernicus GLO-30 heights as loaded, coloured by value.',
    caveat: 'A surface model: roofs, trees and bridges are part of the height.',
    classes: [],
  },
  {
    id: 'fillDepth',
    name: 'Depression filling depth',
    kind: 'derived',
    unit: 'm',
    explanation:
      'How far Priority-Flood raised each cell to remove enclosed hollows: filled level minus measured elevation.',
    caveat: 'Describes the terrain model, not water depth. Bridges and buildings in the data can create false hollows.',
    classes: [
      { from: 0.01, label: '0.01–0.25', color: '#cfe3e0' },
      { from: 0.25, label: '0.25–0.5', color: '#9cc7c1' },
      { from: 0.5, label: '0.5–1', color: '#5fa39b' },
      { from: 1, label: '1–2', color: '#2e7d78' },
      { from: 2, label: '≥ 2', color: '#1a4d4a' },
    ],
    uncoloured: 'Not in a depression',
  },
  {
    id: 'direction',
    name: 'Flow direction',
    kind: 'derived',
    unit: '',
    explanation:
      'The neighbour each cell drains to under D8 (steepest descent over true distance). Lines fade in from the cell and are darkest where they point.',
    caveat: 'Each cell sends all its flow to one neighbour. Drains, culverts and kerbs are not represented.',
    classes: [],
  },
  {
    id: 'accumulation',
    name: 'Flow accumulation',
    kind: 'derived',
    unit: 'km²',
    explanation: 'Ground area whose D8 flow paths pass through each cell, including the cell itself.',
    caveat: 'A terrain-routing measure of upslope area, not measured discharge. Only area inside the selection counts.',
    classes: [
      { from: 10_000, label: '0.01–0.05', color: '#c9ced2' },
      { from: 50_000, label: '0.05–0.1', color: '#9aa3aa' },
      { from: 100_000, label: '0.1–0.5', color: '#5b636b' },
      { from: 500_000, label: '0.5–2', color: '#34404b' },
      { from: 2_000_000, label: '≥ 2', color: '#15202b' },
    ],
    uncoloured: 'Under 0.01 km²',
  },
  {
    id: 'hand',
    name: 'Height above nearest drainage',
    kind: 'derived',
    unit: 'm',
    explanation:
      'Height of each cell above the drainage cell its flow path reaches first. Drainage cells are those whose contributing area meets the threshold.',
    caveat: 'A relative-height index, not a flood depth. It depends on the chosen drainage threshold.',
    classes: [
      { from: 0, label: '0–1', color: '#1a4d4a' },
      { from: 1, label: '1–2', color: '#2e7d78' },
      { from: 2, label: '2–5', color: '#6fa59a' },
      { from: 5, label: '5–10', color: '#a9c4ae' },
      { from: 10, label: '10–20', color: '#d6dcc2' },
      { from: 20, label: '≥ 20', color: '#f3eedd' },
    ],
    uncoloured: 'Leaves the area before reaching drainage',
  },
  {
    id: 'storage',
    name: 'Depression storage',
    kind: 'derived',
    unit: 'm³ per cell',
    explanation: 'Volume below the spill level in each cell: filling depth times the real cell area. Numbers mark the largest depressions.',
    caveat: 'Storage capacity of the terrain model, not water actually present. Hollows behind bridges or buildings may be artefacts.',
    classes: [
      { from: 9, label: '9–100', color: '#f2e2b3' },
      { from: 100, label: '100–250', color: '#e3c473' },
      { from: 250, label: '250–500', color: '#c99a2e' },
      { from: 500, label: '500–1,000', color: '#9a7016' },
      { from: 1000, label: '≥ 1,000', color: '#5e4306' },
    ],
    uncoloured: 'No storage',
  },
  {
    id: 'runoff',
    name: 'Scenario runoff passing',
    kind: 'scenario',
    unit: 'm³',
    explanation:
      'Modelled runoff volume leaving each cell downstream under the chosen rainfall, after depressions upstream have taken what they can hold.',
    caveat: 'An event total from assumed runoff coefficients, not a measured flow. Drains and culverts are not represented.',
    classes: [
      { from: 10, label: '10–100', color: '#d6e6f4' },
      { from: 100, label: '100–1,000', color: '#a8c9e8' },
      { from: 1000, label: '1,000–10,000', color: '#6fa3d4' },
      { from: 10_000, label: '10,000–50,000', color: '#1f6fb5' },
      { from: 50_000, label: '≥ 50,000', color: '#123f69' },
    ],
    uncoloured: 'Under 10 m³',
  },
  {
    id: 'ponding',
    name: 'Modelled ponding depth',
    kind: 'scenario',
    unit: 'm',
    explanation:
      'Depth of water the model holds in terrain hollows under the chosen rainfall, filling each hollow from its lowest cells up to its spill level.',
    caveat: 'A volume balance on a surface model, not a predicted flood depth. Hollows formed by walls, buildings or bridges may not hold water on the ground.',
    classes: [
      { from: 0.01, label: '0.01–0.1', color: '#d6e6f4' },
      { from: 0.1, label: '0.1–0.25', color: '#a8c9e8' },
      { from: 0.25, label: '0.25–0.5', color: '#6fa3d4' },
      { from: 0.5, label: '0.5–1', color: '#1f6fb5' },
      { from: 1, label: '≥ 1', color: '#123f69' },
    ],
    uncoloured: 'No modelled ponding',
  },
  {
    id: 'hotspots',
    name: 'Relative hotspot categories',
    kind: 'scenario',
    unit: '',
    explanation:
      'Screening classes from points for ponding, runoff passing, HAND and slope. Numbers mark the ranked hotspots listed in the panel.',
    caveat: 'Relative to this area and scenario. Not a flood probability or an official risk category.',
    classes: [
      { from: 1, label: 'Moderate relative concentration potential', color: '#e3c473' },
      { from: 2, label: 'Higher relative concentration potential', color: '#8a5a00' },
    ],
    uncoloured: 'Lower relative concentration potential',
  },
]

export const SCENARIO_LAYERS: AnalysisLayerId[] = ['runoff', 'ponding', 'hotspots']

export function analysisLayer(id: AnalysisLayerId): AnalysisLayer {
  return ANALYSIS_LAYERS.find((layer) => layer.id === id)!
}

const hex = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))

function classColour(classes: LegendClass[], value: number): number[] | null {
  for (let k = classes.length - 1; k >= 0; k--) if (value >= classes[k].from) return hex(classes[k].color)
  return null
}

/**
 * Draws a derived layer over a grey hillshade of the measured elevations. Cells with
 * no data stay transparent; cells outside every class show only the hillshade.
 */
export function renderAnalysisLayer(
  id: Exclude<AnalysisLayerId, 'elevation'>,
  grid: ElevationGrid,
  result: HydroPayload,
  scenario: ScenarioPayload | null,
) {
  const shade = hillshade(grid)
  const values: ArrayLike<number> | null =
    id === 'fillDepth'
      ? result.fillDepthM
      : id === 'accumulation'
        ? result.accumulationAreaM2
        : id === 'hand'
          ? result.hand
          : id === 'storage'
            ? result.storageM3
            : id === 'runoff'
              ? (scenario?.passingM3 ?? null)
              : id === 'ponding'
                ? (scenario?.pondDepthM ?? null)
                : id === 'hotspots'
                  ? (scenario?.category.map((c) => (c === 255 ? 0 : c)) ?? null)
                  : null
  const classes = analysisLayer(id).classes
  const rgba = new Uint8ClampedArray(grid.width * grid.height * 4)

  for (let i = 0; i < grid.values.length; i++) {
    if (!Number.isFinite(grid.values[i])) continue
    const grey = 0.62 + 0.38 * shade[i]
    let rgb = [236 * grey, 231 * grey, 220 * grey]
    const v = values ? values[i] : Number.NaN
    if (Number.isFinite(v)) {
      const colour = classColour(classes, v)
      if (colour) rgb = colour.map((c) => c * (0.85 + 0.15 * shade[i]))
    }
    rgba[i * 4] = rgb[0]
    rgba[i * 4 + 1] = rgb[1]
    rgba[i * 4 + 2] = rgb[2]
    rgba[i * 4 + 3] = 255
  }
  return { width: grid.width, height: grid.height, rgba }
}
