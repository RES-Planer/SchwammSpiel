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
