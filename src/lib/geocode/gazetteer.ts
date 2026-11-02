import type { Place } from './types'

interface GazetteerEntry {
  n: string
  k: 'state' | 'district' | 'city' | 'town'
  y: number
  x: number
  p?: number
  o: string
}

interface IndexedEntry extends GazetteerEntry {
  key: string
  words: string[]
}

const KIND_LABEL: Record<GazetteerEntry['k'], string> = {
  state: 'State or union territory',
  district: 'District',
  city: 'City',
  town: 'Town',
}

export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let index: Promise<IndexedEntry[]> | null = null

/** Loads the bundled gazetteer on first use; it is split into its own chunk. */
export function loadGazetteer(): Promise<IndexedEntry[]> {
  index ??= import('../../data/gazetteer-in.json').then((module) =>
    (module.default.places as GazetteerEntry[]).map((entry) => {
      const key = normalise(entry.n)
      return { ...entry, key, words: key.split(' ') }
    }),
  )
  return index
}

function score(entry: IndexedEntry, query: string): number {
  if (entry.key === query) return 0
  if (entry.key.startsWith(query)) return 1
  if (entry.words.some((word) => word.startsWith(query))) return 2
  return -1
}

/** Prefix search over states, districts, cities and larger towns of India. */
export async function searchGazetteer(text: string, limit = 5): Promise<Place[]> {
  const query = normalise(text)
  if (query.length < 2) return []
  const entries = await loadGazetteer()
  const kindOrder = { state: 0, city: 1, district: 2, town: 3 }
  return entries
    .map((entry) => ({ entry, rank: score(entry, query) }))
    .filter(({ rank }) => rank >= 0)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        kindOrder[a.entry.k] - kindOrder[b.entry.k] ||
        (b.entry.p ?? 0) - (a.entry.p ?? 0),
    )
    .slice(0, limit)
    .map(({ entry }) => ({
      id: `gazetteer:${entry.o}`,
      name: entry.n,
      context: KIND_LABEL[entry.k],
      kind: entry.k,
      lng: entry.x,
      lat: entry.y,
      source: 'gazetteer' as const,
    }))
}
