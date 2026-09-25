# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/web/e2e/map.spec.ts >> renders production manifest layers without map load errors
- Location: apps/web/e2e/map.spec.ts:6:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 3
Received: 0
```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e4]:
    - generic [ref=e5]:
      - heading "Schwammregion-Game" [level=1] [ref=e6]
      - paragraph [ref=e7]: Synthetisches Tal
    - generic [ref=e8]:
      - generic [ref=e9]: Sprache
      - combobox "Sprache" [ref=e10]:
        - option "Deutsch" [selected]
        - option "Čeština"
        - option "English"
  - paragraph [ref=e11]: Szenarienvergleich, keine Prognose
  - generic [ref=e12]:
    - complementary [ref=e13]:
      - heading "Werkzeuge" [level=2] [ref=e14]
      - generic [ref=e15]:
        - button "Fläche umnutzen" [ref=e16]
        - button "Rückhaltemulde mit Rohr" [ref=e17]
        - button "Waldmulden" [ref=e18]
        - button "Swale" [ref=e19]
        - button "Steinfeld" [ref=e20]
        - button "Feldrain/Fließweg ändern" [ref=e21]
      - generic [ref=e22]:
        - button "Rückgängig" [disabled] [ref=e23]
        - button "Wiederholen" [disabled] [ref=e24]
        - button "Speichern" [ref=e25]
        - button "Laden" [ref=e26]
        - button "Teilen" [ref=e27]
        - button "Maßnahmensteckbrief" [ref=e28]
        - button "Choose File" [ref=e29]
      - heading "Ebenen" [level=2] [ref=e30]
      - group "Ebenen" [ref=e31]:
        - generic [ref=e33]:
          - checkbox "Schummerung" [checked] [ref=e34]
          - generic [ref=e35]: Schummerung
        - generic [ref=e36]:
          - checkbox "Teilgebiete" [checked] [ref=e37]
          - generic [ref=e38]: Teilgebiete
        - generic [ref=e39]:
          - checkbox "Fließwege" [checked] [ref=e40]
          - generic [ref=e41]: Fließwege
        - generic [ref=e42]:
          - checkbox "Senken" [checked] [ref=e43]
          - generic [ref=e44]: Senken
        - generic [ref=e45]:
          - checkbox "Landnutzung × Bodengruppe" [ref=e46]
          - generic [ref=e47]: Landnutzung × Bodengruppe
        - generic [ref=e48]:
          - checkbox "Flurstücke" [ref=e49]
          - generic [ref=e50]: Flurstücke
      - heading "Legende" [level=2] [ref=e51]
      - list [ref=e52]:
        - listitem [ref=e53]:
          - generic [ref=e55]: Schummerung
        - listitem [ref=e56]:
          - generic [ref=e58]: Teilgebiete
        - listitem [ref=e59]:
          - generic [ref=e61]: Fließwege
        - listitem [ref=e62]:
          - generic [ref=e64]: Senken
      - heading "Maßnahmen" [level=2] [ref=e65]
      - paragraph [ref=e66]: Noch keine Maßnahme vorhanden.
    - region "Karte" [ref=e68]:
      - region "Map" [ref=e69]
      - generic:
        - generic: 500 m
        - group [ref=e71]:
          - generic "Toggle attribution" [ref=e72] [cursor=pointer]
          - generic [ref=e73]: "Quellen: | Demo-Daten"
    - complementary [ref=e74]:
      - heading "Teilgebiet" [level=2] [ref=e75]
      - paragraph [ref=e76]: Tippen oder klicken Sie auf ein Teilgebiet, um Details zu sehen.
      - generic [ref=e77]:
        - heading "Regen auslösen" [level=2] [ref=e78]
        - generic [ref=e79]:
          - text: Regenereignis
          - combobox "Regenereignis" [ref=e80]:
            - option "20-jährlich, 18 h" [selected]
            - option "20-jährlich, 4 h"
            - option "100-jährlich, 4 h"
        - button "Regen" [ref=e81]
        - paragraph [ref=e82]: 69,9 mm · 18 h
```

# Test source

```ts
  1  | import { readFileSync } from 'node:fs';
  2  | import { expect, test } from '@playwright/test';
  3  | 
  4  | const blankPng = readFileSync(new URL('../public/data/demo/hillshade.png', import.meta.url));
  5  | 
  6  | test('renders production manifest layers without map load errors', async ({ page }) => {
  7  |   await page.route('https://sgx.geodatenzentrum.de/**', async (route) => {
  8  |     await route.fulfill({
  9  |       status: 200,
  10 |       contentType: 'image/png',
  11 |       body: blankPng,
  12 |     });
  13 |   });
  14 | 
  15 |   await page.goto('/SchwammSpiel/', { waitUntil: 'domcontentloaded' });
  16 | 
  17 |   await page.waitForFunction(() => {
  18 |     const map = (window as Window & { __map?: { loaded(): boolean } }).__map;
  19 |     return Boolean(map?.loaded());
  20 |   });
  21 | 
  22 |   const state = await page.evaluate(async () => {
  23 |     const { __map: map, __mapErrors = [] } = window as Window & {
  24 |       __map?: {
  25 |         getCenter(): { lng: number; lat: number };
  26 |         getLayer(id: string): unknown;
  27 |         loaded(): boolean;
  28 |         project(point: { lng: number; lat: number }): { x: number; y: number };
  29 |         queryRenderedFeatures(point: { x: number; y: number }): Array<{ layer: { id: string } }>;
  30 |         querySourceFeatures(sourceId: string): unknown[];
  31 |       };
  32 |       __mapErrors?: Array<{ message: string; sourceId?: string }>;
  33 |     };
  34 |     if (!map) {
  35 |       return null;
  36 |     }
  37 | 
  38 |     const manifest = (await fetch('/SchwammSpiel/data/demo/manifest.json').then(async (response) => {
  39 |       return (await response.json()) as {
  40 |         layers: Array<{ id: string; type: string }>;
  41 |       };
  42 |     })) as { layers: Array<{ id: string; type: string }> };
  43 |     const manifestLayerIds = manifest.layers
  44 |       .filter((layer) => layer.type !== 'vector-style')
  45 |       .map((layer) => layer.id);
  46 |     const missingLayerIds = manifestLayerIds.filter((layerId) => !map.getLayer(`catchment-layer-${layerId}`));
  47 |     const renderedLayerIds = map
  48 |       .queryRenderedFeatures(map.project(map.getCenter()))
  49 |       .map((feature) => feature.layer.id);
  50 | 
  51 |     return {
  52 |       missingLayerIds,
  53 |       renderedLayerIds,
  54 |       subcatchmentFeatureCount: map.querySourceFeatures('catchment-source-subcatchments').length,
  55 |       errors: __mapErrors,
  56 |     };
  57 |   });
  58 | 
  59 |   expect(state).not.toBeNull();
  60 |   expect(state?.missingLayerIds).toEqual([]);
> 61 |   expect(state?.subcatchmentFeatureCount).toBe(3);
     |                                           ^ Error: expect(received).toBe(expected) // Object.is equality
  62 |   expect(state?.renderedLayerIds).toContain('catchment-layer-subcatchments');
  63 |   expect(state?.errors).toEqual([]);
  64 | });
  65 | 
```