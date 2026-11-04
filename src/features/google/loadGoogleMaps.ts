/**
 * Loads the Google Maps JavaScript API once per page and returns the libraries the
 * Google views use. The key comes only from VITE_GOOGLE_MAPS_DEMO_KEY at build time.
 */

export type GoogleLoadError =
  | { code: 'NO_KEY'; message: string }
  | { code: 'AUTH'; message: string }
  | { code: 'NETWORK'; message: string }
  | { code: 'UNSUPPORTED'; message: string }

type Ctor = new (options?: Record<string, unknown>) => HTMLElement & Record<string, unknown>

/** The parts of the maps, marker and maps3d libraries the Google views use. */
export interface GoogleLibraries {
  maps: { Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap; Polygon: new (options: Record<string, unknown>) => GoogleShape; Polyline: new (options: Record<string, unknown>) => GoogleShape }
  marker: { AdvancedMarkerElement: new (options: Record<string, unknown>) => GoogleMarker; PinElement: new (options: Record<string, unknown>) => { element: HTMLElement } & HTMLElement }
  maps3d: { Map3DElement: Ctor; Polygon3DElement: Ctor; Polyline3DElement: Ctor; Marker3DElement: Ctor; Marker3DInteractiveElement?: Ctor }
}

export interface GoogleMap {
  fitBounds: (bounds: { north: number; south: number; east: number; west: number }, padding?: number) => void
  panTo: (position: { lat: number; lng: number }) => void
  setCenter: (position: { lat: number; lng: number }) => void
  setZoom: (zoom: number) => void
  getZoom: () => number | undefined
}

export interface GoogleShape {
  setMap: (map: GoogleMap | null) => void
}

export interface GoogleMarker extends HTMLElement {
  map: GoogleMap | null
}

type GoogleGlobal = { maps: { importLibrary: (name: string) => Promise<unknown> } }
type Win = Window & { google?: GoogleGlobal; gm_authFailure?: () => void; __ppMapsReady?: () => void }

export function googleMapsKey(): string | undefined {
  return (import.meta.env.VITE_GOOGLE_MAPS_DEMO_KEY as string | undefined) || undefined
}

/** Whether this build was given a key, so the Google views can be offered at all. */
export const GOOGLE_MAPS_CONFIGURED = Boolean(googleMapsKey())

let loading: Promise<GoogleLibraries> | null = null
let authHandlers: ((error: GoogleLoadError) => void)[] = []
const AUTH_ERROR: GoogleLoadError = {
  code: 'AUTH',
  message: 'Google rejected the Maps key for this site (it may be restricted, out of its daily quota or not allowed here).',
}

/** Resolves with the libraries, or rejects with a typed reason. Loads the script only once. */
export function loadGoogleMaps(): Promise<GoogleLibraries> {
  if (loading) return loading
  const key = googleMapsKey()
  if (!key) {
    return Promise.reject<GoogleLibraries>({ code: 'NO_KEY', message: 'This build has no Google Maps key.' } satisfies GoogleLoadError)
  }
  const win = window as Win
  loading = new Promise<GoogleLibraries>((resolve, reject) => {
    // Google calls this global when it rejects the key, before or after the maps appear.
    win.gm_authFailure = () => {
      reject(AUTH_ERROR)
      for (const handler of authHandlers) handler(AUTH_ERROR)
    }
    win.__ppMapsReady = async () => {
      try {
        const [maps, marker, maps3d] = await Promise.all(
          ['maps', 'marker', 'maps3d'].map((name) => win.google!.maps.importLibrary(name)),
        )
        if (!(maps3d as Partial<GoogleLibraries['maps3d']>).Map3DElement) throw new Error('maps3d has no Map3DElement')
        resolve({ maps, marker, maps3d } as GoogleLibraries)
      } catch (error) {
        reject({
          code: 'UNSUPPORTED',
          message: `Google Maps loaded but its map libraries did not: ${error instanceof Error ? error.message : String(error)}`,
        } satisfies GoogleLoadError)
      }
    }
    const params = new URLSearchParams({ key, v: 'beta', callback: '__ppMapsReady', loading: 'async' })
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    script.async = true
    script.onerror = () => {
      // Allow a later attempt to try again.
      loading = null
      script.remove()
      reject({ code: 'NETWORK', message: 'The Google Maps script could not be downloaded.' } satisfies GoogleLoadError)
    }
    document.head.appendChild(script)
  })
  return loading
}

/** Calls `handler` if Google rejects the key at any point; returns an unsubscribe function. */
export function onGoogleAuthFailure(handler: (error: GoogleLoadError) => void): () => void {
  authHandlers.push(handler)
  return () => {
    authHandlers = authHandlers.filter((h) => h !== handler)
  }
}
