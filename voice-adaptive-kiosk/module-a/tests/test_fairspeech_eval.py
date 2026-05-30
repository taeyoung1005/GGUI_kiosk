from __future__ import annotations

import unittest

from collections import Counter

from scripts.fairspeech_eval import build_balanced_targets, normalize_age_label, years_to_age_bin


class FairSpeechEvalTest(unittest.TestCase):
    def test_normalize_age_label_accepts_dataset_labels(self) -> None:
        self.assertEqual(normalize_age_label("18 - 22"), "18-22")
        self.assertEqual(normalize_age_label("23-30"), "23-30")
        self.assertEqual(normalize_age_label("31 – 45"), "31-45")
        self.assertEqual(normalize_age_label("46_65"), "46-65")

    def test_years_to_age_bin_maps_model_age_to_fairspeech_bucket(self) -> None:
        cases = [
            (18.0, "18-22"),
            (22.9, "18-22"),
            (23.0, "23-30"),
            (30.9, "23-30"),
            (31.0, "31-45"),
            (45.9, "31-45"),
            (46.0, "46-65"),
            (65.9, "46-65"),
            (66.0, "outside"),
            (17.9, "outside"),
            (None, "unknown"),
        ]
        for years, expected in cases:
            with self.subTest(years=years):
                self.assertEqual(years_to_age_bin(years), expected)

    def test_build_balanced_targets_repeats_every_age_gender_cell(self) -> None:
        targets = build_balanced_targets(["18-22", "23-30"], ["female", "male"], per_cell=3)
        counts = Counter(targets)

        self.assertEqual(len(targets), 12)
        self.assertEqual(counts[("18-22", "female")], 3)
        self.assertEqual(counts[("18-22", "male")], 3)
        self.assertEqual(counts[("23-30", "female")], 3)
        self.assertEqual(counts[("23-30", "male")], 3)


if __name__ == "__main__":
    unittest.main()
