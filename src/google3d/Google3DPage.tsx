import { useEffect, useMemo, useRef, useState } from 'react'
import { Wordmark } from '../components/Wordmark'
import { elevationStats } from '../lib/dem/grid'
import { PRESET_RAINFALL_MM } from '../lib/hydrology/scenario'
import { gridToLngLat } from '../map/analysisFeatures'
import { analyseArea, PRESETS, scenarioFor, type Analysis } from './analysis'
import { loadMaps3d, onAuthFailure, type GoogleLoadError, type Maps3dLibrary } from './loadMaps'
import { bboxPath, POND_CLASSES, pondRectangles } from './overlays'
import { RainCanvas } from './RainCanvas'
import './Google3DPage.css'

type GoogleState = { status: 'loading' } | { status: 'ready'; library: Maps3dLibrary } | { status: 'error'; error: GoogleLoadError }
type AnalysisState = { status: 'loading'; presetId: string } | { status: 'ready'; presetId: string; analysis: Analysis } | { status: 'error'; presetId: string; message: string }

type Map3D = HTMLElement & Record<string, unknown> & {
  flyCameraTo?: (options: Record<string, unknown>) => void
  flyCameraAround?: (options: Record<string, unknown>) => void
  stopCameraAnimation?: () => void
}

const CAMERA = { tilt: 62, range: 2600, heading: 25 }

