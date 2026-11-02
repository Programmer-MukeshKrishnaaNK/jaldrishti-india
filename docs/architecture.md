# Architecture

PaaniPulse is a static single-page application. Everything runs in the browser; the only network dependencies are free, keyless public services.

```
GitHub Pages (static files)
        │
        ▼
Browser ── React UI ── MapLibre GL JS ──► OpenFreeMap vector tiles (OSM data)
```

## Source layout

| Path | Responsibility |
|---|---|
| `src/app/` | Application root and top-level state |
| `src/components/` | Reusable presentational pieces (header, wordmark) |
| `src/features/` | Feature modules; `explore/` holds the exploration panel |
| `src/map/` | Map configuration and the MapLibre view, including load and error handling |
| `src/lib/` | Pure helpers such as coordinate formatting |
| `src/types/` | Shared TypeScript types |
| `src/styles/` | Design tokens and global styles |
| `public/` | Files served as-is (favicon) |

Planned additions are created when they get real content: `src/workers/` for analysis running off the main thread, `src/hooks/` for shared hooks, and `src/data/` for small bundled datasets.

## Basemap failure handling

The map treats the basemap as unavailable if its style fails to load or does not load within 15 seconds. It then shows an explicit error with a retry. No substitute map is shown. Tile errors after the style has loaded are left to MapLibre, which keeps the rest of the map usable.
