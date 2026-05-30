from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path

from common import iter_jsonl


def validate_split(path: Path, require_clip: bool) -> tuple[list[dict], Counter]:
    rows = list(iter_jsonl(path))
    labels = Counter(row.get("age_group", "") for row in rows)
    missing = []
    for row in rows:
        key = "clip_path" if require_clip else "audio_path"
        if not row.get(key) or not Path(row[key]).exists():
            missing.append(row.get("id", "<unknown>"))
    if missing:
        preview = ", ".join(missing[:10])
        raise SystemExit(f"{path} has {len(missing)} rows with missing audio files: {preview}")
    return rows, labels


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-dir", default="./data/manifests")
    parser.add_argument("--require-clip", action="store_true")
    parser.add_argument("--min-train", type=int, default=1)
    parser.add_argument("--min-valid", type=int, default=1)
    parser.add_argument("--min-test", type=int, default=1)
    args = parser.parse_args()

    manifest_dir = Path(args.manifest_dir)
    all_rows = {}
    for split in ("train", "valid", "test"):
        path = manifest_dir / f"{split}.jsonl"
        if not path.exists():
            raise SystemExit(f"missing split manifest: {path}")
        rows, labels = validate_split(path, args.require_clip)
        all_rows[split] = rows
        print(f"{split}: rows={len(rows)} labels={dict(labels)}")

    minimums = {"train": args.min_train, "valid": args.min_valid, "test": args.min_test}
    for split, minimum in minimums.items():
        if len(all_rows[split]) < minimum:
            raise SystemExit(f"{split} has {len(all_rows[split])} rows; expected at least {minimum}")

    speaker_splits: dict[str, set[str]] = defaultdict(set)
    for split, rows in all_rows.items():
        for row in rows:
            speaker_id = str(row.get("speaker_id") or row.get("json_path") or row["id"])
            speaker_splits[speaker_id].add(split)
    leaked = {speaker: splits for speaker, splits in speaker_splits.items() if len(splits) > 1}
    if leaked:
        preview = list(leaked.items())[:10]
        raise SystemExit(f"speaker leakage across splits: {preview}")

    print("manifest validation ok")


if __name__ == "__main__":
    main()
