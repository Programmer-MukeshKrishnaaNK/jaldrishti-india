export type BasemapStatus =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string }

export interface PointerPosition {
  lng: number
  lat: number
}
