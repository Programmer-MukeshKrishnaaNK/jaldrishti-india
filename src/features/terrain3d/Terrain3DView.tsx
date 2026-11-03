import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ScenarioState } from '../../hooks/useHydrology'
import type { ElevationGrid } from '../../lib/dem/types'
import { ELEVATION_RAMP } from '../../lib/dem/render'
import { MIN_DRAWN_POND_M, terrainFrame } from '../../lib/terrain3d/geometry'
import { TerrainScene, type PointerCell } from './scene'
import './Terrain3DView.css'

interface Terrain3DViewProps {
  grid: ElevationGrid | null
  scenario: ScenarioState
}

const EXAGGERATIONS = [1, 2, 3, 5]
const DEFAULT_EXAGGERATION = 3

const WEBGL_MESSAGE = 'This browser could not start WebGL, so the 3D view is unavailable. The 2D map still works.'

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

const gradient = `linear-gradient(to right, ${ELEVATION_RAMP.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`
const metres = (v: number) => `${v.toFixed(1)} m`

/** 3D view of the loaded terrain with modelled ponding and an illustrative rain animation. */
export default function Terrain3DView({ grid, scenario }: Terrain3DViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<TerrainScene | null>(null)
  const [webglError, setWebglError] = useState<string | null>(() => (webglAvailable() ? null : WEBGL_MESSAGE))
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION)
  const [rain, setRain] = useState<'stopped' | 'playing' | 'paused'>('stopped')
  const [intensity, setIntensity] = useState(0.5)
  const [cell, setCell] = useState<PointerCell | null>(null)
  const [azimuth, setAzimuth] = useState(0)
  const exaggerationId = useId()
  const intensityId = useId()

  const pond = scenario.status === 'ready' ? scenario.result.pondDepthM : null
  const rainfallMm = scenario.status === 'ready' ? scenario.result.rainfallMm : null

  // Figures for the overlays, derived from the same arrays the scene draws.
  const frame = useMemo(() => (grid ? terrainFrame(grid, exaggeration) : null), [grid, exaggeration])
  const water = useMemo(() => {
    if (!pond || !grid) return null
    let cells = 0
    let maxDepthM = 0
    for (let k = 0; k < pond.length; k++) {
      if (pond[k] >= MIN_DRAWN_POND_M && Number.isFinite(grid.values[k])) {
        cells++
        maxDepthM = Math.max(maxDepthM, pond[k])
      }
    }
    return { cells, maxDepthM }
  }, [pond, grid])

  // One renderer for the lifetime of the view.
  useEffect(() => {
    const element = container.current
    if (!element) return
    let scene: TerrainScene
    try {
      scene = new TerrainScene(element)
    } catch (error) {
      console.error(error)
      // The renderer is an external system; its failure can only be learnt here.
      // oxlint-disable-next-line react/set-state-in-effect
      setWebglError(WEBGL_MESSAGE)
      return
    }
    scene.onPointerCell = setCell
    scene.onAzimuth = setAzimuth
    sceneRef.current = scene
    return () => {
      sceneRef.current = null
      scene.dispose()
    }
  }, [])

  // Terrain: rebuilt for a new grid; an exaggeration change keeps the camera where it is.
  // Water sits on the terrain, so it is redrawn after every terrain rebuild.
  const shownGrid = useRef<ElevationGrid | null>(null)
  const pondRef = useRef(pond)
  useEffect(() => {
    pondRef.current = pond
  })
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !grid) return
    const sameGrid = shownGrid.current === grid
    shownGrid.current = grid
    scene.setTerrain(grid, exaggeration, sameGrid)
    scene.setWater(pondRef.current)
  }, [grid, exaggeration])

  // Water for each new scenario result, always from the model's own ponding array.
  useEffect(() => {
    sceneRef.current?.setWater(pond)
  }, [pond])

  useEffect(() => {
    sceneRef.current?.setRainIntensity(intensity)
  }, [intensity])

  const play = () => {
    sceneRef.current?.startRain()
    setRain('playing')
  }
  const pause = () => {
    sceneRef.current?.pauseRain()
    setRain('paused')
  }
  const stop = () => {
    sceneRef.current?.stopRain()
    setRain('stopped')
  }

  if (webglError) {
    return (
      <div className="view3d view3d-message" role="alert">
        <p>{webglError}</p>
      </div>
    )
  }

  const i = grid && cell ? cell.row * grid.width + cell.col : -1
  const elevation = i >= 0 ? grid!.values[i] : Number.NaN
  const pondHere = i >= 0 && pond ? pond[i] : 0

  return (
    <div className="view3d">
      <div ref={container} className="view3d-canvas" aria-label="3D terrain of the selected area" role="img" />

      {!grid && (
        <div className="view3d-empty">
          <p>Load terrain for an area to see it in 3D.</p>
        </div>
      )}

      {grid && frame && (
        <>
          <div className="view3d-panel view3d-top">
            <p className="view3d-title">
              3D terrain <span className="mono">{(frame.extentX / 1000).toFixed(1)} × {(frame.extentZ / 1000).toFixed(1)} km</span>
            </p>
            <label htmlFor={exaggerationId} className="view3d-field">
              <span className="view3d-wide">Vertical exaggeration</span>
              <span className="view3d-narrow">Heights</span>
              <select
                id={exaggerationId}
                className="mono"
                value={exaggeration}
                onChange={(event) => setExaggeration(Number(event.target.value))}
              >
                {EXAGGERATIONS.map((x) => (
                  <option key={x} value={x}>
                    {x}×
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button view3d-reset" onClick={() => sceneRef.current?.resetView()}>
              Reset view
            </button>
          </div>

          <div className="view3d-compass" aria-label="North arrow" style={{ rotate: `${azimuth}rad` }}>
            <span>N</span>
          </div>

          <div className="view3d-dock">
          <div className="view3d-panel view3d-legend">
            <p className="legend-title">Elevation (Copernicus GLO-30), heights ×{exaggeration}</p>
            <div className="legend-bar" style={{ background: gradient }} aria-hidden="true" />
            <div className="legend-scale mono">
              <span>{metres(frame.minElevation)}</span>
              <span>{metres(frame.maxElevation)}</span>
            </div>
            {scenario.status === 'ready' ? (
              <p className="view3d-water">
                <span className="swatch swatch-water" aria-hidden="true" />
                Modelled ponding, {rainfallMm} mm scenario: {water?.cells ?? 0} cells, up to {metres(water?.maxDepthM ?? 0)}
                <span className="badge badge-scenario">Simulated</span>
              </p>
            ) : (
              <p className="panel-note">Run a rainfall scenario to see modelled ponding here.</p>
            )}
            {scenario.status === 'ready' && scenario.stale && (
              <p className="panel-note">The scenario is out of date for the current drainage threshold; run it again.</p>
            )}
            <p className="panel-note view3d-water-note">
              Water is the model’s ponding in terrain hollows, not observed flooding. Surface model: buildings and bridges
              are part of the terrain.
            </p>
            <p className="view3d-readout mono" aria-live="off">
              {cell && Number.isFinite(elevation)
                ? `${metres(elevation)}${pondHere > 0 ? ` · ponding ${pondHere.toFixed(2)} m` : ''}`
                : 'Point at the terrain for its elevation'}
            </p>
          </div>

          <div className="view3d-panel view3d-rain">
            <div className="button-row">
              {rain === 'playing' ? (
                <button type="button" className="button" onClick={pause}>
                  Pause rain
                </button>
              ) : (
                <button type="button" className="button button-rain" onClick={play}>
                  {rain === 'paused' ? 'Resume rain' : 'Start rain'}
                </button>
              )}
              {rain !== 'stopped' && (
                <button type="button" className="button button-quiet" onClick={stop}>
                  Stop
                </button>
              )}
            </div>
            <label htmlFor={intensityId} className="view3d-field">
              Rain density
              <input
                id={intensityId}
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={intensity}
                onChange={(event) => setIntensity(Number(event.target.value))}
              />
            </label>
            <p className="panel-note">
              Visualisation of the {rainfallMm ? `hypothetical ${rainfallMm} mm` : 'selected hypothetical'} scenario. Speed,
              density and the time water takes to appear are illustrative; they are not a rainfall rate or storm duration.
            </p>
          </div>
          </div>
        </>
      )}
    </div>
  )
}
