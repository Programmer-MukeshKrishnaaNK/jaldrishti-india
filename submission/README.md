# HackCult '26 submission

- `PaaniPulse_HackCult_2026_Pitch_Deck.pdf`: the pitch deck, 10 slides, 16:9.
- `deck/deck.html`: its source, ten 1280 × 720 px slides in HTML and CSS with inline SVG diagrams.
- `deck/export.mjs`: prints the deck to the PDF with headless Chrome (`node submission/deck/export.mjs`).
- `deck/capture.mjs`: captures the screenshots in `deck/shots/` from the live app (`node submission/deck/capture.mjs`). `cover-terrain.jpg`, `threejs-wide.jpg`, `ponding-map.jpg`, `google-rain-wide.jpg` and `google-rain-tall.jpg` are crops of those screenshots; the Google 3D ones show Google imagery (© Google) under PaaniPulse's simulated overlays and illustrative rain.
- `deck/fonts/`: IBM Plex Sans and Mono (SIL Open Font License), copied from the app's Fontsource packages.

Every figure in the deck was read from the live app for Madurai (3 × 3 km, Copernicus GLO-30, hypothetical 100 mm scenario) or from the repository's README and methodology.
