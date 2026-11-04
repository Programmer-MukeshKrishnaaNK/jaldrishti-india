# PaaniPulse

**See where rainwater goes.**

PaaniPulse is a map-first web application for exploring terrain, rainfall scenarios and potential urban waterlogging across India. It keeps four things separate:

1. relatively low-lying terrain,
2. where surface runoff converges,
3. where water could accumulate under a stated rainfall scenario (simulated),
4. waterlogging incidents documented by an identifiable source.

Simulated results are never presented as flood predictions.

## Status

Working now:

- Interactive basemap of India.
- Place search across India: a bundled list of states, districts, cities and larger towns, live suggestions from Photon, and full search via Nominatim.
- Analysis-area selection: a 3 × 3 km square at a searched place or the map centre, or a rectangle drawn on the map, limited to 25 km².
- Real elevation for the selected area, read in the browser from Copernicus DEM GLO-30 and shown as a colour-and-hillshade terrain image with a legend and a pointer readout.
- Terrain flow analysis of the loaded elevation, run in a Web Worker: depression filling, D8 flow direction, flow accumulation, height above nearest drainage (HAND) and depression storage, each shown as a map layer with a legend, units and values at the pointer.
- Hypothetical rainfall scenarios (50, 100, 150 mm or a custom total): runoff from ESA WorldCover land cover and editable coefficients, fill-and-spill through terrain depressions with a full volume balance, and a comparison across scenarios.
- Hotspot screening with relative categories, ranked hotspots and a "Why here?" explanation generated from each hotspot's values.
- Documented waterlogging reports for Madurai from dated news articles, shown as context.
- A 3D view of the loaded terrain (Three.js): real Copernicus elevations with a stated vertical exaggeration, the scenario's modelled ponding drawn cell by cell at its modelled water level, numbered pins for the ranked hotspots, and an illustrative rain animation. The 2D map stays available as a fallback.
- A **Google Maps ↗** link beside the view switch that opens the selected area's centre (or the searched place's name) on the official Google Maps website in a new tab. It is a plain link in the documented Maps URLs format: no API key, no embedded Google map, and only the coordinates or place name are sent.
- "Understand this area": a plain-language explanation of the selected area and scenario, written from the model's own results for people without a hydrology background.
- A method and limitations dialog in the app; the full write-up is in [docs/methodology.md](docs/methodology.md).

PaaniPulse is a screening prototype, not a flood forecast or warning system.

## Terrain analysis

All five steps run on the elevation grid exactly as loaded, in the browser. Source code is in `src/lib/hydrology/`.

1. **Depression filling** — Priority-Flood (Barnes, Lehman & Mulla 2014). The flood starts from every valid cell on the area edge or beside missing data, where water can leave, and raises each enclosed hollow to its spill level. The measured elevations are kept separately; the difference is the filling depth.
2. **Flow direction** — D8 on the filled surface: each cell drains to the neighbour with the steepest drop divided by the true distance between cell centres, using each row's real cell width and height. Cells on flats and in filled hollows follow the path the flood took back towards the spill point, which keeps the flow network free of loops. Directions use the codes 1 = E, 2 = SE, 4 = S, 8 = SW, 16 = W, 32 = NW, 64 = N, 128 = NE, with 0 for cells that drain out of the area and 255 for missing data.
3. **Flow accumulation** — a single topological pass gives the number of cells and the ground area draining through each cell, and rejects any direction grid that contains a cycle.
4. **HAND** — cells whose contributing area reaches a chosen threshold (0.05–1 km², default 0.1 km²) are drainage cells. Every other cell's HAND is its height above the first drainage cell on its flow path, measured on the filled surface. Cells whose path leaves the area first are reported as such.
5. **Depression storage** — filling depth times real cell area, grouped into connected depressions and ranked by volume. Depressions within two cells of the area edge or missing data are flagged, because their spill level may depend on terrain outside the area.

