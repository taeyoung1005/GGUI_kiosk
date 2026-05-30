from __future__ import annotations

import unittest

from inference.stt import NoopSTT, create_stt


class SttConfigTest(unittest.TestCase):
    def test_none_model_uses_noop_stt(self) -> None:
        self.assertIsInstance(create_stt("none", "cpu", "int8"), NoopSTT)
        self.assertIsInstance(create_stt("noop", "cpu", "int8"), NoopSTT)

    def test_noop_stt_reports_unknown_language(self) -> None:
        self.assertEqual(NoopSTT().transcribe("sample.mp3").language, "unknown")


if __name__ == "__main__":
    unittest.main()
