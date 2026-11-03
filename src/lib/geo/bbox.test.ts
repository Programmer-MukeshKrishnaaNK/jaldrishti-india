import { describe, expect, it } from 'vitest'
import { bboxDimensionsKm, MAX_AREA_KM2, MIN_AREA_KM2, squareAround, validateSelection, type Bbox } from './bbox'

const MADURAI: [number, number] = [78.1141, 9.92612]
const GUWAHATI: [number, number] = [91.75394, 26.1806]

describe('analysis area validation', () => {
  it('accepts the default 3 × 3 km square in Madurai and Guwahati', () => {
    for (const [lng, lat] of [MADURAI, GUWAHATI]) {
      const box = squareAround(lng, lat)
      expect(validateSelection(box)).toBeNull()
      expect(bboxDimensionsKm(box).areaKm2).toBeCloseTo(9, 6)
    }
  })

  it('accepts an area at the 25 km² limit and refuses one just above it', () => {
    for (const [lng, lat] of [MADURAI, GUWAHATI]) {
      expect(validateSelection(squareAround(lng, lat, Math.sqrt(MAX_AREA_KM2) - 1e-6))).toBeNull()
      expect(validateSelection(squareAround(lng, lat, Math.sqrt(MAX_AREA_KM2 + 0.1)))?.code).toBe('TOO_LARGE')
    }
  })

  it('refuses areas below the minimum', () => {
    expect(validateSelection(squareAround(...MADURAI, Math.sqrt(MIN_AREA_KM2) + 1e-6))).toBeNull()
    expect(validateSelection(squareAround(...MADURAI, 0.4))?.code).toBe('TOO_SMALL')
  })

  it('refuses areas outside the supported region', () => {
    expect(validateSelection(squareAround(55.27, 25.2))?.code).toBe('OUTSIDE_INDIA')
    // Straddling the southern edge of the supported extent.
    expect(validateSelection([77, 6.48, 77.02, 6.5])?.code).toBe('OUTSIDE_INDIA')
  })

  it('refuses malformed boxes', () => {
    const bad: Bbox[] = [
      [78.2, 9.9, 78.1, 9.95],
      [78.1, 9.95, 78.2, 9.9],
      [Number.NaN, 9.9, 78.2, 9.95],
      [78.1, 9.9, Number.POSITIVE_INFINITY, 9.95],
    ]
    for (const box of bad) expect(validateSelection(box)?.code).toBe('INVALID')
  })
})
