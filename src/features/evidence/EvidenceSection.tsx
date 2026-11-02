import { INCIDENT_POINTS, INCIDENT_REPORTS, pointsInside, UNMAPPED_PLACES } from '../../lib/evidence/incidents'
import type { Bbox } from '../../lib/geo/bbox'

interface EvidenceSectionProps {
  selection: Bbox | null
  visible: boolean
  onVisibleChange: (visible: boolean) => void
}

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export function EvidenceSection({ selection, visible, onVisibleChange }: EvidenceSectionProps) {
  const inside = selection ? pointsInside(selection) : []

  return (
    <section className="panel-section" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading" className="panel-heading">
        Documented reports <span className="badge badge-documented">Reported</span>
      </h2>
      <p className="panel-text">
        Waterlogging reported in dated news articles. Coverage is incomplete and limited to Madurai so far. Reports are
        context, not model output, and are not used to tune or validate it.
      </p>
      <label className="evidence-toggle">
        <input type="checkbox" checked={visible} onChange={(event) => onVisibleChange(event.target.checked)} />
        Show {INCIDENT_POINTS.length} reported places on the map
      </label>
      {selection && (
        <p className="panel-note">
          {inside.length === 0
            ? 'No reported place falls inside the selected area.'
            : `${inside.length} reported place${inside.length > 1 ? 's' : ''} inside the selected area: ${[...new Set(inside.map((p) => p.place))].join(', ')}.`}
        </p>
      )}
      <ul className="evidence-list">
        {INCIDENT_REPORTS.map((report) => {
          const mapped = INCIDENT_POINTS.filter((p) => p.reportId === report.id).map((p) => p.place)
          const unmapped = UNMAPPED_PLACES.filter((p) => p.reportId === report.id)
          return (
            <li key={report.id}>
              <p className="evidence-title">
                {report.eventDate ? formatDate(report.eventDate) : 'Recurring'} ·{' '}
                <a href={report.url}>{report.publisher}</a>, published {formatDate(report.publishedOn)}
              </p>
              <p className="panel-note">{report.summary}</p>
              {mapped.length > 0 && <p className="panel-note">Mapped: {mapped.join(', ')}.</p>}
              {unmapped.length > 0 && (
                <details className="evidence-unmapped">
                  <summary>{unmapped.length} not mapped</summary>
                  <ul>
                    {unmapped.map((u) => (
                      <li key={u.place}>
                        {u.place}: {u.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          )
        })}
      </ul>
      <p className="panel-note">Map points are approximate locality or facility centres from OpenStreetMap, not the exact spots affected.</p>
    </section>
  )
}
