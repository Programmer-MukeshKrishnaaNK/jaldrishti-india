import type { TerrainState } from '../../hooks/useTerrain'
import { COPERNICUS_SOURCE, TERRARIUM_SOURCE, type DemSourceId, type DemStage } from '../../lib/dem'
import { ELEVATION_RAMP } from '../../lib/dem/render'

interface TerrainSectionProps {
  terrain: TerrainState
  onRetry: (source: DemSourceId) => void
}

const STAGES: { id: DemStage; label: string }[] = [
  { id: 'discovering', label: 'Finding tiles in the catalogue' },
  { id: 'signing', label: 'Requesting read access' },
  { id: 'reading', label: 'Reading elevation cells' },
  { id: 'decoding', label: 'Preparing the terrain image' },
]

const metres = (v: number) => `${v.toFixed(1)} m`

// Share of exactly-zero cells above which the panel warns about flattened water.
const FLAT_ZERO_SHARE = 0.05

const gradient = `linear-gradient(to right, ${ELEVATION_RAMP.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`

export function TerrainSection({ terrain, onRetry }: TerrainSectionProps) {
  return (
    <section className="panel-section" aria-labelledby="terrain-heading" aria-busy={terrain.status === 'loading'}>
      <h2 id="terrain-heading" className="panel-heading">
        <span className="panel-step" aria-hidden="true">02</span>
        Terrain
      </h2>

      {terrain.status === 'idle' && (
        <p className="panel-text">Select an area, then load its terrain to see measured elevation.</p>
      )}

      {terrain.status === 'loading' && (
        <ol className="steps" aria-live="polite">
          {STAGES.filter((s) => terrain.source === 'copernicus-glo30' || s.id === 'reading' || s.id === 'decoding').map(
            (step) => {
              const order = STAGES.findIndex((s) => s.id === step.id)
              const current = STAGES.findIndex((s) => s.id === terrain.stage)
              const state = order < current ? 'done' : order === current ? 'current' : 'pending'
              return (
                <li key={step.id} className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
                  {step.label}
                </li>
              )
            },
          )}
        </ol>
      )}

      {terrain.status === 'error' && (
        <div className="panel-alert" role="alert">
          <p>
            <strong>Elevation unavailable.</strong> {terrain.message}
          </p>
          <div className="button-row">
            <button type="button" className="button" onClick={() => onRetry(terrain.source)}>
              Try again
            </button>
            {terrain.source === 'copernicus-glo30' && terrain.code !== 'NO_COVERAGE' && (
              <button type="button" className="button" onClick={() => onRetry('terrarium-srtm')}>
                Use coarser fallback
              </button>
            )}
          </div>
          {terrain.source === 'copernicus-glo30' && terrain.code !== 'NO_COVERAGE' && (
            <p className="panel-note">The fallback is {TERRARIUM_SOURCE.name}: {TERRARIUM_SOURCE.accuracy}</p>
          )}
        </div>
      )}

      {terrain.status === 'ready' && (
        <>
          {terrain.grid.source.id !== COPERNICUS_SOURCE.id && (
            <p className="panel-alert">
              <strong>Fallback data.</strong> {terrain.grid.source.accuracy}
            </p>
          )}

          <figure className="legend">
            <figcaption className="legend-title">Elevation, metres</figcaption>
            <div className="legend-bar" style={{ background: gradient }} aria-hidden="true" />
            <div className="legend-scale mono">
              <span>{metres(terrain.render.low)}</span>
              <span>{metres(terrain.render.high)}</span>
            </div>
          </figure>

          <dl className="facts">
            <div>
              <dt>Range in area</dt>
              <dd className="mono">
                {metres(terrain.render.stats.min)} – {metres(terrain.render.stats.max)}
              </dd>
            </div>
            <div>
              <dt>Median</dt>
              <dd className="mono">{metres(terrain.render.stats.p50)}</dd>
            </div>
            <div>
              <dt>Grid</dt>
              <dd className="mono">
                {terrain.grid.width} × {terrain.grid.height} cells · ~{terrain.grid.source.spacingM} m
              </dd>
            </div>
            {terrain.render.stats.valid < terrain.render.stats.total && (
              <div>
                <dt>No data</dt>
                <dd className="mono">{terrain.render.stats.total - terrain.render.stats.valid} cells</dd>
              </div>
            )}
          </dl>

          {terrain.render.stats.exactZero / terrain.render.stats.total >= FLAT_ZERO_SHARE && (
            <p className="panel-alert">
              {Math.round((100 * terrain.render.stats.exactZero) / terrain.render.stats.total)}% of cells are exactly
              0.0 m. The source flattens water surfaces during editing, so these cells are likely sea or other water,
              not measured ground.
            </p>
          )}

          <p className="panel-note">
            Colour shows measured elevation, stretched to this area’s 2nd–98th percentile. Shading is a hillshade
            computed from the same values: a visual aid, not a measurement.
          </p>
          {terrain.grid.source.id === COPERNICUS_SOURCE.id && (
            <p className="panel-note">{terrain.grid.source.accuracy}</p>
          )}
          <p className="panel-note source-line">
            <a href={terrain.grid.source.url}>{terrain.grid.source.name}</a> · {terrain.grid.provenance.join(', ')} ·
            loaded in {(terrain.elapsedMs / 1000).toFixed(1)} s
          </p>
        </>
      )}
    </section>
  )
}
