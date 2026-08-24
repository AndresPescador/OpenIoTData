from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


MODULE_PATH = Path(__file__).with_name("publish.py")
SPEC = importlib.util.spec_from_file_location("sound_publish", MODULE_PATH)
assert SPEC and SPEC.loader
sound_publish = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sound_publish
SPEC.loader.exec_module(sound_publish)


class SoundAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = sound_publish.Settings(
            source_base_url="http://source",
            target_base_url="http://target",
            dataset_id="dataset-1",
            api_token="secret",
            station_id="station-1",
            latitude=4.7,
            longitude=-74.0,
        )

    def test_maps_measurement_to_flexible_observation(self) -> None:
        result = sound_publish.to_observation(
            self.settings,
            {
                "recorded_at": "2026-08-23T12:00:00Z",
                "station_id": "ST-2",
                "leq_dbfs": -31.4,
                "dominant_frequency": 512,
            },
        )

        self.assertEqual(result["observed_at"], "2026-08-23T12:00:00Z")
        self.assertEqual(result["sensor_id"], "ST-2")
        self.assertEqual(result["location"]["coordinates"], [-74.0, 4.7])
        self.assertEqual(result["data"]["leq_dbfs"], -31.4)
        self.assertNotIn("recorded_at", result["data"])

    def test_idempotency_key_is_stable_and_content_sensitive(self) -> None:
        first = sound_publish.idempotency_key(
            self.settings,
            "2026-08-23T00:00:00Z",
            "2026-08-24T00:00:00Z",
            [{"observed_at": "2026-08-23T12:00:00Z", "data": {"x": 1}}],
        )
        same = sound_publish.idempotency_key(
            self.settings,
            "2026-08-23T00:00:00Z",
            "2026-08-24T00:00:00Z",
            [{"data": {"x": 1}, "observed_at": "2026-08-23T12:00:00Z"}],
        )
        changed = sound_publish.idempotency_key(
            self.settings,
            "2026-08-23T00:00:00Z",
            "2026-08-24T00:00:00Z",
            [{"observed_at": "2026-08-23T12:00:00Z", "data": {"x": 2}}],
        )

        self.assertEqual(first, same)
        self.assertNotEqual(first, changed)

    def test_missing_timestamp_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "marca temporal"):
            sound_publish.to_observation(self.settings, {"leq_dbfs": -42})


if __name__ == "__main__":
    unittest.main()
