from __future__ import annotations

import unittest

from inference.behavioral import score_behavioral


class BehavioralTest(unittest.TestCase):
    def test_senior_broad_age_group_adds_one_assist_level(self) -> None:
        signals = score_behavioral(
            transcript="I would like a latte",
            duration_sec=2.0,
            speech_sec=2.0,
            age_group="senior_adult",
        )

        self.assertEqual(signals.assist_level, 1)

    def test_adult_broad_age_group_does_not_add_senior_assist(self) -> None:
        signals = score_behavioral(
            transcript="I would like a latte",
            duration_sec=2.0,
            speech_sec=2.0,
            age_group="adult",
        )

        self.assertEqual(signals.assist_level, 0)


if __name__ == "__main__":
    unittest.main()
