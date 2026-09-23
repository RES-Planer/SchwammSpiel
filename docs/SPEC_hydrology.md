# SPEC – Hydrologischer Rechenkern „Schwammregion-Game“

Stand 21.09.2026. Grundlage: Masterarbeit Max Gehr (TH Deggendorf, 30.12.2025), Kap. 3.4 und Anhang B6/B8/B9.
Diese Spezifikation ist verbindlich für `packages/engine`. Die ausführbare Referenz liegt in
`reference/nrcs_reference.py`, die Sollwerte in `fixtures/thesis_b8_cases.json`, die Tabellen in
`data/hydrology_tables.json`. Wo Text und Referenzcode abweichen, gilt der Referenzcode.

Alle mit **[ANNAHME]** markierten Punkte sind nicht aus der Arbeit übernommen, sondern rückgerechnet oder
neu festgelegt. Sie müssen in `engine/src/assumptions.ts` als benannte Konstanten stehen und im UI unter
„Annahmen & Grenzen“ erscheinen.

## 1 Begriffe

| Begriff | Bedeutung |
| --- | --- |
| üTGB | übergeordnetes Teilgebiet (Goldbach: TGB 1–7, im Mittel 0,84 km²) |
| uTGB | untergeordnete Maßnahmenfläche innerhalb eines üTGB (z. B. „6d“, 4–42 ha) |
| CN | Curve Number, 0–100; höher = mehr Abfluss |
| HBG | hydrologische Bodengruppe A–D |
| tc | Konzentrationszeit [h] |
| PRF | Peak-Rate-Factor der NRCS-Einheitsganglinie (100 flach/sumpfig … 600 steil; Standard 484) |
| Ia/S | Anfangsverlust-Verhältnis (in der Arbeit je üTGB kalibriert: 0,07–0,165) |
| Neff | abflusswirksamer Niederschlag [mm] |

## 2 Abflussbildung (CN-Verfahren)

`S = 25400/CN − 254` [mm], `Ia = (Ia/S)·S`, `Neff(P) = (P − Ia)² / (P − Ia + S)` für `P > Ia`, sonst 0.

CN je Teilfläche:
1. Tabellenwert: bei „geringer Jahresgang“ aus `cn_low_seasonality_by_soil_group[Nutzung][HBG]`;
   sonst Monatswert aus `cn_monthly_soil_group_C[Nutzung][Monat]` (gilt für HBG C).
2. Mulchdirektsaat (nur Acker): `CN_C = 85 − 0,47·Bedeckungsanteil`, nur anwenden, wenn kleiner als der Monatswert.
3. Umrechnung von C auf die tatsächliche HBG: `adjustments.soil_group_from_C` (B exakt, D/A siehe Status dort).
4. Bewirtschaftungsrichtung: Faktor `tillage_direction` (konturparallel 0,9675).
   UI-Hinweis: Die Eingabefelder „Mulchdirektsaat“ und „Bewirtschaftungsrichtung“ dürfen nur für Acker- und
   Grünlandnutzungen angeboten werden; die Engine filtert diese Fälle nicht selbst.

Prüfwerte aus dem Anhang (HBG, Monat März): Mais C, Mulchdirektsaat + konturparallel → 94 → 84,86 → **82,1**;
Grünland B konturparallel → 87 → 80,62 → **78,0**; Kleegras B konturparallel → 73 → 60,18 → **58,2**.

Aggregation über ein uTGB, zwei Modi:
- `area_weighted` (wie Masterarbeit, Standard für Fixture-Vergleich): `CN = Σ(Aᵢ·CNᵢ)/ΣAᵢ`.
- `runoff_weighted` (methodisch richtig laut Arbeit Kap. 6.4, NEH 630 Kap. 10): Neff je Teilfläche und Zeitschritt
  berechnen, flächengewichtet mitteln. Standard im Spiel.

## 3 Niederschlag

Bemessungsregen `P` [mm] mit Dauer `D` [h] und Form. Summenkurven (Anteil Zeit → Anteil Regen):
`mittenbetont`: (0;0) (0,3;0,2) (0,5;0,7) (1;1) **[ANNAHME A1, DVWK]**; `block`: linear.
Die Regendauer wird auf ein ganzes Vielfaches von ΔD gerundet.

## 4 Abflusskonzentration (NRCS-Einheitsganglinie)

`ΔD = 0,133·tc`, `Tp = ΔD/2 + 0,6·tc`, `qp = PRF·A[mi²]·1 inch / Tp` (metrisch siehe Referenzcode).
Dimensionslose Einheitsganglinie: Gamma-Form `q/qp = τ^m · e^{m(1−τ)}`, `τ = t/Tp`,
`m` aus `645,33/PRF = e^m·Γ(m+1)/m^{m+1}` **[ANNAHME A2]**. Ordinaten bis `q/qp < 0,001`.
Diskrete Faltung der Neff-Inkremente mit der Einheitsganglinie im Raster ΔD. Basisabfluss `Mq·A` konstant addieren
(Goldbach: Mq = 15,53 l/(s·km²)).

