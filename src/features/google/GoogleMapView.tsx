import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScenarioState } from '../../hooks/useHydrology'
import { elevationStats } from '../../lib/dem/grid'
import type { ElevationGrid } from '../../lib/dem/types'
import type { Bbox } from '../../lib/geo/bbox'
import { bboxCentre } from '../../lib/geo/googleMaps'
import { gridToLngLat } from '../../map/analysisFeatures'
import {
  loadGoogleMaps,
  onGoogleAuthFailure,
  type GoogleLibraries,
  type GoogleLoadError,
  type GoogleMap,
  type GoogleMarker,
  type GoogleShape,
} from './loadGoogleMaps'
import { bboxPath, POND_CLASSES, pondRectangles } from './overlays'
import { RainCanvas } from './RainCanvas'
import './GoogleMapView.css'

export type GoogleMode = '2d' | '3d'

interface GoogleMapViewProps {
  mode: GoogleMode
  selection: Bbox | null
  /** Where to look when no area is selected: the 2D map's centre and MapLibre zoom. */
  fallbackCentre: { lat: number; lng: number } | null
  fallbackZoom: number | null
  grid: ElevationGrid | null
  scenario: ScenarioState
  selectedRank: number | null
  onSelectHotspot: (rank: number) => void
  /** Google Maps cannot be used; the reason is in plain words. */
  onUnavailable: (reason: string) => void
}

type Map3D = HTMLElement &
  Record<string, unknown> & {
    flyCameraTo?: (options: Record<string, unknown>) => void
    stopCameraAnimation?: () => void
  }

/** Hotspots marked, matching the hotspot list, the 2D map and the 3D terrain view. */
const PIN_COUNT = 10
const PIN_FILL = { higher: '#8a5a00', moderate: '#e3c473' } as const
const PIN_TEXT = { higher: '#ffffff', moderate: '#15202b' } as const
const TILT = 60
const HEADING = 20
const HOTSPOT_RANGE_M = 900
const HOTSPOT_ZOOM = 17

const ERROR_TEXT: Record<GoogleLoadError['code'], string> = {
  NO_KEY: 'This build of PaaniPulse has no Google Maps key.',
  AUTH: 'Google rejected the Maps key for this site; it may be restricted or out of its daily quota.',
  NETWORK: 'Google Maps could not be reached.',
  UNSUPPORTED: 'Google Maps loaded, but its 3D library is not available in this browser.',
}

function sideMetres([west, south, east, north]: Bbox): number {
  const lat = (south + north) / 2
  return Math.max((east - west) * 111_320 * Math.cos((lat * Math.PI) / 180), (north - south) * 110_574)
}

function pinElement(rank: number, category: 'higher' | 'moderate', selected: boolean): HTMLElement {
  const pin = document.createElement('div')
  pin.className = `gmv-pin${selected ? ' gmv-pin-selected' : ''}`
  pin.style.background = PIN_FILL[category]
  pin.style.color = PIN_TEXT[category]
  pin.textContent = String(rank)
  pin.title = `Hotspot ${rank}`
  return pin
}

/**
 * Google Maps 2D and Photorealistic 3D for the selected area, with PaaniPulse's own
 * results drawn on top: the analysis outline, modelled ponding by depth class and the
 * ranked hotspots. Every overlay comes from the same grids and scenario the rest of the
 * app shows; Google imagery is never used in a calculation.
 */
