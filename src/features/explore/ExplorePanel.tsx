import { formatLatitude, formatLongitude, formatZoom } from '../../lib/format'
import { BASEMAP } from '../../map/config'
import type { BasemapStatus, PointerPosition } from '../../types/map'
import './ExplorePanel.css'

interface ExplorePanelProps {
  basemap: BasemapStatus
  pointer: PointerPosition | null
  zoom: number | null
}

const BASEMAP_LABEL: Record<BasemapStatus['state'], string> = {
  loading: 'Loading',
  ready: 'Available',
  error: 'Unavailable',
}

// Capabilities planned for PaaniPulse that this build does not provide yet.
const PLANNED = ['Place search', 'Terrain analysis', 'Rainfall scenarios', 'Documented incidents']

export function ExplorePanel({ basemap, pointer, zoom }: ExplorePanelProps) {
  return (
    <aside className="app-panel panel" aria-label="Exploration panel">
      <section className="panel-section">
        <h2 className="panel-heading">Explore</h2>
        <p className="panel-text">
          Pan and zoom the basemap anywhere in India. Terrain and rainfall analysis are not part of this
          build yet.
        </p>
      </section>

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
          Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, ODbL.
        </p>
      </section>
    </aside>
  )
}
