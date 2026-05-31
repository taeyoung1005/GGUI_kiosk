from __future__ import annotations

import unittest

import app as app_module


class NoLegacySttTest(unittest.TestCase):
    def test_audio_upload_analyze_route_is_not_registered(self) -> None:
        paths = {route.path for route in app_module.app.routes}

        self.assertNotIn("/analyze", paths)

    def test_health_does_not_expose_legacy_stt_config(self) -> None:
        payload = app_module.health()

        self.assertNotIn("stt_model", payload)
        self.assertNotIn("stt_language", payload)


if __name__ == "__main__":
    unittest.main()
