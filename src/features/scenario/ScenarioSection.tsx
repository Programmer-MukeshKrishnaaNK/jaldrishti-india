import { useId, useState } from 'react'
import type { LandCoverState } from '../../hooks/useLandCover'
import type { ScenarioState } from '../../hooks/useHydrology'
import { WORLDCOVER_CLASSES } from '../../lib/landcover/classes'
import { WORLDCOVER_SOURCE } from '../../lib/landcover/worldcover'
import { MAX_RAINFALL_MM } from '../../lib/hydrology/runoff'
import { PRESET_RAINFALL_MM } from '../../lib/hydrology/scenario'
import './ScenarioSection.css'

export type CoefficientMode = { kind: 'landcover' } | { kind: 'uniform'; value: number }

interface ScenarioSectionProps {
  analysisReady: boolean
  landCover: LandCoverState
  onRetryLandCover: () => void
  coefficients: number[]
  onCoefficientsChange: (coefficients: number[]) => void
  mode: CoefficientMode
  onModeChange: (mode: CoefficientMode) => void
  rainfallMm: number
  onRainfallChange: (mm: number) => void
  scenario: ScenarioState
  onRun: () => void
}

const m3 = (v: number) => Math.round(v).toLocaleString('en-IN')
const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`
const ha = (m2: number) => (m2 / 1e4).toLocaleString('en-IN', { maximumFractionDigits: 1 })

export function ScenarioSection(props: ScenarioSectionProps) {
  const { analysisReady, landCover, mode, rainfallMm, scenario } = props
  const customId = useId()
  const [custom, setCustom] = useState('')
  const isPreset = (PRESET_RAINFALL_MM as readonly number[]).includes(rainfallMm)
  const customValue = Number(custom)
  const customValid = custom.trim() !== '' && Number.isFinite(customValue) && customValue > 0 && customValue <= MAX_RAINFALL_MM

  const coefficientsReady = mode.kind === 'uniform' || landCover.status === 'ready'
  const canRun = analysisReady && coefficientsReady && scenario.status !== 'running'

  return (
    <section className="panel-section" aria-labelledby="scenario-heading" aria-busy={scenario.status === 'running'}>
      <h2 id="scenario-heading" className="panel-heading">
        <span className="panel-step" aria-hidden="true">03</span>
        Rainfall scenario
      </h2>

      {!analysisReady ? (
        <p className="panel-text">Load terrain first; scenarios build on the terrain analysis.</p>
      ) : (
        <>
          <p className="panel-text">
            A <strong>hypothetical</strong> rainfall total over the whole area, not an observation or a forecast.
          </p>

          <div className="rain-options" role="radiogroup" aria-label="Rainfall total">
            {PRESET_RAINFALL_MM.map((mm) => (
              <button
                key={mm}
                type="button"
                role="radio"
                aria-checked={rainfallMm === mm}
                className="rain-option mono"
                onClick={() => props.onRainfallChange(mm)}
              >
                {mm} mm
              </button>
            ))}
          </div>
          <form
            className="rain-custom"
            onSubmit={(event) => {
              event.preventDefault()
              if (customValid) props.onRainfallChange(customValue)
            }}
          >
            <label htmlFor={customId}>Custom</label>
            <input
              id={customId}
              className="mono"
              type="number"
              inputMode="decimal"
              min={1}
              max={MAX_RAINFALL_MM}
              step={1}
              placeholder="mm"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              aria-invalid={custom.trim() !== '' && !customValid}
            />
            <button type="submit" className="button" disabled={!customValid}>
              Use
            </button>
          </form>
          {custom.trim() !== '' && !customValid && (
            <p className="field-error">Enter a rainfall total between 1 and {MAX_RAINFALL_MM} mm.</p>
          )}
          {!isPreset && <p className="panel-note">Custom scenario: {rainfallMm} mm.</p>}

          <div className="coefficient-source">
            <h3 className="legend-title">Runoff coefficients</h3>
            {mode.kind === 'uniform' ? (
              <div className="panel-alert">
                <p>
                  <strong>Uniform assumption.</strong> Every cell uses C = {mode.value.toFixed(2)}; land cover is not used.
                </p>
                <label className="uniform-value">
                  C
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={mode.value}
                    onChange={(event) => props.onModeChange({ kind: 'uniform', value: Number(event.target.value) })}
                  />
                  <span className="mono">{mode.value.toFixed(2)}</span>
                </label>
                {landCover.status === 'ready' && (
                  <button type="button" className="button" onClick={() => props.onModeChange({ kind: 'landcover' })}>
                    Use land cover instead
                  </button>
                )}
              </div>
            ) : landCover.status === 'loading' ? (
              <p className="panel-text">Loading ESA WorldCover land cover…</p>
            ) : landCover.status === 'error' ? (
              <div className="panel-alert" role="alert">
                <p>
                  <strong>Land cover unavailable.</strong> {landCover.message}
                </p>
                <div className="button-row">
                  <button type="button" className="button" onClick={props.onRetryLandCover}>
                    Try again
                  </button>
                  <button type="button" className="button" onClick={() => props.onModeChange({ kind: 'uniform', value: 0.6 })}>
                    Use one coefficient
                  </button>
                </div>
              </div>
            ) : landCover.status === 'ready' ? (
              <details className="coefficients">
                <summary>
                  From {WORLDCOVER_SOURCE.name} <span className="badge badge-parameter">Assumptions</span>
                </summary>
                <p className="panel-note">
                  Share of runoff per land-cover class. These are PaaniPulse assumptions, not local measurements; edit
                  them to test sensitivity. Cells with under half their pixels classified get no coefficient.
                </p>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Class</th>
                      <th scope="col">Area share</th>
                      <th scope="col">C</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WORLDCOVER_CLASSES.map((c, k) =>
                      landCover.classShare[k] > 0 ? (
                        <tr key={c.code}>
                          <th scope="row" title={c.reasoning}>
                            {c.name}
                          </th>
                          <td className="mono">{pct(landCover.classShare[k])}</td>
                          <td>
                            <input
                              className="mono"
                              type="number"
                              min={0}
                              max={1}
                              step={0.05}
                              aria-label={`Runoff coefficient for ${c.name}`}
                              value={props.coefficients[k]}
                              onChange={(event) => {
                                const v = Math.min(1, Math.max(0, Number(event.target.value)))
                                if (!Number.isFinite(v)) return
                                const next = [...props.coefficients]
                                next[k] = v
                                props.onCoefficientsChange(next)
                              }}
                            />
                          </td>
                        </tr>
                      ) : null,
                    )}
                  </tbody>
                </table>
                {landCover.missingShare > 0 && (
                  <p className="panel-note">Unclassified pixels: {pct(landCover.missingShare)} of the area.</p>
                )}
                <ul className="reasoning">
                  {WORLDCOVER_CLASSES.filter((_, k) => landCover.classShare[k] > 0).map((c) => (
                    <li key={c.code}>
                      <strong>{c.name}:</strong> {c.reasoning}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => props.onCoefficientsChange(WORLDCOVER_CLASSES.map((c) => c.coefficient))}
                >
                  Reset to defaults
                </button>
              </details>
            ) : null}
          </div>

          <button type="button" className="button button-primary" disabled={!canRun} onClick={props.onRun}>
            {scenario.status === 'running' ? 'Running scenario…' : `Run ${rainfallMm} mm scenario`}
          </button>

          {scenario.status === 'error' && (
            <div className="panel-alert" role="alert">
              <p>
                <strong>Scenario failed.</strong> {scenario.message}
              </p>
              <div className="button-row">
                <button type="button" className="button" onClick={props.onRun}>
                  Try again
                </button>
              </div>
            </div>
          )}

          {scenario.status === 'ready' && (
            <div className="scenario-results" aria-live="polite">
              {scenario.stale && (
                <p className="panel-alert">The drainage threshold changed. Run the scenario again to update the results.</p>
              )}
              {scenario.result.rainfallMm !== rainfallMm && (
                <p className="panel-note">Results below are for {scenario.result.rainfallMm} mm. Run again to apply {rainfallMm} mm.</p>
              )}
              <MassBalance scenario={scenario} />
              <Comparison scenario={scenario} />
            </div>
          )}
        </>
      )}
    </section>
  )
}

function MassBalance({ scenario }: { scenario: Extract<ScenarioState, { status: 'ready' }> }) {
  const s = scenario.result.summary
  return (
    <>
      <h3 className="legend-title">
        Volume balance, {s.rainfallMm} mm <span className="badge badge-scenario">Simulated</span>
      </h3>
      <dl className="facts">
        <div>
          <dt>Runoff generated</dt>
          <dd className="mono">{m3(s.generatedM3)} m³</dd>
        </div>
        <div>
          <dt>Held in terrain hollows</dt>
          <dd className="mono">
            {m3(s.storedM3)} m³ ({s.generatedM3 > 0 ? pct(s.storedM3 / s.generatedM3) : '—'})
          </dd>
        </div>
        <div>
          <dt>Leaves the area</dt>
          <dd className="mono">{m3(s.exitedM3)} m³</dd>
        </div>
        <div>
          <dt>Residual</dt>
          <dd className="mono">{s.residualM3.toExponential(1)} m³</dd>
        </div>
        <div>
          <dt>Mean runoff coefficient</dt>
          <dd className="mono">{Number.isFinite(s.meanCoefficient) ? s.meanCoefficient.toFixed(3) : '—'}</dd>
        </div>
        {s.missingCoefficientCells > 0 && (
          <div>
            <dt>Cells without land cover</dt>
            <dd className="mono">{s.missingCoefficientCells.toLocaleString('en-IN')} (no runoff)</dd>
          </div>
        )}
        <div>
          <dt>Depressions reached / overflowing</dt>
          <dd className="mono">
            {s.depressionsReached} / {s.depressionsSpilling}
          </dd>
        </div>
        <div>
          <dt>Processing</dt>
          <dd className="mono">{scenario.elapsedMs.toFixed(0)} ms incl. comparison</dd>
        </div>
      </dl>
      <p className="panel-note">
        Held water stays in the model’s hollows; drains, pumps and infiltration after runoff are not modelled, so in a real
        city much of it could drain away.
      </p>
    </>
  )
}

function Comparison({ scenario }: { scenario: Extract<ScenarioState, { status: 'ready' }> }) {
  const rows = scenario.result.comparison
  return (
    <table className="comparison">
      <caption>Scenario comparison (same terrain and coefficients)</caption>
      <thead>
        <tr>
          <th scope="col">Rain</th>
          <th scope="col">Runoff m³</th>
          <th scope="col">Leaves area</th>
          <th scope="col">Overflowing</th>
          <th scope="col">Higher ha</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.rainfallMm} aria-current={s.rainfallMm === scenario.result.rainfallMm ? 'true' : undefined}>
            <th scope="row" className="mono">
              {s.rainfallMm} mm
            </th>
            <td className="mono">{m3(s.generatedM3)}</td>
            <td className="mono">{s.generatedM3 > 0 ? pct(s.exitedM3 / s.generatedM3) : '—'}</td>
            <td className="mono">{s.depressionsSpilling}</td>
            <td className="mono">{ha(s.higherAreaM2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