export default function GoogleMapView({
  mode,
  selection,
  fallbackCentre,
  fallbackZoom,
  grid,
  scenario,
  selectedRank,
  onSelectHotspot,
  onUnavailable,
}: GoogleMapViewProps) {
  const [libraries, setLibraries] = useState<GoogleLibraries | null>(null)
  const [raining, setRaining] = useState(false)
  const [density, setDensity] = useState(0.5)
  const container2d = useRef<HTMLDivElement>(null)
  const container3d = useRef<HTMLDivElement>(null)
  const map2d = useRef<GoogleMap | null>(null)
  const map3d = useRef<Map3D | null>(null)
  // Bumped when a map is created, so overlay effects run for it.
  const [maps, setMaps] = useState({ has2d: false, has3d: false })

  const handlers = useRef({ onSelectHotspot, onUnavailable })
  useEffect(() => {
    handlers.current = { onSelectHotspot, onUnavailable }
  })

  // The script loads once per page; a key rejected later is reported the same way.
  useEffect(() => {
    let active = true
    const fail = (error: GoogleLoadError) => active && handlers.current.onUnavailable(ERROR_TEXT[error.code])
    const unsubscribe = onGoogleAuthFailure(fail)
    loadGoogleMaps().then((libs) => active && setLibraries(libs), fail)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const result = scenario.status === 'ready' ? scenario.result : null
  const area = selection
  const centre = area ? bboxCentre(area) : fallbackCentre
  const groundM = useMemo(() => (grid ? (elevationStats(grid.values)?.p50 ?? 0) : 0), [grid])
  const rectangles = useMemo(() => (grid && result ? pondRectangles(grid, result.pondDepthM) : []), [grid, result])
  const pins = useMemo(() => {
    if (!grid || !result) return []
    return result.hotspots
      .filter((h, k) => k < PIN_COUNT || h.rank === selectedRank)
      .map((h) => {
        const row = Math.floor(h.peak.index / grid.width)
        const [lng, lat] = gridToLngLat(grid, row + 0.5, (h.peak.index % grid.width) + 0.5)
        return { rank: h.rank, category: h.category, position: { lat, lng }, selected: h.rank === selectedRank }
      })
  }, [grid, result, selectedRank])

  // Each map is created the first time its mode is shown, then kept, so switching views
  // or changing the scenario never reloads Google imagery.
  useEffect(() => {
    if (!libraries) return
    try {
      if (mode === '2d' && !map2d.current && container2d.current) {
        map2d.current = new libraries.maps.Map(container2d.current, {
          center: centre ?? { lat: 22, lng: 79 },
          zoom: fallbackZoom !== null ? Math.round(fallbackZoom + 1) : 5,
          mapId: 'DEMO_MAP_ID',
          mapTypeId: 'hybrid',
          streetViewControl: false,
          fullscreenControl: false,
          tilt: 0,
        })
        setMaps((m) => ({ ...m, has2d: true }))
      }
      if (mode === '3d' && !map3d.current && container3d.current) {
        const range = area ? sideMetres(area) * 0.95 : 60_000
        const map = new libraries.maps3d.Map3DElement({
          center: { ...(centre ?? { lat: 22, lng: 79 }), altitude: groundM },
          range,
          tilt: TILT,
          heading: HEADING,
          mode: 'SATELLITE',
        }) as Map3D
        map.className = 'gmv-map3d'
        container3d.current.appendChild(map)
        map3d.current = map
        setMaps((m) => ({ ...m, has3d: true }))
      }
    } catch (error) {
      console.error(error)
      handlers.current.onUnavailable(
        `Google ${mode === '3d' ? 'Photorealistic 3D' : 'Maps'} could not start: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    // Created once per mode; later camera moves are handled below.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [libraries, mode])

  // Camera: each map frames the chosen hotspot, else the selected area (or the 2D map's
  // view), when it is created and whenever the area changes.
  const areaKey = area?.join(',') ?? `${centre?.lat},${centre?.lng}`
  const chosen = pins.find((p) => p.selected) ?? null
  useEffect(() => {
    const map = map2d.current
    if (!map || !centre) return
    if (chosen) {
      map.setCenter(chosen.position)
      map.setZoom(HOTSPOT_ZOOM)
    } else if (area) {
      const [west, south, east, north] = area
      map.fitBounds({ west, south, east, north }, 48)
    } else {
      map.setCenter(centre)
    }
    // Moves only for a new map or area, not on every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, maps.has2d])

  useEffect(() => {
    const map = map3d.current
    if (!map || !centre) return
    map.stopCameraAnimation?.()
    map.flyCameraTo?.({
      endCamera: chosen
        ? { center: { ...chosen.position, altitude: groundM }, range: HOTSPOT_RANGE_M, tilt: TILT, heading: HEADING }
        : { center: { ...centre, altitude: groundM }, range: area ? sideMetres(area) * 0.95 : 60_000, tilt: TILT, heading: HEADING },
      durationMillis: 2200,
    })
    // Moves only for a new map, area or terrain, not on every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, groundM, maps.has3d])

  // A chosen hotspot brings the camera to it.
  useEffect(() => {
    const pin = pins.find((p) => p.selected)
    if (!pin) return
    if (map2d.current) {
      map2d.current.panTo(pin.position)
      if ((map2d.current.getZoom() ?? 0) < HOTSPOT_ZOOM) map2d.current.setZoom(HOTSPOT_ZOOM)
    }
    map3d.current?.flyCameraTo?.({
      endCamera: { center: { ...pin.position, altitude: groundM }, range: HOTSPOT_RANGE_M, tilt: TILT, heading: HEADING },
      durationMillis: 1500,
    })
    // Only a change of selection moves the camera.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRank])

  // 2D overlays: outline and ponding.
  useEffect(() => {
    const map = map2d.current
    if (!libraries || !map) return
    const shapes: GoogleShape[] = []
    if (area) {
      shapes.push(
        new libraries.maps.Polyline({ path: bboxPath(area), strokeColor: '#f1ede4', strokeWeight: 5, strokeOpacity: 0.9, clickable: false, zIndex: 1 }),
        new libraries.maps.Polyline({ path: bboxPath(area), strokeColor: '#15202b', strokeWeight: 2.5, clickable: false, zIndex: 2 }),
      )
    }
    for (const r of rectangles) {
      shapes.push(new libraries.maps.Polygon({ paths: r.path, fillColor: POND_CLASSES[r.depthClass].color, fillOpacity: 1, strokeWeight: 0, clickable: false, zIndex: 3 }))
    }
    for (const shape of shapes) shape.setMap(map)
    return () => {
      for (const shape of shapes) shape.setMap(null)
    }
  }, [libraries, maps, area, rectangles])

  // 2D hotspot markers.
  useEffect(() => {
    const map = map2d.current
    if (!libraries || !map) return
    const markers: GoogleMarker[] = pins.map((p) => {
      const marker = new libraries.marker.AdvancedMarkerElement({
        map,
        position: p.position,
        content: pinElement(p.rank, p.category, p.selected),
        title: `Hotspot ${p.rank}`,
        gmpClickable: true,
        zIndex: p.selected ? 1000 : 100 - p.rank,
      })
      marker.addEventListener('gmp-click', () => handlers.current.onSelectHotspot(p.rank))
      return marker
    })
    return () => {
      for (const marker of markers) marker.map = null
    }
  }, [libraries, maps, pins])

  // 3D overlays: outline and ponding clamped to the ground.
  useEffect(() => {
    const map = map3d.current
    if (!libraries || !map) return
    const { Polyline3DElement, Polygon3DElement } = libraries.maps3d
    const added: HTMLElement[] = []
    if (area) {
      const outline = new Polyline3DElement({
        altitudeMode: 'CLAMP_TO_GROUND',
        strokeColor: '#15202b',
        strokeWidth: 6,
        outerColor: '#f1ede4',
        outerWidth: 0.5,
        drawsOccludedSegments: true,
      })
      outline.path = bboxPath(area)
      added.push(outline)
    }
    for (const r of rectangles) {
      const polygon = new Polygon3DElement({ altitudeMode: 'CLAMP_TO_GROUND', fillColor: POND_CLASSES[r.depthClass].color, strokeWidth: 0 })
      polygon.path = r.path
      added.push(polygon)
    }
    for (const element of added) map.append(element)
    return () => {
      for (const element of added) element.remove()
    }
  }, [libraries, maps, area, rectangles])

  // 3D hotspot markers; clickable where the library supports it.
  useEffect(() => {
    const map = map3d.current
    if (!libraries || !map) return
    const Marker = libraries.maps3d.Marker3DInteractiveElement ?? libraries.maps3d.Marker3DElement
    const added = pins.map((p) => {
      const marker = new Marker({
        position: { ...p.position, altitude: p.selected ? 70 : 45 },
        altitudeMode: 'RELATIVE_TO_GROUND',
        extruded: true,
      })
      try {
        marker.append(
          new libraries.marker.PinElement({
            background: PIN_FILL[p.category],
            borderColor: p.selected ? '#15202b' : '#f1ede4',
            glyphColor: PIN_TEXT[p.category],
            glyphText: String(p.rank),
            scale: p.selected ? 1.35 : 1.05,
          }),
        )
      } catch {
        marker.label = String(p.rank)
      }
      marker.addEventListener('gmp-click', () => handlers.current.onSelectHotspot(p.rank))
      map.append(marker)
      return marker
    })
    return () => {
      for (const marker of added) marker.remove()
    }
  }, [libraries, maps, pins])

  const pondedCells = rectangles.reduce((sum, r) => sum + r.cells, 0)

  return (
    <div className="gmv">
      <div ref={container2d} className="gmv-canvas" hidden={mode !== '2d'} />
      <div ref={container3d} className="gmv-canvas" hidden={mode !== '3d'} />
      <RainCanvas playing={raining && libraries !== null} density={density} />

      {!libraries && <p className="map-notice gmv-loading">Loading Google Maps…</p>}

      {libraries && (
        <section className="gmv-panel" aria-label="Google map key">
          <p className="gmv-title">
            {mode === '3d' ? 'Google Photorealistic 3D' : 'Google Maps 2D'}
            <span className="badge badge-scenario">PaaniPulse overlay</span>
          </p>
          {!area && <p className="panel-note">Choose an area to see PaaniPulse’s analysis here.</p>}
          {area && !result && <p className="panel-note">Outline: the selected analysis area. Run a rainfall scenario to draw modelled ponding and hotspots.</p>}
          {result && (
            <>
              <p className="gmv-figures mono">
                {result.rainfallMm} mm · {pondedCells.toLocaleString('en-IN')} ponded cells · {result.hotspots.length} hotspots{' '}
                <span className="badge badge-scenario">Simulated</span>
              </p>
              <ul className="gmv-legend">
                {POND_CLASSES.map((c) => (
                  <li key={c.label}>
                    <span className="gmv-swatch" style={{ background: c.color }} aria-hidden="true" />
                    {c.label}
                  </li>
                ))}
                <li>
                  <span className="symbol-hotspot mono" aria-hidden="true">
                    1
                  </span>
                  Ranked hotspot (top {Math.min(PIN_COUNT, result.hotspots.length)}); select to explain
                </li>
              </ul>
            </>
          )}
          <div className="gmv-rain">
            <button type="button" className="button button-rain" onClick={() => setRaining((r) => !r)}>
              {raining ? 'Stop rain' : 'Show rain'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={density}
              aria-label="Rain density"
              onChange={(event) => setDensity(Number(event.target.value))}
            />
          </div>
          <p className="panel-note">
            Simulated, hypothetical scenario: modelled ponding, not observed flooding or a flood alert. Rain is
            illustrative. Imagery © Google; analysis from Copernicus GLO-30 and ESA WorldCover. Google imagery is not used
            in any calculation.
          </p>
        </section>
      )}
    </div>
  )
}
