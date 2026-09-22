# Prompts für den GitHub-Copilot-Agenten – Schwammregion-Game

So benutzt du das Paket: neues GitHub-Repository anlegen, den gesamten Ordner `schwammregion-copilot` hineinkopieren
(wichtig sind `.github/copilot-instructions.md`, `docs/`, `data/`, `fixtures/`, `reference/`), committen. Danach
je Prompt ein Issue anlegen, den Text unverändert einfügen und das Issue Copilot zuweisen. Reihenfolge einhalten;
Prompts 1–7 brauchen keine Geodaten, 8–11 laufen mit Platzhalterdaten, 12 braucht deine QGIS-Daten.
Jeder Prompt ist so geschrieben, dass der Agent nichts Fachliches selbst entscheiden muss.

---

## Prompt 1 – Projektgerüst

**Titel:** Monorepo-Gerüst mit CI und GitHub Pages

Lege ein pnpm-Workspace-Monorepo an, wie in `.github/copilot-instructions.md` festgelegt:
`packages/engine` (TypeScript-Bibliothek, ESM, keine Abhängigkeiten) und `apps/web` (Vite + Preact + MapLibre GL JS + uPlot).
Richte TypeScript strict, ESLint, Prettier und Vitest ein. Root-Skripte: `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm dev`.
GitHub Actions: Workflow `ci.yml` (lint, test, build bei jedem PR) und `pages.yml` (Deployment von `apps/web/dist` auf
GitHub Pages bei Push auf `main`; Vite-`base` aus dem Repository-Namen ableiten).
`apps/web` zeigt vorerst nur eine Seite mit Titel aus `i18n/de.json` und einer leeren MapLibre-Karte (Zentrum 49.945 N, 11.93 E, Zoom 13,
OSM-Rasterkacheln mit Attribution). Lege `i18n/{de,cs,en}.json` und eine winzige `t(key)`-Funktion mit Sprachumschalter an.
README auf Deutsch: Zweck, lokale Entwicklung, Struktur, Verweis auf `docs/SPEC_hydrology.md`. Lizenzdatei nicht anlegen (wird vom Projekt entschieden).
**Fertig, wenn:** CI grün, Seite baut, `packages/engine` exportiert eine Dummy-Funktion mit einem Test.

---

## Prompt 2 – Rechenkern: Ganglinie

**Titel:** Engine: CN-Abflussbildung, Bemessungsregen, NRCS-Einheitsganglinie, Faltung

Portiere aus `reference/nrcs_reference.py` die Funktionen `gamma_shape`, `cumulative_rain_fraction`, `effective_rain_mm`
und `hydrograph` nach `packages/engine/src/` (Module `unitHydrograph.ts`, `rain.ts`, `runoff.ts`, `hydrograph.ts`).
Halte dich an `docs/SPEC_hydrology.md` Abschnitte 2–4. Für `lgamma` eine eigene Lanczos-Implementierung schreiben (keine Abhängigkeit).
Öffentliche API: `computeHydrograph(input: HydrographInput): HydrographResult` mit Feldern
`areaHa, cn, tcH, pMm, durationH, iaRatio, prf, rainShape, mqLsKm2` → `qM3s[], dtH, tpH, neffMm, sMm, iaMm, baseFlowM3s, qMaxM3s, tPeakH`.
Lege `assumptions.ts` an und trage A1, A2, A5 aus der Referenzdatei ein.
Tests (Vitest), datengetrieben über `fixtures/thesis_b8_cases.json`: alle Fälle mit `consistent === true`;
prüfe `tpH` (±0,5 %), `sMm` und `iaMm` (±0,02 mm), `qMaxM3s` (±4 %). `sum_q_m3` nicht testen. Zusätzlich Massenbilanztest:
Summe(Q − Basisabfluss)·Δt = Neff·A (±0,5 %).
**Fertig, wenn:** alle 51 konsistenten Fälle grün sind, ohne dass Sollwerte oder Toleranzen verändert wurden.

---

## Prompt 3 – Rechenkern: Speicher mit Drossel

**Titel:** Engine: Kleinrückhalt mit Rohrdrossel, konstanter Drossel und Überlauf