Toleranz gegen Fixtures: `q_max` ±4 %. `sum_q_m3` hängt von der Reihenlänge ab und wird nicht getestet;
stattdessen `Neff·A` exakt prüfen (S und Ia auf 0,01 mm).

## 5 Konzentrationszeit (Geschwindigkeitsmethode)

Fließweg = Liste von Abschnitten `{type, k, length_m, slope, r_hyd_m}`; `v = k·R^{2/3}·J^{1/2}`, `t = l/v`,
`tc = tc_factor · Σt`. `tc_factor` wird je üTGB kalibriert (TGB 1: 2,1).
Abschnittstypen: `sheet` (Schichtabfluss, R = 0,002 m), `rill` (Rinnen/Rillen, R = 0,04 m), `hollow` (Hangmulde,
R = 0,10 m), `trapezoid` (Trapezgraben: Fließtiefe h iterativ aus Abflussspende, `R = A/U`), `pipe`.
Prüfwert: sheet k=17, l=48,5 m, J=0,041 → v=0,0546 m/s. Das VBA rundet v auf 0,01 m/s (→ 0,05 m/s, t=16,17 min);
die Engine rundet **nicht**, bietet aber `legacyRounding` für den Vergleich.

## 6 Speicher mit Drossel (Kleinrückhalt am Auslass)

Volumenbilanz explizit im Schritt ΔD. Abfluss Rohrdrossel:
`Q = A_Rohr · sqrt( 2·g·h / (2,5 + 0,02·L/d) )` **[ANNAHME A3]**. Alternativ `constant` (gekappter Drosselabfluss).
Speicherformen: `Fläche` (Prisma `V = A·h`) und `Mulde` (`V_max = 2/3·L·B·h_max`, `V(h) = V_max·(h/h_max)^{1,5}`)
**[A4, im Anhang bestätigt]**. Bei `V > V_max` läuft der Überschuss als Überlauf sofort ab und wird ausgewiesen.
Toleranz gegen Fixtures: `q_out_max` ±4 %, `h_reached` ±7 %.
Hinweis für das UI: Rohrdrosseln brauchen Verklausungsschutz; Bemessung ist kein Ausführungsplan.

## 7 Abflusslose Rückhalteelemente (gemeinsames Modell)

Gilt für: verteilte Waldmulden, **Swale**, Porenspeicher des **Steinfelds**.

Je Element `e`: Volumen `V_e`, Einzugsanteil `a_e` (Fläche oberhalb des Elements / Fläche uTGB; aus GIS, editierbar;
verteilte Mulden pauschal 0,9), Fließzeit zum Auslass `t_e` [h], Versickerungsfläche `A_inf,e` [m²].

Modus `physical` (Standard) **[ANNAHME A6]**: Zufluss `q_e(t) = a_e·(Q(t+t_e) − Q_Basis)`. Das Element füllt sich ab
dem ersten Abfluss. Solange es nicht voll ist, wird `q_e` vollständig zurückgehalten; ist es voll, läuft alles über.
Versickerung `q_inf = kf·A_inf` entleert das Element laufend, wenn `infiltration = on`; `kf` aus
`soil_infiltration_by_group` (Mittelwert der Spanne). Standard `infiltration = off` (= konservativ wie die Arbeit).
Ergebnis: `Q_neu(t) = Q(t) − Σ_e zurückgehalten_e(t − t_e)`.

Modus `thesis_triangle` (Dreiecksabzug der Masterarbeit, Kap. 4.2.2.2): **noch nicht spezifiziert**, weil
Startzeit und Fülldauer nur im Original-VBA stehen. Interface vorsehen, Implementierung wirft `NotImplemented`.

Wichtig fürs Spielgefühl und fürs UI: Im Modus `physical` sind abflusslose Speicher bei langen Regen (18 h) meist
schon voll, wenn der Scheitel kommt (Testfall 5b: 600 m³ → Scheitel −2 % statt −19 % in der Arbeit). Faustwert aus der
Referenzrechnung: Der Scheitel sinkt erst, wenn das Element etwa ein Drittel des Abflussvolumens des Ereignisses fasst;
dasselbe Volumen wirkt deshalb beim kurzen Starkregen (kleineres Abflussvolumen) stärker als beim 18-h-Regen.
Das UI zeigt immer „voll nach … h / Scheitel nach … h“ und wertet das zurückgehaltene Wasser (m³) als eigenes Ziel
(Landschaftswasserhaushalt, Dürrevorsorge), nicht nur die Scheitelminderung.

## 8 Neue Maßnahme: Swale (höhenlinienparalleler Versickerungsgraben mit talseitigem Wall)

