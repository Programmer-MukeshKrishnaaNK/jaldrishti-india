import { useState } from 'react'
import { Header } from '../components/Header'
import { ExplorePanel } from '../features/explore/ExplorePanel'
import { MapView } from '../map/MapView'
import type { BasemapStatus, PointerPosition } from '../types/map'

export function App() {
  const [basemap, setBasemap] = useState<BasemapStatus>({ state: 'loading' })
  const [pointer, setPointer] = useState<PointerPosition | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)

  return (
    <div className="app">
      <Header />
      <ExplorePanel basemap={basemap} pointer={pointer} zoom={zoom} />
      <main className="app-map" aria-label="Map of India">
        <MapView onStatusChange={setBasemap} onPointerChange={setPointer} onZoomChange={setZoom} />
      </main>
    </div>
  )
}
