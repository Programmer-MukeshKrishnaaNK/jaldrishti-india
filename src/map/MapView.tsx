import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef, useState } from 'react'
import type { BasemapStatus, PointerPosition } from '../types/map'
import { BASEMAP, INDIA_VIEW, STYLE_TIMEOUT_MS } from './config'
import './MapView.css'

// MapLibre resolves its worker relative to its own module, which bundling breaks.
// Point it at the copy Vite emits instead.
setWorkerUrl(workerUrl)

interface MapViewProps {
  onStatusChange: (status: BasemapStatus) => void
  onPointerChange: (pointer: PointerPosition | null) => void
  onZoomChange: (zoom: number) => void
}

export function MapView({ onStatusChange, onPointerChange, onZoomChange }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<BasemapStatus>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)

  // Keep the latest callbacks without re-creating the map when they change.
  const callbacks = useRef({ onStatusChange, onPointerChange, onZoomChange })
  useEffect(() => {
    callbacks.current = { onStatusChange, onPointerChange, onZoomChange }
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const report = (next: BasemapStatus) => {
      setStatus(next)
      callbacks.current.onStatusChange(next)
    }

    let map: MapLibreMap
    try {
      map = new MapLibreMap({
        container,
        style: BASEMAP.styleUrl,
        bounds: INDIA_VIEW.bounds,
        fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      })
    } catch (error) {
      report({
        state: 'error',
        message:
          error instanceof Error && /webgl/i.test(error.message)
            ? 'This browser could not start WebGL, which the map needs.'
            : 'The map could not be started in this browser.',
      })
      return
    }

    let styleLoaded = false
    const timeout = window.setTimeout(() => {
      if (!styleLoaded) {
        report({ state: 'error', message: `${BASEMAP.name} did not respond in time.` })
      }
    }, STYLE_TIMEOUT_MS)

    map.on('style.load', () => {
      styleLoaded = true
      window.clearTimeout(timeout)
      report({ state: 'ready' })
    })

    // Errors before the style loads mean the basemap itself is unavailable.
    // Later errors are individual tiles; MapLibre keeps the rest of the map usable.
    map.on('error', (event) => {
      if (styleLoaded) return
      window.clearTimeout(timeout)
      report({
        state: 'error',
        message: `${BASEMAP.name} could not be loaded${event.error?.message ? ` (${event.error.message})` : ''}.`,
      })
    })

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    // Top-left keeps the scale clear of the attribution, which spans the bottom on phones.
    map.addControl(new ScaleControl({ unit: 'metric' }), 'top-left')

    callbacks.current.onZoomChange(map.getZoom())
    map.on('zoom', () => callbacks.current.onZoomChange(map.getZoom()))
    map.on('mousemove', (event) =>
      callbacks.current.onPointerChange({ lng: event.lngLat.lng, lat: event.lngLat.lat }),
    )
    map.on('mouseout', () => callbacks.current.onPointerChange(null))

    return () => {
      window.clearTimeout(timeout)
      map.remove()
    }
  }, [attempt])

  const retry = () => {
    const next: BasemapStatus = { state: 'loading' }
    setStatus(next)
    onStatusChange(next)
    setAttempt((n) => n + 1)
  }

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-canvas" key={attempt} />

      {status.state === 'loading' && (
        <p className="map-notice" role="status">
          Loading basemap…
        </p>
      )}

      {status.state === 'error' && (
        <div className="map-error" role="alert">
          <h2>Basemap unavailable</h2>
          <p>{status.message}</p>
          <p className="map-error-note">
            PaaniPulse uses the free {BASEMAP.name} service and does not substitute another map.
          </p>
          <button type="button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
