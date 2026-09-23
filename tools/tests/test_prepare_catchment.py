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


if __name__ == '__main__':
    unittest.main()
