/**
 * Loads the Google Maps JavaScript API once and returns the 3D maps library.
 * The key comes only from VITE_GOOGLE_MAPS_DEMO_KEY in .env.development.local,
 * which Vite reads for the local dev server and never for production builds.
 */

export type GoogleLoadError =
  | { code: 'NO_KEY'; message: string }
  | { code: 'AUTH'; message: string }
  | { code: 'NETWORK'; message: string }
  | { code: 'UNSUPPORTED'; message: string }

/** Minimal shape of the parts of the maps3d library this page uses. */
export interface Maps3dLibrary {
  Map3DElement: new (options: Record<string, unknown>) => HTMLElement & Record<string, unknown>
  Polygon3DElement: new (options: Record<string, unknown>) => HTMLElement
  Polyline3DElement: new (options: Record<string, unknown>) => HTMLElement
  Marker3DElement: new (options: Record<string, unknown>) => HTMLElement
}

type GoogleGlobal = { maps: { importLibrary: (name: string) => Promise<unknown> } }
type Win = Window & { google?: GoogleGlobal; gm_authFailure?: () => void; __ppMapsReady?: () => void }

export function demoKey(): string | undefined {
  // Only present when running `npm run dev` with .env.development.local; undefined in builds.
  return import.meta.env.DEV ? (import.meta.env.VITE_GOOGLE_MAPS_DEMO_KEY as string | undefined) || undefined : undefined
}

let loading: Promise<Maps3dLibrary> | null = null
let authFailed: ((error: GoogleLoadError) => void) | null = null

/** Resolves with the maps3d library, or rejects with a typed reason. Safe to call repeatedly. */
export function loadMaps3d(): Promise<Maps3dLibrary> {
  if (loading) return loading
  const key = demoKey()
  if (!key) {
    return Promise.reject<Maps3dLibrary>({
      code: 'NO_KEY',
      message: 'No Maps Demo Key is configured for local development.',
    } satisfies GoogleLoadError)
  }

  const win = window as Win
  loading = new Promise<Maps3dLibrary>((resolve, reject) => {
    // Google calls this global if the key is rejected (invalid, restricted or not allowed for this API).
    authFailed = reject
    win.gm_authFailure = () =>
      authFailed?.({ code: 'AUTH', message: 'Google rejected the API key for the Maps JavaScript API. See the browser console for Google’s error code.' })

    win.__ppMapsReady = async () => {
      try {
        const library = (await win.google!.maps.importLibrary('maps3d')) as Partial<Maps3dLibrary>
        if (!library.Map3DElement) throw new Error('maps3d library has no Map3DElement')
        resolve(library as Maps3dLibrary)
      } catch (error) {
        reject({
          code: 'UNSUPPORTED',
          message: `The 3D maps library could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        } satisfies GoogleLoadError)
      }
    }

    const params = new URLSearchParams({ key, v: 'beta', libraries: 'maps3d', callback: '__ppMapsReady', loading: 'async' })
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    script.async = true
    script.onerror = () => reject({ code: 'NETWORK', message: 'The Google Maps script could not be downloaded.' } satisfies GoogleLoadError)
    document.head.appendChild(script)
  })
  return loading
}

/** Lets the page report an authentication failure that arrives after the map was created. */
export function onAuthFailure(handler: (error: GoogleLoadError) => void): void {
  authFailed = handler
}
