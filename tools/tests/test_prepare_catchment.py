import importlib.util
from pathlib import Path
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / 'tools' / 'prepare_catchment.py'

spec = importlib.util.spec_from_file_location('prepare_catchment', MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec is not None and spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class PrepareCatchmentExportTests(unittest.TestCase):
    def test_reference_cn_uses_gis_value_when_available(self) -> None:
        reference = module._build_reference_cn(78.345, 75.0)
        self.assertEqual(reference['cn'], 78.34)
        self.assertEqual(reference['cn_status'], 'gis-derived')
        self.assertNotIn('cn_warning', reference)

    def test_reference_cn_falls_back_when_missing(self) -> None:
        reference = module._build_reference_cn(None, 75.0)
        self.assertEqual(reference['cn'], 75.0)
        self.assertEqual(reference['cn_status'], 'fallback-default')
        self.assertIn('cn_warning', reference)

    def test_reference_cn_falls_back_for_nan(self) -> None:
        reference = module._build_reference_cn(float('nan'), 75.0)
        self.assertEqual(reference['cn'], 75.0)
        self.assertEqual(reference['cn_status'], 'fallback-default')
        self.assertIn('cn_warning', reference)

    def test_build_catchment_payload_contains_default_events(self) -> None:
        payload = module._build_catchment_payload(
            catchment_id='goldbach',
            catchment_name='Goldbach bei Ebnath',
            mq_ls_km2=15.53,
            subcatchments=[
                {
                    'id': 'tgb-1',
                    'reference': {'cn': 74.1, 'cn_status': 'gis-derived', 'tcH': 1.2},
                    'measureAreas': [{'flowPath': [{'lengthM': 1200.0}]}],
                }
            ],
        )

        self.assertEqual(
            payload['rainEvents'],
            [
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
            ],
        )
        self.assertEqual(payload['id'], 'goldbach')
        self.assertEqual(payload['mqLsKm2'], 15.53)

    def test_subcatchment_record_marks_cn_fallback(self) -> None:
        record = module._build_subcatchment_record(
            sid='tgb-1',
            area_ha=10.0,
            flow_path=[{'type': 'hollow', 'lengthM': 300.0, 'slope': 0.02, 'k': 25.0, 'rHydM': 0.1}],
            default_ia_ratio=0.1,
            default_prf=484,
            default_tc_factor=1.0,
            default_cn=75.0,
            cn_low_avg=None,
            cn_march_avg=81.234,
            slope_deg_mean=5.0,
        )
        self.assertEqual(record['reference']['cn'], 75.0)
        self.assertEqual(record['reference']['tcH'], 0.2)
        self.assertEqual(record['reference']['cn_status'], 'fallback-default')
        self.assertIn('cn_warning', record['reference'])
        self.assertEqual(record['measureAreas'][0]['patches'][0]['cn'], 75.0)
        self.assertEqual(record['meta']['cnMarchC'], 81.23)

    def test_resolve_accumulation_column_prefers_known_names(self) -> None:
        self.assertEqual(module._resolve_accumulation_column(['foo', 'VALUE']), 'VALUE')
        self.assertEqual(module._resolve_accumulation_column(['strm_val', 'value']), 'strm_val')
        self.assertIsNone(module._resolve_accumulation_column(['foo', 'bar']))


if __name__ == '__main__':
    unittest.main()