A 25 km² area (about 27,000 cells) takes roughly 40 ms in testing; a 3 × 3 km area of Madurai takes under 20 ms.

### What the analysis does and does not show

- It describes how the **terrain model** directs and holds water. HAND is a relative height, not a flood depth; storage is the capacity of hollows in the model, not water present; accumulation is upslope area, not discharge.
- GLO-30 is a surface model at about 30 m. Buildings, walls, bridges and embankments are part of the heights, so they can dam modelled flow and create hollows that do not exist on the ground. In central Madurai, for example, the second-largest depression lies on the Meenakshi Amman Temple complex, enclosed by its walls and towers in the data, and the third lies on the Vaigai river, whose surface is flattened in the data.
- Storm drains, culverts, kerbs and channels narrower than a cell are not represented.
- Only area inside the selection contributes to accumulation and HAND.

## 3D view

The **2D Map / 3D View** switch over the map opens a Three.js view of the same area; Three.js is downloaded only the first time. Nothing is recomputed or downloaded again: the terrain mesh is built from the loaded `ElevationGrid` (one vertex per cell at its real spacing, east = +x, north = −z, no-data cells left as holes), and the water from the active scenario's `pondDepthM`, one flat quad per ponded cell at ground + ponding depth. Heights are exaggerated 3× by default (1×, 2×, 3× or 5×), as the view states.

The rain is a visualisation of the chosen hypothetical total; its speed, density and the few seconds the water takes to rise to its modelled level are illustrative and do not represent rainfall rate or storm duration. The animation only moves particles and the displayed water height; the model's arrays are never modified. The same top-10 hotspots as the list and the 2D map stand as numbered pins on their scoring cells; selecting a pin selects the hotspot everywhere, and selecting one in the list moves the camera to it.

If WebGL is unavailable, the renderer fails to start or the browser takes the graphics context away (for example under memory pressure), the app returns to the 2D map and says why. The area, scenario and selected hotspot are kept, because they live outside the 3D view.

The 3D view uses PaaniPulse's own Three.js scene, not Google Maps. A photorealistic Google Maps 3D prototype exists on the `google-maps-3d-experiment` branch, but it is not part of the public app: production use needs a billing-enabled Google Cloud project, the Maps Demo Key is for evaluation only, and Google's terms do not allow its 3D maps beside a non-Google map such as the MapLibre basemap.

## Understand this area

The "Understand this area" box near the top of the panel answers five questions in everyday words: what am I looking at, where might water collect, why here, what the rainfall scenario means, and how confident the result is. It is generated by `src/lib/explain/area.ts` from the loaded elevation, land cover and the active scenario's results: the same volumes, hotspots and criteria the rest of the app shows. It names no value that the model did not compute. It updates when the area, rainfall scenario or selected hotspot changes, and it always states that results are a simplified hypothetical scenario, not a flood prediction or a record of observed flooding. The rainfall section uses the India Meteorological Department's 24-hour rainfall categories (for example, 64.5–115.5 mm is "heavy rain") to put the scenario total in context.

## Rainfall scenarios and hotspots

Scenarios reuse the terrain analysis, so changing rainfall or coefficients takes milliseconds and nothing is downloaded again.

- **Runoff:** rainfall (mm) ÷ 1000 × C × cell area, where C is the area-weighted coefficient of the WorldCover pixels in each cell. Coefficients are documented assumptions, editable in the app. Cells with under half their pixels classified generate no runoff and are counted.
- **Fill and spill:** depressions act as reservoirs with their terrain storage capacity; runoff is routed downstream, stored until full, and the excess spills on. The app reports generated, held and departing volume and the residual.
- **Screening:** points for modelled ponding, passing runoff, HAND and slope give higher or moderate relative concentration potential. Hotspots overlapping very deep hollows or permanent water have reduced confidence.

See [docs/methodology.md](docs/methodology.md) for equations, coefficients, thresholds and limitations.

No observed rainfall is bundled: IMD gridded rainfall is publicly downloadable, but its redistribution terms could not be confirmed.

