import { bboxDimensionsKm, MAX_AREA_KM2, type Bbox, type SelectionProblem } from '../../lib/geo/bbox'
import { formatLatitude, formatLongitude } from '../../lib/format'

interface AreaSectionProps {
  selection: Bbox | null
  problem: SelectionProblem | null
  drawing: boolean
  busy: boolean
  onToggleDraw: () => void
  onPlaceAtCentre: () => void
  onClear: () => void
  onLoadTerrain: () => void
}

export function AreaSection(props: AreaSectionProps) {
  const { selection, problem, drawing, busy } = props
  const dims = selection ? bboxDimensionsKm(selection) : null

  return (
    <section className="panel-section" aria-labelledby="area-heading">
      <h2 id="area-heading" className="panel-heading">
        Analysis area
      </h2>

      {selection && dims ? (
        <div className="area-readout">
          <p className="area-size mono">
            {dims.widthKm.toFixed(2)} × {dims.heightKm.toFixed(2)} km
            <span className="area-total"> · {dims.areaKm2.toFixed(2)} km²</span>
          </p>
          <p className="area-bounds mono">
            {formatLatitude(selection[1])} – {formatLatitude(selection[3])}
            <br />
            {formatLongitude(selection[0])} – {formatLongitude(selection[2])}
          </p>
        </div>
      ) : (
        <p className="panel-text">
          Search for a place, or draw an area on the map. Areas can be up to {MAX_AREA_KM2} km².
        </p>
      )}

      {problem && (
        <p className="panel-alert" role="alert">
          {problem.message}
        </p>
      )}

      <div className="button-row">
        <button type="button" className="button" aria-pressed={drawing} onClick={props.onToggleDraw}>
          {drawing ? 'Cancel drawing' : 'Draw area'}
        </button>
        <button type="button" className="button" onClick={props.onPlaceAtCentre} disabled={drawing}>
          3 × 3 km at map centre
        </button>
        {selection && (
          <button type="button" className="button button-quiet" onClick={props.onClear} disabled={drawing}>
            Clear
          </button>
        )}
      </div>

      <button
        type="button"
        className="button button-primary"
        onClick={props.onLoadTerrain}
        disabled={!selection || !!problem || drawing || busy}
      >
        {busy ? 'Loading terrain…' : 'Load terrain'}
      </button>
    </section>
  )
}