Portiere `pipe_outflow` und `route_storage` aus `reference/nrcs_reference.py` nach `packages/engine/src/storage.ts`
gemäß SPEC Abschnitt 6. Typen: `StorageShape = {form:'prism', baseAreaM2, hMaxM} | {form:'hollow', lengthM, widthM, hMaxM}`
(hollow: `vMax = 2/3·L·B·hMax`, `V(h) = vMax·(h/hMax)^1.5`), `Outlet = {type:'pipe', lengthM, dnMm} | {type:'constant', qM3s}`.
Ergebnis: `qOutM3s[], qOutMaxM3s, hReachedM, vUsedM3, spillM3, fillRatio, tFullH | null`. Annahmen A3, A4 in `assumptions.ts`.
Ergänze `sizeStorageForTarget(qIn, outlet, hMaxM, targetQOutM3s)`: sucht per Bisektion das kleinste Volumen ohne Überlauf.
Tests über alle Fixtures mit `storage` und `overflow_case === false` (Fixture-`form` „Fläche“→prism, „Mulde“→hollow):
`q_out_max_m3s` ±4 %, `h_reached_m` ±7 %. Eigener Test: Überlauf tritt auf und die Massenbilanz stimmt, wenn `vMax` halbiert wird.

---

## Prompt 4 – Rechenkern: CN-Ermittlung

**Titel:** Engine: CN-Werte aus Landnutzung, Bodengruppe, Monat und Bewirtschaftung

Implementiere `packages/engine/src/curveNumber.ts` nach SPEC Abschnitt 2. Tabellen ausschließlich aus
`data/hydrology_tables.json` (per Build-Schritt als typisiertes Modul einbinden, nicht abtippen).
`cnForPatch({landUse, soilGroup, month | 'low-seasonality', mulchCoverFraction?, tillage})` → `{cn, steps[], warnings[]}`;
`steps` dokumentiert jeden Rechenschritt für den späteren Steckbrief. Bodengruppe A oder terrassierte Bewirtschaftung →
Warnung `missing-formula` und Rückgabe des unangepassten Werts. Aggregation: `aggregateCn(patches, mode)` mit
`'area_weighted'` und `'runoff_weighted'`; für `runoff_weighted` liefert die Engine statt eines CN eine Funktion
`neffMm(pCumMm)` und `computeHydrograph` akzeptiert diese alternativ zu `cn`.
Tests mit den drei Prüfwerten aus der SPEC sowie: 1abc-Flächenliste aus der SPEC-Quelle
(1,7 ha CN 92,0; 3 ha 94,0→82,1; 5,4 ha 84,2; 4,4 ha 93,0; 4,6 ha 78,0→58,2; 4,5 ha 48,3; 1,7 ha 80,6; 2,5 ha 60,0)
ergibt flächengewichtet 77,9 (Ist) und 73,3 (Maßnahme), jeweils ±0,1.

---

## Prompt 5 – Rechenkern: Konzentrationszeit

**Titel:** Engine: Fließzeit nach Geschwindigkeitsmethode

Implementiere `packages/engine/src/flowPath.ts` nach SPEC Abschnitt 5: Abschnittstypen `sheet | rill | hollow | trapezoid | pipe | stonefield`,
`travelTime(segments, {tcFactor, legacyRounding})` → `{tcH, perSegment[{vMs, tMin, share}]}`.
Trapezgraben: Fließtiefe h per Bisektion aus `Q = k·A·R^{2/3}·J^{1/2}` mit `A = (b + m·h)·h`, `U = b + 2h·sqrt(1+m²)`,
`Q = qSpecific·areaHa`; Eingang `qSpecific` aus Neff und Regendauer (mittlere Abflussspende).
Standard-Hydraulikradien und k-Spannen aus `data/hydrology_tables.json`.
Tests: SPEC-Prüfwert (v = 0,0546 m/s; mit `legacyRounding` 0,05 m/s und 16,17 min); `rill` k=25, l=80 m, J=0,069, R=0,04 → v=0,768 m/s (mit `legacyRounding` 0,77 m/s und 1,73 min);
`tcFactor` 2,1 auf Σt = 0,40 h → 0,84 h.

---

## Prompt 6 – Rechenkern: abflusslose Elemente, Swale, Steinfeld

**Titel:** Engine: Mulden, Swale und Infiltrationsboden („Steinfeld“)

