import type { Bbox } from './bbox'

/** What to show in Google Maps: a point, or a place name when no coordinates are known. */
export type MapsTarget = { lat: number; lng: number } | { name: string }

/**
 * Link to the official Google Maps website using its documented Maps URLs format,
 * which needs no API key: https://developers.google.com/maps/documentation/urls/get-started.
 * Only the coordinates or the place name are sent.
 */
export function googleMapsUrl(target: MapsTarget): string {
  const query = 'name' in target ? target.name : `${target.lat.toFixed(5)},${target.lng.toFixed(5)}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function bboxCentre([west, south, east, north]: Bbox): { lat: number; lng: number } {
  return { lat: (south + north) / 2, lng: (west + east) / 2 }
}
