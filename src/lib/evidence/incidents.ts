import data from '../../data/incidents-madurai.json'
import type { Bbox } from '../geo/bbox'

export interface IncidentReport {
  id: string
  eventDate: string | null
  eventDateNote: string
  publisher: string
  publishedOn: string
  url: string
  kind: string
  summary: string
}

export interface IncidentPoint {
  reportId: string
  place: string
  precision: 'locality' | 'facility'
  lat: number
  lng: number
  osm: string
  matched: string
}

export const INCIDENT_REPORTS = data.reports as unknown as IncidentReport[]
export const INCIDENT_POINTS = data.points as IncidentPoint[]
export const UNMAPPED_PLACES = data.unmapped as { reportId: string; place: string; reason: string }[]

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export function pointsInside([west, south, east, north]: Bbox): IncidentPoint[] {
  return INCIDENT_POINTS.filter((p) => p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north)
}

export function nearestPoint(at: { lat: number; lng: number }): { point: IncidentPoint; distanceM: number } | null {
  let best: { point: IncidentPoint; distanceM: number } | null = null
  for (const point of INCIDENT_POINTS) {
    const d = distanceM(at, point)
    if (!best || d < best.distanceM) best = { point, distanceM: d }
  }
  return best
}

export function reportFor(id: string): IncidentReport | undefined {
  return INCIDENT_REPORTS.find((r) => r.id === id)
}
