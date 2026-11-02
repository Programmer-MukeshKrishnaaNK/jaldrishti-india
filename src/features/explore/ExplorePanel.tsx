import type { ReactNode } from 'react'
import { formatLatitude, formatLongitude, formatZoom } from '../../lib/format'
import { BASEMAP } from '../../map/config'
import type { BasemapStatus, PointerPosition } from '../../types/map'
import './ExplorePanel.css'

interface ExplorePanelProps {
  basemap: BasemapStatus
  pointer: PointerPosition | null
  zoom: number | null
  /** Elevation under the pointer: a number, NaN for a no-data cell, or null when not over loaded terrain. */
  pointerElevation: number | null
  terrainLoaded: boolean
  children: ReactNode
}

const BASEMAP_LABEL: Record<BasemapStatus['state'], string> = {
  loading: 'Loading',
  ready: 'Available',
  error: 'Unavailable',
}

const AVAILABLE = ['Place search', 'Area selection', 'Elevation (Copernicus GLO-30)']

// Capabilities planned for PaaniPulse that this build does not provide yet.
const PLANNED = ['Runoff analysis', 'Rainfall scenarios', 'Documented incidents']

export function ExplorePanel({ basemap, pointer, zoom, pointerElevation, terrainLoaded, children }: ExplorePanelProps) {
  let elevation = '—'
  if (pointerElevation !== null) {
    elevation = Number.isFinite(pointerElevation) ? `${pointerElevation.toFixed(1)} m` : 'No data'
  } else if (pointer && terrainLoaded) {
    elevation = 'Outside area'
  }

  return (
    <aside className="app-panel panel" aria-label="Exploration panel">
      {children}

      <section className="panel-section">
        <h2 className="panel-heading">Pointer</h2>
        <dl className="readout mono" aria-live="off">
          <div>
            <dt>Lat</dt>
            <dd>{pointer ? formatLatitude(pointer.lat) : '—'}</dd>
          </div>
          <div>
            <dt>Lon</dt>
            <dd>{pointer ? formatLongitude(pointer.lng) : '—'}</dd>
          </div>
          <div>
            <dt>Elevation</dt>
            <dd>{elevation}</dd>
          </div>
          <div>
            <dt>Zoom</dt>
            <dd>{zoom === null ? '—' : formatZoom(zoom)}</dd>
          </div>
        </dl>
      </section>

      <section className="panel-section">
        <h2 className="panel-heading">Build status</h2>
        <ul className="status-list">
          <li>
            <span>Basemap</span>
            <span className={`status status-${basemap.state}`}>{BASEMAP_LABEL[basemap.state]}</span>
          </li>
          {AVAILABLE.map((name) => (
            <li key={name}>
              <span>{name}</span>
              <span className="status status-ready">Available</span>
            </li>
          ))}
          {PLANNED.map((name) => (
            <li key={name}>
              <span>{name}</span>
              <span className="status status-planned">Not yet available</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-section panel-sources">
        <h2 className="panel-heading">Sources</h2>
        <p className="panel-text">
          Basemap: <a href={BASEMAP.homepage}>{BASEMAP.name}</a>, © <a href="https://openmaptiles.org">OpenMapTiles</a>.
          Map data and place names © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>,
          ODbL, via a bundled list, <a href="https://photon.komoot.io">Photon</a> and{' '}
          <a href="https://nominatim.org">Nominatim</a>.
        </p>
        <p className="panel-text">
          Elevation: Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018,
          provided under COPERNICUS by the European Union and ESA, read via{' '}
          <a href="https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30">Microsoft Planetary Computer</a>.
        </p>
      </section>
    </aside>
  )
}
