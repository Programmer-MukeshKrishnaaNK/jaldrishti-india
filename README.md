# PaaniPulse

**See where rainwater goes.**

PaaniPulse is a map-first web application for exploring terrain, rainfall scenarios and potential urban waterlogging across India. It keeps four things separate:

1. relatively low-lying terrain,
2. where surface runoff converges,
3. where water could accumulate under a stated rainfall scenario (simulated),
4. waterlogging incidents documented by an identifiable source.

Simulated results are never presented as flood predictions.

## Status

Foundation build. The application shell and an interactive basemap of India are in place. Place search, terrain analysis, rainfall scenarios and documented incidents are not implemented yet.

## Stack

- React, TypeScript and Vite
- MapLibre GL JS with the [OpenFreeMap](https://openfreemap.org) Liberty style
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

## Deployment

Pushes to `main` run `.github/workflows/deploy.yml`, which lints, builds and publishes `dist/` to GitHub Pages at
`https://programmer-mukeshkrishnaank.github.io/jaldrishti-india/`. The repository's Pages source must be set to **GitHub Actions**.

See [docs/architecture.md](docs/architecture.md) for the code layout.

## Data and attribution

- Basemap: OpenFreeMap, © OpenMapTiles. Map data © OpenStreetMap contributors, available under the ODbL.
