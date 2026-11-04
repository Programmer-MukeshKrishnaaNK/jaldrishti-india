import { lazy, Suspense, useMemo, useState } from 'react'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { Header } from '../components/Header'
import { AreaSection } from '../features/area/AreaSection'
import { EvidenceSection } from '../features/evidence/EvidenceSection'
import { ExplorePanel } from '../features/explore/ExplorePanel'
import { HotspotSection } from '../features/hotspots/HotspotSection'
import { HydrologySection } from '../features/hydrology/HydrologySection'
import { MethodologyDialog } from '../features/methodology/MethodologyDialog'
import { ScenarioSection, type CoefficientMode } from '../features/scenario/ScenarioSection'
import { SearchBox } from '../features/search/SearchBox'
import { TerrainSection } from '../features/terrain/TerrainSection'
import { GOOGLE_MAPS_CONFIGURED } from '../features/google/loadGoogleMaps'
import { webglAvailable, WEBGL_UNAVAILABLE } from '../features/terrain3d/support'
import { UnderstandSection } from '../features/understand/UnderstandSection'
import { useAnalysisImage } from '../hooks/useAnalysisImage'
import { useHydrology } from '../hooks/useHydrology'
import { useLandCover } from '../hooks/useLandCover'
import { useTerrain } from '../hooks/useTerrain'
import { elevationAt } from '../lib/dem/grid'
import { INCIDENT_POINTS } from '../lib/evidence/incidents'
import { squareAround, validateSelection, type Bbox } from '../lib/geo/bbox'
import { bboxCentre, googleMapsUrl } from '../lib/geo/googleMaps'
import type { AreaInput } from '../lib/explain/area'
import { isRegion, type Place } from '../lib/geocode/types'
import type { Hotspot } from '../lib/hydrology/hotspots'
import { analysisLayer, SCENARIO_LAYERS, type AnalysisLayerId } from '../lib/hydrology/layers'
import { coefficientGrid, uniformCoefficientGrid } from '../lib/hydrology/runoff'
import { defaultCoefficients } from '../lib/landcover/classes'
import { depressionMarkers, flowDirectionLines, gridToLngLat, hotspotMarkers, incidentMarkers } from '../map/analysisFeatures'
import { MapLegend } from '../map/MapLegend'
import { MapView, type FlyRequest } from '../map/MapView'
import type { BasemapStatus, PointerPosition } from '../types/map'

const HOTSPOT_ZOOM = 15.5

/** Element-wise equality, with no-data (NaN) equal to itself. */
function sameValues(a: Float32Array, b: Float32Array | null): boolean {
  if (!b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return false
  }
  return true
}

// Three.js is only downloaded the first time the 3D view is opened.
const Terrain3DView = lazy(() => import('../features/terrain3d/Terrain3DView'))

// Google Maps is downloaded only when a Google view is first opened, and only in builds with a key.
const GoogleMapView = lazy(() => import('../features/google/GoogleMapView'))

type View = '2d' | '3d' | 'g2d' | 'g3d'
const VIEW_LABEL: Record<View, string> = { '2d': '2D Map', '3d': '3D View', g2d: 'Google 2D', g3d: 'Google 3D' }
const VIEWS: View[] = GOOGLE_MAPS_CONFIGURED ? ['2d', '3d', 'g2d', 'g3d'] : ['2d', '3d']
const isGoogle = (view: View) => view === 'g2d' || view === 'g3d'

