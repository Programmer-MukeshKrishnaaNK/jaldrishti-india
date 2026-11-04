// Builds src/data/gazetteer-in.json from OpenStreetMap via the public Overpass API.
// Run occasionally with: node scripts/build-gazetteer.mjs
// Data © OpenStreetMap contributors, available under the Open Database License (ODbL).

import { writeFile } from 'node:fs/promises'

const ENDPOINT = 'https://overpass-api.de/api/interpreter'
const USER_AGENT = 'PaaniPulse gazetteer build (https://github.com/Programmer-MukeshKrishnaaNK/pannipulse)'

// States and union territories (admin level 4), districts (level 5), and cities and
// larger towns. Towns are limited to those with a recorded population of 50,000+.
const QUERY = `
[out:json][timeout:180];
area["ISO3166-1"="IN"][admin_level=2]->.in;
(
  relation["boundary"="administrative"]["admin_level"="4"](area.in);
  relation["boundary"="administrative"]["admin_level"="5"](area.in);
  node["place"="city"](area.in);
  node["place"="town"]["population"](if: number(t["population"]) >= 50000)(area.in);
);
out center tags;
`

const KIND = { 4: 'state', 5: 'district' }

function nameOf(tags) {
  return (tags['name:en'] || tags.name || '').trim()
}

const response = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ data: QUERY }),
})
if (!response.ok) throw new Error(`Overpass answered HTTP ${response.status}`)
const { elements } = await response.json()

const seen = new Set()
const places = []
for (const el of elements) {
  const tags = el.tags ?? {}
  const name = nameOf(tags)
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (!name || lat === undefined || lon === undefined) continue
  const kind = el.type === 'relation' ? KIND[tags.admin_level] : tags.place
  const key = `${kind}:${name}:${lat.toFixed(2)}:${lon.toFixed(2)}`
  if (seen.has(key)) continue
  seen.add(key)
  const population = Number.parseInt(String(tags.population ?? '').replace(/[^0-9]/g, ''), 10)
  places.push({
    n: name,
    k: kind,
    y: Number(lat.toFixed(5)),
    x: Number(lon.toFixed(5)),
    ...(Number.isFinite(population) && population > 0 ? { p: population } : {}),
    o: `${el.type}/${el.id}`,
  })
}

const order = { state: 0, city: 1, district: 2, town: 3 }
places.sort((a, b) => order[a.k] - order[b.k] || (b.p ?? 0) - (a.p ?? 0) || a.n.localeCompare(b.n))

const output = {
  source: 'OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright',
  generated: new Date().toISOString().slice(0, 10),
  note: 'Coordinates are OSM place nodes or the centre of boundary relations, not official capitals.',
  places,
}
await writeFile(new URL('../src/data/gazetteer-in.json', import.meta.url), JSON.stringify(output))

const counts = places.reduce((acc, p) => ({ ...acc, [p.k]: (acc[p.k] ?? 0) + 1 }), {})
console.log(`Wrote ${places.length} places`, counts)
