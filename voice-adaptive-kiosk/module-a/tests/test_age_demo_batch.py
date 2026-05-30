from __future__ import annotations

import unittest

from collections import Counter

from scripts.age_demo_batch import age_to_decade, build_balanced_plan, expected_match, make_prompt


class AgeDemoBatchTest(unittest.TestCase):
    def test_make_prompt_varies_by_decade_language_gender_and_index(self) -> None:
        first = make_prompt("20대", "en", 0, "female")
        second = make_prompt("20대", "en", 1, "male")
        senior = make_prompt("50+", "en", 0, "female")
        korean = make_prompt("20대", "ko", 0, "female")
        self.assertNotEqual(first, second)
        self.assertIn("20s", first)
        self.assertIn("female", first)
        self.assertIn("50s and older", senior)
        self.assertIn("주세요", korean)

    def test_age_to_decade_maps_continuous_age(self) -> None:
        self.assertEqual(age_to_decade(0), "0대")
        self.assertEqual(age_to_decade(9.9), "0대")
        self.assertEqual(age_to_decade(10), "10대")
        self.assertEqual(age_to_decade(65.24), "60대")
        self.assertEqual(age_to_decade(140), "90대")

    def test_expected_match_uses_exact_decade(self) -> None:
        self.assertTrue(expected_match("60대", "60대"))
        self.assertFalse(expected_match("60대", "50대"))
        self.assertTrue(expected_match("50+", "50대"))
        self.assertTrue(expected_match("50+", "60대"))
        self.assertFalse(expected_match("50+", "40대"))

    def test_build_balanced_plan_spreads_age_and_gender_evenly(self) -> None:
        plan = build_balanced_plan(100)
        self.assertEqual(len(plan), 100)
        by_pair = Counter((item.age_group, item.gender) for item in plan)
        self.assertEqual(len(by_pair), 10)
        self.assertTrue(all(count == 10 for count in by_pair.values()))


if __name__ == "__main__":
    unittest.main()
