from __future__ import annotations

import argparse
from pathlib import Path

import soundfile as sf
import torchaudio
from common import iter_jsonl, write_jsonl


def export_clip(row: dict, out_dir: Path, target_sr: int, min_sec: float, max_sec: float) -> dict | None:
    duration = float(row["duration"])
    if duration < min_sec:
        return None
    start = float(row["start"])
    end = min(float(row["end"]), start + max_sec)
    audio_path = Path(row["audio_path"])
    if not audio_path.exists():
        return None

    info = torchaudio.info(str(audio_path))
    sr = int(info.sample_rate)
    frame_offset = max(0, int(start * sr))
    num_frames = max(1, int((end - start) * sr))
    waveform, sr = torchaudio.load(str(audio_path), frame_offset=frame_offset, num_frames=num_frames)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sr != target_sr:
        waveform = torchaudio.functional.resample(waveform, sr, target_sr)

    label = row["age_group"]
    clip_dir = out_dir / label
    clip_dir.mkdir(parents=True, exist_ok=True)
    clip_path = clip_dir / f"{row['id']}.wav"
    sf.write(clip_path, waveform.squeeze(0).numpy(), target_sr)

    new_row = dict(row)
    new_row["clip_path"] = str(clip_path)
    new_row["sample_rate"] = target_sr
    new_row["duration"] = round(float(waveform.shape[1]) / target_sr, 3)
    return new_row


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="./data/manifests/raw_segments.jsonl")
    parser.add_argument("--out-dir", default="./data/clips")
    parser.add_argument("--out-manifest", default="./data/manifests/clips.jsonl")
    parser.add_argument("--target-sr", type=int, default=16000)
    parser.add_argument("--min-sec", type=float, default=1.0)
    parser.add_argument("--max-sec", type=float, default=12.0)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    rows = []
    for idx, row in enumerate(iter_jsonl(Path(args.manifest)), start=1):
        if args.limit and idx > args.limit:
            break
        clip = export_clip(row, out_dir, args.target_sr, args.min_sec, args.max_sec)
        if clip:
            rows.append(clip)
        if idx % 1000 == 0:
            print(f"processed {idx}; clips={len(rows)}")

    write_jsonl(Path(args.out_manifest), rows)
    print(f"wrote {len(rows)} clips to {args.out_manifest}")


if __name__ == "__main__":
    main()
