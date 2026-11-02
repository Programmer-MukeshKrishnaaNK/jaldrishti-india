import type { FeatureCollection } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Bbox } from '../lib/geo/bbox'

export const SOURCES = {
  selection: 'pp-selection',
  draft: 'pp-draft',
  terrain: 'pp-terrain',
} as const

export const LAYERS = {
  terrain: 'pp-terrain',
  selectionHalo: 'pp-selection-halo',
  selectionLine: 'pp-selection-line',
  draftLine: 'pp-draft-line',
} as const

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

export function bboxFeature([west, south, east, north]: Bbox): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      },
    ],
  }
}

export function imageCorners([west, south, east, north]: Bbox): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ]
}

/**
 * The layer to insert overlays beneath: the first label after the last basemap
 * geometry layer. Some labels come early in the style, so the first symbol layer
 * would leave roads and bridges drawn over the overlay.
 */
function labelsAboveGeometry(map: MapLibreMap): string | undefined {
  const layers = map.getStyle().layers.filter((layer) => !layer.id.startsWith('pp-'))
  const lastGeometry = layers.findLastIndex((layer) => layer.type !== 'symbol')
  return layers[lastGeometry + 1]?.id
}

/** Adds PaaniPulse's own sources and layers once the basemap style has loaded. */
export function addOverlayLayers(map: MapLibreMap): void {
  const ink = '#15202b'
  const silt = '#f1ede4'

  map.addSource(SOURCES.selection, { type: 'geojson', data: EMPTY })
  map.addSource(SOURCES.draft, { type: 'geojson', data: EMPTY })

  map.addLayer({
    id: LAYERS.selectionHalo,
    type: 'line',
    source: SOURCES.selection,
    paint: { 'line-color': silt, 'line-width': 6, 'line-opacity': 0.9 },
  })
  map.addLayer({
    id: LAYERS.selectionLine,
    type: 'line',
    source: SOURCES.selection,
    paint: { 'line-color': ink, 'line-width': 2 },
  })
  map.addLayer({
    id: LAYERS.draftLine,
    type: 'line',
    source: SOURCES.draft,
    paint: { 'line-color': ink, 'line-width': 1.5, 'line-dasharray': [2, 2] },
  })
}

export function setTerrainImage(map: MapLibreMap, image: { url: string; bounds: Bbox } | null): void {
  if (map.getLayer(LAYERS.terrain)) map.removeLayer(LAYERS.terrain)
  if (map.getSource(SOURCES.terrain)) map.removeSource(SOURCES.terrain)
  if (!image) return
  map.addSource(SOURCES.terrain, { type: 'image', url: image.url, coordinates: imageCorners(image.bounds) })
  map.addLayer(
    {
      id: LAYERS.terrain,
      type: 'raster',
      source: SOURCES.terrain,
      // Nearest-neighbour keeps each DEM cell visible as a cell rather than smoothing it.
      paint: { 'raster-opacity': 0.9, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
    },
    labelsAboveGeometry(map),
  )
}

export { EMPTY as EMPTY_FEATURES }
