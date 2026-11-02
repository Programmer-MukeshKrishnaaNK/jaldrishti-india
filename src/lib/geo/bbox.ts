/** Geographic bounding box in degrees: [west, south, east, north]. */
export type Bbox = [west: number, south: number, east: number, north: number]

export const MAX_AREA_KM2 = 25
export const MIN_AREA_KM2 = 0.25
export const DEFAULT_SIDE_KM = 3

// Approximate extent of India, used only as a coarse first check.
// It is a rectangle, so it also covers parts of neighbouring countries.
export const INDIA_EXTENT: Bbox = [68.0, 6.5, 97.5, 35.7]

const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LON_EQUATOR = 111.32

export function kmPerDegLon(lat: number): number {
  return KM_PER_DEG_LON_EQUATOR * Math.cos((lat * Math.PI) / 180)
}

export function bboxDimensionsKm([west, south, east, north]: Bbox) {
  const midLat = (south + north) / 2
  const widthKm = (east - west) * kmPerDegLon(midLat)
  const heightKm = (north - south) * KM_PER_DEG_LAT
  return { widthKm, heightKm, areaKm2: widthKm * heightKm }
}

/** A square of the given side length centred on a point. */
export function squareAround(lng: number, lat: number, sideKm = DEFAULT_SIDE_KM): Bbox {
  const halfLat = sideKm / 2 / KM_PER_DEG_LAT
  const halfLon = sideKm / 2 / kmPerDegLon(lat)
  return [lng - halfLon, lat - halfLat, lng + halfLon, lat + halfLat]
}

export function bboxFromCorners(a: [number, number], b: [number, number]): Bbox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
}

export function bboxContains([west, south, east, north]: Bbox, lng: number, lat: number): boolean {
  return lng >= west && lng <= east && lat >= south && lat <= north
}

export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
}

export type SelectionProblem =
  | { code: 'INVALID'; message: string }
  | { code: 'TOO_SMALL'; message: string }
  | { code: 'TOO_LARGE'; message: string }
  | { code: 'OUTSIDE_INDIA'; message: string }

export function validateSelection(bbox: Bbox): SelectionProblem | null {
  const [west, south, east, north] = bbox
  const finite = bbox.every(Number.isFinite)
  if (!finite || west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    return { code: 'INVALID', message: 'The selection has invalid coordinates. Draw it again.' }
  }
  const [iw, is, ie, inn] = INDIA_EXTENT
  if (west < iw || east > ie || south < is || north > inn) {
    return {
      code: 'OUTSIDE_INDIA',
      message: 'Part of this selection lies outside the region PaaniPulse supports. Select an area within India.',
    }
  }
  const { areaKm2 } = bboxDimensionsKm(bbox)
  if (areaKm2 > MAX_AREA_KM2) {
    return {
      code: 'TOO_LARGE',
      message: `This area is ${areaKm2.toFixed(1)} km². The limit is ${MAX_AREA_KM2} km², which keeps analysis fast in the browser.`,
    }
  }
  if (areaKm2 < MIN_AREA_KM2) {
    return {
      code: 'TOO_SMALL',
      message: `This area is ${areaKm2.toFixed(2)} km². Select at least ${MIN_AREA_KM2} km² so the terrain is meaningful.`,
    }
  }
  return null
}
