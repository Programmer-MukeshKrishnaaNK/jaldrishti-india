import { normalise } from './gazetteer'
import type { Place } from './types'

const OSM_TYPE: Record<string, string> = { n: 'node', w: 'way', r: 'relation', node: 'node', way: 'way', relation: 'relation' }

/**
 * The OpenStreetMap object behind a result, written the same way for every source:
 * the bundled list stores "relation/123", Photon "R123" and Nominatim "relation123".
 */
export function osmRef(place: Place): string | null {
  const raw = place.id.slice(place.id.indexOf(':') + 1)
  const match = /^([a-z]+)\/?(\d+)$/i.exec(raw)
  const type = match && OSM_TYPE[match[1].toLowerCase()]
  return type ? `${type}/${match[2]}` : null
}

// The same name this close is one place, however each source classifies it.
const SAME_POINT_M = 50
// Results closer than this, with the same name and kind or description, cannot be told apart in the list.
const SAME_SPOT_M = 250

function distanceM(a: Place, b: Place): number {
  const dy = (a.lat - b.lat) * 111_320
  const dx = (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.hypot(dx, dy)
}

function sameEntry(a: Place, b: Place): boolean {
  const refA = osmRef(a)
  if (refA && refA === osmRef(b)) return true
  if (normalise(a.name) !== normalise(b.name)) return false
  const distance = distanceM(a, b)
  if (distance < SAME_POINT_M) return true
  // Same name nearby: the same place from two sources (same kind), or several OSM objects
  // for one place, such as a station and its platform stops, that the list would show as
  // identical rows (same description).
  return distance < SAME_SPOT_M && (a.kind === b.kind || a.context === b.context)
}

/**
 * Combines suggestion lists, keeping the first of any results that are the same place.
 * Places that only share a name, elsewhere or with a different description, are kept.
 */
export function mergePlaces(primary: Place[], secondary: Place[], limit = 8): Place[] {
  const merged: Place[] = []
  for (const place of [...primary, ...secondary]) {
    if (merged.length >= limit) break
    if (!merged.some((kept) => sameEntry(kept, place))) merged.push(place)
  }
  return merged
}