Eingaben: Linie (GeoJSON), Sohlbreite `b` (Standard 0,5 m), Tiefe `t` (0,5 m), Böschung `1:m` (m = 2).
- Validierung: Höhenunterschied entlang der Linie > 0,3 m → Warnung „nicht höhenlinienparallel – wirkt als Graben“.
- `V_max = L·(b·t + m·t²)`; `A_inf = L·(b + 2·t·sqrt(1+m²))`; Aushub ≈ `V_max`, wird talseitig als Wall eingebaut.
- Rückhalt: Element nach Abschnitt 7 mit `a_e` = Fläche oberhalb der Linie (aus Fließakkumulation).
- Fließweg: schneidet die Linie den maßgebenden Fließweg, wird der konzentrierte Abfluss dort gebrochen. Die
  folgenden `l_sheet` Meter (Standard 30 m **[ANNAHME A7]**) werden zu `sheet` mit dem k-Wert der Landbedeckung;
  danach geht es mit den ursprünglichen Abschnitten weiter. tc wird neu berechnet.
- Ausgabe: `V_max`, Aushub, Länge, betroffene Flurstücke, „voll nach … h“, ΔScheitel, Δtc.

## 9 Neue Maßnahme: Infiltrationsboden / „Steinfeld“

Beschreibung (Vorgabe Projekt): in einer Abflussbahn werden maschinell ca. 0,8 m tiefe Löcher gebohrt/gegraben,
mit Sand verfüllt und die Fläche unregelmäßig mit kleinen Steinen belegt. Ziel: konzentrierten Abfluss brechen,
Versickerung erhöhen, Abfluss wieder als Schichtabfluss weiterführen.

Eingaben: Polygon; daraus Breite quer zur Fließrichtung `W` und Länge in Fließrichtung `L_f`. Lochraster `s`
(Standard 2 m), Lochdurchmesser `d` (0,4 m), Tiefe `z` (0,8 m), nutzbare Porosität Sand `n` (0,30), Steingröße
`d50` (0,08 m). Alle Standardwerte **[ANNAHME A8 – Expertenschätzung, durch THD/Monitoring zu kalibrieren]**.
- Lochzahl `N = floor(W/s)·floor(L_f/s)`; Porenspeicher `V = N·π/4·d²·z·n`; `A_inf = N·(π/4·d² + π·d·z)`.
  → Element nach Abschnitt 7 (mit `infiltration = on` als Standard für dieses Element, kf nach HBG).
- Fließweg: der Abschnitt der Länge `L_f` wird ersetzt durch Typ `stonefield`:
  Einheitsabfluss `q = Q_zu,max / W`; Fließtiefe aus `q = k·h^{5/3}·J^{1/2}` mit `k_stone = 8` (Spanne 5–12).
  - `h ≤ 0,03 m`: Schichtabfluss, `v = q/h`.
  - `h > 0,03 m`: Status „überlastet“ → `k = 25` (grobe Steinschüttung), Warnung „Feld verbreitern“.
- Lagestabilität der Steine: `τ = ρ·g·h·J` gegen `τ_c = 0,047·(ρ_s − ρ)·g·d50` (ρ_s = 2650 kg/m³); `τ > τ_c` → Warnung.
- Ehrlichkeitshinweis im UI: Auf HBG C/D (im Goldbachgebiet 97 % der Fläche) ist die Versickerung klein
  (kf ≤ 1·10⁻⁶ m/s); die Wirkung entsteht dort überwiegend durch die längere Fließzeit, nicht durch Versickerung.

## 10 Übertragung auf üTGB und Goldbach (Fünf-Punkte-Plan)

`Q_üTGB,neu(t) = Q_üTGB,ref(t) − Q_uTGB,ist(t − Δt) + Q_uTGB,Maßnahme(t − Δt)`; alle Reihen auf das Zeitraster der
Referenz linear interpolieren; `Δt` = Fließzeit uTGB-Auslass → üTGB-Auslass (reine Translation).
`Q_üTGB,ref`: bevorzugt EGL_X-Export (CSV, wenn vorhanden), sonst NRCS-Ganglinie des üTGB, deren `tc` so kalibriert
wird, dass `q_max` den Wert der Arbeit trifft (HQ20, D = 18 h: TGB 1–7 = 0,91 / 0,93 / 0,64 / 0,50 / 0,42 / 1,12 / 0,22 m³/s).
Goldbach gesamt = Summe der üTGB mit Translation je üTGB; Ziel IST-Zustand HQ20 = 4,46 m³/s, HQ100 = 7,68 m³/s.

## 11 Grenzen, die im Produkt sichtbar bleiben

Keine Pegelvalidierung → Ergebnisse sind Szenarienvergleiche, keine Prognosen. CN-Verfahren stark vereinfacht.
Speicherbemessung ist Vorentwurf, keine Ausführungsplanung. Dezentrale Wirkung v. a. bis etwa HQ20.
