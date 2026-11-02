import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
  type MapTouchEvent,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { FeatureCollection } from 'geojson'
import { useEffect, useRef, useState } from 'react'
import { bboxFromCorners, squareAround, type Bbox } from '../lib/geo/bbox'
import { isRegion, type Place } from '../lib/geocode/types'
import type { BasemapStatus, PointerPosition } from '../types/map'
import { BASEMAP, INDIA_VIEW, STYLE_TIMEOUT_MS } from './config'
import { addOverlayLayers, bboxFeature, EMPTY_FEATURES, setTerrainImage, SOURCES } from './layers'
import './MapView.css'

// MapLibre resolves its worker relative to its own module, which bundling breaks.
// Point it at the copy Vite emits instead.
setWorkerUrl(workerUrl)

// Drags shorter than this are treated as a click that places the default square.
const CLICK_TOLERANCE_PX = 6

// Regions without a known extent get a fixed zoom; other places get a 3 × 3 km square,
// so the map zooms in far enough for that square to fill much of the view.
const ZOOM_FOR_REGION: Record<string, number> = { state: 6, district: 9 }
const ZOOM_FOR_AREA = 13.3

export interface FlyRequest {
  key: number
  place: Place
  /** Overrides the zoom chosen from the place kind. */
  zoom?: number
}

interface MapViewProps {
  selection: Bbox | null
  terrainImage: { url: string; bounds: Bbox } | null
  flowLines: FeatureCollection | null
  depressionPoints: FeatureCollection | null
  hotspotPoints: FeatureCollection | null
  incidentPoints: FeatureCollection | null
  drawing: boolean
  flyRequest: FlyRequest | null
  onSelectionDrawn: (bbox: Bbox) => void
  onDrawingCancelled: () => void
  onCentreChange: (centre: PointerPosition) => void
  onStatusChange: (status: BasemapStatus) => void
  onPointerChange: (pointer: PointerPosition | null) => void
  onZoomChange: (zoom: number) => void
}