export function Google3DPage() {
  const [google, setGoogle] = useState<GoogleState>({ status: 'loading' })
  const [presetId, setPresetId] = useState(PRESETS[0].id)
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'loading', presetId: PRESETS[0].id })
  const [rainfallMm, setRainfallMm] = useState(100)
  const [raining, setRaining] = useState(false)
  const [density, setDensity] = useState(0.5)
  const [orbiting, setOrbiting] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map3D | null>(null)
  const overlays = useRef<HTMLElement[]>([])
  const preset = PRESETS.find((p) => p.id === presetId)!

  // Google Maps JS: loaded once per page.
  useEffect(() => {
    let active = true
    onAuthFailure((error) => active && setGoogle({ status: 'error', error }))
    loadMaps3d().then(
      (library) => active && setGoogle({ status: 'ready', library }),
      (error: GoogleLoadError) => active && setGoogle({ status: 'error', error }),
    )
    return () => {
      active = false
    }
  }, [])

  // PaaniPulse analysis from Copernicus DEM and ESA WorldCover; independent of Google, but
  // skipped when there is no Google map to show it on.
  const googleFailed = google.status === 'error'
  useEffect(() => {
    if (googleFailed) return
    const abort = new AbortController()
    analyseArea(preset, abort.signal).then(
      (result) => setAnalysis({ status: 'ready', presetId: preset.id, analysis: result }),
      (error: unknown) => {
        if (abort.signal.aborted) return
        setAnalysis({ status: 'error', presetId: preset.id, message: error instanceof Error ? error.message : 'Analysis failed.' })
      },
    )
    return () => abort.abort()
  }, [preset, googleFailed])

  const current = analysis.presetId === presetId ? analysis : { status: 'loading' as const, presetId }
  const ready = current.status === 'ready' ? current.analysis : null
  const scenario = useMemo(() => (ready ? scenarioFor(ready, rainfallMm) : null), [ready, rainfallMm])
  const rectangles = useMemo(
    () => (ready && scenario ? pondRectangles(ready.grid, scenario.spill.pondDepthM) : []),
    [ready, scenario],
  )
  const groundM = useMemo(() => (ready ? (elevationStats(ready.grid.values)?.p50 ?? 0) : 0), [ready])

  // The Google 3D map element: created once, kept for the life of the page.
  useEffect(() => {
    if (google.status !== 'ready' || !container.current || mapRef.current) return
    const map = new google.library.Map3DElement({
      center: { lat: PRESETS[0].lat, lng: PRESETS[0].lng, altitude: 140 },
      ...CAMERA,
      mode: 'SATELLITE',
    }) as Map3D
    map.className = 'g3d-map'
    container.current.appendChild(map)
    mapRef.current = map
  }, [google])

  // Camera to the analysed area.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.stopCameraAnimation?.()
    map.flyCameraTo?.({
      endCamera: { center: { lat: preset.lat, lng: preset.lng, altitude: groundM }, ...CAMERA },
      durationMillis: 2500,
    })
  }, [ready, preset, groundM, google])

  // Our overlays: replaced whenever the analysis or scenario changes.
  useEffect(() => {
    const map = mapRef.current
    if (google.status !== 'ready' || !map || !ready || !scenario) return
    for (const element of overlays.current) element.remove()
    const { Polygon3DElement, Polyline3DElement, Marker3DElement } = google.library
    const added: HTMLElement[] = []

    const outline = new Polyline3DElement({
      altitudeMode: 'CLAMP_TO_GROUND',
      strokeColor: '#15202b',
      strokeWidth: 6,
      outerColor: '#f1ede4',
      outerWidth: 0.5,
      drawsOccludedSegments: true,
    }) as HTMLElement & Record<string, unknown>
    outline.path = bboxPath(ready.bbox)
    added.push(outline)

    for (const r of rectangles) {
      const polygon = new Polygon3DElement({
        altitudeMode: 'CLAMP_TO_GROUND',
        fillColor: POND_CLASSES[r.depthClass].color,
        strokeWidth: 0,
      }) as HTMLElement & Record<string, unknown>
      polygon.path = r.path
      added.push(polygon)
    }

    for (const h of scenario.hotspots.slice(0, 10)) {
      const row = Math.floor(h.peak.index / ready.grid.width)
      const [lng, lat] = gridToLngLat(ready.grid, row + 0.5, (h.peak.index % ready.grid.width) + 0.5)
      added.push(
        new Marker3DElement({
          position: { lat, lng, altitude: 35 },
          altitudeMode: 'RELATIVE_TO_GROUND',
          extruded: true,
          label: String(h.rank),
        }),
      )
    }
    for (const element of added) map.append(element)
    overlays.current = added
  }, [google, ready, scenario, rectangles])

  const orbit = () => {
    const map = mapRef.current
    if (!map) return
    if (orbiting) {
      map.stopCameraAnimation?.()
      setOrbiting(false)
      return
    }
    map.flyCameraAround?.({
      camera: { center: { lat: preset.lat, lng: preset.lng, altitude: groundM }, ...CAMERA },
      durationMillis: 40_000,
      rounds: 1,
    })
    setOrbiting(true)
  }

  const pondedCells = rectangles.reduce((sum, r) => sum + r.cells, 0)

  return (
    <div className="g3d">
      <header className="g3d-header">
        <Wordmark />
        <p className="g3d-title">
          Google 3D scenery <span className="badge badge-parameter">Experimental · local only</span>
        </p>
      </header>

      <main className="g3d-stage">
        <div ref={container} className="g3d-container" />
        <RainCanvas playing={raining && google.status === 'ready'} density={density} />

        {google.status === 'loading' && <p className="g3d-notice">Loading Google 3D…</p>}
        {google.status === 'error' && <GoogleError error={google.error} />}

        {google.status !== 'error' && (
          <aside className="g3d-panel" aria-label="Scenario controls">
            <div className="g3d-row" role="radiogroup" aria-label="Place">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={p.id === presetId} className="g3d-chip" onClick={() => setPresetId(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="g3d-row" role="radiogroup" aria-label="Hypothetical rainfall">
              {PRESET_RAINFALL_MM.map((mm) => (
                <button key={mm} type="button" role="radio" aria-checked={mm === rainfallMm} className="g3d-chip mono" onClick={() => setRainfallMm(mm)}>
                  {mm} mm
                </button>
              ))}
            </div>

            {current.status === 'loading' && <p className="panel-note">Analysing {preset.name} from Copernicus GLO-30 and ESA WorldCover…</p>}
            {current.status === 'error' && <p className="panel-alert">Analysis unavailable: {current.message}</p>}
            {scenario && (
              <>
                <p className="g3d-figures mono">
                  {pondedCells.toLocaleString('en-IN')} ponded cells · {scenario.summary.higherHotspotCount} higher hotspots ·{' '}
                  {Math.round(scenario.summary.storedM3).toLocaleString('en-IN')} m³ held
                </p>
                <ul className="g3d-legend">
                  {POND_CLASSES.map((c) => (
                    <li key={c.label}>
                      <span style={{ background: c.color }} aria-hidden="true" />
                      {c.label}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="g3d-row">
              <button type="button" className="button button-rain" onClick={() => setRaining((r) => !r)} disabled={google.status !== 'ready'}>
                {raining ? 'Stop rain' : 'Start rain'}
              </button>
              <button type="button" className="button" onClick={orbit} disabled={google.status !== 'ready' || !ready}>
                {orbiting ? 'Stop orbit' : 'Orbit'}
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
              Scenery: Google. Analysis: Copernicus GLO-30 and ESA WorldCover; Google imagery is not used in any
              calculation. Blue cells are modelled ponding for a hypothetical {rainfallMm} mm, drawn on the ground and
              coloured by depth. Rain is illustrative only.
            </p>
          </aside>
        )}
      </main>
    </div>
  )
}

function GoogleError({ error }: { error: GoogleLoadError }) {
  const title = {
    NO_KEY: 'Google 3D is not configured',
    AUTH: 'Google rejected the key',
    NETWORK: 'Google Maps could not be reached',
    UNSUPPORTED: 'Google 3D is not available',
  }[error.code]
  return (
    <div className="g3d-error" role="alert">
      <h2>{title}</h2>
      <p>{error.message}</p>
      {error.code === 'NO_KEY' && (
        <p className="panel-note">
          For local development only, add <code>VITE_GOOGLE_MAPS_DEMO_KEY</code> to <code>.env.development.local</code> and
          restart <code>npm run dev</code>. Production builds never include a key.
        </p>
      )}
      <p className="panel-note">
        PaaniPulse’s own 3D view needs no key: <a href={import.meta.env.BASE_URL}>open PaaniPulse</a> and choose 3D.
      </p>
    </div>
  )
}
