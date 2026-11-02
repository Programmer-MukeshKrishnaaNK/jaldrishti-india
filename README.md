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

Not implemented yet: runoff analysis, rainfall scenarios, hotspot ranking and documented incidents.

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
npm run build      # outputs dist/
```

The bundled gazetteer in `src/data/gazetteer-in.json` is generated from OpenStreetMap:

```bash
node scripts/build-gazetteer.mjs
```

## Deployment

Pushes to `main` run `.github/workflows/deploy.yml`, which lints, builds and publishes `dist/` to GitHub Pages at
`https://programmer-mukeshkrishnaank.github.io/jaldrishti-india/`. The repository's Pages source must be set to **GitHub Actions**.

See [docs/architecture.md](docs/architecture.md) for the code layout.

## Data and attribution

- Basemap: OpenFreeMap, © OpenMapTiles. Map data © OpenStreetMap contributors, available under the ODbL.
- Place names: © OpenStreetMap contributors (ODbL), via the bundled gazetteer, [Photon](https://photon.komoot.io) and [Nominatim](https://nominatim.org). Nominatim requests are limited to one per second and cached.
- Elevation: Copernicus DEM GLO-30 © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA, accessed through [Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30).
- Fallback elevation: [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) on AWS Open Data, including SRTM (NASA/USGS) and GMTED2010.

GLO-30 is a surface model: heights include buildings and trees, and water surfaces are edited flat. Its stated absolute vertical accuracy is better than 4 m for 90% of points.
