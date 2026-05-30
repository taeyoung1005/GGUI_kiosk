from __future__ import annotations

import unittest

from pathlib import Path
from unittest import mock

import numpy as np

from inference.age import age_years_to_group, create_age_model, prediction_from_years


class PublicAgeModelTest(unittest.TestCase):
    def test_age_years_are_mapped_to_kiosk_age_groups(self) -> None:
        cases = [
            (14.9, "10대"),
            (24.0, "20대"),
            (37.2, "30대"),
            (49.9, "40대"),
            (50.0, "50+"),
            (88.0, "50+"),
        ]
        for years, expected_group in cases:
            with self.subTest(years=years):
                self.assertEqual(age_years_to_group(years), expected_group)

    def test_prediction_from_years_clamps_range_and_sets_child_probability(self) -> None:
        prediction = prediction_from_years(years=8.0, confidence=0.7)
        self.assertEqual(prediction.group, "10대")
        self.assertEqual(prediction.years_est, 8.0)
        self.assertEqual(prediction.confidence, 0.7)
        self.assertEqual(prediction.child_prob, 1.0)

        prediction = prediction_from_years(years=140.0, confidence=1.4)
        self.assertEqual(prediction.group, "50+")
        self.assertEqual(prediction.years_est, 100.0)
        self.assertEqual(prediction.confidence, 1.0)
        self.assertEqual(prediction.child_prob, 0.0)

    def test_prediction_accepts_numpy_scalar(self) -> None:
        prediction = prediction_from_years(np.array([[0.43]], dtype=np.float32) * 100, confidence=0.5)
        self.assertEqual(prediction.group, "40대")
        self.assertAlmostEqual(prediction.years_est or 0, 43.0, places=2)

    def test_public_provider_factory_selects_wavlm_age_sex_model(self) -> None:
        with mock.patch("inference.age.VoxProfileWavLMAgeSexClassifier") as classifier:
            model = create_age_model(provider="wavlm_age_sex", model_path=Path("missing"))
        self.assertIs(model, classifier.return_value)
        classifier.assert_called_once()

    def test_local_provider_factory_falls_back_when_checkpoint_is_missing(self) -> None:
        model = create_age_model(provider="local", model_path=Path("missing"))
        prediction = model.predict(np.zeros(16000, dtype=np.float32), 16000)
        self.assertEqual(prediction.group, "unknown")


if __name__ == "__main__":
    unittest.main()
