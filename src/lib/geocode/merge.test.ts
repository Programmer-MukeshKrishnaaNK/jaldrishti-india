import { describe, expect, it } from 'vitest'
import { mergePlaces, osmRef } from './merge'
import type { Place } from './types'

// Records as the bundled list, Photon and Nominatim return them (checked against live Photon, Nov 2026).
const place = (p: Partial<Place> & Pick<Place, 'id' | 'name' | 'lat' | 'lng'>): Place => ({
  context: 'India',
  kind: 'city',
  source: 'photon',
  ...p,
})

const maduraiCity = place({ id: 'gazetteer:node/1254628537', name: 'Madurai', context: 'City', lat: 9.92612, lng: 78.1141, source: 'gazetteer' })
const maduraiDistrict = place({ id: 'gazetteer:relation/1819275', name: 'Madurai', context: 'District', kind: 'district', lat: 9.93674, lng: 77.96859, source: 'gazetteer' })
const photonMaduraiCity = place({ id: 'photon:R11268397', name: 'Madurai', context: 'Madurai South, Tamil Nadu', lat: 9.9261, lng: 78.1141 })
const photonMaduraiDistrict = place({ id: 'photon:R1819275', name: 'Madurai', context: 'Tamil Nadu', kind: 'county', lat: 9.9369, lng: 78.0078 })
const maduraiHotel = place({ id: 'photon:W801862876', name: 'Madurai', context: 'Thrissur, Kerala', kind: 'house', lat: 10.544, lng: 76.2134 })
const guwahatiStation = place({ id: 'photon:N2669094329', name: 'Guwahati', context: 'Paltan Bazaar, Assam', kind: 'house', lat: 26.1824, lng: 91.7501 })
const platformStops = [26.1821, 26.1817, 26.182, 26.1819].map((lat, i) =>
  place({ id: `photon:N71107768${i}`, name: 'Guwahati', context: 'Paltan Bazaar, Assam', kind: 'house', lat, lng: 91.7502 }),
)
const guwahatiCity = place({ id: 'gazetteer:node/566672802', name: 'Guwahati', context: 'City', lat: 26.1806, lng: 91.75394, source: 'gazetteer' })

describe('osmRef', () => {
  it('writes every source’s OSM reference the same way', () => {
    expect(osmRef(maduraiDistrict)).toBe('relation/1819275')
    expect(osmRef(photonMaduraiDistrict)).toBe('relation/1819275')
    expect(osmRef(place({ id: 'nominatim:relation1819275', name: 'Madurai', lat: 0, lng: 0 }))).toBe('relation/1819275')
    expect(osmRef(place({ id: 'hotspot-1', name: 'x', lat: 0, lng: 0 }))).toBeNull()
  })
})

describe('mergePlaces', () => {
  it('drops a live result for the same OSM object even when its coordinates differ', () => {
    const merged = mergePlaces([maduraiCity, maduraiDistrict], [photonMaduraiCity, photonMaduraiDistrict, maduraiHotel])
    expect(merged.map((p) => p.id)).toEqual([maduraiCity.id, maduraiDistrict.id, maduraiHotel.id])
  })

  it('collapses objects that would show as identical rows at the same spot', () => {
    const merged = mergePlaces([guwahatiCity], [guwahatiStation, ...platformStops])
    expect(merged.map((p) => p.id)).toEqual([guwahatiCity.id, guwahatiStation.id])
  })

  it('merges one city that two sources place at the same point but classify differently', () => {
    const chennai = place({ id: 'gazetteer:node/3233393892', name: 'Chennai', context: 'City', lat: 13.08009, lng: 80.2808, source: 'gazetteer' })
    const photonChennai = place({ id: 'photon:R1766358', name: 'Chennai', context: 'Chennai District, Tamil Nadu', kind: 'district', lat: 13.0801, lng: 80.2808 })
    expect(mergePlaces([chennai], [photonChennai])).toEqual([chennai])
  })

  it('keeps places that share a name but are elsewhere or described differently', () => {
    const elsewhere = place({ ...guwahatiStation, id: 'photon:N1', lat: 26.3, lng: 91.9 })
    const ropeway = place({ id: 'photon:W1221400150', name: 'Guwahati', context: 'Pan Bazar, Assam', kind: 'house', lat: 26.1898, lng: 91.7466 })
    expect(mergePlaces([guwahatiCity], [guwahatiStation, elsewhere, ropeway])).toHaveLength(4)
  })

  it('stops at the limit and keeps the order of the sources', () => {
    const many = Array.from({ length: 12 }, (_, i) => place({ id: `photon:N${i}`, name: `Place ${i}`, lat: 10 + i, lng: 78 }))
    const merged = mergePlaces(many.slice(0, 3), many.slice(3))
    expect(merged).toHaveLength(8)
    expect(merged[0].id).toBe('photon:N0')
  })
})
