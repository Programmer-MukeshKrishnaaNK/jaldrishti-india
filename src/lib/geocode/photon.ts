import { INDIA_EXTENT } from '../geo/bbox'
import { GeocodeError, type Place } from './types'

const ENDPOINT = 'https://photon.komoot.io/api/'

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_type?: string
    osm_id?: number
    name?: string
    type?: string
    osm_value?: string
    countrycode?: string
    city?: string
    district?: string
    county?: string
    state?: string
    extent?: [number, number, number, number]
  }
}

/** Type-ahead suggestions from Photon, restricted to places in India. */
export async function searchPhoton(text: string, signal?: AbortSignal, limit = 6): Promise<Place[]> {
  const params = new URLSearchParams({
    q: text,
    limit: String(limit * 2),
    lang: 'en',
    bbox: INDIA_EXTENT.join(','),
  })
  let response: Response
  try {
    response = await fetch(`${ENDPOINT}?${params}`, { signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new GeocodeError('The suggestion service could not be reached.', { cause: error })
  }
  if (!response.ok) throw new GeocodeError(`The suggestion service answered HTTP ${response.status}.`)
  const { features } = (await response.json()) as { features: PhotonFeature[] }

  return features
    .filter((f) => f.properties.countrycode === 'IN' && f.properties.name)
    .slice(0, limit)
    .map((f) => {
      const p = f.properties
      const [lng, lat] = f.geometry.coordinates
      const kind = (p.type ?? p.osm_value ?? 'place').toLowerCase()
      const context = [p.city !== p.name ? p.city : undefined, p.district ?? p.county, p.state]
        .filter((part, i, all) => part && part !== p.name && all.indexOf(part) === i)
        .join(', ')
      return {
        id: `photon:${p.osm_type}${p.osm_id}`,
        name: p.name!,
        context: context || 'India',
        kind,
        lng,
        lat,
        // Photon extents are [west, north, east, south].
        bounds: p.extent ? [p.extent[0], p.extent[3], p.extent[2], p.extent[1]] : undefined,
        source: 'photon' as const,
      }
    })
}