### Tests

```bash
npm test                         # synthetic grids with known answers
PAANIPULSE_LIVE=1 npm test       # also runs real Madurai and Guwahati areas via Planetary Computer
```

The tests check a paraboloid pit against its analytic volume (within 1%), downslope directions on tilted planes, exact contributing counts in a converging valley, flat terrain, missing-data holes, exact HAND in a V-shaped valley, pit storage volumes, a 25 km² benchmark, runoff unit conversion and missing land cover, volume conservation and spill cascades, hotspot ranking, explanations and scenario comparison.

## How elevation is loaded

Everything runs in the browser; there is no backend.

1. The Planetary Computer STAC API finds the GLO-30 tiles that intersect the area.
2. An anonymous, short-lived read token is requested for the storage container and cached until shortly before it expires. A failed read is retried once with a fresh token.
3. geotiff.js reads only the byte ranges covering the area from the cloud-optimised GeoTIFFs (typically two 64 KiB requests for a 3 × 3 km area) and decodes the Float32 elevations.
4. Areas that straddle a 1° tile edge are stitched onto the common one-arc-second grid. Cell geometry comes from the catalogue's `proj:transform`, because GLO-30 cells are centred on whole arc-seconds.

If Planetary Computer cannot be reached, the user can choose to load AWS Terrain Tiles (Terrarium) instead. This fallback is coarser (about 34–38 m over India, mostly SRTM-derived) and is labelled as such whenever it is shown. It is never substituted automatically.

## Stack

- React, TypeScript and Vite
- MapLibre GL JS with the [OpenFreeMap](https://openfreemap.org) Liberty style
- [geotiff.js](https://geotiffjs.github.io/) for reading cloud-optimised GeoTIFFs
- IBM Plex Sans and IBM Plex Mono, self-hosted via Fontsource
- Static hosting on GitHub Pages — no backend, database or paid service

## Development

Requires Node.js 20.19+ or 22.12+ (developed on Node 24).

```bash
npm install
npm run dev        # http://localhost:5173/jaldrishti-india/
npm run typecheck
npm run lint
npm test
npm run build      # outputs dist/
```

The bundled gazetteer in `src/data/gazetteer-in.json` is generated from OpenStreetMap:

```bash
node scripts/build-gazetteer.mjs
```

## Deployment

Pushes to `main` run `.github/workflows/deploy.yml`, which lints, tests, builds and publishes `dist/` to GitHub Pages at
`https://programmer-mukeshkrishnaank.github.io/jaldrishti-india/`. The repository's Pages source must be set to **GitHub Actions**.

See [docs/architecture.md](docs/architecture.md) for the code layout.

## Data and attribution

- Basemap: OpenFreeMap, © OpenMapTiles. Map data © OpenStreetMap contributors, available under the ODbL.
- Place names: © OpenStreetMap contributors (ODbL), via the bundled gazetteer, [Photon](https://photon.komoot.io) and [Nominatim](https://nominatim.org). Nominatim requests are limited to one per second and cached.
- Elevation: Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA, accessed through [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30).
- Fallback elevation: [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) on AWS Open Data, including SRTM (NASA/USGS) and GMTED2010.
- Land cover: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium, CC BY 4.0, accessed through [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/esa-worldcover).
- Documented reports: [PTI via Deccan Herald, 26 Oct 2024](https://www.deccanherald.com/india/tamil-nadu/heavy-downpour-in-15-minutes-brings-tamil-nadus-madurai-under-swathes-of-water-3250135) and [DT Next, 23 Oct 2026](https://www.dtnext.in/news/tamilnadu/heavy-rain-leaves-madurai-under-water-hundreds-of-homes-flooded-rs-23-crore-drainage-projects-planned); locations from OpenStreetMap via `scripts/build-incidents.mjs`.

GLO-30 is a surface model: heights include buildings and trees, and water surfaces are edited flat. Its stated absolute vertical accuracy is better than 4 m for 90% of points.
