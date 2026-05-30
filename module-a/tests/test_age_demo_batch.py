from __future__ import annotations

import unittest

from scripts.age_demo_batch import age_to_decade, expected_match, make_prompt


class AgeDemoBatchTest(unittest.TestCase):
    def test_make_prompt_varies_by_decade_language_gender_and_index(self) -> None:
        first = make_prompt("20대", "en", 0, "female")
        second = make_prompt("20대", "en", 1, "male")
        korean = make_prompt("20대", "ko", 0, "female")
        self.assertNotEqual(first, second)
        self.assertIn("20s", first)
        self.assertIn("female", first)
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


if __name__ == "__main__":
    unittest.main()
