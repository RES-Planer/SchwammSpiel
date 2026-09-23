# SchwammSpiel

SchwammSpiel ist ein browserbasiertes Karten-Game für den dezentralen Wasserrückhalt in der Schwammregion.
Das Projekt kombiniert einen deterministischen Rechenkern (`packages/engine`) mit einer statischen Web-App (`apps/web`).

## Lokale Entwicklung

Voraussetzungen: Node.js 22 und pnpm.

```bash
pnpm install
pnpm dev
```

Wichtige Befehle:

```bash
pnpm lint
pnpm test
pnpm build
pnpm calibrate
```

## Struktur

- `packages/engine`: TypeScript-Rechenkern (ESM, keine Laufzeit-Abhängigkeiten)
- `apps/web`: Vite + Preact + MapLibre-Weboberfläche
- `fixtures/`: Test- und Referenzdaten
- `docs/SPEC_hydrology.md`: Verbindliche hydrologische Fachspezifikation

## Karten-Manifest (`apps/web/public/data/<gebiet>/manifest.json`)

- Basiskarten und Fachdaten-Layer werden ausschließlich über das Manifest geladen (keine fest verdrahteten Tile-URLs im Code).
- Attributionsangaben je Layer sind verpflichtend und müssen den Anbieter inkl. Lizenz enthalten.
- Für die derzeitigen Basiskarten gilt:
  - `basemap-topplusopen`: `TopPlusOpen (BKG), CC BY 4.0`
  - `basemap-openfreemap`: OpenFreeMap/OpenMapTiles/OpenStreetMap-Mitwirkende inkl. `ODbL` (lokalisiert in `de/cs/en`).
