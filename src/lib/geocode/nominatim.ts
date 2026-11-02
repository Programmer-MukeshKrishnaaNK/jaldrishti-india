import { GeocodeError, type Place } from './types'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'

// OSMF policy: an absolute maximum of one request per second across the application.
// Browsers send the page's origin as the Referer, which identifies the application.
const MIN_INTERVAL_MS = 1100

interface NominatimResult {
  osm_type: string
  osm_id: number
  lat: string
  lon: string
  name?: string
  display_name: string
  addresstype?: string
  type?: string
  boundingbox?: [string, string, string, string]
}

let nextSlot = 0
const cache = new Map<string, Place[]>()

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

/** Explicit search via Nominatim, rate-limited and cached per query. */
export async function searchNominatim(text: string, signal?: AbortSignal, limit = 5): Promise<Place[]> {
  const key = text.trim().toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached

  const slot = Math.max(Date.now(), nextSlot)
  nextSlot = slot + MIN_INTERVAL_MS
  await wait(slot - Date.now(), signal)

  const params = new URLSearchParams({
    q: text,
    format: 'jsonv2',
    countrycodes: 'in',
    limit: String(limit),
    'accept-language': 'en',
  })
  let response: Response
  try {
    response = await fetch(`${ENDPOINT}?${params}`, { signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new GeocodeError('The place search service could not be reached.', { cause: error })
  }
  if (response.status === 429) throw new GeocodeError('The place search service is busy. Try again in a moment.')
  if (!response.ok) throw new GeocodeError(`The place search service answered HTTP ${response.status}.`)
  const results = (await response.json()) as NominatimResult[]

  const places = results.map((r) => {
    const [name, ...rest] = r.display_name.split(', ')
    const bb = r.boundingbox?.map(Number)
    return {
      id: `nominatim:${r.osm_type}${r.osm_id}`,
      name: r.name || name,
      context: rest.filter((part) => part !== 'India').slice(0, 3).join(', ') || 'India',
      kind: (r.addresstype ?? r.type ?? 'place').toLowerCase(),
      lng: Number(r.lon),
      lat: Number(r.lat),
      // Nominatim bounding boxes are [south, north, west, east].
      bounds: bb && bb.every(Number.isFinite) ? ([bb[2], bb[0], bb[3], bb[1]] as Place['bounds']) : undefined,
      source: 'nominatim' as const,
    }
  })
  cache.set(key, places)
  return places
}