export function App() {
  const [basemap, setBasemap] = useState<BasemapStatus>({ state: 'loading' })
  const [pointer, setPointer] = useState<PointerPosition | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [centre, setCentre] = useState<PointerPosition | null>(null)
  const [selection, setSelection] = useState<Bbox | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null)
  const [layer, setLayer] = useState<AnalysisLayerId>('elevation')
  const [rainfallMm, setRainfallMm] = useState(100)
  const [coefficients, setCoefficients] = useState(defaultCoefficients)
  const [coefficientMode, setCoefficientMode] = useState<CoefficientMode>({ kind: 'landcover' })
  const [selectedHotspot, setSelectedHotspot] = useState<number | null>(null)
  const [showReports, setShowReports] = useState(true)
  const [methodOpen, setMethodOpen] = useState(false)
  const [view, setView] = useState<View>('2d')
  // Why the 3D or a Google view could not be shown, once it has failed; the 2D map is shown instead.
  const [threeDProblem, setThreeDProblem] = useState<string | null>(null)
  const [googleProblem, setGoogleProblem] = useState<string | null>(null)
  // The Google maps stay mounted once opened, so switching back does not reload them.
  const [googleOpened, setGoogleOpened] = useState(false)
  const [lastGoogleMode, setLastGoogleMode] = useState<'2d' | '3d'>('3d')
  const [hasWebgl] = useState(webglAvailable)
  const [areaLabel, setAreaLabel] = useState('that you drew')
  // The searched place's name, for Google Maps when there is no selected area (e.g. a state).
  const [placeName, setPlaceName] = useState<string | null>(null)
  const terrain = useTerrain()

  const terrainState = terrain.state
  const demGrid = terrainState.status === 'ready' ? terrainState.grid : null
  const hydrology = useHydrology(demGrid)
  const landCover = useLandCover(demGrid)
  const hydro = hydrology.state
  const scenario = hydrology.scenario
  const scenarioReady = scenario.status === 'ready'
  // Scenario layers need a result; fall back to elevation when there is none.
  const activeLayer = SCENARIO_LAYERS.includes(layer) && !scenarioReady ? 'elevation' : layer
  const analysisImage = useAnalysisImage(hydro, scenario, activeLayer)

  const problem = useMemo(() => (selection ? validateSelection(selection) : null), [selection])

  const coefficientCells = useMemo(() => {
    if (!demGrid) return null
    if (coefficientMode.kind === 'uniform') return uniformCoefficientGrid(demGrid.width * demGrid.height, coefficientMode.value)
    return landCover.state.status === 'ready' ? coefficientGrid(landCover.state.landCover, coefficients) : null
  }, [demGrid, coefficientMode, landCover.state, coefficients])

  // Whether the shown scenario ran with coefficients other than the current ones.
  const coefficientsChanged = useMemo(
    () => scenario.status === 'ready' && !sameValues(scenario.coefficients, coefficientCells),
    [scenario, coefficientCells],
  )

  const flowLines = useMemo(
    () => (hydro.status === 'ready' && activeLayer === 'direction' ? flowDirectionLines(hydro.grid, hydro.result.directions) : null),
    [hydro, activeLayer],
  )
  const depressionPoints = useMemo(
    () =>
      hydro.status === 'ready' && (activeLayer === 'storage' || activeLayer === 'fillDepth')
        ? depressionMarkers(hydro.grid, hydro.result.depressions)
        : null,
    [hydro, activeLayer],
  )
  const hotspotPoints = useMemo(
    () =>
      demGrid && scenario.status === 'ready' && (SCENARIO_LAYERS.includes(activeLayer) || selectedHotspot !== null)
        ? hotspotMarkers(demGrid, scenario.result.hotspots, selectedHotspot)
        : null,
    [demGrid, scenario, activeLayer, selectedHotspot],
  )
  const incidentPoints = useMemo(() => (showReports ? incidentMarkers(INCIDENT_POINTS) : null), [showReports])

  // Terrain always belongs to the current selection; a new selection discards it,
  // which also cancels any analysis or scenario running on it.
  const select = (bbox: Bbox | null, label = 'that you drew', name: string | null = null) => {
    setAreaLabel(label)
    setPlaceName(name)
    terrain.clear()
    setSelectedHotspot(null)
    setSelection(bbox)
  }

  const onPlace = (place: Place) => {
    setFlyRequest((previous) => ({ key: (previous?.key ?? 0) + 1, place }))
    setDrawing(false)
    select(
      isRegion(place) ? null : squareAround(place.lng, place.lat),
      `around ${place.name}`,
      // Context can be a kind ("State or union territory") rather than a place, so it is left out.
      `${place.name}, India`,
    )
  }

  const runScenario = () => {
    if (!coefficientCells) return
    setSelectedHotspot(null)
    hydrology.runScenario({
      rainfallMm,
      coefficients: coefficientCells,
      waterShare: landCover.state.status === 'ready' ? landCover.state.waterShare : null,
    })
    if (!SCENARIO_LAYERS.includes(layer)) setLayer('hotspots')
  }

  const selectHotspot = (hotspot: Hotspot | null) => {
    setSelectedHotspot(hotspot?.rank ?? null)
    if (!hotspot || !demGrid) return
    const row = Math.floor(hotspot.peak.index / demGrid.width)
    const [lng, lat] = gridToLngLat(demGrid, row + 0.5, (hotspot.peak.index % demGrid.width) + 0.5)
    setFlyRequest((previous) => ({
      key: (previous?.key ?? 0) + 1,
      zoom: HOTSPOT_ZOOM,
      place: { id: `hotspot-${hotspot.rank}`, name: `Hotspot ${hotspot.rank}`, context: '', kind: 'hotspot', lng, lat, source: 'gazetteer' },
    }))
  }

  const showView = (mode: View) => {
    if (mode === '3d' && !hasWebgl) {
      setThreeDProblem(WEBGL_UNAVAILABLE)
      return
    }
    setThreeDProblem(null)
    setGoogleProblem(null)
    setView(mode)
    if (mode !== '2d') setDrawing(false)
    if (isGoogle(mode)) {
      setGoogleOpened(true)
      setLastGoogleMode(mode === 'g2d' ? '2d' : '3d')
    }
  }

  const scenarioResult = scenario.status === 'ready' ? scenario.result : null
  const scenarioOutdated = scenario.status === 'ready' && (scenario.stale || coefficientsChanged)
  const landCoverReady = landCover.state.status === 'ready' ? landCover.state : null
  const areaInput = useMemo<AreaInput | null>(() => {
    if (!demGrid) return null
    return {
      areaLabel,
      grid: demGrid,
      landCover: landCoverReady
        ? { grid: landCoverReady.landCover, classShare: landCoverReady.classShare, missingShare: landCoverReady.missingShare }
        : null,
      uniformCoefficient: coefficientMode.kind === 'uniform' ? coefficientMode.value : null,
      scenario: scenarioResult
        ? {
            rainfallMm: scenarioResult.rainfallMm,
            summary: scenarioResult.summary,
            comparison: scenarioResult.comparison,
            hotspots: scenarioResult.hotspots,
            fills: scenarioResult.fills,
            outdated: scenarioOutdated,
          }
        : null,
      chosenRainfallMm: rainfallMm,
      selected: scenarioResult?.hotspots.find((h) => h.rank === selectedHotspot) ?? null,
      view: isGoogle(view) ? 'google' : view,
    }
  }, [demGrid, areaLabel, landCoverReady, coefficientMode, scenarioResult, scenarioOutdated, rainfallMm, selectedHotspot, view])

  // The selected area's centre, else the searched place's name, else the map centre.
  const googleMapsHref = selection
    ? googleMapsUrl(bboxCentre(selection))
    : placeName
      ? googleMapsUrl({ name: placeName })
      : centre
        ? googleMapsUrl(centre)
        : null

  const pointerElevation =
    terrainState.status === 'ready' && pointer ? elevationAt(terrainState.grid, pointer.lng, pointer.lat) : null

  const elevationImage = terrainState.status === 'ready' ? terrainState.image : null
  const mapImage =
    hydro.status === 'ready' && activeLayer !== 'elevation' && activeLayer !== 'direction' ? analysisImage : elevationImage

  return (
    <div className="app">
      <Header>
        <SearchBox onSelect={onPlace} />
        <button type="button" className="button header-method" onClick={() => setMethodOpen(true)}>
          Method
        </button>
      </Header>

      <ExplorePanel
        basemap={basemap}
        pointer={pointer}
        zoom={zoom}
        pointerElevation={pointerElevation}
        terrainLoaded={terrainState.status === 'ready'}
      >
        <AreaSection
          selection={selection}
          problem={problem}
          drawing={drawing}
          busy={terrainState.status === 'loading'}
          onToggleDraw={() => setDrawing((d) => !d)}
          onPlaceAtCentre={() => centre && select(squareAround(centre.lng, centre.lat), 'around the map centre')}
          onClear={() => select(null)}
          onLoadTerrain={() => selection && !problem && terrain.load('copernicus-glo30', selection)}
        />
        <UnderstandSection input={areaInput} />
        <TerrainSection terrain={terrainState} onRetry={(source) => selection && terrain.load(source, selection)} />
        <ScenarioSection
          analysisReady={hydro.status === 'ready'}
          landCover={landCover.state}
          onRetryLandCover={landCover.retry}
          coefficients={coefficients}
          onCoefficientsChange={setCoefficients}
          mode={coefficientMode}
          onModeChange={setCoefficientMode}
          rainfallMm={rainfallMm}
          onRainfallChange={setRainfallMm}
          scenario={scenario}
          coefficientsChanged={coefficientsChanged}
          onRun={runScenario}
        />
        <HotspotSection scenario={scenario} grid={demGrid} selectedRank={selectedHotspot} onSelect={selectHotspot} />
        <HydrologySection
          state={hydro}
          terrainLoaded={terrainState.status === 'ready'}
          layer={activeLayer}
          onLayerChange={setLayer}
          thresholdM2={hydrology.thresholdM2}
          onThresholdChange={hydrology.setThreshold}
          pointer={pointer}
          onRetry={hydrology.retry}
          scenarioReady={scenarioReady}
        />
        <EvidenceSection selection={selection} visible={showReports} onVisibleChange={setShowReports} />
      </ExplorePanel>

      <main className="app-map" aria-label="Map of India">
        <div className="view-controls">
          <div className="view-switch" role="radiogroup" aria-label="Map view">
            {VIEWS.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={view === mode}
                title={mode === '3d' && !hasWebgl ? WEBGL_UNAVAILABLE : undefined}
                onClick={() => showView(mode)}
              >
                {VIEW_LABEL[mode]}
              </button>
            ))}
          </div>
          {googleMapsHref && (
            <a
              className="view-external"
              href={googleMapsHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this location on the Google Maps website, in a new tab"
            >
              Google Maps<span aria-hidden="true"> ↗</span>
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          )}
        </div>
        {googleProblem && view === '2d' && (
          <div className="view-notice" role="status">
            <p>
              <strong>Google Maps is unavailable, so the 2D map is shown.</strong> {googleProblem} The area, scenario
              and hotspots are unchanged. PaaniPulse’s own 3D terrain view does not need Google.
            </p>
            <div className="button-row">
              {hasWebgl && (
                <button type="button" className="button" onClick={() => showView('3d')}>
                  Open 3D View
                </button>
              )}
              <button type="button" className="button button-quiet" onClick={() => setGoogleProblem(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}
        {threeDProblem && view === '2d' && (
          <div className="view-notice" role="status">
            <p>
              <strong>Showing the 2D map.</strong> {threeDProblem} Everything else works here, with the same area and
              scenario.
            </p>
            <button type="button" className="button button-quiet" onClick={() => setThreeDProblem(null)}>
              Dismiss
            </button>
          </div>
        )}
        {view === '3d' && (
          <ErrorBoundary
            label="The 3D view"
            actions={
              <button type="button" className="button" onClick={() => setView('2d')}>
                Use the 2D map
              </button>
            }
          >
            <Suspense fallback={<p className="map-notice">Loading 3D view…</p>}>
              <Terrain3DView
                grid={demGrid}
                scenario={scenario}
                selectedRank={selectedHotspot}
                onSelectHotspot={(rank) => {
                  const hotspot = scenario.status === 'ready' ? scenario.result.hotspots.find((h) => h.rank === rank) : null
                  selectHotspot(hotspot ?? null)
                }}
                onUnavailable={(reason) => {
                  setThreeDProblem(reason)
                  setView('2d')
                }}
              />
            </Suspense>
          </ErrorBoundary>
        )}
        {googleOpened && (
          <div className="google-layer" hidden={!isGoogle(view)}>
            <ErrorBoundary
              label="Google Maps"
              actions={
                <button type="button" className="button" onClick={() => showView('2d')}>
                  Use the 2D map
                </button>
              }
            >
              <Suspense fallback={<p className="map-notice">Loading Google Maps…</p>}>
                <GoogleMapView
                  mode={isGoogle(view) ? (view === 'g2d' ? '2d' : '3d') : lastGoogleMode}
                  selection={selection}
                  fallbackCentre={centre}
                  fallbackZoom={zoom}
                  grid={demGrid}
                  scenario={scenario}
                  selectedRank={selectedHotspot}
                  onSelectHotspot={(rank) => {
                    const hotspot = scenario.status === 'ready' ? scenario.result.hotspots.find((h) => h.rank === rank) : null
                    selectHotspot(hotspot ?? null)
                  }}
                  onUnavailable={(reason) => {
                    setGoogleProblem(reason)
                    setGoogleOpened(false)
                    setView((current) => (isGoogle(current) ? '2d' : current))
                  }}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {view === '2d' && (
          <MapLegend
            layer={terrainState.status === 'ready' ? analysisLayer(hydro.status === 'ready' ? activeLayer : 'elevation') : null}
            elevation={terrainState.status === 'ready' ? terrainState.render : null}
            hotspots={hotspotPoints !== null}
            reports={showReports}
          />
        )}
        <MapView
          selection={selection}
          terrainImage={mapImage}
          flowLines={flowLines}
          depressionPoints={depressionPoints}
          hotspotPoints={hotspotPoints}
          incidentPoints={incidentPoints}
          drawing={drawing}
          flyRequest={flyRequest}
          onSelectionDrawn={(bbox) => {
            setDrawing(false)
            select(bbox)
          }}
          onDrawingCancelled={() => setDrawing(false)}
          onCentreChange={setCentre}
          onStatusChange={setBasemap}
          onPointerChange={setPointer}
          onZoomChange={setZoom}
        />
      </main>

      <MethodologyDialog open={methodOpen} onClose={() => setMethodOpen(false)} />
    </div>
  )
}
