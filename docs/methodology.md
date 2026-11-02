# PaaniPulse methodology

PaaniPulse is a scenario-based screening prototype. It shows where the terrain model concentrates or holds water under a hypothetical rainfall depth, and why. It is not a flood forecast, a warning system or a hydraulic simulation, and it does not replace official warnings.

## What each output is

| Output | Kind | Source |
|---|---|---|
| Elevation | Measured (surface model) | Copernicus DEM GLO-30 |
| Filling depth, flow direction, accumulation, HAND, depression storage | Derived from elevation | Phase 2 engine |
| Rainfall scenario | Hypothetical input chosen by the user | — |
| Runoff | Estimated from rainfall and land-cover assumptions | ESA WorldCover 2021 + coefficients below |
| Ponding, depression fill and spill | Modelled volume balance | This page |
| Hotspot categories | Relative screening classes | Rules below |
| Documented reports | Third-party reports, not model output | News articles listed in the app |

## Data

- **Elevation:** Copernicus DEM GLO-30, one arc-second (about 30 m), a surface model that includes buildings, trees and bridges. Stated absolute vertical accuracy better than 4 m (90% of points). Read through Microsoft Planetary Computer.
- **Land cover:** ESA WorldCover 10 m 2021 v200 (CC BY 4.0), read through Microsoft Planetary Computer. Each 10 m pixel is assigned to the elevation cell containing its centre, so a 30 m cell typically contains about nine pixels.
- **Rainfall:** no observed rainfall is used. IMD's 0.25° gridded daily rainfall is publicly downloadable, but its terms of use and redistribution could not be confirmed, so it is not bundled.

## Runoff

For each elevation cell:

    runoff (m³) = rainfall (m) × C × cell area (m²)

with rainfall entered in millimetres and divided by 1000, and the cell area from that row's real east–west and north–south size. C is the area-weighted mean of the coefficients of the land-cover pixels in the cell. If fewer than half of a cell's pixels have a land-cover class, it has no coefficient and generates no runoff; the app reports how many cells this affects.

The coefficients are PaaniPulse assumptions, chosen with the reasoning shown in the app and editable there. Rational-method tables (for example the CPHEEO Manual on Storm Water Drainage Systems, 2019, and FHWA HEC-22) give ranges by surface type, and WorldCover classes are broader than those types, so none of the values below is a table value or a local measurement.

| Class | C | Reasoning |
|---|---|---|
| Tree cover | 0.15 | Interception and well-infiltrating soils |
| Shrubland | 0.25 | Sparser cover than trees |
| Grassland | 0.25 | Comparable to parks and lawns on mixed soils |
| Cropland | 0.30 | Compacted or bare between crops |
| Built-up | 0.80 | Roofs and paving are typically 0.85–0.95; lowered because built-up pixels include gaps and unpaved lanes |
| Bare / sparse vegetation | 0.50 | Crusted or compacted earth |
| Snow and ice | 0.90 | Frozen surface |
| Permanent water | 1.00 | Rain on water joins the water body |
| Herbaceous wetland | 0.80 | Usually saturated |
| Mangroves | 0.80 | Tidal, saturated ground |
| Moss and lichen | 0.30 | Thin cover; rare in India |

The coefficient is applied to the whole event depth. There is no rainfall intensity, duration or timing, and no infiltration beyond what the coefficient implies.

## Fill and spill

Each depression found in Phase 2 is a reservoir whose capacity is its terrain storage volume. Runoff is passed downstream along the D8 network in topological order. Water that reaches any cell of a depression, including rain on the depression itself, joins its reservoir. A depression stores inflow up to its capacity; the excess leaves through its exit, the cell after the last depression cell on the D8 path from its deepest cell. Water that reaches an outlet cell leaves the area.

Within a partly filled depression, the stored volume is placed by filling its lowest cells first (a bathtub fill) to give a modelled water level and ponding depth. The app reports generated, stored and exited volume and the residual (generated − stored − exited), which is at rounding level (around 10⁻⁸ m³ in real areas).

This is a volume balance on a terrain model. It has no timing, no flow velocity, no evaporation, and no drains, culverts or pumps, which in cities can carry away much of the water the model stores.

## Hotspot screening

Each cell earns points:

| Criterion | 2 points | 1 point |
|---|---|---|
| Modelled ponding depth | ≥ 0.5 m | ≥ 0.1 m |
| Scenario runoff passing through the cell | ≥ the runoff generated on 0.5 km² at the area's mean C | ≥ the same for 0.1 km² |
| HAND | ≤ 1 m | ≤ 3 m |
| Slope of the measured surface | — | < 1% |

The three water-concentration criteria carry up to two points each; slope carries one because it slows drainage rather than concentrating water. There is no calibration data, so the points are deliberately coarse.

- **Higher relative concentration potential:** 5–7 points.
- **Moderate relative concentration potential:** 3–4 points.
- **Lower:** fewer points, or no points from ponding or runoff. A cell needs a water criterion to rise above lower, so zero rainfall produces no hotspots.

Adjacent higher and moderate cells form a hotspot. Hotspots are ranked higher before moderate, then standard before reduced confidence, then by points × area and by ponded volume. Confidence is reduced when a hotspot overlaps a hollow more than 3 m deep (often walls, buildings, embankments or bridges in a surface model) or lies mostly on permanent water. Each explanation is generated from the hotspot's own values, one sentence per scoring criterion.

These categories are relative within the selected area. They are not probabilities and not official risk categories.

## Documented reports

Reports come from dated news articles listed in the app. Each named place is located with OpenStreetMap: a locality only when OpenStreetMap has a place of that kind (suburb, neighbourhood and similar), and a named facility as that facility. Places without a suitable match are listed without a point. Points are approximate locality centres, not the exact spots affected. The reports are shown as context; PaaniPulse makes no claim that they validate the model.

## Known limitations

- 30 m surface elevation cannot resolve kerbs, drains, culverts, underpasses or narrow channels, and buildings, walls and bridges can create false hollows and barriers. In one Madurai test area the largest hollows lie on the Meenakshi Amman Temple complex and on the Vaigai river.
- Only the selected area is modelled; water from outside it is ignored and water leaving it is reported but not followed.
- Runoff coefficients and screening thresholds are assumptions, not calibrated parameters.
- Rainfall is uniform over the area and has no duration or intensity.
