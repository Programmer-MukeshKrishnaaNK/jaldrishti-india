// Adds approximate locations to the transcribed waterlogging reports.
// Run with: node scripts/build-incidents.mjs
//
// Each place name is looked up in OpenStreetMap through Nominatim, restricted to the
// Madurai area, at most one request per second. The matched OSM object is recorded so
// every coordinate can be checked; places without a match are kept, unmapped.
// Data © OpenStreetMap contributors (ODbL).

import { readFile, writeFile } from 'node:fs/promises'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'PaaniPulse incident build (https://github.com/Programmer-MukeshKrishnaaNK/pannipulse)'
// West, north, east, south around Madurai city.
const VIEWBOX = '77.98,10.02,78.22,9.84'

// A locality is only mapped when OSM returns a place of this kind. Shops, bus stops or
// roads that share a locality's name are not treated as the locality.
const PLACE_TYPES = new Set(['suburb', 'neighbourhood', 'quarter', 'village', 'hamlet', 'locality', 'city_district'])

const source = JSON.parse(await readFile(new URL('../src/data/incidents-source.json', import.meta.url), 'utf8'))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cache = new Map()

async function locate(name) {
  if (cache.has(name)) return cache.get(name)
  await wait(1100)
  const params = new URLSearchParams({
    q: `${name}, Madurai`,
    format: 'jsonv2',
    countrycodes: 'in',
    viewbox: VIEWBOX,
    bounded: '1',
    limit: '1',
    'accept-language': 'en',
  })
  const response = await fetch(`${ENDPOINT}?${params}`, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) throw new Error(`Nominatim answered HTTP ${response.status} for ${name}`)
  const [hit] = await response.json()
  const result = hit
    ? {
        lat: Number(Number(hit.lat).toFixed(5)),
        lng: Number(Number(hit.lon).toFixed(5)),
        osm: `${hit.osm_type}/${hit.osm_id}`,
        matched: hit.display_name,
        osmType: hit.addresstype ?? hit.type,
      }
    : null
  cache.set(name, result)
  return result
}

const points = []
const unmapped = []
for (const report of source.reports) {
  for (const place of report.places) {
    if (place.kind === 'area') {
      unmapped.push({ reportId: report.id, place: place.name, reason: place.reason })
      console.log(`– ${place.name}: ${place.reason}`)
      continue
    }
    const location = await locate(place.name)
    let reason = null
    if (!location) reason = 'No match in OpenStreetMap within Madurai.'
    else if (place.kind === 'locality' && !PLACE_TYPES.has(location.osmType)) {
      reason = `OpenStreetMap's closest match is a ${location.osmType} (${location.matched.split(',')[0].trim()}), not the locality.`
    }
    if (reason) {
      unmapped.push({ reportId: report.id, place: place.name, reason })
      console.log(`✗ ${place.name}: ${reason}`)
    } else {
      points.push({ reportId: report.id, place: place.name, precision: place.kind, ...location })
      console.log(`✓ ${place.name} → ${location.matched}`)
    }
  }
}

const output = {
  generated: new Date().toISOString().slice(0, 10),
  note: source.note,
  geocoding: 'OpenStreetMap Nominatim, restricted to the Madurai area. © OpenStreetMap contributors, ODbL.',
  reports: source.reports,
  points,
  unmapped,
}
await writeFile(new URL('../src/data/incidents-madurai.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`)
console.log(`Wrote ${points.length} points, ${unmapped.length} unmapped`)
