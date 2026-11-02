import type { ScenarioState } from '../../hooks/useHydrology'
import type { ElevationGrid } from '../../lib/dem/types'
import { nearestPoint, reportFor } from '../../lib/evidence/incidents'
import { formatLatitude, formatLongitude } from '../../lib/format'
import { explainHotspot } from '../../lib/hydrology/explain'
import { HOTSPOT_RULES, type Hotspot } from '../../lib/hydrology/hotspots'
import { gridToLngLat } from '../../map/analysisFeatures'
import './HotspotSection.css'

interface HotspotSectionProps {
  scenario: ScenarioState
  grid: ElevationGrid | null
  selectedRank: number | null
  onSelect: (hotspot: Hotspot | null) => void
}

const LIST_LENGTH = 10
const m3 = (v: number) => Math.round(v).toLocaleString('en-IN')
const km2 = (m2: number) => (m2 / 1e6).toLocaleString('en-IN', { maximumFractionDigits: m2 < 1e5 ? 3 : 2 })
const metres = (v: number, d = 2) => (Number.isFinite(v) ? `${v.toFixed(d)} m` : '—')

const CATEGORY_LABEL = { higher: 'Higher', moderate: 'Moderate' } as const

export function HotspotSection({ scenario, grid, selectedRank, onSelect }: HotspotSectionProps) {
  if (scenario.status !== 'ready' || !grid) {
    return (
      <section className="panel-section" aria-labelledby="hotspot-heading">
        <h2 id="hotspot-heading" className="panel-heading">
          Hotspots
        </h2>
        <p className="panel-text">Run a rainfall scenario to screen for places where the model concentrates water.</p>
      </section>
    )
  }

  const { hotspots, rainfallMm, fills } = scenario.result
  const selected = hotspots.find((h) => h.rank === selectedRank) ?? null
  const higher = hotspots.filter((h) => h.category === 'higher').length

  return (
    <section className="panel-section" aria-labelledby="hotspot-heading">
      <h2 id="hotspot-heading" className="panel-heading">
        Hotspots, {rainfallMm} mm <span className="badge badge-scenario">Relative screening</span>
      </h2>
      {hotspots.length === 0 ? (
        <p className="panel-text">
          No cell reaches the moderate category in this scenario: nowhere does modelled ponding or passing runoff combine
          with low, flat ground enough to score {HOTSPOT_RULES.moderateMinPoints} points.
        </p>
      ) : (
        <>
          <p className="panel-text">
            {higher} higher and {hotspots.length - higher} moderate hotspots. Categories compare places within this area
            under this scenario; they are not flood probabilities.
          </p>
          <ol className="hotspot-list">
            {hotspots.slice(0, LIST_LENGTH).map((h) => (
              <li key={h.rank}>
                <button
                  type="button"
                  className="hotspot-item"
                  aria-pressed={h.rank === selectedRank}
                  onClick={() => onSelect(h.rank === selectedRank ? null : h)}
                >
                  <span className="hotspot-rank mono">{h.rank}</span>
                  <span className={`hotspot-category category-${h.category}`}>{CATEGORY_LABEL[h.category]}</span>
                  <span className="hotspot-figures mono">
                    {h.peak.points}/7 · {m3(h.areaM2)} m²
                    {h.maxPondDepthM > 0 && ` · ponds ${metres(h.maxPondDepthM)}`}
                  </span>
                  {h.confidence === 'reduced' && <span className="hotspot-flag">Reduced confidence</span>}
                </button>
              </li>
            ))}
          </ol>
          {hotspots.length > LIST_LENGTH && (
            <p className="panel-note">Showing the top {LIST_LENGTH} of {hotspots.length}; all are drawn on the hotspot layer.</p>
          )}
        </>
      )}

      {selected && <WhyHere hotspot={selected} grid={grid} rainfallMm={rainfallMm} fills={fills} onClose={() => onSelect(null)} />}
    </section>
  )
}

function WhyHere({
  hotspot,
  grid,
  rainfallMm,
  fills,
  onClose,
}: {
  hotspot: Hotspot
  grid: ElevationGrid
  rainfallMm: number
  fills: Parameters<typeof explainHotspot>[2]
  onClose: () => void
}) {
  const explanation = explainHotspot(hotspot, rainfallMm, fills)
  const row = Math.floor(hotspot.peak.index / grid.width)
  const col = hotspot.peak.index % grid.width
  const [lng, lat] = gridToLngLat(grid, row + 0.5, col + 0.5)
  const nearest = nearestPoint({ lat, lng })
  const report = nearest && reportFor(nearest.point.reportId)
  const depression = hotspot.depressionRanks.map((r) => fills[r - 1]).find(Boolean)

  return (
    <article className="why-here" aria-labelledby="why-heading">
      <header>
        <h3 id="why-heading">Why here? Hotspot {hotspot.rank}</h3>
        <button type="button" className="button button-quiet" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="why-headline">{explanation.headline}</p>
      <ul className="why-reasons">
        {explanation.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      <dl className="facts">
        <div>
          <dt>Scoring cell</dt>
          <dd className="mono">
            {formatLatitude(lat)} {formatLongitude(lng)}
          </dd>
        </div>
        <div>
          <dt>Elevation (measured)</dt>
          <dd className="mono">{metres(hotspot.peak.elevationM, 1)}</dd>
        </div>
        <div>
          <dt>Contributing area</dt>
          <dd className="mono">{km2(hotspot.peak.contributingAreaM2)} km²</dd>
        </div>
        <div>
          <dt>HAND</dt>
          <dd className="mono">{metres(hotspot.peak.handM)}</dd>
        </div>
        <div>
          <dt>Slope</dt>
          <dd className="mono">{hotspot.peak.slopePct.toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Runoff passing</dt>
          <dd className="mono">
            {hotspot.peak.pondDepthM > 0 && depression
              ? `collects in #${depression.rank} (${m3(depression.inflowM3)} m³ in)`
              : `${m3(hotspot.peak.passingM3)} m³`}
          </dd>
        </div>
        <div>
          <dt>Modelled ponding</dt>
          <dd className="mono">
            {metres(hotspot.maxPondDepthM)} max · {m3(hotspot.pondedVolumeM3)} m³
          </dd>
        </div>
        {depression && (
          <div>
            <dt>Depression #{depression.rank}</dt>
            <dd className="mono">
              {Math.round(depression.fillFraction * 100)}% of {m3(depression.capacityM3)} m³
              {depression.status === 'spilling' ? ', overflowing' : ''}
            </dd>
          </div>
        )}
        <div>
          <dt>Hotspot size</dt>
          <dd className="mono">
            {hotspot.cells} cells · {m3(hotspot.areaM2)} m²
          </dd>
        </div>
      </dl>

      {explanation.notCounted.length > 0 && (
        <>
          <h4 className="legend-title">Did not add points</h4>
          <ul className="why-minor">
            {explanation.notCounted.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}

      <h4 className="legend-title">How far to trust this</h4>
      <ul className="why-cautions">
        {explanation.cautions.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>

      {nearest && report && nearest.distanceM < 3000 && (
        <p className="panel-note">
          Nearest documented report location: {nearest.point.place} (approximate {nearest.point.precision} centre),{' '}
          {Math.round(nearest.distanceM).toLocaleString('en-IN')} m away, from{' '}
          <a href={report.url}>{report.publisher}</a>
          {report.eventDate ? `, ${report.eventDate}` : ''}. Shown as context; it does not confirm this result.
        </p>
      )}
    </article>
  )
}
