from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

from app import load_demo_batch_summary


class DemoBatchSummaryTest(unittest.TestCase):
    def test_load_demo_batch_summary_combines_summary_and_csv_distribution(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary_path = root / "summary.json"
            csv_path = root / "results.csv"
            summary_path.write_text(
                json.dumps(
                    {
                        "total": 3,
                        "ok": 3,
                        "match": 2,
                        "by_expected_decade": {"10대": {"ok": 1}, "50+": {"ok": 2}},
                        "by_gender": {"female": {"ok": 2}, "male": {"ok": 1}},
                    }
                ),
                encoding="utf-8",
            )
            with csv_path.open("w", encoding="utf-8", newline="") as fp:
                writer = csv.DictWriter(fp, fieldnames=["status", "target_age_group", "gender_prompt", "predicted_decade"])
                writer.writeheader()
                writer.writerow({"status": "ok", "target_age_group": "10대", "gender_prompt": "female", "predicted_decade": "20대"})
                writer.writerow({"status": "ok", "target_age_group": "50+", "gender_prompt": "male", "predicted_decade": "50대"})
                writer.writerow({"status": "ok", "target_age_group": "50+", "gender_prompt": "female", "predicted_decade": "80대"})

            loaded = load_demo_batch_summary(summary_path, csv_path)

        self.assertTrue(loaded["available"])
        self.assertEqual(loaded["total"], 3)
        self.assertEqual(loaded["ok"], 3)
        self.assertEqual(loaded["match"], 2)
        self.assertEqual(loaded["evaluation_label"], "metadata_proxy")
        self.assertEqual(loaded["target_distribution"], {"10대": 1, "50+": 2})
        self.assertEqual(loaded["gender_distribution"], {"female": 2, "male": 1})
        self.assertEqual(loaded["predicted_distribution"], {"20대": 1, "50대": 1, "80대": 1})

    def test_load_demo_batch_summary_understands_fairspeech_validation_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary_path = root / "fairspeech_eval_summary.json"
            csv_path = root / "fairspeech_eval.csv"
            summary_path.write_text(
                json.dumps(
                    {
                        "total": 2,
                        "ok": 2,
                        "match": 1,
                        "evaluation_label": "real_recording_demographic_label",
                        "note": "real validation",
                        "by_expected_age_bin": {"18-22": {"ok": 1}, "46-65": {"ok": 1}},
                        "by_gender": {"female": {"ok": 1}, "male": {"ok": 1}},
                    }
                ),
                encoding="utf-8",
            )
            with csv_path.open("w", encoding="utf-8", newline="") as fp:
                writer = csv.DictWriter(fp, fieldnames=["status", "target_age_bin", "gender", "predicted_age_bin"])
                writer.writeheader()
                writer.writerow({"status": "ok", "target_age_bin": "18-22", "gender": "female", "predicted_age_bin": "23-30"})
                writer.writerow({"status": "ok", "target_age_bin": "46-65", "gender": "male", "predicted_age_bin": "46-65"})

            loaded = load_demo_batch_summary(summary_path, csv_path)

        self.assertEqual(loaded["evaluation_label"], "real_recording_demographic_label")
        self.assertEqual(loaded["note"], "real validation")
        self.assertEqual(loaded["target_distribution"], {"18-22": 1, "46-65": 1})
        self.assertEqual(loaded["gender_distribution"], {"female": 1, "male": 1})
        self.assertEqual(loaded["predicted_distribution"], {"23-30": 1, "46-65": 1})

    def test_load_demo_batch_summary_reports_unavailable_when_files_missing(self) -> None:
        loaded = load_demo_batch_summary(Path("/missing/summary.json"), Path("/missing/results.csv"))

        self.assertFalse(loaded["available"])


if __name__ == "__main__":
    unittest.main()
