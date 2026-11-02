import { useMemo, useState } from 'react'
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
import { useAnalysisImage } from '../hooks/useAnalysisImage'
import { useHydrology } from '../hooks/useHydrology'
import { useLandCover } from '../hooks/useLandCover'
import { useTerrain } from '../hooks/useTerrain'
import { elevationAt } from '../lib/dem/grid'
import { INCIDENT_POINTS } from '../lib/evidence/incidents'
import { squareAround, validateSelection, type Bbox } from '../lib/geo/bbox'
import { isRegion, type Place } from '../lib/geocode/types'
import type { Hotspot } from '../lib/hydrology/hotspots'
import { SCENARIO_LAYERS, type AnalysisLayerId } from '../lib/hydrology/layers'
import { coefficientGrid, uniformCoefficientGrid } from '../lib/hydrology/runoff'
import { defaultCoefficients } from '../lib/landcover/classes'
import { depressionMarkers, flowDirectionLines, gridToLngLat, hotspotMarkers, incidentMarkers } from '../map/analysisFeatures'
import { MapView, type FlyRequest } from '../map/MapView'
import type { BasemapStatus, PointerPosition } from '../types/map'

const HOTSPOT_ZOOM = 15.5

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
  const select = (bbox: Bbox | null) => {
    terrain.clear()
    setSelectedHotspot(null)
    setSelection(bbox)
  }

  const onPlace = (place: Place) => {
    setFlyRequest((previous) => ({ key: (previous?.key ?? 0) + 1, place }))
    setDrawing(false)
    select(isRegion(place) ? null : squareAround(place.lng, place.lat))
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
          onPlaceAtCentre={() => centre && select(squareAround(centre.lng, centre.lat))}
          onClear={() => select(null)}
          onLoadTerrain={() => selection && !problem && terrain.load('copernicus-glo30', selection)}
        />
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
