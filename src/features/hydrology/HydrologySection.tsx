import { useId } from 'react'
import { DRAINAGE_THRESHOLDS_M2, type HydrologyState } from '../../hooks/useHydrology'
import { cellAt } from '../../lib/dem/grid'
import { NEIGHBOURS } from '../../lib/hydrology/grid'
import { ANALYSIS_LAYERS, analysisLayer, type AnalysisLayerId } from '../../lib/hydrology/layers'
import type { HydroStage } from '../../lib/hydrology/engine'
import type { PointerPosition } from '../../types/map'
import './HydrologySection.css'

interface HydrologySectionProps {
  state: HydrologyState
  terrainLoaded: boolean
  layer: AnalysisLayerId
  onLayerChange: (layer: AnalysisLayerId) => void
  thresholdM2: number
  onThresholdChange: (thresholdM2: number) => void
  pointer: PointerPosition | null
  onRetry: () => void
}

const STAGES: { id: HydroStage; label: string }[] = [
  { id: 'filling', label: 'Filling depressions (Priority-Flood)' },
  { id: 'directions', label: 'Flow directions (D8)' },
  { id: 'accumulation', label: 'Flow accumulation' },
  { id: 'hand', label: 'Height above nearest drainage' },
  { id: 'storage', label: 'Depression storage' },
]

const ARROWS: Record<number, string> = { 1: '→', 2: '↘', 4: '↓', 8: '↙', 16: '←', 32: '↖', 64: '↑', 128: '↗' }
const DIRECTION_NAMES: Record<number, string> = { 1: 'E', 2: 'SE', 4: 'S', 8: 'SW', 16: 'W', 32: 'NW', 64: 'N', 128: 'NE' }

const km2 = (m2: number) => (m2 / 1e6).toLocaleString('en-IN', { maximumFractionDigits: m2 < 1e5 ? 3 : 2 })
const m3 = (v: number) => Math.round(v).toLocaleString('en-IN')
const m = (v: number, digits = 2) => `${v.toFixed(digits)} m`

