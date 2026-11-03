// Checks which Google 3D APIs the local key can reach. Reads VITE_GOOGLE_MAPS_DEMO_KEY from
// .env.development.local and prints only HTTP status and Google's error text, never the key.
// Each run makes at most two requests; the Map Tiles root request counts as one root tileset request.
import { readFileSync } from 'node:fs'

let key
try {
  const env = readFileSync(new URL('../.env.development.local', import.meta.url), 'utf8')
  key = env.match(/^VITE_GOOGLE_MAPS_DEMO_KEY=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
} catch {
  // Reported below.
}
if (!key) {
  console.log('No VITE_GOOGLE_MAPS_DEMO_KEY in .env.development.local; nothing tested.')
  process.exit(1)
}
const redact = (text) => text.split(key).join('[key]')

async function check(name, url) {
  try {
    const response = await fetch(url)
    const body = await response.text()
    let detail = ''
    if (!response.ok) {
      try {
        detail = JSON.parse(body).error?.message ?? ''
      } catch {
        detail = body.slice(0, 200)
      }
    }
    console.log(`${name}: HTTP ${response.status}${detail ? ` — ${redact(detail)}` : ''}`)
    return response.ok
  } catch (error) {
    console.log(`${name}: request failed — ${redact(String(error))}`)
    return false
  }
}

const js = await check(
  'Maps JavaScript API (script)',
  `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=beta&libraries=maps3d`,
)
const tiles = await check(
  'Map Tiles API — Photorealistic 3D Tiles root',
  `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`,
)
console.log('Note: the Maps JavaScript script returns 200 even for restricted keys; key errors surface in the browser.')
process.exit(js || tiles ? 0 : 1)
