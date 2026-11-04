import { describe, expect, it } from 'vitest'
import { bboxCentre, googleMapsUrl } from './googleMaps'

describe('googleMapsUrl', () => {
  it('opens a point on the official Google Maps site without a key', () => {
    const url = googleMapsUrl({ lat: 9.925201, lng: 78.119775 })
    expect(url).toBe('https://www.google.com/maps/search/?api=1&query=9.92520%2C78.11978')
    expect(url).not.toMatch(/key=/)
  })

  it('falls back to an encoded place name', () => {
    expect(googleMapsUrl({ name: 'Tamil Nadu, India' })).toBe('https://www.google.com/maps/search/?api=1&query=Tamil%20Nadu%2C%20India')
  })
})

describe('bboxCentre', () => {
  it('returns the middle of the area', () => {
    const centre = bboxCentre([78.1, 9.9, 78.2, 10])
    expect(centre.lat).toBeCloseTo(9.95, 9)
    expect(centre.lng).toBeCloseTo(78.15, 9)
  })
})
