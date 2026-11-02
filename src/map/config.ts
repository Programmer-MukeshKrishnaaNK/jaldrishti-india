import type { LngLatBoundsLike, LngLatLike } from 'maplibre-gl'

export const BASEMAP = {
  name: 'OpenFreeMap Liberty',
  styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  homepage: 'https://openfreemap.org',
} as const

// Opening view: mainland India with the islands in frame on wider screens.
export const INDIA_VIEW: { bounds: LngLatBoundsLike; center: LngLatLike; zoom: number } = {
  bounds: [
    [68.0, 6.5],
    [97.5, 35.7],
  ],
  center: [80.5, 22.5],
  zoom: 4,
}

// A style that has not loaded by now is treated as unavailable.
export const STYLE_TIMEOUT_MS = 15_000
