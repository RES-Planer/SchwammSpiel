# Copilot-Anweisungen – Schwammregion-Game

## Was das ist
Browserbasiertes Karten-„Game“ für den dezentralen Wasserrückhalt (Verein Schwammregion Fichtelgebirge /
INTERREG-Vorhaben „Schwammregion Egertal“, Bayern–Tschechien). Laien, Kommunen und Landwirte setzen auf einer Karte
einfache Maßnahmen (maximal Baggerarbeiten), lösen einen Bemessungsregen aus, sehen Fließwege und die
Abflussganglinie vorher/nachher und exportieren einen Maßnahmensteckbrief für die Behörden.
Pilotgebiet: Einzugsgebiet Goldbach bei Ebnath (5,87 km², 7 Teilgebiete). Fachgrundlage: `docs/SPEC_hydrology.md`.

## Feste Entscheidungen (nicht neu verhandeln)
- TypeScript (strict), Node 22, pnpm-Workspace, Vite, Vitest, ESLint + Prettier.
- `packages/engine`: reiner Rechenkern, keine DOM-/Browser-APIs, keine Laufzeit-Abhängigkeiten, deterministisch.
- `apps/web`: Vite + MapLibre GL JS, kein UI-Framework außer Preact, Diagramme mit uPlot. Kein Backend, kein Login,
  keine Cookies, keine Tracker. Deployment als statische Seite über GitHub Pages.
- Geodaten liegen als statische Dateien unter `apps/web/public/data/<gebiet>/` (GeoJSON, COG/PNG-Kacheln).
- Sprachen: Deutsch (Standard), Tschechisch, Englisch über `apps/web/src/i18n/{de,cs,en}.json`. Keine festen UI-Texte im Code.
- SI-Einheiten im Code (m, m², m³, s, m³/s); Niederschlag in mm, Zeit in Ganglinien in h. Einheit steht im Bezeichner
  (`areaHa`, `tcH`, `qMaxM3s`). Bezeichner englisch, Fachkommentare dürfen deutsch sein.

## Regeln für den Rechenkern
- `docs/SPEC_hydrology.md` ist verbindlich; `reference/nrcs_reference.py` ist die ausführbare Referenz.
  Formeln nicht „verbessern“, nicht aus dem Gedächtnis ergänzen. Fehlt etwas: `TODO(SPEC)` setzen und im PR nennen.
- Jede als [ANNAHME] markierte Größe ist eine benannte Konstante in `packages/engine/src/assumptions.ts`
  mit Quelle und Status (`thesis` | `derived` | `expert-estimate`).
- Tests gegen `fixtures/thesis_b8_cases.json` mit den Toleranzen aus der SPEC; Fälle mit `consistent: false` überspringen.
  Tests dürfen nie durch Anpassen der Sollwerte oder Aufweiten der Toleranzen „grün“ gemacht werden.
- Tabellenwerte ausschließlich aus `data/hydrology_tables.json` laden, nie im Code duplizieren. Einträge mit
  `formula: null` oder Status „UNBEKANNT/SCHAETZUNG“ führen zu einer sichtbaren Warnung, nicht zu stillen Defaults.

## Regeln für UI und Export
- Mobile first (Tablet im Gelände), Bedienung ohne Fachwissen; Fachwerte in ausklappbaren Details.
- Jede Ergebnisanzeige trägt den Hinweis „Szenarienvergleich, keine Prognose“; der Export trägt „Vorentwurf – ersetzt
  keine Genehmigung und keine Ausführungsplanung“.
- Barrierearm: Tastaturbedienung, Kontrast AA, keine Information nur über Farbe.
- Datenquellen mit Lizenz in der Karte nennen (DGM1: Bayerische Vermessungsverwaltung, CC BY 4.0; DMR 5G: ČÚZK, CC BY 4.0).

## Arbeitsweise
- Kleine PRs, je Issue ein PR, mit Tests. `pnpm lint && pnpm test && pnpm build` müssen lokal und in CI grün sein.
- Keine neuen Abhängigkeiten ohne Begründung im PR. Keine Binärdateien > 5 MB ins Repo (Geodaten kommen per Release-Asset/LFS).
