import { useEffect, useRef } from 'react'
import { DEEP_HOLLOW_M, HOTSPOT_RULES } from '../../lib/hydrology/hotspots'
import { MIN_CLASSIFIED_SHARE } from '../../lib/hydrology/runoff'
import { WORLDCOVER_CLASSES } from '../../lib/landcover/classes'
import { WORLDCOVER_SOURCE } from '../../lib/landcover/worldcover'
import './MethodologyDialog.css'

interface MethodologyDialogProps {
  open: boolean
  onClose: () => void
}

const R = HOTSPOT_RULES

/** Method, assumptions and limits. Tables are generated from the same constants the engine uses. */
export function MethodologyDialog({ open, onClose }: MethodologyDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog ref={dialog} className="methodology" aria-labelledby="method-title" onClose={onClose}>
      <header>
        <h2 id="method-title">Method and limitations</h2>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="methodology-body">
        <p>
          <strong>PaaniPulse is a scenario-based screening prototype.</strong> It shows where the terrain model concentrates
          or holds water under a hypothetical rainfall total, and why. It is not a flood forecast, a warning system or a
          hydraulic simulation, and does not replace official warnings.
        </p>

        <h3>What each output is</h3>
        <table>
          <tbody>
            <tr>
              <th scope="row">Measured</th>
              <td>Copernicus DEM GLO-30 elevation (≈30 m surface model, includes buildings, trees and bridges).</td>
            </tr>
            <tr>
              <th scope="row">Derived</th>
              <td>Depression filling, D8 flow direction, flow accumulation, HAND and depression storage, all computed from the elevation.</td>
            </tr>
            <tr>
              <th scope="row">Hypothetical input</th>
              <td>The rainfall total you choose. No observed or forecast rainfall is used.</td>
            </tr>
            <tr>
              <th scope="row">Simulated</th>
              <td>Runoff, depression filling, spill and ponding: a volume balance on the terrain model.</td>
            </tr>
            <tr>
              <th scope="row">Screening</th>
              <td>Relative hotspot categories from documented points.</td>
            </tr>
            <tr>
              <th scope="row">Reported</th>
              <td>Waterlogging in dated news articles, shown as context only.</td>
            </tr>
          </tbody>
        </table>

        <h3>Runoff</h3>
        <p className="formula mono">runoff (m³) = rainfall (mm) ÷ 1000 × C × cell area (m²)</p>
        <p>
          C is the area-weighted mean of the coefficients of the {WORLDCOVER_SOURCE.name} pixels in each cell (about nine
          10 m pixels per 30 m cell). Cells with under {MIN_CLASSIFIED_SHARE * 100}% of pixels classified get no
          coefficient and generate no runoff. The coefficients are assumptions, not calibrated or measured values:
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Land cover</th>
              <th scope="col">C</th>
              <th scope="col">Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {WORLDCOVER_CLASSES.map((c) => (
              <tr key={c.code}>
                <th scope="row">{c.name}</th>
                <td className="mono">{c.coefficient.toFixed(2)}</td>
                <td>{c.reasoning}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Fill and spill</h3>
        <p>
          Each terrain depression is a reservoir with its computed storage capacity. Runoff is passed downstream along the D8
          network; water reaching a depression joins it until it is full, then the excess leaves through its exit. Water
          reaching the edge of the area leaves it. Stored water fills each hollow from its lowest cells. The app reports
          generated, held and departing volumes and the residual, which stays at rounding level. There is no timing, flow
          speed, evaporation or drainage network.
        </p>

        <h3>Hotspot screening</h3>
        <table>
          <thead>
            <tr>
              <th scope="col">Criterion</th>
              <th scope="col">2 points</th>
              <th scope="col">1 point</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Modelled ponding depth</th>
              <td className="mono">≥ {R.ponding.strongM} m</td>
              <td className="mono">≥ {R.ponding.weakM} m</td>
            </tr>
            <tr>
              <th scope="row">Runoff passing the cell</th>
              <td>≥ runoff from {R.runoff.strongM2 / 1e6} km²</td>
              <td>≥ runoff from {R.runoff.weakM2 / 1e6} km²</td>
            </tr>
            <tr>
              <th scope="row">Height above nearest drainage</th>
              <td className="mono">≤ {R.hand.strongM} m</td>
              <td className="mono">≤ {R.hand.weakM} m</td>
            </tr>
            <tr>
              <th scope="row">Slope of measured ground</th>
              <td>—</td>
              <td className="mono">&lt; {R.flat.maxSlopePct}%</td>
            </tr>
          </tbody>
        </table>
        <p>
          Higher relative concentration potential needs {R.higherMinPoints}–7 points, moderate {R.moderateMinPoints}–
          {R.higherMinPoints - 1}, and either needs at least one point from ponding or runoff. The water criteria carry
          two points each and slope one, because slope slows drainage rather than concentrating water; there is no
          calibration data to justify finer weights. Runoff thresholds use the area's mean coefficient, so they scale with
          the scenario. Hotspots with a hollow deeper than {DEEP_HOLLOW_M} m or mostly on permanent water have reduced
          confidence and are ranked after others in their category.
        </p>

        <h3>Rainfall data</h3>
        <p>
          IMD publishes 0.25° gridded daily rainfall, but its terms of use and redistribution could not be confirmed, so no
          historical rainfall is bundled. Scenario totals are hypothetical.
        </p>

        <h3>Known limitations</h3>
        <ul>
          <li>30 m surface elevation misses kerbs, drains, culverts, underpasses and narrow channels; walls, buildings and bridges can create false hollows and barriers.</li>
          <li>Drains, pumps and infiltration after runoff are not modelled, so held volumes overstate what would remain in a real city.</li>
          <li>Only the selected area is modelled; inflow from outside it is ignored.</li>
          <li>Coefficients and scoring thresholds are assumptions; categories are relative to the area and scenario.</li>
          <li>Rainfall is uniform over the area, with no duration or intensity.</li>
        </ul>
      </div>
    </dialog>
  )
}