Implementiere SPEC Abschnitte 7–9 in `packages/engine/src/measures/`.
1. `retention.ts`: `applyRetentionElements(q, dtH, baseFlow, elements[], {mode, infiltration})` mit Modus `physical`;
   Modus `thesis_triangle` als Interface, das `NotImplementedError` wirft. Rückgabe je Element: zurückgehaltenes Volumen,
   `tFullH`, versickertes Volumen; gesamt: neue Ganglinie, `tPeakH`.
2. `swale.ts`: Geometrie → `vMaxM3`, `aInfM2`, `excavationM3`; `applyToFlowPath(segments, chainageM, landCoverK)` ersetzt die
   folgenden `l_sheet` Meter durch `sheet`. Validierung „nicht höhenlinienparallel“ als Warnung (Eingang: Höhenprofil der Linie).
3. `stonefield.ts`: Lochzahl, Porenspeicher, `aInfM2`; Fließwegabschnitt `stonefield` mit Überlastungsprüfung (h ≤ 0,03 m)
   und Lagestabilitätsprüfung der Steine; Warnungen `overloaded`, `stones-unstable`, `low-infiltration-soil` (bei HBG C/D).
Alle Standardwerte als Annahmen A6–A8 in `assumptions.ts` mit Status `expert-estimate`.
Tests: (a) Massenbilanz je Element; (b) Fall 5b (11 ha, CN 73,1, tc 3,0 h, P 69,9 mm, D 18 h, Ia/S 0,07, PRF 250) mit 600 m³,
`a_e` = 0,9, ohne Versickerung: Element ist vor dem Scheitel voll, Scheitelminderung < 5 %; mit 1500 m³: Minderung > 25 %;
(c) Fall 6d (4 ha, CN 91, tc 0,6 h, Ia/S 0,165) mit 457 m³, `a_e` = 0,9: beim 4-h-Regen (48,8 mm, PRF 300) Minderung > 15 %, beim 18-h-Regen (69,9 mm, PRF 350) Minderung < 2 %; (d) Steinfeld 10 m × 30 m, J = 0,07, Q = 0,02 m³/s → nicht überlastet, W = 2 m → überlastet.

---

## Prompt 7 – Rechenkern: Szenario, Überlagerung, Kalibrierung

**Titel:** Engine: Szenario-Modell, Fünf-Punkte-Plan und Kalibrier-Skript

Definiere in `packages/engine/src/scenario.ts` das JSON-Datenmodell (mit JSON-Schema unter `docs/schema/scenario.schema.json`):
`Catchment { id, name, mqLsKm2, rainEvents[], subcatchments[] }`, `Subcatchment (üTGB) { id, areaHa, iaRatio, prf, tcFactor, lagToOutletH, reference: {cn, tcH} | {csv} , measureAreas[] }`,
`MeasureArea (uTGB) { id, areaHa, patches[], flowPath[], lagToParentH, measures[] }`, `Measure` = Vereinigung aus
`landUseChange | storage | retentionGroup | swale | stonefield | flowPathChange`.
`evaluateScenario(catchment, rainEventId, measuresOn)` rechnet je uTGB Ist und Maßnahme, überlagert nach SPEC Abschnitt 10 auf üTGB
und Gesamtgebiet und liefert Kennzahlen: `qMax` vorher/nachher, Δ%, Scheitelverzögerung, Volumen, Rückhaltevolumen, beanspruchte Fläche, Aushub, Warnungen.
Skript `pnpm calibrate`: bestimmt je üTGB das `tcH`, mit dem `qMax` die Sollwerte der SPEC trifft, und die `lagToOutletH`, mit denen die Summe 4,46 m³/s ergibt;
schreibt `data/goldbach/catchment.json`. Für TGB 3, 4 und 7 fehlen CN-Werte → Platzhalter 73,0 / 74,0 / 75,0 mit `TODO(DATA)`.
Tests: Überlagerung ohne Maßnahme ergibt exakt die Referenz; Translation verschiebt den Scheitel um Δt; Kennzahlen konsistent.

---

## Prompt 8 – Karte

**Titel:** Web: Kartenansicht mit Gebietsdaten und Ebenensteuerung

