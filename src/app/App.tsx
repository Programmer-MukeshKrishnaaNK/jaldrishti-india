import { useMemo, useState } from 'react'
import { Header } from '../components/Header'
import { AreaSection } from '../features/area/AreaSection'
import { ExplorePanel } from '../features/explore/ExplorePanel'
import { HydrologySection } from '../features/hydrology/HydrologySection'
import { SearchBox } from '../features/search/SearchBox'
import { TerrainSection } from '../features/terrain/TerrainSection'
import { useAnalysisImage } from '../hooks/useAnalysisImage'
import { useHydrology } from '../hooks/useHydrology'
import { useTerrain } from '../hooks/useTerrain'
import { elevationAt } from '../lib/dem/grid'
import { squareAround, validateSelection, type Bbox } from '../lib/geo/bbox'
import { isRegion, type Place } from '../lib/geocode/types'
import type { AnalysisLayerId } from '../lib/hydrology/layers'
import { depressionMarkers, flowDirectionLines } from '../map/analysisFeatures'
import { MapView, type FlyRequest } from '../map/MapView'
import type { BasemapStatus, PointerPosition } from '../types/map'

export function App() {
  const [basemap, setBasemap] = useState<BasemapStatus>({ state: 'loading' })
  const [pointer, setPointer] = useState<PointerPosition | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [centre, setCentre] = useState<PointerPosition | null>(null)
  const [selection, setSelection] = useState<Bbox | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null)
  const [layer, setLayer] = useState<AnalysisLayerId>('elevation')
  const terrain = useTerrain()

  const terrainState = terrain.state
  const demGrid = terrainState.status === 'ready' ? terrainState.grid : null
  const hydrology = useHydrology(demGrid)
  const hydro = hydrology.state
  const analysisImage = useAnalysisImage(hydro, layer)

  const problem = useMemo(() => (selection ? validateSelection(selection) : null), [selection])

  const flowLines = useMemo(
    () => (hydro.status === 'ready' && layer === 'direction' ? flowDirectionLines(hydro.grid, hydro.result.directions) : null),
    [hydro, layer],
  )
  const depressionPoints = useMemo(
    () =>
      hydro.status === 'ready' && (layer === 'storage' || layer === 'fillDepth')
        ? depressionMarkers(hydro.grid, hydro.result.depressions)
        : null,
    [hydro, layer],
  )

  // Terrain always belongs to the current selection; a new selection discards it,
  // which also cancels any analysis running on it.
  const select = (bbox: Bbox | null) => {
    terrain.clear()
    setSelection(bbox)
  }

  const onPlace = (place: Place) => {
    setFlyRequest((previous) => ({ key: (previous?.key ?? 0) + 1, place }))
    setDrawing(false)
    select(isRegion(place) ? null : squareAround(place.lng, place.lat))
  }

  const pointerElevation =
    terrainState.status === 'ready' && pointer ? elevationAt(terrainState.grid, pointer.lng, pointer.lat) : null

  const showAnalysis = hydro.status === 'ready' && layer !== 'elevation'
  const mapImage = showAnalysis
    ? layer === 'direction'
      ? terrainState.status === 'ready'
        ? terrainState.image
        : null
      : analysisImage
    : terrainState.status === 'ready'
      ? terrainState.image
      : null

  return (
    <div className="app">
      <Header>
        <SearchBox onSelect={onPlace} />
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
        <HydrologySection
          state={hydro}
          terrainLoaded={terrainState.status === 'ready'}
          layer={layer}
          onLayerChange={setLayer}
          thresholdM2={hydrology.thresholdM2}
          onThresholdChange={hydrology.setThreshold}
          pointer={pointer}
          onRetry={hydrology.retry}
        />
      </ExplorePanel>

      <main className="app-map" aria-label="Map of India">
        <MapView
          selection={selection}
          terrainImage={mapImage}
          flowLines={flowLines}
          depressionPoints={depressionPoints}
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
    </div>
  )
}
