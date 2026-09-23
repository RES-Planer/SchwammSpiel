# Datenpipeline: QGIS-Rohdaten → Web-Daten

Dieses Dokument beschreibt die Aufbereitung mit `tools/prepare_catchment.py`.

## Ziel

Aus QGIS-Rohdaten unter `raw/<gebiet>/` werden Web-Daten unter
`apps/web/public/data/<gebiet>/` erzeugt:

- `dem_2m_cog.tif`
- `tiles/hillshade/{z}/{x}/{y}.png` (Zoom 12–17)
- `subcatchments.geojson`
- `flow_paths.geojson`
- `sinks.geojson`
- `cn_zones.geojson`
- `parcels.geojson`
- `catchment.json`
- `manifest.json`
- optional `warnings.txt`

## Eingabestruktur (`raw/<gebiet>/`)

Erwartete Daten (Shapefile oder GPKG je Ebene):

- DEM-Kacheln: `dem/**/*.tif` (alternativ `dem_tiles/**/*.tif`)
- Teilgebiete: `subcatchments/*.shp` oder `teilgebiete/*.shp`
- Landnutzung (ALKIS-TN): `landuse/*.shp` oder `alkis_tn/*.shp`
- Hydrologische Bodengruppen: `soil_groups/*.shp` oder `hbg/*.shp`
- Flurstücke: `parcels/*.shp` oder `flurstuecke/*.shp`
- optional Gebäude: `buildings/*.shp` oder `hausumringe/*.shp`
- optional Maßnahmen (Masterarbeit): `measures/*.shp`

Zusätzlich wird `data/hydrology_tables.json` für CN-Werte genutzt.

## Ablauf (entsprechend Issue-Anforderung)

1. DEM-Kacheln verschmelzen.
2. Auf Einzugsgebiet + 200 m Puffer zuschneiden.
3. Gebäude um 10 m puffern und Höhen um +10 m anheben.
4. Senken füllen (Wang & Liu, WhiteboxTools).
5. D8-Fließrichtung und D8-Flussakkumulation berechnen.
6. Fließwege ab Schwellwert vektorisieren.
7. Senken als Polygone aus Tiefe > 0,2 m und Fläche > 2,5 m² ableiten.
8. Landnutzung × Bodengruppe verschneiden und CN aus
   `data/hydrology_tables.json` zuweisen:
   - `cn_low_seasonality_by_soil_group`
   - `cn_monthly_soil_group_C` (März)
9. Teilgebietskennwerte ableiten:
   - Fläche [ha]
   - mittlere Neigung [°]
   - längster Fließweg als Abschnittsfolge
     (`sheet` < 0,5 ha, `rill` < 5 ha, sonst `hollow`; `sheet` max. 50 m)
10. Export in EPSG:4326 (vereinfacht), inkl. `catchment.json` und `manifest.json`.

## Aufruf

```bash
python3 /home/runner/work/SchwammSpiel/SchwammSpiel/tools/prepare_catchment.py \
  --catchment goldbach \
  --root /home/runner/work/SchwammSpiel/SchwammSpiel
```

Hilfsparameter (Auszug):

- `--buffer-m` (Default 200)
- `--sink-depth-min-m` (Default 0.2)
- `--sink-area-min-m2` (Default 2.5)
- `--stream-threshold-cells` (Default 1250)
- `--tile-zoom-min` / `--tile-zoom-max` (Default 12 / 17)

## Abhängigkeiten

Python 3.11 sowie:

- `geopandas`
- `rasterio`
- `whitebox`
- `numpy`
- GDAL CLI (`gdal_translate`, `gdal2tiles`) für COG/Tiles

## Hinweise

- Vektordaten müssen in einem projizierten CRS (Meter, z. B. EPSG:25832) vorliegen.
- Wenn `gdal_translate`/`gdal2tiles` fehlen, wird eine Warnung geschrieben.
- LAZ-Eingang (DMR 5G) ist als Pfad vorgesehen (`raw/<gebiet>/dem_laz/`),
  die automatische Konvertierung ist bewusst als `TODO(SPEC)` markiert.
- Lizenz-/Quellenangaben sind im `manifest.json` enthalten
  (DGM1 Bayerische Vermessungsverwaltung, DMR 5G ČÚZK, jeweils CC BY 4.0).
