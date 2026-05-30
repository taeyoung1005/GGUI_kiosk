from __future__ import annotations

import argparse
import hashlib
from collections import Counter
from collections import defaultdict
from pathlib import Path

from common import iter_jsonl, write_jsonl


def speaker_score(speaker_id: str) -> float:
    digest = hashlib.sha1(speaker_id.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def assign_speakers(rows: list[dict], valid_ratio: float, test_ratio: float) -> dict[str, str]:
    speakers_by_label: dict[str, set[str]] = defaultdict(set)
    speaker_majority: dict[str, str] = {}
    for row in rows:
        speaker_id = str(row.get("speaker_id") or row.get("json_path") or row["id"])
        label = str(row["age_group"])
        speakers_by_label[label].add(speaker_id)
        speaker_majority[speaker_id] = label

    assignments: dict[str, str] = {}
    for label, speakers in speakers_by_label.items():
        ordered = sorted(speakers, key=speaker_score)
        n = len(ordered)
        if n == 1:
            assignments[ordered[0]] = "train"
            continue

        test_count = max(1, round(n * test_ratio)) if n >= 3 else 0
        valid_count = max(1, round(n * valid_ratio)) if n - test_count >= 2 else 0
        if test_count + valid_count >= n:
            valid_count = max(0, n - test_count - 1)

        for idx, speaker_id in enumerate(ordered):
            if idx < test_count:
                assignments[speaker_id] = "test"
            elif idx < test_count + valid_count:
                assignments[speaker_id] = "valid"
            else:
                assignments[speaker_id] = "train"

    return assignments


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="./data/manifests/clips.jsonl")
    parser.add_argument("--out-dir", default="./data/manifests")
    parser.add_argument("--valid-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    args = parser.parse_args()

    rows = list(iter_jsonl(Path(args.manifest)))
    assignments = assign_speakers(rows, args.valid_ratio, args.test_ratio)

    splits = {"train": [], "valid": [], "test": []}
    for row in rows:
        speaker_id = str(row.get("speaker_id") or row.get("json_path") or row["id"])
        split = assignments[speaker_id]
        splits[split].append(row)

    out_dir = Path(args.out_dir)
    for split, rows in splits.items():
        write_jsonl(out_dir / f"{split}.jsonl", rows)
        counts = Counter(row["age_group"] for row in rows)
        print(split, len(rows), dict(counts))


if __name__ == "__main__":
    main()