export function HydrologySection(props: HydrologySectionProps) {
  const { state, terrainLoaded, layer, thresholdM2, pointer } = props
  const radioName = useId()
  const thresholdId = useId()
  const active = analysisLayer(layer)

  return (
    <section className="panel-section" aria-labelledby="hydro-heading" aria-busy={state.status === 'running'}>
      <h2 id="hydro-heading" className="panel-heading">
        Terrain analysis
      </h2>

      {state.status === 'idle' && (
        <p className="panel-text">
          {terrainLoaded ? 'Preparing analysis…' : 'Load terrain to calculate how water would move across it.'}
        </p>
      )}

      {state.status === 'running' && (
        <ol className="steps" aria-live="polite">
          {STAGES.map((step, order) => {
            const current = STAGES.findIndex((s) => s.id === state.stage)
            const status = order < current ? 'done' : order === current ? 'current' : 'pending'
            return (
              <li key={step.id} className={`step step-${status}`} aria-current={status === 'current' ? 'step' : undefined}>
                {step.label}
              </li>
            )
          })}
        </ol>
      )}

      {state.status === 'error' && (
        <div className="panel-alert" role="alert">
          <p>
            <strong>Analysis failed.</strong> {state.message}
          </p>
          <div className="button-row">
            <button type="button" className="button" onClick={props.onRetry}>
              Try again
            </button>
          </div>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <fieldset className="layer-picker">
            <legend className="layer-picker-title">Map layer</legend>
            {ANALYSIS_LAYERS.map((option) => (
              <label key={option.id} className="layer-option">
                <input
                  type="radio"
                  name={radioName}
                  value={option.id}
                  checked={layer === option.id}
                  onChange={() => props.onLayerChange(option.id)}
                />
                <span className="layer-option-name">{option.name}</span>
                <span className={`badge badge-${option.kind}`}>{option.kind === 'source' ? 'Measured' : 'Derived'}</span>
              </label>
            ))}
          </fieldset>

          <div className="layer-detail">
            <p className="panel-text">{active.explanation}</p>
            {active.classes.length > 0 && (
              <figure className="class-legend">
                <figcaption className="legend-title">
                  {active.name}
                  {active.unit && `, ${active.unit}`}
                </figcaption>
                <ul>
                  {active.classes.map((c) => (
                    <li key={c.label}>
                      <span className="swatch" style={{ background: c.color }} aria-hidden="true" />
                      <span className="mono">{c.label}</span>
                    </li>
                  ))}
                  {active.uncoloured && (
                    <li>
                      <span className="swatch swatch-none" aria-hidden="true" />
                      <span>{active.uncoloured}</span>
                    </li>
                  )}
                </ul>
              </figure>
            )}
            {layer === 'direction' && (
              <p className="panel-note">
                Lines appear from zoom 13. Cells at the area edge with no lower neighbour drain out of the area and have no line.
              </p>
            )}
            {layer === 'elevation' && <p className="panel-note">Legend and range are under Terrain above.</p>}
            <p className="panel-note">{active.caveat}</p>
          </div>

          <div className="parameter">
            <label htmlFor={thresholdId} className="parameter-label">
              Drainage threshold <span className="badge badge-parameter">Parameter</span>
            </label>
            <select
              id={thresholdId}
              className="parameter-select mono"
              value={thresholdM2}
              disabled={state.updating}
              onChange={(event) => props.onThresholdChange(Number(event.target.value))}
            >
              {DRAINAGE_THRESHOLDS_M2.map((value) => (
                <option key={value} value={value}>
                  {km2(value)} km² contributing area
                </option>
              ))}
            </select>
            <p className="panel-note">
              A cell counts as drainage for HAND once this much area drains through it. There is no universal value;
              change it to see how sensitive HAND is.{state.updating && ' Recalculating HAND…'}
            </p>
          </div>

          <dl className="facts">
            <div>
              <dt>Valid cells</dt>
              <dd className="mono">
                {state.result.summary.validCells.toLocaleString('en-IN')}
                {state.result.summary.noDataCells > 0 && ` (+${state.result.summary.noDataCells} no data)`}
              </dd>
            </div>
            <div>
              <dt>Largest contributing area</dt>
              <dd className="mono">{km2(state.result.summary.maxContributingAreaM2)} km²</dd>
            </div>
            <div>
              <dt>Drainage cells</dt>
              <dd className="mono">{state.result.summary.drainageCells.toLocaleString('en-IN')}</dd>
            </div>
            <div>
              <dt>Maximum HAND</dt>
              <dd className="mono">
                {Number.isFinite(state.result.summary.maxHandM) ? m(state.result.summary.maxHandM, 1) : '—'}
              </dd>
            </div>
            {state.result.summary.unreachedCells > 0 && (
              <div>
                <dt>No drainage reached</dt>
                <dd className="mono">{state.result.summary.unreachedCells.toLocaleString('en-IN')} cells</dd>
              </div>
            )}
            <div>
              <dt>Depression storage</dt>
              <dd className="mono">{m3(state.result.summary.totalStorageM3)} m³</dd>
            </div>
            <div>
              <dt>Depressions</dt>
              <dd className="mono">{state.result.summary.depressionCount.toLocaleString('en-IN')}</dd>
            </div>
            <div>
              <dt>Processing</dt>
              <dd className="mono">{state.result.summary.totalMs.toFixed(0)} ms in a worker</dd>
            </div>
          </dl>

          {state.result.depressions.length > 0 && (
            <table className="depressions">
              <caption>Largest depressions (numbered on the storage layer)</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Volume m³</th>
                  <th scope="col">Area m²</th>
                  <th scope="col">Max depth</th>
                </tr>
              </thead>
              <tbody>
                {state.result.depressions.slice(0, 5).map((d) => (
                  <tr key={d.rank}>
                    <td className="mono">
                      {d.rank}
                      {d.nearEdge && <span title="Near the area edge or missing data: its spill level may depend on terrain outside the area."> *</span>}
                    </td>
                    <td className="mono">{m3(d.volumeM3)}</td>
                    <td className="mono">{m3(d.areaM2)}</td>
                    <td className="mono">{m(d.maxDepthM)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {state.result.depressions.slice(0, 5).some((d) => d.nearEdge) && (
            <p className="panel-note">* Near the area edge or missing data; its fill level may depend on terrain outside the selection.</p>
          )}

          <PointerValues state={state} pointer={pointer} />

          <p className="panel-note">
            All analysis layers are calculated from the 30 m surface model in your browser. Bridges, buildings and
            embankments in the data can block or divert modelled flow, and drains and culverts are not represented. These
            are terrain indicators, not a flood forecast.
          </p>
        </>
      )}
    </section>
  )
}

function PointerValues({ state, pointer }: { state: Extract<HydrologyState, { status: 'ready' }>; pointer: PointerPosition | null }) {
  const cell = pointer ? cellAt(state.grid, pointer.lng, pointer.lat) : null
  const i = cell ? cell.row * state.grid.width + cell.col : -1
  const valid = i >= 0 && Number.isFinite(state.grid.values[i])
  const r = state.result
  const code = valid ? r.directions[i] : 0
  const flow = NEIGHBOURS.some((n) => n.code === code) ? `${ARROWS[code]} ${DIRECTION_NAMES[code]} (${code})` : 'Out of area'

  return (
    <div className="pointer-values" aria-live="off">
      <h3 className="legend-title">At the pointer</h3>
      {valid ? (
        <dl className="facts">
          <div>
            <dt>Fill depth</dt>
            <dd className="mono">{m(r.fillDepthM[i])}</dd>
          </div>
          <div>
            <dt>Flows to</dt>
            <dd className="mono">{flow}</dd>
          </div>
          <div>
            <dt>Contributing area</dt>
            <dd className="mono">
              {km2(r.accumulationAreaM2[i])} km² · {r.accumulationCells[i].toLocaleString('en-IN')} cells
            </dd>
          </div>
          <div>
            <dt>HAND</dt>
            <dd className="mono">{Number.isFinite(r.hand[i]) ? m(r.hand[i]) : 'No drainage reached'}</dd>
          </div>
          <div>
            <dt>Storage in cell</dt>
            <dd className="mono">{m3(r.storageM3[i])} m³</dd>
          </div>
        </dl>
      ) : (
        <p className="panel-note">Move the pointer over the analysed area.</p>
      )}
    </div>
  )
}