Baue in `apps/web` die Kartenansicht: Laden von `public/data/<gebiet>/manifest.json` (Liste der Ebenen mit Typ, Pfad, Stil, Attribution).
Ebenen: Schummerung (Rasterkacheln), Luftbild optional (WMTS-URL aus Manifest), Teilgebiete (Polygon), Fließwege (Linie, Breite nach Attribut `accumulation`),
Senken, Landnutzung × Bodengruppe (Polygon, Farbe nach CN), Flurstücke (nur ab Zoom 16). Ebenenschalter, Legende, Maßstab, Attribution.
Klick auf Teilgebiet öffnet Seitenleiste mit Fläche, CN, tc, Landnutzungsanteilen. Lege Platzhalterdaten `public/data/demo/` an
(synthetisches Tal, 3 Teilgebiete, erzeugt per Skript `tools/make_demo_data.ts`), damit alles ohne echte Geodaten läuft. Layout mobil zuerst; Seitenleiste wird unter 768 px zum Bottom-Sheet.

---

## Prompt 9 – Maßnahmen-Werkzeuge

**Titel:** Web: Maßnahmen zeichnen und parametrieren

Werkzeugleiste mit: „Fläche umnutzen“ (Polygon wählen/zeichnen → Landnutzung, Monat, Mulchdirektsaat, Bewirtschaftungsrichtung),
„Rückhaltemulde mit Rohr“ (Polygon → Form, Tiefe, Rohr DN/Länge; Knopf „Größe vorschlagen“ ruft `sizeStorageForTarget`),
„Waldmulden“ (Anzahl × Volumen, Lage oben/Mitte/unten), „Swale“ (Linie; Querschnitt), „Steinfeld“ (Polygon; Lochraster, Durchmesser, Tiefe, Steingröße),
„Feldrain/Fließweg ändern“ (Abschnitt wählen → Typ und Rauheit). Zeichnen mit eigener, schlanker MapLibre-Interaktion (keine Draw-Bibliothek),
Längen/Flächen geodätisch mit eigener Funktion. Jede Maßnahme erscheint als Karte in der Seitenleiste mit Kennwerten aus der Engine
(Volumen, Aushub, Fläche, Warnungen) und lässt sich an-/abschalten, bearbeiten, löschen. Zustand als `Scenario`-JSON; Speichern/Laden als Datei
sowie Teilen per URL-Fragment (komprimiert). Rückgängig/Wiederholen. Alle Texte über i18n.

---

## Prompt 10 – Regen, Ganglinie, Punkte

**Titel:** Web: Regen auslösen, Fließwege animieren, Ganglinien und Wertung

Knopf „Regen“ mit Auswahl des Ereignisses (aus `rainEvents`, z. B. „20-jährlich, 18 h“, „20-jährlich, 4 h“, „100-jährlich, 4 h“).
Berechnung in einem Web Worker über `evaluateScenario`. Anzeige: (1) Animation entlang der Fließwege – Linienbreite/-farbe proportional zum Abfluss
des zugehörigen Teilgebiets im Zeitverlauf, Zeitregler; Speicher füllen sich sichtbar, Überlauf blinkt; (2) uPlot-Diagramm Ist gegen Maßnahme für das
gewählte Teilgebiet und den Gebietsauslass, mit Regen als invertiertem Balkendiagramm oben; (3) Wertungskarte: Scheitelminderung %, Scheitelverzögerung,
zurückgehaltenes Volumen, „voll nach … h / Scheitel nach … h“, Flächenverbrauch, Aushub, grobe Kosten (Einheitspreise aus `data/unit_costs.json`, Platzhalterwerte mit `TODO(DATA)`).
Drei Sterne nach festen Schwellen (≥ 5 %, ≥ 15 %, ≥ 25 % Scheitelminderung am gewählten Schutzpunkt). Unter jeder Ergebnisanzeige der Hinweis
„Szenarienvergleich, keine Prognose“ und ein Link „Annahmen & Grenzen“, der `assumptions.ts` und SPEC Abschnitt 11 lesbar darstellt.

---

## Prompt 11 – Maßnahmensteckbrief

**Titel:** Web: Export „Maßnahmensteckbrief“ als druckbare Seite (PDF über Browserdruck)

