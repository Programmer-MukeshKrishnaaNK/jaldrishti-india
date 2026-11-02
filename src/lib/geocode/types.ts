import type { Bbox } from '../geo/bbox'

export type PlaceSource = 'gazetteer' | 'photon' | 'nominatim'

export interface Place {
  id: string
  name: string
  /** Short description of where the place is or what it is, e.g. "District · Tamil Nadu". */
  context: string
  /** OSM place type or administrative level, lowercased. */
  kind: string
  lng: number
  lat: number
  bounds?: Bbox
  source: PlaceSource
}

// Kinds that describe a whole region rather than somewhere to analyse directly.
const REGION_KINDS = new Set(['state', 'district', 'county', 'state_district', 'region', 'country', 'province'])

export function isRegion(place: Place): boolean {
  return REGION_KINDS.has(place.kind)
}

export class GeocodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GeocodeError'
  }
}
