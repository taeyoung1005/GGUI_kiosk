from __future__ import annotations

import unittest

from pathlib import Path
from unittest import mock

import numpy as np

from inference.age import age_years_to_group, create_age_model, prediction_from_years


class PublicAgeModelTest(unittest.TestCase):
    def test_age_years_are_mapped_to_vox_profile_broad_groups(self) -> None:
        cases = [
            (14.9, "young_adult"),
            (24.0, "young_adult"),
            (30.0, "adult"),
            (49.9, "adult"),
            (60.0, "adult"),
            (60.1, "senior_adult"),
            (88.0, "senior_adult"),
        ]
        for years, expected_group in cases:
            with self.subTest(years=years):
                self.assertEqual(age_years_to_group(years), expected_group)

    def test_prediction_from_years_clamps_range_and_sets_child_probability(self) -> None:
        prediction = prediction_from_years(years=8.0, confidence=0.7)
        self.assertEqual(prediction.group, "young_adult")
        self.assertEqual(prediction.years_est, 8.0)
        self.assertEqual(prediction.confidence, 0.7)
        self.assertEqual(prediction.child_prob, 1.0)

        prediction = prediction_from_years(years=140.0, confidence=1.4)
        self.assertEqual(prediction.group, "senior_adult")
        self.assertEqual(prediction.years_est, 100.0)
        self.assertEqual(prediction.confidence, 1.0)
        self.assertEqual(prediction.child_prob, 0.0)

    def test_prediction_accepts_numpy_scalar(self) -> None:
        prediction = prediction_from_years(np.array([[0.43]], dtype=np.float32) * 100, confidence=0.5)
        self.assertEqual(prediction.group, "adult")
        self.assertAlmostEqual(prediction.years_est or 0, 43.0, places=2)

    def test_public_provider_factory_selects_wavlm_age_sex_model(self) -> None:
        with mock.patch("inference.age.VoxProfileWavLMAgeSexClassifier") as classifier:
            model = create_age_model(provider="wavlm_age_sex", model_path=Path("missing"))
        self.assertIs(model, classifier.return_value)
        classifier.assert_called_once()

    def test_local_fine_tuned_provider_is_not_supported_in_current_demo(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported AGE_MODEL_PROVIDER"):
            create_age_model(provider="local", model_path=Path("missing"))


if __name__ == "__main__":
    unittest.main()
