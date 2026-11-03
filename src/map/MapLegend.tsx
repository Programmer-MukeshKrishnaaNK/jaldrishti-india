import { useState } from 'react'
import { ELEVATION_RAMP } from '../lib/dem/render'
import type { AnalysisLayer } from '../lib/hydrology/layers'

interface MapLegendProps {
  /** The layer drawn on the map, or null before terrain is loaded. */
  layer: AnalysisLayer | null
  /** Stretch of the elevation colours, in metres. */
  elevation: { low: number; high: number } | null
  hotspots: boolean
  reports: boolean
}

const KIND = { source: 'Measured', derived: 'Derived', scenario: 'Simulated' } as const

const gradient = `linear-gradient(to right, ${ELEVATION_RAMP.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`

/** Key to what is drawn on the 2D map. The same classes are explained in full in the panel. */
export function MapLegend({ layer, elevation, hotspots, reports }: MapLegendProps) {
  // Starts collapsed on phones, where the open key would cover much of the map.
  const [initiallyOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  if (!layer && !reports) return null
  return (
    <details className="map-legend" open={initiallyOpen}>
      <summary>
        <span className="map-legend-title">{layer ? layer.name : 'Map key'}</span>
        {layer && <span className={`badge badge-${layer.kind}`}>{KIND[layer.kind]}</span>}
      </summary>
      <div className="map-legend-body">
        {layer?.id === 'elevation' && elevation && (
          <figure className="legend">
            <div className="legend-bar" style={{ background: gradient }} aria-hidden="true" />
            <div className="legend-scale mono">
              <span>{elevation.low.toFixed(1)} m</span>
              <span>{elevation.high.toFixed(1)} m</span>
            </div>
          </figure>
        )}
        {layer?.id === 'direction' && <p className="map-legend-note">Lines point downhill, darkest at the arrow end.</p>}
        {layer && layer.classes.length > 0 && (
          <ul className="map-legend-classes">
            {layer.classes.map((c) => (
              <li key={c.label}>
                <span className="swatch" style={{ background: c.color }} aria-hidden="true" />
                <span className={layer.unit ? 'mono' : undefined}>
                  {c.label}
                  {layer.unit && ` ${layer.unit}`}
                </span>
              </li>
            ))}
            {layer.uncoloured && (
              <li>
                <span className="swatch swatch-none" aria-hidden="true" />
                <span>{layer.uncoloured}</span>
              </li>
            )}
          </ul>
        )}
        {(hotspots || reports) && (
          <ul className="map-legend-classes map-legend-symbols">
            {hotspots && (
              <li>
                <span className="symbol-hotspot mono" aria-hidden="true">
                  1
                </span>
                <span>Ranked hotspot</span>
              </li>
            )}
            {reports && (
              <li>
                <span className="symbol-report" aria-hidden="true" />
                <span>Documented report</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </details>
  )
}
