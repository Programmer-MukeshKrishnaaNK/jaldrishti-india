import type { Bbox } from '../geo/bbox'
import { DemError, isAbort } from './errors'

const PC_API = 'https://planetarycomputer.microsoft.com/api'

// Renew a little before the stated expiry so a long read does not cross it.
const TOKEN_MARGIN_MS = 2 * 60 * 1000

export interface StacItem {
  id: string
  bbox: number[]
  properties: Record<string, unknown> & {
    'proj:shape'?: [number, number]
    'proj:transform'?: number[]
  }
  assets: Record<string, { href: string; type?: string }>
}

async function getJson<T>(url: string, signal: AbortSignal | undefined, what: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (isAbort(error)) throw new DemError('ABORTED', 'The request was cancelled.')
    throw new DemError('NETWORK', `Could not reach the Planetary Computer ${what}.`, { cause: error })
  }
  if (!response.ok) {
    throw new DemError(
      response.status === 429 ? 'NETWORK' : what === 'signing service' ? 'SIGNING' : 'NETWORK',
      response.status === 429
        ? `The Planetary Computer ${what} is rate-limiting requests. Try again shortly.`
        : `The Planetary Computer ${what} answered HTTP ${response.status}.`,
    )
  }
  return (await response.json()) as T
}

/** Items of a STAC collection that intersect the bounding box. */
export async function searchItems(collection: string, bbox: Bbox, signal?: AbortSignal): Promise<StacItem[]> {
  const params = new URLSearchParams({ collections: collection, bbox: bbox.join(','), limit: '10' })
  const result = await getJson<{ features: StacItem[] }>(`${PC_API}/stac/v1/search?${params}`, signal, 'catalogue')
  return result.features
}

interface CachedToken {
  token: string
  expiresAt: number
}

const tokens = new Map<string, CachedToken>()

/**
 * Appends a shared-access token to an Azure Blob URL. Tokens are issued per
 * storage account and container, anonymously, and cached until near expiry.
 */
export async function signHref(href: string, signal?: AbortSignal, forceRefresh = false): Promise<string> {
  const url = new URL(href)
  const account = url.hostname.split('.')[0]
  const container = url.pathname.split('/')[1]
  const key = `${account}/${container}`

  let cached = tokens.get(key)
  if (forceRefresh || !cached || cached.expiresAt - TOKEN_MARGIN_MS < Date.now()) {
    const issued = await getJson<{ token: string; 'msft:expiry': string }>(
      `${PC_API}/sas/v1/token/${key}`,
      signal,
      'signing service',
    )
    cached = { token: issued.token, expiresAt: Date.parse(issued['msft:expiry']) }
    tokens.set(key, cached)
  }
  url.search = cached.token
  return url.toString()
}
