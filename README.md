# Starterpaket „Schwammregion-Game“ für GitHub Copilot

Inhalt: `PROMPTS.md` (13 Issue-Texte in Reihenfolge), `.github/copilot-instructions.md` (Dauerregeln für den Agenten),
`docs/SPEC_hydrology.md` (Fachspezifikation inkl. Swale und Steinfeld), `data/hydrology_tables.json` (CN-, Rauheits-, Boden- und Regenwerte),
`fixtures/thesis_b8_cases.json` (53 Rechenblätter aus Anhang B8/B9 der Masterarbeit Gehr als Sollwerte),
`reference/nrcs_reference.py` (lauffähige Referenz; `python3 reference/nrcs_reference.py fixtures/thesis_b8_cases.json`).

Stand der Referenz gegen die 51 konsistenten Blätter: Scheitel max. 3,2 %, Drosselabfluss max. 2,9 %, Einstauhöhe max. 6,2 % Abweichung.
