from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ManifestPipelineTest(unittest.TestCase):
    def run_script(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )

    def test_index_parses_aihub_shaped_json_and_split_keeps_speaker_groups(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "raw"
            raw.mkdir()

            for idx, age_group in enumerate(["10대", "20대", "30대", "40대", "50대"]):
                (raw / f"sample_{idx}.wav").write_bytes(b"")
                payload = {
                    "MediaUrl": f"sample_{idx}.wav",
                    "Speakers": [{"SpeakerID": f"spk{idx}", "Agegroup": age_group}],
                    "Dialogs": [
                        {
                            "SpeakerID": f"spk{idx}",
                            "StartTime": "00:00:01.000",
                            "EndTime": "00:00:03.500",
                            "Speakertext": "라떼 하나 주세요",
                        }
                    ],
                }
                (raw / f"sample_{idx}.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            manifest = Path(tmp) / "raw_segments.jsonl"
            splits = Path(tmp) / "splits"
            self.run_script("training/02_index.py", "--data-root", str(raw), "--out", str(manifest))
            self.run_script("training/04_split.py", "--manifest", str(manifest), "--out-dir", str(splits))

            rows = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(rows), 5)
            self.assertEqual({row["age_group"] for row in rows}, {"10대", "20대", "30대", "40대", "50+"})
            self.assertEqual(rows[0]["start"], 1.0)
            self.assertEqual(rows[0]["end"], 3.5)

            split_rows = {}
            for split in ("train", "valid", "test"):
                split_rows[split] = [
                    json.loads(line)
                    for line in (splits / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()
                    if line.strip()
                ]
            self.assertEqual(sum(len(rows) for rows in split_rows.values()), 5)
            seen = {}
            for split, rows_for_split in split_rows.items():
                for row in rows_for_split:
                    speaker_id = row["speaker_id"]
                    self.assertNotIn(speaker_id, seen)
                    seen[speaker_id] = split

            validation = self.run_script(
                "training/validate_manifest.py",
                "--manifest-dir",
                str(splits),
                "--min-valid",
                "0",
                "--min-test",
                "0",
            )
            self.assertIn("manifest validation ok", validation.stdout)


if __name__ == "__main__":
    unittest.main()