Route `#/steckbrief/<measureId>` rendert eine A4-Druckansicht (Print-CSS, keine PDF-Bibliothek), gegliedert nach der bayerischen WPBV:
1 Erläuterung (Anlass, Beschreibung, Bemessungsereignis, Rechenweg mit den `steps` aus der CN-Ermittlung, Ergebnis vorher/nachher, Annahmen),
2 Übersichtslageplan (Kartenbild 1:25 000), 3 Lageplan (1:1 000 mit Flurstücken, Maßnahme, Fließweg, Nordpfeil, Maßstabsleiste),
4 Bauzeichnung (generierter Regelquerschnitt als SVG: Mulde, Swale mit Wall, Steinfeld mit Lochraster, Rohrdrossel), 5 Bauwerksverzeichnis,
6 Grundstücksverzeichnis (Flurstücksnummern aus der Ebene, Eigentümer als leere Spalte), 7 Hinweise (Verklausungsschutz, Standsicherheit ab Dammhöhe,
Naturschutz, Abstimmung mit Wasserwirtschaftsamt und Landratsamt). Kopfzeile auf jeder Seite: „Vorentwurf – ersetzt keine Genehmigung und keine Ausführungsplanung“.
Kartenbilder über `map.getCanvas().toDataURL()` (MapLibre mit `preserveDrawingBuffer`). Zusätzlich Export der Maßnahme als GeoJSON (EPSG:25832 und 4326).
Sammelexport „Alle Maßnahmen“ als Tabelle (CSV) und Übersichtskarte.

---

## Prompt 12 – Datenaufbereitung (erst starten, wenn die QGIS-Daten im Repo liegen)

**Titel:** Tools: Pipeline von QGIS-Daten zu Web-Daten

Schreibe `tools/prepare_catchment.py` (Python 3.11, GDAL/rasterio, geopandas, whitebox). Eingang: `raw/<gebiet>/` mit DGM1-GeoTIFF-Kacheln,
Teilgebiets-Shapefile, Landnutzung (ALKIS-TN), hydrologische Bodengruppen, Flurstücke, optional Maßnahmenflächen der Masterarbeit.
Schritte wie in der Masterarbeit Kap. 3.2: Kacheln verschmelzen, auf Gebiet + 200 m Puffer zuschneiden, Gebäude um 10 m anheben (Hausumringe),
Senken füllen (Wang & Liu), D8-Fließrichtung und -akkumulation, Fließwege ab Schwellenwert vektorisieren, Senken > 0,2 m Tiefe und > 2,5 m² als Polygone,
Landnutzung × Bodengruppe verschneiden und CN (Monat März und „geringer Jahresgang“) aus `data/hydrology_tables.json` zuweisen,
je Teilgebiet Fläche, mittlere Neigung, längster Fließweg mit Abschnitten (Typ nach Akkumulation: < 0,5 ha sheet bis max. 50 m, < 5 ha rill, sonst hollow).
Ausgang: `apps/web/public/data/<gebiet>/` mit Schummerungskacheln (PNG, z 12–17), DGM als 2-m-COG (Float32), GeoJSON in EPSG:4326 (vereinfacht, < 2 MB je Datei),
`catchment.json` im Schema aus Prompt 7 und `manifest.json`. Lizenz-/Quellenangaben ins Manifest. Tschechische Seite: Eingang DMR 5G (LAZ → Raster 2 m) vorsehen.
Dokumentiere den Ablauf in `docs/DATA_PIPELINE.md`.

---

## Prompt 13 – Ausbaustufe: Gelände lokal verändern

**Titel:** Web: „Baggern“ im Geländemodell mit lokaler Neuberechnung der Fließwege

Beim Anlegen von Mulde, Swale oder Wall wird das 2-m-DGM in einem Fenster von 400 m × 400 m um die Maßnahme im Speicher verändert
(Abtrag/Auftrag gemäß Querschnitt, Massenbilanz anzeigen) und D8-Fließrichtung/-akkumulation in einem Web Worker nur für dieses Fenster neu berechnet
(Priority-Flood zum Senkenfüllen, Randzellen behalten ihre ursprüngliche Akkumulation als Zufluss). Ergebnis: aktualisierte Fließwege im Fenster,
automatisch bestimmter Einzugsanteil `a_e` der Maßnahme und aktualisierte Fließweg-Abschnitte für die Engine. Ziel: < 300 ms je Neuberechnung auf einem Mittelklasse-Tablet.
Tests mit synthetischem Hang: Swale quer zum Hang fängt die gesamte oberhalb liegende Fläche; schräg gelegte Linie erzeugt die Warnung „nicht höhenlinienparallel“.
