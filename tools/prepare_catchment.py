#!/usr/bin/env python3
"""Prepare catchment GIS data for SchwammSpiel web assets.

Pipeline (QGIS/raw -> apps/web/public/data/<gebiet>):
- DEM tiles mosaic, clip to subcatchment extent + buffer
- optional building elevation burn (+10 m)
- sink filling (Wang & Liu), D8 flow direction/accumulation
- stream extraction and vectorization
- depression polygons from fill-depth raster
- CN zones from landuse x soil-group overlay
- subcatchment summary + simple flow-path sectioning for catchment.json
- web outputs: COG DEM, hillshade PNG tiles, GeoJSON(4326), manifest.json

The script is intentionally deterministic and file-based to keep reproducibility
for the planned Goldbach and future Czech DMR 5G inputs.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class InputPaths:
    dem_tiles: list[Path]
    subcatchments: Path
    landuse: Path
    soil_groups: Path
    parcels: Path
    buildings: Path | None
    measures: Path | None
    dem_laz: list[Path]


def _require_optional_dependencies() -> tuple[Any, Any, Any, Any, Any, Any, Any]:
    try:
        import geopandas as gpd
        import numpy as np
        import rasterio
        from rasterio import features
        from rasterio.merge import merge
        from rasterio.mask import mask
        from shapely.geometry import box, shape

        return gpd, np, rasterio, features, merge, mask, shape, box
    except ImportError as exc:  # pragma: no cover - runtime environment concern
        raise RuntimeError(
            'Missing GIS dependency. Install Python packages: geopandas rasterio shapely whitebox numpy.'
        ) from exc


def _require_whitebox() -> Any:
    try:
        from whitebox.whitebox_tools import WhiteboxTools

        return WhiteboxTools
    except ImportError as exc:  # pragma: no cover - runtime environment concern
        raise RuntimeError('Missing dependency: whitebox') from exc


def _find_one(raw_dir: Path, candidates: Iterable[str], required: bool = True) -> Path | None:
    for candidate in candidates:
        for path in sorted(raw_dir.glob(candidate)):
            if path.is_file():
                return path
    if required:
        tried = ', '.join(candidates)
        raise FileNotFoundError(f'Could not find required input in {raw_dir}: {tried}')
    return None


def discover_inputs(raw_dir: Path) -> InputPaths:
    dem_tile_patterns = [
        'dem/**/*.tif',
        'dem/**/*.tiff',
        'dem_tiles/**/*.tif',
        'dem_tiles/**/*.tiff',
        'dem/*.tif',
        'dem/*.tiff',
        '*.tif',
        '*.tiff',
    ]
    dem_tiles = sorted({p for pattern in dem_tile_patterns for p in raw_dir.glob(pattern) if p.is_file()})
    dem_laz = sorted({p for pattern in ['dem_laz/**/*.laz', 'dem_laz/*.laz'] for p in raw_dir.glob(pattern) if p.is_file()})

    subcatchments = _find_one(
        raw_dir,
        ['subcatchments/*.shp', 'teilgebiete/*.shp', 'subcatchments.gpkg', 'teilgebiete.gpkg'],
        required=True,
    )
    landuse = _find_one(raw_dir, ['landuse/*.shp', 'alkis_tn/*.shp', 'landuse.gpkg'], required=True)
    soil_groups = _find_one(raw_dir, ['soil_groups/*.shp', 'hbg/*.shp', 'soil_groups.gpkg'], required=True)
    parcels = _find_one(raw_dir, ['parcels/*.shp', 'flurstuecke/*.shp', 'parcels.gpkg'], required=True)
    buildings = _find_one(raw_dir, ['buildings/*.shp', 'hausumringe/*.shp', 'buildings.gpkg'], required=False)
    measures = _find_one(raw_dir, ['measures/*.shp', 'master_thesis_measures/*.shp', 'measures.gpkg'], required=False)

    if not dem_tiles and not dem_laz:
        raise FileNotFoundError(
            f'No DEM raster tiles (*.tif/*.tiff) and no LAZ tiles found in {raw_dir}. '
            'Expected raw/<gebiet>/dem/ or raw/<gebiet>/dem_laz/.'
        )

    return InputPaths(
        dem_tiles=list(dem_tiles),
        dem_laz=list(dem_laz),
        subcatchments=subcatchments,
        landuse=landuse,
        soil_groups=soil_groups,
        parcels=parcels,
        buildings=buildings,
        measures=measures,
    )


def maybe_convert_laz_to_dem(inputs: InputPaths, work_dir: Path) -> list[Path]:
    if inputs.dem_tiles:
        return inputs.dem_tiles

    if not inputs.dem_laz:
        raise RuntimeError('No DEM source available after discovery.')

    raise RuntimeError(
        'LAZ input detected (DMR 5G path is supported by design), but direct conversion is not enabled yet. '
        'Please pre-rasterize LAZ to 2 m GeoTIFF tiles in raw/<gebiet>/dem/. '
        'TODO(SPEC): lock final DMR 5G conversion parameters and enable automated conversion.'
    )


def _ensure_projected(gdf: Any) -> None:
    if gdf.crs is None:
        raise ValueError('Input vector data has no CRS. A projected CRS (e.g. EPSG:25832) is required.')
    if bool(getattr(gdf.crs, 'is_geographic', False)):
        raise ValueError('Input vector data must be projected (meters), not geographic degrees.')


def _prefer_column(columns: list[str], options: list[str]) -> str | None:
    lowered = {c.lower(): c for c in columns}
    for option in options:
        if option.lower() in lowered:
            return lowered[option.lower()]
    return None


def _mean_for_entry(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, list) and value:
        numbers = [float(v) for v in value if isinstance(v, (int, float))]
        if numbers:
            return float(sum(numbers) / len(numbers))
    return None


def _warn_unknown_formulas(tables: dict[str, Any], sink: list[str]) -> None:
    adjustments = tables.get('soil_group_from_C', {})
    for group, payload in adjustments.items():
        formula = payload.get('formula') if isinstance(payload, dict) else None
        status = payload.get('status') if isinstance(payload, dict) else None
        if formula is None or (isinstance(status, str) and any(tag in status.upper() for tag in ('UNBEKANNT', 'SCHAETZUNG'))):
            sink.append(f'WARN(CN table): soil_group_from_C[{group}] formula/status not robust: {status}')


def _build_cn_lookup(tables: dict[str, Any], warnings: list[str]) -> tuple[dict[tuple[str, str], float], dict[str, float]]:
    low = tables.get('cn_low_seasonality_by_soil_group')
    monthly_c = tables.get('cn_monthly_soil_group_C')
    if not isinstance(low, dict) or not isinstance(monthly_c, dict):
        raise ValueError('hydrology_tables.json missing CN lookup sections.')

    low_lookup: dict[tuple[str, str], float] = {}
    for landuse, by_group in low.items():
        if not isinstance(by_group, dict):
            continue
        for group in ('A', 'B', 'C', 'D'):
            value = by_group.get(group)
            if isinstance(value, (int, float)):
                low_lookup[(str(landuse), group)] = float(value)

    march_lookup: dict[str, float] = {}
    for landuse, by_month in monthly_c.items():
        if not isinstance(by_month, dict):
            continue
        march = by_month.get('März')
        if not isinstance(march, (int, float)):
            march = by_month.get('Maerz')
        if isinstance(march, (int, float)):
            march_lookup[str(landuse)] = float(march)

    if not low_lookup:
        raise ValueError('No low-seasonality CN values loaded from hydrology tables.')
    if not march_lookup:
        warnings.append('WARN(CN table): No March CN values found in cn_monthly_soil_group_C.')

    _warn_unknown_formulas(tables, warnings)
    return low_lookup, march_lookup


def _cn_for(landuse: str, soil_group: str, low_lookup: dict[tuple[str, str], float], march_lookup: dict[str, float], warnings: list[str]) -> tuple[float | None, float | None]:
    cn_low = low_lookup.get((landuse, soil_group))
    cn_march = march_lookup.get(landuse)
    if cn_low is None:
        warnings.append(f'WARN(CN lookup): no low-seasonality CN for landuse="{landuse}" soil_group="{soil_group}"')
    if cn_march is None:
        warnings.append(f'WARN(CN lookup): no March CN_C for landuse="{landuse}"')
    return cn_low, cn_march


def _flow_type_for_accumulation_ha(area_ha: float) -> str:
    if area_ha < 0.5:
        return 'sheet'
    if area_ha < 5:
        return 'rill'
    return 'hollow'


def _weighted_mean_ignore_nan(values: Any, weights: Any, np: Any) -> float | None:
    vals = np.asarray(values, dtype='float64')
    w = np.asarray(weights, dtype='float64')
    mask = np.isfinite(vals) & np.isfinite(w) & (w > 0)
    if not mask.any():
        return None
    return float(np.average(vals[mask], weights=w[mask]))


def _get_table_number(
    tables: dict[str, Any], path: list[str], warnings: list[str], fallback: float, label: str
) -> float:
    current: Any = tables
    for key in path:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            warnings.append(
                f'WARN(table): missing {".".join(path)}; using fallback {fallback} for {label}.'
            )
            return fallback
    if isinstance(current, (int, float)):
        return float(current)
    warnings.append(
        f'WARN(table): non-numeric {".".join(path)}={current!r}; using fallback {fallback} for {label}.'
    )
    return fallback


def _get_table_roughness_mean(
    tables: dict[str, Any], path: list[str], warnings: list[str], fallback: float, label: str
) -> float:
    current: Any = tables
    for key in path:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            warnings.append(
                f'WARN(table): missing {".".join(path)}; using fallback {fallback} for {label}.'
            )
            return fallback
    value = _mean_for_entry(current)
    if value is None:
        warnings.append(
            f'WARN(table): non-numeric {".".join(path)}={current!r}; using fallback {fallback} for {label}.'
        )
        return fallback
    return float(value)


def _build_reference_cn(cn_low_avg: float | None, default_cn: float) -> dict[str, Any]:
    if cn_low_avg is None or not math.isfinite(cn_low_avg):
        return {
            'cn': float(default_cn),
            'cn_status': 'fallback-default',
            'cn_warning': 'CN fallback used (missing landuse×soil lookup)',
        }
    return {'cn': round(float(cn_low_avg), 2), 'cn_status': 'gis-derived'}


def _estimate_tc_h(flow_path: list[dict[str, Any]]) -> float:
    return round(max(0.1, sum(float(seg['lengthM']) for seg in flow_path) / 1500.0), 3)


def _default_rain_events() -> list[dict[str, Any]]:
    return [
        {
            'id': 'hq20-18h',
            'name': 'HQ20 18h',
            'pMm': 69.9,
            'durationH': 18,
            'rainShape': 'mittenbetont',
        },
        {
            'id': 'hq20-4h',
            'name': 'HQ20 4h',
            'pMm': 48.8,
            'durationH': 4,
            'rainShape': 'mittenbetont',
        },
    ]


def _build_catchment_payload(
    catchment_id: str, catchment_name: str, mq_ls_km2: float, subcatchments: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        'id': catchment_id,
        'name': catchment_name,
        'mqLsKm2': float(mq_ls_km2),
        'rainEvents': _default_rain_events(),
        'subcatchments': subcatchments,
    }


def _build_subcatchment_record(
    sid: str,
    area_ha: float,
    flow_path: list[dict[str, Any]],
    default_ia_ratio: float,
    default_prf: int,
    default_tc_factor: float,
    default_cn: float,
    cn_low_avg: float | None,
    cn_march_avg: float | None,
    slope_deg_mean: float,
) -> dict[str, Any]:
    reference_cn = _build_reference_cn(cn_low_avg, default_cn)
    reference_cn_value = float(reference_cn['cn'])
    return {
        'id': sid,
        'areaHa': round(float(area_ha), 3),
        'iaRatio': float(default_ia_ratio),
        'prf': int(default_prf),
        'tcFactor': float(default_tc_factor),
        'lagToOutletH': 0,
        'reference': {
            **reference_cn,
            'tcH': _estimate_tc_h(flow_path),
        },
        'measureAreas': [
            {
                'id': f'{sid}-a',
                'areaHa': round(float(area_ha), 3),
                'patches': [
                    {
                        'id': f'{sid}-patch',
                        'areaHa': round(float(area_ha), 3),
                        'cn': reference_cn_value,
                    }
                ],
                'flowPath': [
                    {
                        'type': seg['type'],
                        'lengthM': round(float(seg['lengthM']), 2),
                        'slope': round(float(seg['slope']), 6),
                        'k': round(float(seg['k']), 3),
                        'rHydM': round(float(seg['rHydM']), 4),
                    }
                    for seg in flow_path
                ],
                'lagToParentH': 0,
                'measures': [],
            }
        ],
        'meta': {
            'meanSlopeDeg': round(slope_deg_mean, 3),
            'cnMarchC': round(cn_march_avg, 2)
            if cn_march_avg is not None and math.isfinite(cn_march_avg)
            else None,
        },
    }


def _line_length_m(coords: list[tuple[float, float]]) -> float:
    total = 0.0
    for a, b in zip(coords[:-1], coords[1:]):
        total += math.hypot(b[0] - a[0], b[1] - a[1])
    return total


def _split_sheet_max_50m(segment: dict[str, Any]) -> list[dict[str, Any]]:
    if segment.get('type') != 'sheet' or segment.get('lengthM', 0.0) <= 50.0:
        return [segment]
    count = max(1, math.ceil(segment['lengthM'] / 50.0))
    chunk = segment['lengthM'] / count
    return [{**segment, 'lengthM': chunk} for _ in range(count)]


def run_pipeline(args: argparse.Namespace) -> Path:
    gpd, np, rasterio, features, merge, rio_mask, shape, box = _require_optional_dependencies()
    WhiteboxTools = _require_whitebox()

    root = Path(args.root).resolve()
    raw_dir = (root / args.raw_root / args.catchment).resolve()
    output_dir = (root / args.output_root / args.catchment).resolve()
    tables_path = (root / args.tables).resolve()

    if not raw_dir.exists():
        raise FileNotFoundError(f'Raw input folder not found: {raw_dir}')
    if not tables_path.exists():
        raise FileNotFoundError(f'hydrology_tables.json not found: {tables_path}')

    output_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    tables = json.loads(tables_path.read_text(encoding='utf-8'))
    cn_low_lookup, cn_march_lookup = _build_cn_lookup(tables, warnings)

    inputs = discover_inputs(raw_dir)
    print(f'[prepare] Input directory: {raw_dir}')

    with tempfile.TemporaryDirectory(prefix=f'prepare_{args.catchment}_', dir=args.tmp_dir) as tmp_name:
        tmp = Path(tmp_name)
        dem_tiles = maybe_convert_laz_to_dem(inputs, tmp)

        subcatchments = gpd.read_file(inputs.subcatchments)
        landuse = gpd.read_file(inputs.landuse)
        soil_groups = gpd.read_file(inputs.soil_groups)
        parcels = gpd.read_file(inputs.parcels)
        buildings = gpd.read_file(inputs.buildings) if inputs.buildings else None
        measures = gpd.read_file(inputs.measures) if inputs.measures else None

        for gdf in [subcatchments, landuse, soil_groups, parcels]:
            _ensure_projected(gdf)

        target_crs = subcatchments.crs
        if landuse.crs != target_crs:
            print(f'[prepare] Reprojecting landuse to {target_crs}')
            landuse = landuse.to_crs(target_crs)
        if soil_groups.crs != target_crs:
            print(f'[prepare] Reprojecting soil_groups to {target_crs}')
            soil_groups = soil_groups.to_crs(target_crs)
        if parcels.crs != target_crs:
            print(f'[prepare] Reprojecting parcels to {target_crs}')
            parcels = parcels.to_crs(target_crs)
        if buildings is not None:
            _ensure_projected(buildings)
            if buildings.crs != target_crs:
                buildings = buildings.to_crs(target_crs)
        if measures is not None:
            _ensure_projected(measures)
            if measures.crs != target_crs:
                measures = measures.to_crs(target_crs)

        min_x, min_y, max_x, max_y = subcatchments.total_bounds
        buffered = box(
            min_x - float(args.buffer_m),
            min_y - float(args.buffer_m),
            max_x + float(args.buffer_m),
            max_y + float(args.buffer_m),
        )

        print(f'[prepare] DEM mosaic from {len(dem_tiles)} tile(s)')
        srcs = [rasterio.open(path) for path in dem_tiles]
        try:
            dem_mosaic, dem_transform = merge(srcs)
            dem_meta = srcs[0].meta.copy()
        finally:
            for src in srcs:
                src.close()

        dem_merged = tmp / 'dem_merged.tif'
        dem_meta.update(
            {
                'driver': 'GTiff',
                'height': dem_mosaic.shape[1],
                'width': dem_mosaic.shape[2],
                'transform': dem_transform,
                'count': 1,
                'dtype': str(dem_mosaic.dtype),
                'crs': target_crs,
                'nodata': float(args.nodata),
            }
        )
        with rasterio.open(dem_merged, 'w', **dem_meta) as dst:
            dst.write(dem_mosaic)

        dem_clip = tmp / 'dem_clip.tif'
        with rasterio.open(dem_merged) as src:
            out_image, out_transform = rio_mask(src, [buffered], crop=True, nodata=float(args.nodata))
            out_meta = src.meta.copy()
            out_meta.update(
                {
                    'height': out_image.shape[1],
                    'width': out_image.shape[2],
                    'transform': out_transform,
                    'nodata': float(args.nodata),
                }
            )
            with rasterio.open(dem_clip, 'w', **out_meta) as dst:
                dst.write(out_image)

        dem_burned = tmp / 'dem_buildings_burned.tif'
        with rasterio.open(dem_clip) as src:
            dem = src.read(1)
            if buildings is not None and not buildings.empty:
                print('[prepare] Raising building footprints by +10m (with 10m buffer)')
                building_mask = features.rasterize(
                    ((geom, 1) for geom in buildings.buffer(10.0).geometry if geom is not None and not geom.is_empty),
                    out_shape=dem.shape,
                    transform=src.transform,
                    fill=0,
                    dtype='uint8',
                )
                dem = np.where(building_mask == 1, dem + float(args.building_raise_m), dem)
            meta = src.meta.copy()
            with rasterio.open(dem_burned, 'w', **meta) as dst:
                dst.write(dem, 1)

        wbt = WhiteboxTools()
        wbt.set_working_dir(str(tmp))
        wbt.set_verbose_mode(args.verbose)

        dem_filled = tmp / 'dem_filled.tif'
        flow_dir = tmp / 'flow_dir.tif'
        flow_acc = tmp / 'flow_acc.tif'
        slope_raster = tmp / 'slope_deg.tif'
        streams_raster = tmp / 'streams.tif'
        streams_vector = tmp / 'flow_paths_native.geojson'

        print('[prepare] Whitebox: fill depressions (Wang & Liu), D8 pointer/accumulation, slope')
        wbt.fill_depressions_wang_and_liu(str(dem_burned), str(dem_filled))
        wbt.d8_pointer(str(dem_filled), str(flow_dir), esri_pntr=False)
        wbt.d8_flow_accumulation(str(dem_filled), str(flow_acc), out_type='cells', pntr=False)
        wbt.slope(str(dem_filled), str(slope_raster), units='degrees')

        print(f'[prepare] Extract streams with threshold={args.stream_threshold_cells} cells')
        wbt.extract_streams(str(flow_acc), str(streams_raster), threshold=float(args.stream_threshold_cells))
        wbt.raster_streams_to_vector(str(streams_raster), str(flow_dir), str(streams_vector), esri_pntr=False)

        # depression polygons by depth/area thresholds
        print('[prepare] Derive depression polygons from fill-depth')
        depressions_geojson_native = tmp / 'sinks_native.geojson'
        with rasterio.open(dem_burned) as dem_src, rasterio.open(dem_filled) as fill_src:
            dem_arr = dem_src.read(1)
            fill_arr = fill_src.read(1)
            depth = fill_arr - dem_arr
            mask = depth > float(args.sink_depth_min_m)
            records: list[dict[str, Any]] = []
            for geom, value in features.shapes(depth.astype('float32'), mask=mask, transform=dem_src.transform):
                if value <= float(args.sink_depth_min_m):
                    continue
                poly = shape(geom)
                if poly.is_empty:
                    continue
                if poly.area < float(args.sink_area_min_m2):
                    continue
                records.append({'geometry': poly, 'depthM': float(value), 'areaM2': float(poly.area)})

        if records:
            sinks_native = gpd.GeoDataFrame(records, geometry='geometry', crs=target_crs)
        else:
            sinks_native = gpd.GeoDataFrame(columns=['depthM', 'areaM2', 'geometry'], geometry='geometry', crs=target_crs)
        sinks_native.to_file(depressions_geojson_native, driver='GeoJSON')

        # CN zones: landuse x soil groups
        print('[prepare] Overlay landuse x soil groups and assign CN')
        lu_field = _prefer_column(list(landuse.columns), ['landuse', 'land_use', 'nutzung', 'usage', 'class'])
        sg_field = _prefer_column(list(soil_groups.columns), ['soil_group', 'hbg', 'soil', 'gruppe'])
        if lu_field is None or sg_field is None:
            raise ValueError(
                f'Could not infer fields. landuse columns={list(landuse.columns)}, soil columns={list(soil_groups.columns)}'
            )

        cn_overlay = gpd.overlay(
            landuse[[lu_field, 'geometry']].rename(columns={lu_field: 'landuse'}),
            soil_groups[[sg_field, 'geometry']].rename(columns={sg_field: 'soilGroup'}),
            how='intersection',
            keep_geom_type=True,
        )
        cn_overlay['landuse'] = cn_overlay['landuse'].astype(str)
        cn_overlay['soilGroup'] = cn_overlay['soilGroup'].astype(str).str.upper().str[0]
        cn_overlay['areaHa'] = cn_overlay.geometry.area / 10_000.0

        cn_low_values: list[float | None] = []
        cn_march_values: list[float | None] = []
        for _, row in cn_overlay.iterrows():
            cn_low, cn_march = _cn_for(row['landuse'], row['soilGroup'], cn_low_lookup, cn_march_lookup, warnings)
            cn_low_values.append(cn_low)
            cn_march_values.append(cn_march)
        cn_overlay['cnLowSeasonality'] = cn_low_values
        cn_overlay['cnMarchC'] = cn_march_values

        # Subcatchment-level summaries
        print('[prepare] Compute subcatchment summaries')
        subcatchments = subcatchments.copy()
        sc_id_field = _prefer_column(list(subcatchments.columns), ['id', 'tgb_id', 'name'])
        if sc_id_field is None:
            subcatchments['id'] = [f'tgb-{i + 1}' for i in range(len(subcatchments))]
            sc_id_field = 'id'
        subcatchments['id'] = subcatchments[sc_id_field].astype(str)
        subcatchments['areaHa'] = subcatchments.geometry.area / 10_000.0

        with rasterio.open(slope_raster) as slope_src:
            nodata = slope_src.nodata
            subcatchment_records: list[dict[str, Any]] = []

            streams_native = gpd.read_file(streams_vector)
            if streams_native.crs != target_crs:
                streams_native = streams_native.to_crs(target_crs)
            subcatchment_geoms = subcatchments[['id', 'geometry']].rename(columns={'id': 'scId'})
            cn_by_sc = gpd.overlay(cn_overlay, subcatchment_geoms, how='intersection', keep_geom_type=True)
            streams_by_sc = gpd.overlay(streams_native, subcatchment_geoms, how='intersection', keep_geom_type=True)

            k_sheet = _get_table_roughness_mean(
                tables,
                ['roughness_strickler_sheet_flow', 'values', 'Acker Bedeckung <5 %'],
                warnings,
                fallback=17.0,
                label='sheet roughness',
            )
            k_conc = _get_table_roughness_mean(
                tables,
                ['roughness_strickler_concentrated', 'values', 'Erosionsrinne Acker (kastenfoermig)'],
                warnings,
                fallback=25.0,
                label='concentrated roughness',
            )
            r_sheet = _get_table_number(
                tables,
                ['hydraulic_radius_defaults_m', 'sheet_flow'],
                warnings,
                fallback=0.002,
                label='sheet hydraulic radius',
            )
            r_rill = _get_table_number(
                tables,
                ['hydraulic_radius_defaults_m', 'rills'],
                warnings,
                fallback=0.04,
                label='rill hydraulic radius',
            )
            r_hollow = _get_table_number(
                tables,
                ['hydraulic_radius_defaults_m', 'swale_hollow'],
                warnings,
                fallback=0.1,
                label='hollow hydraulic radius',
            )

            for _, sc in subcatchments.iterrows():
                sid = str(sc['id'])
                geom = sc.geometry
                clipped = rio_mask(slope_src, [geom], crop=True, filled=False)[0][0]
                valid = np.ma.masked_invalid(clipped)
                if nodata is not None:
                    valid = np.ma.masked_where(clipped == nodata, valid)
                slope_deg_mean = float(valid.mean()) if valid.count() > 0 else 0.0

                cn_in_sc = cn_by_sc[cn_by_sc['scId'] == sid]
                if cn_in_sc.empty:
                    cn_low_avg = None
                    cn_march_avg = None
                else:
                    areas = cn_in_sc.geometry.area
                    cn_low_avg = _weighted_mean_ignore_nan(cn_in_sc['cnLowSeasonality'], areas, np)
                    cn_march_avg = _weighted_mean_ignore_nan(cn_in_sc['cnMarchC'], areas, np)

                flow_in_sc = streams_by_sc[streams_by_sc['scId'] == sid].copy()
                if flow_in_sc.empty:
                    flow_path = [
                        {
                            'type': 'hollow',
                            'lengthM': max(50.0, math.sqrt(float(sc['areaHa']) * 10_000.0) * 2),
                            'slope': max(0.001, math.tan(math.radians(max(slope_deg_mean, 0.1)))),
                            'k': k_conc,
                            'rHydM': r_hollow,
                        }
                    ]
                else:
                    flow_in_sc['lengthM'] = flow_in_sc.geometry.length
                    longest = flow_in_sc.sort_values('lengthM', ascending=False).iloc[0]
                    coords = list(longest.geometry.coords)
                    total_length = _line_length_m(coords)
                    slope_value = max(0.001, math.tan(math.radians(max(slope_deg_mean, 0.1))))

                    # simple classification by accumulation threshold at subcatchment outlet share
                    outlet_acc_ha = max(0.01, float(sc['areaHa']))
                    sections = [
                        {
                            'type': _flow_type_for_accumulation_ha(outlet_acc_ha * 0.1),
                            'lengthM': total_length * 0.25,
                            'slope': slope_value,
                            'k': k_sheet,
                            'rHydM': r_sheet,
                        },
                        {
                            'type': _flow_type_for_accumulation_ha(outlet_acc_ha * 0.7),
                            'lengthM': total_length * 0.35,
                            'slope': slope_value,
                            'k': k_conc,
                            'rHydM': r_rill,
                        },
                        {
                            'type': _flow_type_for_accumulation_ha(outlet_acc_ha),
                            'lengthM': total_length * 0.40,
                            'slope': slope_value,
                            'k': k_conc,
                            'rHydM': r_hollow,
                        },
                    ]
                    flow_path = [split for section in sections for split in _split_sheet_max_50m(section) if split['lengthM'] > 0]

                subcatchment_record = _build_subcatchment_record(
                    sid=sid,
                    area_ha=float(sc['areaHa']),
                    flow_path=flow_path,
                    default_ia_ratio=float(args.default_ia_ratio),
                    default_prf=int(args.default_prf),
                    default_tc_factor=float(args.default_tc_factor),
                    default_cn=float(args.default_cn),
                    cn_low_avg=cn_low_avg,
                    cn_march_avg=cn_march_avg,
                    slope_deg_mean=slope_deg_mean,
                )
                subcatchment_records.append(subcatchment_record)

        # Export rasters for web
        dem_cog = output_dir / 'dem_2m_cog.tif'
        hillshade_tif = tmp / 'hillshade.tif'
        hillshade_tiles_dir = output_dir / 'tiles' / 'hillshade'
        hillshade_tiles_dir.mkdir(parents=True, exist_ok=True)

        print('[prepare] Create COG and hillshade tiles')
        wbt.multidirectional_hillshade(str(dem_filled), str(hillshade_tif), altitude=45.0, zfactor=1.0)

        gdal_translate = shutil.which('gdal_translate')
        gdal2tiles = shutil.which('gdal2tiles.py') or shutil.which('gdal2tiles')
        if gdal_translate:
            subprocess.run(
                [
                    gdal_translate,
                    '-of',
                    'COG',
                    '-co',
                    'COMPRESS=DEFLATE',
                    '-co',
                    'PREDICTOR=3',
                    '-co',
                    'OVERVIEWS=IGNORE_EXISTING',
                    str(dem_filled),
                    str(dem_cog),
                ],
                check=True,
            )
        else:
            shutil.copyfile(dem_filled, dem_cog)
            warnings.append('WARN(cog): gdal_translate missing; dem_2m_cog.tif is plain GeoTIFF, not COG.')

        if gdal_translate and gdal2tiles:
            subprocess.run(
                [
                    gdal2tiles,
                    '--zoom',
                    f'{args.tile_zoom_min}-{args.tile_zoom_max}',
                    '--xyz',
                    '--processes',
                    str(args.tile_processes),
                    str(hillshade_tif),
                    str(hillshade_tiles_dir),
                ],
                check=True,
            )
        else:
            warnings.append('WARN(tiles): gdal_translate/gdal2tiles missing; hillshade tiles were not generated.')

        # Reproject vectors to WGS84 and simplify for web size
        web_crs = 'EPSG:4326'
        record_by_id = {record['id']: record for record in subcatchment_records}
        subcatchments_web = subcatchments[['id', 'areaHa', 'geometry']].copy().to_crs(web_crs)
        subcatchments_web['name'] = subcatchments_web['id']
        subcatchments_web['cn'] = subcatchments_web['id'].map(
            lambda sid: record_by_id.get(sid, {}).get('reference', {}).get('cn')
        )
        subcatchments_web['tcH'] = subcatchments_web['id'].map(
            lambda sid: record_by_id.get(sid, {}).get('reference', {}).get('tcH')
        )

        cn_zones_web = cn_overlay[['landuse', 'soilGroup', 'cnLowSeasonality', 'cnMarchC', 'areaHa', 'geometry']].copy().to_crs(web_crs)
        cn_zones_web = cn_zones_web.rename(columns={'cnLowSeasonality': 'cn'})

        streams_web = gpd.read_file(streams_vector).to_crs(web_crs)
        acc_source = None
        for candidate in ('strm_val', 'value'):
            for column in streams_web.columns:
                if column.lower() == candidate:
                    acc_source = column
                    break
            if acc_source is not None:
                break
        if acc_source is not None and acc_source != 'accumulation':
            streams_web = streams_web.rename(columns={acc_source: 'accumulation'})
        if 'accumulation' not in streams_web.columns:
            streams_web['accumulation'] = 1

        sinks_web = sinks_native.to_crs(web_crs)
        parcels_web = parcels[['geometry']].copy().to_crs(web_crs)
        parcels_web['id'] = [f'parcel-{i + 1}' for i in range(len(parcels_web))]

        if measures is not None and not measures.empty:
            measures_web = measures.to_crs(web_crs)
            measures_web.to_file(output_dir / 'measures.geojson', driver='GeoJSON')

        simplify_tolerance_deg = float(args.simplify_tolerance_deg)
        for frame in [subcatchments_web, cn_zones_web, streams_web, sinks_web, parcels_web]:
            frame['geometry'] = frame.geometry.simplify(simplify_tolerance_deg, preserve_topology=True)

        subcatchments_path = output_dir / 'subcatchments.geojson'
        cn_zones_path = output_dir / 'cn_zones.geojson'
        streams_path = output_dir / 'flow_paths.geojson'
        sinks_path = output_dir / 'sinks.geojson'
        parcels_path = output_dir / 'parcels.geojson'

        subcatchments_web.to_file(subcatchments_path, driver='GeoJSON')
        cn_zones_web.to_file(cn_zones_path, driver='GeoJSON')
        streams_web.to_file(streams_path, driver='GeoJSON')
        sinks_web.to_file(sinks_path, driver='GeoJSON')
        parcels_web.to_file(parcels_path, driver='GeoJSON')

        # Keep web files small (<2MB per GeoJSON target)
        for path in [subcatchments_path, cn_zones_path, streams_path, sinks_path, parcels_path]:
            size_mb = path.stat().st_size / (1024 * 1024)
            if size_mb > 2:
                warnings.append(f'WARN(size): {path.name} is {size_mb:.2f} MB (>2 MB target)')

        # catchment.json
        catchment = _build_catchment_payload(
            catchment_id=args.catchment,
            catchment_name=args.catchment_name,
            mq_ls_km2=float(args.default_mq_ls_km2),
            subcatchments=subcatchment_records,
        )

        catchment_path = output_dir / 'catchment.json'
        catchment_path.write_text(json.dumps(catchment, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

        # manifest.json
        bounds = subcatchments_web.total_bounds.tolist()  # [minx,miny,maxx,maxy]
        manifest = {
            'id': args.catchment,
            'name': {'de': args.catchment_name, 'cs': args.catchment_name, 'en': args.catchment_name},
            'bounds': [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
            'layers': [
                {
                    'id': 'hillshade',
                    'name': {'de': 'Schummerung', 'cs': 'Stínovaný reliéf', 'en': 'Hillshade'},
                    'type': 'raster',
                    'layerType': 'raster',
                    'tiles': [f'tiles/hillshade/{{z}}/{{x}}/{{y}}.png'],
                    'tileSize': 256,
                    'visibleByDefault': True,
                    'attribution': 'DGM1: Bayerische Vermessungsverwaltung, CC BY 4.0; DMR 5G: ČÚZK, CC BY 4.0',
                },
                {
                    'id': 'subcatchments',
                    'name': {'de': 'Teilgebiete', 'cs': 'Dílčí povodí', 'en': 'Subcatchments'},
                    'type': 'geojson',
                    'layerType': 'fill',
                    'path': 'subcatchments.geojson',
                    'visibleByDefault': True,
                    'inspectable': True,
                    'attribution': 'QGIS-Aufbereitung aus Projekt-Rohdaten',
                },
                {
                    'id': 'flow-paths',
                    'name': {'de': 'Fließwege', 'cs': 'Odtokové dráhy', 'en': 'Flow paths'},
                    'type': 'geojson',
                    'layerType': 'line',
                    'path': 'flow_paths.geojson',
                    'visibleByDefault': True,
                    'attribution': 'Abgeleitet aus D8-Flussakkumulation',
                },
                {
                    'id': 'sinks',
                    'name': {'de': 'Senken', 'cs': 'Deprese', 'en': 'Depressions'},
                    'type': 'geojson',
                    'layerType': 'fill',
                    'path': 'sinks.geojson',
                    'visibleByDefault': False,
                    'attribution': 'Abgeleitet aus Depressionstiefe (Wang & Liu)',
                },
                {
                    'id': 'cn-zones',
                    'name': {'de': 'Landnutzung × Bodengruppe', 'cs': 'Využití půdy × hydrol. skupina', 'en': 'Land use × soil group'},
                    'type': 'geojson',
                    'layerType': 'fill',
                    'path': 'cn_zones.geojson',
                    'visibleByDefault': False,
                    'attribution': 'ALKIS-TN × HBG, CN nach data/hydrology_tables.json',
                },
                {
                    'id': 'parcels',
                    'name': {'de': 'Flurstücke', 'cs': 'Parcely', 'en': 'Parcels'},
                    'type': 'geojson',
                    'layerType': 'line',
                    'path': 'parcels.geojson',
                    'visibleByDefault': False,
                    'minzoom': 16,
                    'attribution': 'ALKIS/Flurstücksdaten aus QGIS-Export',
                },
            ],
            'pipeline': {
                'bufferM': float(args.buffer_m),
                'sinkDepthMinM': float(args.sink_depth_min_m),
                'sinkAreaMinM2': float(args.sink_area_min_m2),
                'streamThresholdCells': int(args.stream_threshold_cells),
            },
        }
        manifest_path = output_dir / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

        warnings_path = output_dir / 'warnings.txt'
        if warnings:
            warnings_path.write_text('\n'.join(sorted(set(warnings))) + '\n', encoding='utf-8')
            print(f'[prepare] Warnings written: {warnings_path}')
        elif warnings_path.exists():
            warnings_path.unlink()

        print(f'[prepare] Done. Output: {output_dir}')
        return output_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Prepare catchment data from QGIS raw inputs to web assets.')
    parser.add_argument('--catchment', required=True, help='Catchment folder name under raw/, e.g. goldbach')
    parser.add_argument('--catchment-name', default='Goldbach bei Ebnath', help='Human-readable catchment name')
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[1]), help='Repository root directory')
    parser.add_argument('--raw-root', default='raw', help='Raw data root relative to repo root')
    parser.add_argument('--output-root', default='apps/web/public/data', help='Web data output root relative to repo root')
    parser.add_argument('--tables', default='data/hydrology_tables.json', help='Hydrology tables JSON path relative to repo root')
    parser.add_argument('--tmp-dir', default=None, help='Optional temp directory parent')

    parser.add_argument('--buffer-m', type=float, default=200.0, help='Clip buffer around catchment boundary in meters')
    parser.add_argument('--building-raise-m', type=float, default=10.0, help='Elevation raise for building footprint cells')
    parser.add_argument('--sink-depth-min-m', type=float, default=0.2, help='Minimum sink depth for polygon output')
    parser.add_argument('--sink-area-min-m2', type=float, default=2.5, help='Minimum sink area for polygon output')
    parser.add_argument('--stream-threshold-cells', type=int, default=1250, help='D8 accumulation threshold in cells for stream extraction')
    parser.add_argument('--tile-zoom-min', type=int, default=12)
    parser.add_argument('--tile-zoom-max', type=int, default=17)
    parser.add_argument('--tile-processes', type=int, default=2)
    parser.add_argument('--simplify-tolerance-deg', type=float, default=0.00001, help='GeoJSON simplification tolerance in degrees (EPSG:4326)')

    parser.add_argument('--default-cn', type=float, default=75.0)
    parser.add_argument('--default-prf', type=int, default=484)
    parser.add_argument('--default-ia-ratio', type=float, default=0.1)
    parser.add_argument('--default-tc-factor', type=float, default=1.0)
    parser.add_argument('--default-mq-ls-km2', type=float, default=15.53)

    parser.add_argument('--nodata', type=float, default=-9999.0)
    parser.add_argument('--verbose', action='store_true')
    return parser


def main() -> None:
    if sys.version_info < (3, 11):
        raise RuntimeError('tools/prepare_catchment.py requires Python 3.11+')
    parser = build_parser()
    args = parser.parse_args()
    run_pipeline(args)


if __name__ == '__main__':
    main()