export function MapView(props: MapViewProps) {
  const { selection, terrainImage, flowLines, depressionPoints, hotspotPoints, incidentPoints, drawing, flyRequest, onStatusChange } =
    props
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [status, setStatus] = useState<BasemapStatus>({ state: 'loading' })
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // Keep the latest callbacks without re-creating the map when they change.
  const callbacks = useRef(props)
  useEffect(() => {
    callbacks.current = props
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
    mapRef.current = map

    let styleLoaded = false
    const timeout = window.setTimeout(() => {
      if (!styleLoaded) {
        report({ state: 'error', message: `${BASEMAP.name} did not respond in time.` })
      }
    }, STYLE_TIMEOUT_MS)

    map.on('style.load', () => {
      styleLoaded = true
      window.clearTimeout(timeout)
      addOverlayLayers(map)
      setReady(true)
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

    const emitView = () => {
      callbacks.current.onZoomChange(map.getZoom())
      const centre = map.getCenter()
      callbacks.current.onCentreChange({ lng: centre.lng, lat: centre.lat })
    }
    emitView()
    map.on('zoom', () => callbacks.current.onZoomChange(map.getZoom()))
    map.on('moveend', emitView)
    map.on('mousemove', (event) =>
      callbacks.current.onPointerChange({ lng: event.lngLat.lng, lat: event.lngLat.lat }),
    )
    map.on('mouseout', () => callbacks.current.onPointerChange(null))

    return () => {
      window.clearTimeout(timeout)
      mapRef.current = null
      setReady(false)
      map.remove()
    }
  }, [attempt])

  // Selection outline.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const source = map.getSource<GeoJSONSource>(SOURCES.selection)
    source?.setData(selection ? bboxFeature(selection) : EMPTY_FEATURES)
  }, [ready, selection])

  // Terrain image.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    setTerrainImage(map, terrainImage)
  }, [ready, terrainImage])

  // Analysis overlays.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.getSource<GeoJSONSource>(SOURCES.flow)?.setData(flowLines ?? EMPTY_FEATURES)
  }, [ready, flowLines])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.getSource<GeoJSONSource>(SOURCES.depressions)?.setData(depressionPoints ?? EMPTY_FEATURES)
  }, [ready, depressionPoints])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.getSource<GeoJSONSource>(SOURCES.hotspots)?.setData(hotspotPoints ?? EMPTY_FEATURES)
  }, [ready, hotspotPoints])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.getSource<GeoJSONSource>(SOURCES.incidents)?.setData(incidentPoints ?? EMPTY_FEATURES)
  }, [ready, incidentPoints])

  // Fly to a chosen place.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !flyRequest) return
    const { place } = flyRequest
    if (place.bounds && isRegion(place)) {
      const [w, s, e, n] = place.bounds
      map.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 13, duration: 1200 })
    } else {
      map.flyTo({
        center: [place.lng, place.lat],
        zoom: flyRequest.zoom ?? (isRegion(place) ? (ZOOM_FOR_REGION[place.kind] ?? 8) : ZOOM_FOR_AREA),
        duration: 1200,
      })
    }
  }, [ready, flyRequest])

  // Drawing mode: drag to draw a rectangle; a click places the default square.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !drawing) return

    const canvas = map.getCanvasContainer()
    canvas.style.cursor = 'crosshair'
    map.dragPan.disable()
    map.boxZoom.disable()
    const draft = map.getSource<GeoJSONSource>(SOURCES.draft)
    let start: { lngLat: [number, number]; point: { x: number; y: number } } | null = null

    const begin = (event: MapMouseEvent | MapTouchEvent) => {
      event.preventDefault()
      start = { lngLat: [event.lngLat.lng, event.lngLat.lat], point: event.point }
    }
    const move = (event: MapMouseEvent | MapTouchEvent) => {
      if (!start) return
      draft?.setData(bboxFeature(bboxFromCorners(start.lngLat, [event.lngLat.lng, event.lngLat.lat])))
    }
    const complete = (point: { x: number; y: number }) => {
      if (!start) return
      const end = map.unproject([point.x, point.y])
      const moved = Math.hypot(point.x - start.point.x, point.y - start.point.y)
      const bbox =
        moved < CLICK_TOLERANCE_PX
          ? squareAround(start.lngLat[0], start.lngLat[1])
          : bboxFromCorners(start.lngLat, [end.lng, end.lat])
      start = null
      draft?.setData(EMPTY_FEATURES)
      callbacks.current.onSelectionDrawn(bbox)
    }
    const finishTouch = (event: MapTouchEvent) => complete(event.point)
    // The mouse may be released over an overlay or outside the map, so listen on the
    // window and clamp the release point to the map's edges.
    const finishMouse = (event: MouseEvent) => {
      if (!start) return
      const rect = map.getCanvas().getBoundingClientRect()
      complete({
        x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
        y: Math.min(rect.height, Math.max(0, event.clientY - rect.top)),
      })
    }
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      start = null
      draft?.setData(EMPTY_FEATURES)
      callbacks.current.onDrawingCancelled()
    }

    map.on('mousedown', begin)
    map.on('touchstart', begin)
    map.on('mousemove', move)
    map.on('touchmove', move)
    map.on('touchend', finishTouch)
    window.addEventListener('mouseup', finishMouse)
    window.addEventListener('keydown', cancel)

    return () => {
      map.off('mousedown', begin)
      map.off('touchstart', begin)
      map.off('mousemove', move)
      map.off('touchmove', move)
      map.off('touchend', finishTouch)
      window.removeEventListener('mouseup', finishMouse)
      window.removeEventListener('keydown', cancel)
      draft?.setData(EMPTY_FEATURES)
      canvas.style.cursor = ''
      map.dragPan.enable()
      map.boxZoom.enable()
    }
  }, [ready, drawing])

  const retry = () => {
    const next: BasemapStatus = { state: 'loading' }
    setStatus(next)
    onStatusChange(next)
    setAttempt((n) => n + 1)
  }

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-canvas" key={attempt} />

      {drawing && (
        <p className="map-notice map-notice-draw" role="status">
          Drag to draw an area, or click for a 3 × 3 km square. Esc cancels.
        </p>
      )}

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
